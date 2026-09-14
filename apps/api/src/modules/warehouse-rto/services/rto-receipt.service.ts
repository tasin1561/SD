import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  RtoDisposition,
  ActorType,
  OrderStatus,
  ShipmentStatus,
  StockMovementType,
  StockUnitStatus,
  SystemIssueKind,
  SystemIssueSeverity,
  WarehouseStatus,
  SellerCapability,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { RtoFeeAccrualService } from '../../seller-wallet-accrual/services/rto-fee-accrual.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { RtoRestockTargetService } from './rto-restock-target.service';
import { resolveRestockSources } from './rto-restock-sources';
import { loadPackEvidence } from './rto-stock-evidence';
import type { ReceiveBookingMetadata } from './rto-held-returns';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * WMS-8e — what the receive did about the returns hold.
 *
 *   BOOKED           units booked into the receiving warehouse's RTO_HOLD
 *   NOTHING_TO_BOOK  no line has pack evidence (never left our stock
 *                    through Skydrop — a seeded / imported parcel)
 *   NO_HOLD_BIN      the warehouse has no RTO_HOLD bin: the receive is
 *                    recorded, nothing is booked, a system issue says so,
 *                    and the parcel finalizes straight to a sellable bin
 *   FAILED           the booking threw; the receive stands, the parcel
 *                    finalizes the same way as NO_HOLD_BIN
 *   SKIPPED          not this call's to book: already received, or another
 *                    call won the receive stamp (it books, or already did)
 */
export type HoldBookingOutcome =
  | 'BOOKED'
  | 'NOTHING_TO_BOOK'
  | 'NO_HOLD_BIN'
  | 'FAILED'
  | 'SKIPPED';

export interface HoldBookingResult {
  readonly outcome: HoldBookingOutcome;
  readonly unitsBooked: number;
  /** Per booked line, the (hold bin, batch) holding most of its units — what
   *  the unit ledger follows. */
  readonly lines: ReadonlyArray<{
    readonly shipmentItemId: string;
    readonly quantity: number;
    readonly binId: string;
    readonly batchId: string;
  }>;
}

const HOLD_SKIPPED: HoldBookingResult = { outcome: 'SKIPPED', unitsBooked: 0, lines: [] };

/** One open issue per warehouse missing a returns hold. */
function holdBinIssueKey(warehouseId: string): string {
  return `rto-hold-bin-missing:${warehouseId}`;
}

export interface ReceiveRtoResult {
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  status: OrderStatus;
  rtoReceivedAt: Date;
  /** R6 — the warehouse the parcel was physically received at. Falls
   *  back to the shipment's origin warehouse when the caller did not
   *  specify one (pre-R6 behavior). */
  rtoReceivedWarehouseId: string;
  /** R6 — true ⇒ received somewhere OTHER than where it shipped from.
   *  RESTOCK finalize is blocked in this state (see
   *  RtoDispositionService restocks it into a lineage-preserving child
   *  batch at THIS warehouse — R6b). */
  crossWarehouse: boolean;
  /** true ⇒ idempotent no-op (already RTO_RECEIVED + stamped). */
  alreadyReceived: boolean;
  /** WMS-8e — whether the returned units were booked into the returns hold. */
  holdBooking: HoldBookingResult;
}

/**
 * Module 8 — RTO receipt (commit 14, WMS-8). Marks the parcel as
 * physically arrived at the warehouse for RTO processing: stamps
 * shipment.rtoReceivedAt + drives the order to RTO_RECEIVED.
 *
 * Saga discipline (mirrors PickExecutionService.complete /
 * PackService.complete): operational stamp FIRST (guarded updateMany
 * idempotent on retry), authoritative transitionStatus LAST. Cross-
 * boundary failure (stamp OK / transition FAIL) leaves a TRUTHFUL
 * intermediate (rtoReceivedAt set, order still RTO_IN_TRANSIT/INITIATED)
 * that converges on retry — the stamp's guard skips re-application and
 * the transition retries cleanly.
 *
 * WMS-8e (2026-09-14): between the stamp and the transition, the call that
 * WON the stamp books each line's units into the receiving warehouse's
 * RTO_HOLD bin — `RETURN_RECEIVE` +qty per (bin, batch) the unit LEFT from
 * (WMS-8c's pack evidence; a cross-warehouse return in its R6b child
 * batch). Received-but-undecided stock is then on the ledger where it
 * physically is, and never sellable (BIN-2). The booking NEVER blocks the
 * receive — the parcel is at the door whatever the ledger says: no hold
 * bin, nothing that left through us, or a failure all record the receive,
 * book nothing, and leave the parcel to finalize the pre-WMS-8e way
 * (straight to a sellable bin), which conserves stock on its own. Only the
 * stamp winner books, so two concurrent receives cannot book twice; a
 * prior `RETURN_RECEIVE` for the shipment is checked as well.
 */
@Injectable()
export class RtoReceiptService {
  private readonly logger = new Logger(RtoReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly audit: AuditLogService,
    private readonly units: StockUnitService,
    private readonly rtoFees: RtoFeeAccrualService,
    private readonly orderCharges: OrderChargesService,
    // The M10 shared primitive: the courier's own scan times (TRK-3).
    private readonly trackingEvents: TrackingEventAppendService,
    // WMS-8e — the receive booking into the returns hold (INV-1).
    private readonly mutation: StockMutationService,
    private readonly restockTargets: RtoRestockTargetService,
    private readonly issues: SystemIssueService,
  ) {}

  /**
   * Receive the RTO parcel by AWB. Canonical AWB is `shipments.awbNumber`
   * (Layer 7; `awb_labels` is the versioned PDF table, separate
   * concern). 404 on missing AWB / shipment / order. 409
   * ORDER_NOT_RTO_RECEIVABLE when the order is not in
   * {RTO_INITIATED, RTO_IN_TRANSIT} — the only inbound matrix edges to
   * RTO_RECEIVED.
   */
  async receive(
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
    receivedWarehouseId?: string,
  ): Promise<ReceiveRtoResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber, deletedAt: null },
      select: {
        id: true,
        awbNumber: true,
        status: true,
        rtoReceivedAt: true,
        originWarehouseId: true,
        rtoReceivedWarehouseId: true,
        orderShipments: {
          // The seller comes through the ORDER — a shipment has none.
          select: { orderId: true, order: { select: { sellerId: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (shipment !== null) {
      // A hold can cover booking returns back in. Offered because an
      // operator occasionally needs it, and it is the one that costs
      // the most: goods physically arrive whether or not we record
      // them, so a blocked return is a carton on the bench with no row
      // behind it. The admin screen says so before it is chosen.
      const sellerId = shipment.orderShipments[0]?.order.sellerId ?? null;
      if (sellerId !== null) {
        await this.restrictions.assertAllowed(sellerId, SellerCapability.RTO_RECEIVE);
      }
    }
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `No shipment found with AWB ${awbNumber}`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipment.id} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipment.id} not found`,
      });
    }

    // R6: validate the receiving warehouse BEFORE any write. An unknown
    // or non-ACTIVE warehouse is a caller error, not something to
    // silently coerce to origin.
    if (receivedWarehouseId !== undefined) {
      const warehouse = await this.prisma.client.warehouse.findFirst({
        where: { id: receivedWarehouseId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!warehouse) {
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: `Warehouse ${receivedWarehouseId} not found`,
        });
      }
      if (warehouse.status !== WarehouseStatus.ACTIVE) {
        throw new ConflictException({
          code: 'WAREHOUSE_NOT_ACTIVE',
          message: `Warehouse ${receivedWarehouseId} is ${warehouse.status}; RTO receipt requires an ACTIVE warehouse`,
        });
      }
    }

    // Idempotent short-circuit: already RTO_RECEIVED + stamped. Reports
    // the ORIGINALLY-recorded receiving warehouse — a re-submit with a
    // different warehouse does NOT rewrite history.
    if (order.status === OrderStatus.RTO_RECEIVED && shipment.rtoReceivedAt !== null) {
      const settled = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;
      return {
        shipmentId: shipment.id,
        orderId,
        awbNumber,
        status: OrderStatus.RTO_RECEIVED,
        rtoReceivedAt: shipment.rtoReceivedAt,
        rtoReceivedWarehouseId: settled,
        crossWarehouse: settled !== shipment.originWarehouseId,
        alreadyReceived: true,
        // Never re-attempted here: a finalize may already be reading the
        // order as RTO_RECEIVED, and a booking landing under it would
        // count the same units twice.
        holdBooking: HOLD_SKIPPED,
      };
    }
    if (order.status !== OrderStatus.RTO_INITIATED && order.status !== OrderStatus.RTO_IN_TRANSIT) {
      throw new ConflictException({
        code: 'ORDER_NOT_RTO_RECEIVABLE',
        message: `Order is ${order.status}; RTO receive requires RTO_INITIATED or RTO_IN_TRANSIT`,
      });
    }

    const now = new Date();
    // 1. OPERATIONAL stamp FIRST (idempotent: a retry after a failed
    //    transition finds rtoReceivedAt already set → count 0, original
    //    timestamp AND original receiving warehouse both preserved).
    //    R6: rtoReceivedWarehouseId rides the SAME guarded write, so the
    //    two can never disagree about which attempt won.
    const stamped = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipment.id,
        rtoReceivedAt: null,
      },
      data: {
        rtoReceivedAt: now,
        ...(receivedWarehouseId === undefined
          ? {}
          : { rtoReceivedWarehouseId: receivedWarehouseId }),
      },
    });
    const wonTheStamp = stamped.count === 1;
    const rtoReceivedAt = wonTheStamp ? now : (shipment.rtoReceivedAt ?? now);
    const effectiveWarehouseId = wonTheStamp
      ? (receivedWarehouseId ?? shipment.originWarehouseId)
      : (shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId);
    const crossWarehouse = effectiveWarehouseId !== shipment.originWarehouseId;

    // 1b. WMS-8e: book the units into the returns hold — AFTER the stamp
    //     (the durable "it is here" fact) and BEFORE the transition, so no
    //     finalize can read the order as RTO_RECEIVED before the booking
    //     exists. Only the stamp winner books; it never throws.
    const holdBooking = wonTheStamp
      ? await this.bookIntoHold({
          shipmentId: shipment.id,
          orderId,
          originWarehouseId: shipment.originWarehouseId,
          warehouseId: effectiveWarehouseId,
          staffId,
        })
      : HOLD_SKIPPED;

    // 2. AUTHORITATIVE transition LAST. expectedFrom uses the order's
    //    actual current status — RTO_INITIATED or RTO_IN_TRANSIT — so
    //    the matrix accepts either path.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.RTO_RECEIVED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: order.status,
      reason: `RTO parcel ${awbNumber} received at warehouse`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    // R6: a cross-warehouse return is audited at MEDIUM, not LOW — it
    // means stock came back somewhere other than where it left, which
    // blocks RESTOCK finalize and needs an ops decision.
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: crossWarehouse ? 'rto.received_cross_warehouse' : 'rto.received',
      entityType: 'shipment',
      entityId: shipment.id,
      severity: crossWarehouse ? 'MEDIUM' : 'LOW',
      metadata: {
        orderId,
        awbNumber,
        priorStatus: order.status,
        shipmentStatus: shipment.status as ShipmentStatus,
        originWarehouseId: shipment.originWarehouseId,
        rtoReceivedWarehouseId: effectiveWarehouseId,
        crossWarehouse,
        holdBooking: holdBooking.outcome,
        unitsBookedIntoHold: holdBooking.unitsBooked,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    // The money. A returned parcel costs the delivery fee PLUS the flat
    // RTO fee (200 + 30 by default), and BOTH are charged here because
    // this is the moment the return became a fact rather than a scan.
    //
    // Best-effort and post-transition, deliberately: the parcel IS in
    // the building, and a wallet failure must not un-receive it. Both
    // halves are idempotent, so a retry or a re-submitted receive
    // converges rather than double-charging.
    try {
      // The delivery half of that 230 is swept from the order's CHARGE
      // ROWS, so an order that never had any is billed the ₹30 return
      // fee and not the ₹200 carriage — silently, because a zero sum
      // reads as "nothing to charge". Ensure they exist first.
      //
      // Pre-tx: persistForOrderSystem owns its own transaction (the M5
      // saga rule). Idempotent, and best-effort — a pricing failure
      // must not stop the return fee being taken.
      try {
        await this.orderCharges.persistForOrderSystem(orderId);
      } catch (chargeErr) {
        this.logger.warn(
          { orderId, err: chargeErr instanceof Error ? chargeErr.message : String(chargeErr) },
          'Could not compute charges before the RTO fee; the delivery leg may go unbilled',
        );
      }

      await this.prisma.client.$transaction((tx) =>
        this.rtoFees.chargeOnReceive(tx, orderId, order.sellerId),
      );
    } catch (err) {
      this.logger.error(
        { orderId, awbNumber, err: err instanceof Error ? err.message : String(err) },
        'RTO fee charge failed after receive — the parcel is received; the debit is not',
      );
    }

    // R4 — the parcel is physically back: walk its serialized units
    // DISPATCHED → RTO_RECEIVED at the warehouse that actually received
    // them (which may differ from origin — R6). Parcel-grained; the AWB
    // is the scanned thing at the returns bench. Best-effort + guarded on
    // fromStatus: the order transition above is the durable fact, and a
    // unit-ledger failure must not un-receive a parcel that is standing
    // in the building. The discrepancy report surfaces stragglers.
    try {
      await this.prisma.client.$transaction(async (tx) => {
        // WMS-8e: a line booked into the returns hold has its units IN
        // STOCK at that hold bin — where the aggregate now says they are,
        // so the STRICT reconciliation (units IN_STOCK vs qtyOnHand) keeps
        // agreeing. Guarded on DISPATCHED like everything else here.
        for (const line of holdBooking.lines) {
          await this.units.advanceUnitsForShipment(tx, {
            shipmentId: shipment.id,
            shipmentItemId: line.shipmentItemId,
            fromStatus: StockUnitStatus.DISPATCHED,
            toStatus: StockUnitStatus.IN_STOCK,
            gate: 'RTO_RECEIVE',
            actorType: ActorType.STAFF,
            actorId: staffId,
            warehouseId: effectiveWarehouseId,
            binId: line.binId,
            batchId: line.batchId,
          });
        }
        // Any line not booked waits as RTO_RECEIVED, as before.
        await this.units.advanceUnitsForShipment(tx, {
          shipmentId: shipment.id,
          fromStatus: StockUnitStatus.DISPATCHED,
          toStatus: StockUnitStatus.RTO_RECEIVED,
          gate: 'RTO_RECEIVE',
          actorType: ActorType.STAFF,
          actorId: staffId,
          warehouseId: effectiveWarehouseId,
        });
      });
    } catch (err) {
      this.logger.warn(
        { shipmentId: shipment.id, awbNumber, err: (err as Error).message },
        'RTO receive: unit ledger advance failed — parcel IS received; discrepancy report will surface the units',
      );
    }

    return {
      shipmentId: shipment.id,
      orderId,
      awbNumber,
      status: OrderStatus.RTO_RECEIVED,
      rtoReceivedAt,
      rtoReceivedWarehouseId: effectiveWarehouseId,
      crossWarehouse,
      alreadyReceived: false,
      holdBooking,
    };
  }

  /**
   * WMS-8e — book a received parcel's units into the returns hold.
   *
   * Per line, what LEFT our stock for it (PACK_CONFIRM / DISPATCH net of
   * PACK_REVERSED, read by order — WMS-8c) is booked back as
   * `RETURN_RECEIVE` +qty into the receiving warehouse's RTO_HOLD bin, one
   * movement per (bin, batch) it left from, in that batch (same warehouse)
   * or its R6b child batch (cross-warehouse). A line with less evidence than
   * its quantity books what left; a line with none — or only a pick hint,
   * which is not evidence the unit ever left — books nothing.
   *
   * Every movement is written in ONE transaction, so the booking exists
   * whole or not at all. NEVER throws: the receive it belongs to must be
   * recorded whatever happens here.
   */
  private async bookIntoHold(input: {
    readonly shipmentId: string;
    readonly orderId: string;
    readonly originWarehouseId: string;
    readonly warehouseId: string;
    readonly staffId: string;
  }): Promise<HoldBookingResult> {
    try {
      // Gate: a booking already on the ledger for this shipment (the
      // explicit existence query IS the gate — stock_movements has no
      // dedup key). The stamp win already serialises receives; this also
      // covers an attempt that booked and then failed at its transition.
      const prior = await this.prisma.client.stockMovement.findFirst({
        where: { shipmentId: input.shipmentId, type: StockMovementType.RETURN_RECEIVE },
        select: { id: true },
      });
      if (prior !== null) return HOLD_SKIPPED;

      const items = await this.prisma.client.shipmentItem.findMany({
        where: { shipmentId: input.shipmentId },
        select: {
          id: true,
          orderItemId: true,
          quantity: true,
          pickedBinId: true,
          pickedBatchId: true,
          orderItem: { select: { variantId: true, order: { select: { sellerId: true } } } },
        },
      });
      const evidence = await loadPackEvidence(this.prisma.client, input.orderId);
      const resolution = resolveRestockSources({
        lines: items.map((i) => ({
          shipmentItemId: i.id,
          orderItemId: i.orderItemId,
          variantId: i.orderItem.variantId,
          quantity: i.quantity,
          pickedBinId: i.pickedBinId,
          pickedBatchId: i.pickedBatchId,
        })),
        leftMovements: evidence.leftMovements,
        reversedMovementIds: evidence.reversedMovementIds,
        originWarehouseId: input.originWarehouseId,
        allowPartial: true,
      });
      const toBook = resolution.resolved.filter(
        (r) => r.origin === 'PACK_MOVEMENT' && r.sources.length > 0,
      );
      if (toBook.length === 0) return { outcome: 'NOTHING_TO_BOOK', unitsBooked: 0, lines: [] };
      const unitsToBook = toBook.reduce(
        (sum, r) => sum + r.sources.reduce((s, src) => s + src.quantity, 0),
        0,
      );
      const byItem = new Map(items.map((i) => [i.id, i]));

      const booked = await this.mutation.runWithRetry(async (tx) => {
        const holdBinId = await this.restockTargets.holdBinId(tx, input.warehouseId);
        if (holdBinId === null) return null;
        const written: Array<{
          shipmentItemId: string;
          quantity: number;
          binId: string;
          batchId: string;
        }> = [];
        for (const r of toBook) {
          const item = byItem.get(r.shipmentItemId);
          if (item === undefined) continue;
          const sellerId = item.orderItem.order.sellerId;
          const variantId = item.orderItem.variantId;
          for (const source of r.sources) {
            const batchId = await this.restockTargets.bookingBatch(tx, {
              sellerId,
              variantId,
              originWarehouseId: source.warehouseId,
              receivedWarehouseId: input.warehouseId,
              pickedBatchId: source.batchId,
              quantity: source.quantity,
              staffId: input.staffId,
            });
            const metadata: ReceiveBookingMetadata = {
              shipmentItemId: r.shipmentItemId,
              leftFromWarehouseId: source.warehouseId,
              leftFromBinId: source.binId,
              leftFromBatchId: source.batchId,
            };
            await this.mutation.apply(tx, {
              sellerId,
              variantId,
              warehouseId: input.warehouseId,
              binId: holdBinId,
              batchId,
              qtyChange: source.quantity, // +qty — the unit is back in the building
              type: StockMovementType.RETURN_RECEIVE,
              actorType: ActorType.STAFF,
              actorId: input.staffId,
              reasonCode: null,
              reason: 'RTO received — held in the returns hold until it is decided',
              orderId: input.orderId,
              orderItemId: item.orderItemId,
              shipmentId: input.shipmentId,
              metadata: { ...metadata },
            });
            written.push({
              shipmentItemId: r.shipmentItemId,
              quantity: source.quantity,
              binId: holdBinId,
              batchId,
            });
          }
        }
        return written;
      });

      if (booked === null) {
        await this.raiseNoHoldBin(input.warehouseId, input.shipmentId, unitsToBook);
        return { outcome: 'NO_HOLD_BIN', unitsBooked: 0, lines: [] };
      }
      await this.issues.resolveByKey(
        holdBinIssueKey(input.warehouseId),
        'A return was booked into a returns hold at this warehouse.',
      );

      // The unit ledger follows the (bin, batch) holding most of a line.
      const largest = new Map<string, (typeof booked)[number]>();
      for (const b of booked) {
        const prior = largest.get(b.shipmentItemId);
        if (prior === undefined || b.quantity > prior.quantity) largest.set(b.shipmentItemId, b);
      }
      return {
        outcome: 'BOOKED',
        unitsBooked: booked.reduce((sum, b) => sum + b.quantity, 0),
        lines: [...largest.values()],
      };
    } catch (err) {
      this.logger.error(
        { shipmentId: input.shipmentId, err: err instanceof Error ? err.message : String(err) },
        'RTO receive: booking into the returns hold failed — the parcel IS received; it will finalize straight to a sellable bin',
      );
      return { outcome: 'FAILED', unitsBooked: 0, lines: [] };
    }
  }

  /**
   * A warehouse that receives returns with no RTO_HOLD bin. The receive is
   * recorded and nothing is lost — finalize still restocks straight to a
   * sellable bin — but the undecided return is off the ledger until then,
   * which is exactly what the owner asked the hold to show. MEDIUM: a setup
   * step is missing and stays missing, nothing is wrong with the parcel.
   * One issue per warehouse, bumped by every parcel, cleared by the first
   * booking that succeeds there.
   */
  private async raiseNoHoldBin(
    warehouseId: string,
    shipmentId: string,
    units: number,
  ): Promise<void> {
    try {
      const warehouse = await this.prisma.client.warehouse.findFirst({
        where: { id: warehouseId },
        select: { code: true },
      });
      const code = warehouse?.code ?? warehouseId;
      await this.issues.raise({
        kind: SystemIssueKind.OTHER,
        severity: SystemIssueSeverity.MEDIUM,
        title: `No returns hold bin at ${code}`,
        detail:
          `A returned parcel was received at ${code}, which has no returns hold (RTO_HOLD) bin, ` +
          'so its units could not be booked in while they wait to be inspected — they are off ' +
          'the stock ledger until the return is finalized. Nothing is lost: finalizing still puts ' +
          'good units back into sellable stock. Create one (Warehouse → Bins, type "Returns hold — ' +
          'not pickable"); this clears itself on the next return received there.',
        source: 'warehouse-rto.receive',
        dedupeKey: holdBinIssueKey(warehouseId),
        metadata: { warehouseId, shipmentId, unitsNotBooked: units },
      });
    } catch (err) {
      this.logger.warn(
        { warehouseId, shipmentId, err: err instanceof Error ? err.message : String(err) },
        'RTO receive: could not raise the missing-hold-bin issue',
      );
    }
  }

  /**
   * Returns sitting on the bench, waiting on somebody.
   *
   * The operator workflow — receive, inspect, finalise — has always
   * existed one shipment at a time, reachable only if you already knew
   * the id. A supervisor had no way to see what was waiting, which is
   * how a carton sits in RTO_HOLD for three weeks: nothing was broken,
   * nobody could see it.
   *
   * Two things qualify. Received but not finalised is the ordinary
   * backlog. Anything still marked INSPECT_LATER is the more
   * interesting one — an operator declined to guess, and until somebody
   * decides those goods are neither sellable nor written off.
   */
  /**
   * The courier says these came back. Nobody has received them.
   *
   * ── THE GAP THIS CLOSES ──────────────────────────────────────────
   * TRK-6 is deliberate: an `RTO_DELIVERED` scan is INFORMATIONAL and
   * does NOT move the order, because a webhook driving `RTO_RECEIVED`
   * would let a spoofed or malformed scan trigger the
   * conservation-critical restock/write-off chain with nobody having
   * seen the goods. Only a person at the bench can say a parcel is
   * back.
   *
   * The cost of that rule was invisibility. `listOpen` selects
   * `rtoReceivedAt: { not: null }` — returns already received and
   * waiting to be finalised — so a parcel the courier had handed back
   * and nobody had received appeared on NO screen and triggered no
   * alert. SD-TEST-524086 sat like that for five days: shipment
   * RTO_DELIVERED, order RTO_IN_TRANSIT, seller told it was still on
   * its way. It was found by a person noticing an order looked wrong,
   * which is the same way TRK-10's gap was found.
   *
   * ── TWO STAGES, ONE QUERY ────────────────────────────────────────
   * `RETURNED` is the courier saying the return leg is finished: these
   * are AT OUR DOOR and somebody must receive them. `ON_THE_WAY` is
   * `RTO_INITIATED` / `RTO_IN_TRANSIT` — still with the courier, and
   * nothing to do yet, but knowing what is coming is the difference
   * between a bench that is expecting six parcels and one that is
   * surprised by them.
   *
   * Deliberately ONE query with a stage on each row rather than two
   * endpoints: the rule for which statuses mean what is the thing worth
   * having in a single place, and two callers would eventually disagree
   * about where `RTO_INITIATED` belongs.
   *
   * `LOST` and `DAMAGED` are in neither. Nothing is coming back, and
   * putting them in a receiving queue asks somebody to scan a parcel
   * that does not exist.
   */
  async listAwaitingReceipt(): Promise<{
    items: Array<{
      shipmentId: string;
      shipmentNumber: string;
      awbNumber: string | null;
      courierCode: string;
      /** RETURNED — at our door, receive it. ON_THE_WAY — still moving. */
      stage: 'RETURNED' | 'ON_THE_WAY';
      /** The courier's own word for where it is, so a bench can tell a
       *  parcel that has only just turned around from one nearly here. */
      shipmentStatus: string;
      orderId: string | null;
      orderNumber: string | null;
      orderStatus: string | null;
      sellerName: string | null;
      /** When the courier's last scan landed — the clock that matters. */
      returnedAt: string | null;
      waitingHours: number;
      itemCount: number;
    }>;
  }> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        status: {
          in: [
            ShipmentStatus.RTO_DELIVERED,
            ShipmentStatus.RTO_IN_TRANSIT,
            ShipmentStatus.RTO_INITIATED,
          ],
        },
        rtoReceivedAt: null,
        // A retired shipment is not a parcel anybody can receive: the
        // replacement carries the story now (CUR-7).
        supersededAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        status: true,
        updatedAt: true,
        items: { select: { id: true } },
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
          select: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                seller: { select: { companyName: true } },
              },
            },
          },
        },
      },
    });

    const scanAt = await this.trackingEvents.reachedStatusAt(
      rows.map((r) => r.id),
      [ShipmentStatus.RTO_DELIVERED, ShipmentStatus.RTO_IN_TRANSIT, ShipmentStatus.RTO_INITIATED],
    );

    const now = Date.now();
    return {
      items: rows.map((r) => {
        const order = r.orderShipments[0]?.order ?? null;
        return {
          shipmentId: r.id,
          shipmentNumber: r.shipmentNumber,
          awbNumber: r.awbNumber,
          courierCode: r.courierCode,
          stage:
            r.status === ShipmentStatus.RTO_DELIVERED
              ? ('RETURNED' as const)
              : ('ON_THE_WAY' as const),
          shipmentStatus: r.status,
          orderId: order?.id ?? null,
          orderNumber: order?.orderNumber ?? null,
          orderStatus: order?.status ?? null,
          sellerName: order?.seller.companyName ?? null,
          // The COURIER'S scan time, not `shipments.updatedAt`. That
          // column is `@updatedAt` and any write to the row resets it,
          // so it reported a parcel that had waited five days as 0h —
          // which is worse than no number, because it looks precise.
          // Falls back to the row's own timestamp only when there is no
          // scan at all (a status set by hand).
          returnedAt: (scanAt.get(r.id) ?? r.updatedAt).toISOString(),
          waitingHours: Math.max(
            0,
            Math.floor((now - (scanAt.get(r.id) ?? r.updatedAt).getTime()) / 3_600_000),
          ),
          itemCount: r.items.length,
        };
      }),
    };
  }

  async listOpen(warehouseId?: string): Promise<{
    items: Array<{
      shipmentId: string;
      shipmentNumber: string;
      awbNumber: string | null;
      orderNumber: string | null;
      sellerName: string | null;
      rtoReceivedAt: string | null;
      itemCount: number;
      undecidedCount: number;
      uninspectedCount: number;
    }>;
  }> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        rtoReceivedAt: { not: null },
        ...(warehouseId === undefined ? {} : { rtoReceivedWarehouseId: warehouseId }),
        // Finalising is what takes a return off this list. The order's
        // status is the authority on that (WMS-9), not a column on the
        // shipment.
        orderShipments: {
          some: {
            order: { status: { notIn: [OrderStatus.RTO_RESTOCKED, OrderStatus.RTO_DAMAGED] } },
          },
        },
      },
      orderBy: { rtoReceivedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        rtoReceivedAt: true,
        items: { select: { rtoDisposition: true, rtoCondition: true } },
        orderShipments: {
          take: 1,
          select: {
            order: {
              select: { orderNumber: true, seller: { select: { companyName: true } } },
            },
          },
        },
      },
    });

    return {
      items: rows.map((r) => ({
        shipmentId: r.id,
        shipmentNumber: r.shipmentNumber,
        awbNumber: r.awbNumber,
        orderNumber: r.orderShipments[0]?.order.orderNumber ?? null,
        sellerName: r.orderShipments[0]?.order.seller?.companyName ?? null,
        rtoReceivedAt: r.rtoReceivedAt?.toISOString() ?? null,
        itemCount: r.items.length,
        undecidedCount: r.items.filter((i) => i.rtoDisposition === RtoDisposition.INSPECT_LATER)
          .length,
        uninspectedCount: r.items.filter(
          (i) => i.rtoCondition === null || i.rtoDisposition === null,
        ).length,
      })),
    };
  }
}
