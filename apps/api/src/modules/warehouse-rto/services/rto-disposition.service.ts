import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  StockMovementType,
  StockUnitStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { RtoRestockTargetService, type RestockTarget } from './rto-restock-target.service';
import {
  resolveRestockSources,
  type ResolvedRestockLine,
  type RestockSourceResolution,
} from './rto-restock-sources';
import { InboundFreightAmortisationService } from '../../inbound-freight/services/inbound-freight-amortisation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FinalizeRtoItemSummary {
  shipmentItemId: string;
  orderItemId: string;
  disposition: RtoDisposition;
  quantity: number;
  /** RESTOCK only: the RETURN_RESTOCK movement id (null for WRITE_OFF
   *  lines — no movement; and null for RESTOCK lines whose movement-gate
   *  skipped on a retry). */
  movementId: string | null;
  /** Every RETURN_RESTOCK written for the line — more than one when the
   *  units left from more than one (bin, batch). Empty where movementId
   *  is null. */
  movementIds: string[];
}

export interface FinalizeRtoResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  restockedCount: number;
  writtenOffCount: number;
  items: FinalizeRtoItemSummary[];
  /** true ⇒ the gate-2 existence query fired — RETURN_RESTOCK rows
   *  already present for this shipment, so the movement tx was skipped
   *  on this call (recovery from a prior crash-after-movements). */
  movementsAlreadyApplied: boolean;
  /** true ⇒ idempotent no-op (order already RTO_RESTOCKED). */
  alreadyFinalized: boolean;
}

/**
 * Module 8 RTO disposition finalize — Module 9 reverted it to a
 * dispatch-time decrement model (the bug-1 fix), and Model C
 * (2026-09-03) later moved WHEN that decrement fires without touching
 * this finalize logic at all — see the conservation history below.
 *
 * ── qtyOnHand decrements ONCE, before finalize ever runs ───────────────
 * The `DISPATCH_STOCK` matrix side-effect decrements
 * `stock_levels.qtyOnHand` and `fulfill()`s the phase-2 reservation
 * exactly once per shipment — originally at PENDING_DISPATCH →
 * DISPATCHED (Model A), now at PICKED → PACKED (Model C). This service
 * does not care WHICH edge fired it: every RTO order has necessarily
 * passed through it by the time it reaches RTO_RECEIVED, so by finalize
 * time the unit's qtyOnHand was ALREADY decremented and the reservation
 * is ALREADY FULFILLED (no ACTIVE reservation remains — finalize does
 * NOT touch reservations). That decoupling is why Model C required NO
 * changes here.
 *
 * The correct RTO finalize, either model:
 *   - RESTOCK : issue a RETURN_RESTOCK +qty StockMovement — the unit
 *               physically left the building and has now come back; add
 *               it to qtyOnHand. (10 → 8 at pack/dispatch → 10 after
 *               restock.)
 *   - WRITE_OFF: NO movement — the unit left and never returned; the
 *               original decrement stands. (8 stays 8.)
 *
 * NB: this is the ORIGINAL M8-commit-15 design. The M8 follow-on
 * temporarily made it release-based (Model B) because the physical
 * decrement was unimplemented (latent bug-1). Module 9 implemented it
 * at dispatch (Model A), so finalize reverted to this — the two halves
 * were ONE atomic conservation fix (landed together). Model C only
 * moved which matrix edge issues that decrement.
 *
 * ── SAGA (movements-first, transition-last; visible-vs-silent) ─────────
 *   1. Pre-flight: gate 1 (order.status===RTO_RESTOCKED short-circuit),
 *      ORDER_NOT_RTO_READY, RTO_INSPECTION_INCOMPLETE,
 *      RTO_RESTOCK_NEVER_LEFT_STOCK / RTO_RESTOCK_EXCEEDS_STOCK_LEFT
 *      (each RESTOCK line is credited back where the order's PACK_CONFIRM
 *      movements say it left, falling back to the pick hint; a line with
 *      neither never left through us — rto-restock-sources.ts),
 *      RTO_NO_ITEMS, and (R6)
 *      RTO_RESTOCK_WAREHOUSE_MISMATCH when the parcel was physically
 *      received at a warehouse other than the one it shipped from —
 *      see the inline note at that guard for why we refuse instead of
 *      restocking at the receiving warehouse.
 *   2. Gate 2 (movement idempotency, RESTOCK only): existence query on
 *      (shipmentId, type=RETURN_RESTOCK). Present ⇒ skip the movement
 *      loop (crash-after-movements recovery). stock_movements has no
 *      native dedup key — the explicit query IS the gate.
 *   3. RETURN_RESTOCK movements: one runWithRetry((tx) => for each
 *      RESTOCK item: mutation.apply(tx, RETURN_RESTOCK, +qty)) — atomic
 *      (INV-1/INV-6). reasonCode null (RETURN_RESTOCK self-describes;
 *      INV-7 requires reasonCode only for ADJUSTMENT_* / CYCLE_COUNT /
 *      EXPIRY_WRITE_OFF).
 *   4. Authoritative transition RTO_RECEIVED → RTO_RESTOCKED (own tx).
 *
 * Failure ordering: movements committed → transition fails ⇒ order
 * stays RTO_RECEIVED (truthful), retry's gate-2 skips re-application;
 * movements fail ⇒ atomic rollback. The order goes RTO_RESTOCKED
 * regardless of restock/write-off mix.
 */
@Injectable()
export class RtoDispositionService {
  private readonly logger = new Logger(RtoDispositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly mutation: StockMutationService,
    private readonly audit: AuditLogService,
    private readonly units: StockUnitService,
    private readonly restockTargets: RtoRestockTargetService,
    private readonly freightAmortisation: InboundFreightAmortisationService,
  ) {}

  async finalize(
    shipmentId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<FinalizeRtoResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        originWarehouseId: true,
        rtoReceivedWarehouseId: true,
        orderShipments: {
          select: { orderId: true },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
        items: {
          select: {
            id: true,
            orderItemId: true,
            quantity: true,
            rtoCondition: true,
            rtoDisposition: true,
            pickedBinId: true,
            pickedBatchId: true,
            orderItem: {
              select: {
                id: true,
                variantId: true,
                skuCode: true,
                order: { select: { sellerId: true } },
              },
            },
          },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipmentId} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipmentId} not found`,
      });
    }

    // ── GATE 1: idempotency short-circuit on already-finalized.
    // BOTH terminals count: a fully written-off return lands RTO_DAMAGED,
    // and treating only RTO_RESTOCKED as "done" would let a retry try to
    // transition an already-finalised order.
    if (order.status === OrderStatus.RTO_RESTOCKED || order.status === OrderStatus.RTO_DAMAGED) {
      const summary = this.buildItemSummaries(shipment.items, null);
      return {
        shipmentId,
        orderId,
        status: order.status,
        restockedCount: summary.filter((s) => s.disposition === RtoDisposition.RESTOCK).length,
        writtenOffCount: summary.filter((s) => s.disposition === RtoDisposition.WRITE_OFF).length,
        items: summary,
        movementsAlreadyApplied: true,
        alreadyFinalized: true,
      };
    }
    if (order.status !== OrderStatus.RTO_RECEIVED) {
      throw new ConflictException({
        code: 'ORDER_NOT_RTO_READY',
        message: `Order is ${order.status}; RTO finalize requires RTO_RECEIVED`,
      });
    }
    if (shipment.items.length === 0) {
      throw new ConflictException({
        code: 'RTO_NO_ITEMS',
        message: `Shipment ${shipmentId} has no items to finalize`,
      });
    }

    // ── Inspection-completeness check.
    const uninspected = shipment.items.filter(
      (i) => i.rtoCondition === null || i.rtoDisposition === null,
    );
    if (uninspected.length > 0) {
      throw new ConflictException({
        code: 'RTO_INSPECTION_INCOMPLETE',
        message: `${uninspected.length} shipment item(s) have not been inspected`,
        cause: uninspected.map((i) => i.id),
      });
    }

    // Undecided items block the finalize, and that is the point of the
    // disposition existing at all. Finalizing around them would force
    // the same guess the operator declined to make at the bench — and
    // WMS-8 is conservation-critical, so a guess here moves real stock.
    // The goods are safe meanwhile: they sit in RTO_HOLD, which BIN-2
    // keeps out of every availability sum, so nothing undecided sells.
    const undecided = shipment.items.filter(
      (i) => i.rtoDisposition === RtoDisposition.INSPECT_LATER,
    );
    if (undecided.length > 0) {
      throw new ConflictException({
        code: 'RTO_DISPOSITION_UNDECIDED',
        message:
          `${undecided.length} item(s) are still marked for later inspection. ` +
          'Inspect them again and choose restock or write-off before finalizing.',
        cause: undecided.map((i) => i.id),
      });
    }

    const restockItems = shipment.items.filter((i) => i.rtoDisposition === RtoDisposition.RESTOCK);
    const writeOffItems = shipment.items.filter(
      (i) => i.rtoDisposition === RtoDisposition.WRITE_OFF,
    );

    // ── WHERE each RESTOCK line goes back to (2026-09-13).
    //
    // The RETURN_RESTOCK movement targets a concrete (bin, batch), and the
    // authority on that is where the unit LEFT: the order's PACK_CONFIRM
    // movements (DISPATCH for pre-Model-C orders), net of PACK_REVERSED,
    // queried by ORDER — a supersede leaves them on the original shipment
    // (CUR-3). The pick hint is used only when a line has no pack evidence
    // at all; a line with neither never left stock through us and is
    // refused by name. See `rto-restock-sources.ts` for the precedence
    // argument. WRITE_OFF needs no movement, so no source.
    const sourcesByItem = new Map<string, ResolvedRestockLine>();
    if (restockItems.length > 0) {
      const resolution = await this.resolveSources(
        orderId,
        shipment.originWarehouseId,
        restockItems,
      );
      const skuOf = (id: string): string =>
        restockItems.find((i) => i.id === id)?.orderItem.skuCode ?? id;
      if (resolution.neverLeft.length > 0) {
        const skus = resolution.neverLeft.map(skuOf).join(', ');
        throw new ConflictException({
          code: 'RTO_RESTOCK_NEVER_LEFT_STOCK',
          message:
            `${resolution.neverLeft.length} line(s) marked Restock never left our stock (${skus}): ` +
            'no pick location was recorded and no pack movement took them off a shelf. ' +
            'Restocking would add stock that was never taken out — re-inspect them as Write off instead.',
          cause: resolution.neverLeft,
        });
      }
      if (resolution.shortfalls.length > 0) {
        const detail = resolution.shortfalls
          .map((s) => `${skuOf(s.shipmentItemId)}: ${s.quantity} returned, ${s.leftQuantity} left`)
          .join('; ');
        throw new ConflictException({
          code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT',
          message:
            `More units are marked Restock than left our stock for this order (${detail}). ` +
            'Restocking the difference would add stock that was never taken out — ' +
            'check the inspection, and write off what did not leave through us.',
          cause: resolution.shortfalls.map((s) => s.shipmentItemId),
        });
      }
      for (const r of resolution.resolved) sourcesByItem.set(r.shipmentItemId, r);
    }
    const hintDisagreements = [...sourcesByItem.values()]
      .filter((r) => r.hintDisagrees)
      .map((r) => r.shipmentItemId);
    const restockedFromHintOnly = [...sourcesByItem.values()]
      .filter((r) => r.origin === 'PICK_HINT')
      .map((r) => r.shipmentItemId);
    if (hintDisagreements.length > 0) {
      this.logger.warn(
        { shipmentId, orderId, shipmentItemIds: hintDisagreements },
        'RTO finalize: pick hint disagrees with where PACK_CONFIRM took the stock — restocking where it actually left',
      );
    }

    // ── R6/R6b: CROSS-WAREHOUSE RESTOCK.
    //
    // The naive restock target is the item's ORIGINAL pickedBin/Batch,
    // which belong to `originWarehouseId`. When the parcel physically came
    // back somewhere else, crediting that origin bin would book a unit
    // into a warehouse that does not hold it — silent corruption (the
    // pre-R6 behaviour, latent only while Phase 1A ran one warehouse).
    //
    // R6 refused outright. R6b resolves a real target instead:
    // `RtoRestockTargetService` finds-or-creates a CHILD batch at the
    // RECEIVING warehouse that inherits expiry, unit cost and the
    // receipt→freight chain from the original, plus an RTO_HOLD/STORAGE
    // bin there. The goods become sellable where they actually are,
    // without pretending they are somewhere else and without losing FEFO.
    // It still refuses when that warehouse has no bin able to hold
    // returns (RTO_RESTOCK_NO_TARGET_BIN) — that is a missing setup step,
    // not something to guess at.
    //
    // WRITE_OFF-only finalize never reaches this: it emits no movement.
    const restockWarehouseId = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;
    const crossWarehouseRestock =
      restockItems.length > 0 && restockWarehouseId !== shipment.originWarehouseId;

    // Where each restocked line actually landed, so the unit ledger can
    // follow the aggregate rather than assuming the original bin/batch.
    const targetsByItem = new Map<string, RestockTarget>();

    // ── GATE 2: movement-level idempotency, RESTOCK only. RETURN_RESTOCK
    //    is the marker. stock_movements has no native unique constraint;
    //    the explicit existence query IS the gate.
    let movementsAlreadyApplied = false;
    let itemSummaries: FinalizeRtoItemSummary[];
    if (restockItems.length > 0) {
      const existing = await this.prisma.client.stockMovement.findFirst({
        where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
        select: { id: true },
      });
      movementsAlreadyApplied = existing !== null;

      if (!movementsAlreadyApplied) {
        const movementIds = await this.mutation.runWithRetry(async (tx) => {
          // Cleared per attempt: runWithRetry may re-run the whole tx.
          targetsByItem.clear();
          const ids = new Map<string, string[]>();
          for (const item of restockItems) {
            const resolved = sourcesByItem.get(item.id);
            if (resolved === undefined) {
              // Pre-flighted: every RESTOCK line resolved or we refused.
              throw new ConflictException({
                code: 'RTO_RESTOCK_NEVER_LEFT_STOCK',
                message: `item ${item.id} has no restock source`,
              });
            }
            const itemIds: string[] = [];
            // One RETURN_RESTOCK per place the unit(s) left from, so a
            // line picked from two bins goes back as the same split.
            for (const source of resolved.sources) {
              // R6b: resolve the real target (same-warehouse ⇒ the source
              // batch, into RTO_HOLD when there is one; cross-warehouse ⇒
              // a lineage-preserving child batch + a returns bin at the
              // receiving warehouse).
              const target = await this.restockTargets.resolve(tx, {
                sellerId: item.orderItem.order.sellerId,
                variantId: item.orderItem.variantId,
                originWarehouseId: source.warehouseId,
                receivedWarehouseId: restockWarehouseId,
                pickedBinId: source.binId,
                pickedBatchId: source.batchId,
                quantity: source.quantity,
                staffId,
              });
              // The unit ledger follows the LARGEST source (first).
              if (!targetsByItem.has(item.id)) targetsByItem.set(item.id, target);
              const result = await this.mutation.apply(tx, {
                sellerId: item.orderItem.order.sellerId,
                variantId: item.orderItem.variantId,
                warehouseId: target.warehouseId,
                binId: target.binId,
                batchId: target.batchId,
                qtyChange: source.quantity, // +qty — the unit returned
                type: StockMovementType.RETURN_RESTOCK,
                actorType: ActorType.STAFF,
                actorId: staffId,
                // RETURN_RESTOCK self-describes (INV-7 — no reasonCode req).
                reasonCode: null,
                reason: `RTO restock: rtoCondition=${item.rtoCondition ?? 'unknown'}`,
                orderId,
                orderItemId: item.orderItemId,
                shipmentId,
                metadata: {
                  restockSource: resolved.origin,
                  leftFromWarehouseId: source.warehouseId,
                  leftFromBinId: source.binId,
                  leftFromBatchId: source.batchId,
                },
              });
              itemIds.push(result.movementId);
            }
            ids.set(item.id, itemIds);
          }
          return ids;
        });
        itemSummaries = this.buildItemSummaries(shipment.items, movementIds);
      } else {
        itemSummaries = this.buildItemSummaries(shipment.items, null);
      }
    } else {
      itemSummaries = this.buildItemSummaries(shipment.items, null);
    }

    // ── Authoritative transition (its own tx).
    //
    // RTO_DAMAGED when NOTHING came back sellable. Until now finalize
    // landed RTO_RESTOCKED unconditionally, so a parcel where every line
    // was written off reported as restocked — the write-off was visible
    // in stock movements and unit statuses, and invisible in the one
    // field reports read. `RTO_DAMAGED` had an inbound matrix edge, a
    // notification template, a seller webhook and three lines in the
    // damage-rate report, and no code path ever set it: that report
    // could only ever read zero.
    //
    // The test is "nothing restocked", not "something written off" — a
    // mixed parcel that saved even one unit is a restock with losses,
    // and calling it damaged would overstate the damage rate as badly as
    // the old behaviour understated it.
    const nothingRestocked = restockItems.length === 0 && writeOffItems.length > 0;
    const finalStatus = nothingRestocked ? OrderStatus.RTO_DAMAGED : OrderStatus.RTO_RESTOCKED;

    await this.orderWrite.transitionStatus({
      orderId,
      to: finalStatus,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.RTO_RECEIVED,
      reason: `RTO finalize on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    const restockedCount = restockItems.length;
    const writtenOffCount = writeOffItems.length;

    // R4 — settle the serialized units per LINE, mirroring the aggregate
    // decision that just committed: a RESTOCK line's units go back
    // IN_STOCK at the bin+batch the aggregate was credited to; a
    // WRITE_OFF line's units are retired WRITTEN_OFF carrying the
    // inspection condition as the reason (the unit left the building and
    // that original decrement stands — CUR-3).
    // Best-effort + guarded on fromStatus: the aggregate movements and
    // the order transition are the durable facts; a unit-ledger failure
    // must not undo a finalize. Stragglers surface in the discrepancy
    // report, and a re-run moves nothing twice.
    for (const item of restockItems) {
      try {
        await this.prisma.client.$transaction((tx) =>
          this.units.advanceUnitsForShipment(tx, {
            shipmentId,
            shipmentItemId: item.id,
            fromStatus: StockUnitStatus.RTO_RECEIVED,
            toStatus: StockUnitStatus.IN_STOCK,
            gate: 'RTO_RESTOCK',
            actorType: ActorType.STAFF,
            actorId: staffId,
            warehouseId: targetsByItem.get(item.id)?.warehouseId ?? restockWarehouseId,
            binId: targetsByItem.get(item.id)?.binId ?? item.pickedBinId,
            batchId: targetsByItem.get(item.id)?.batchId ?? item.pickedBatchId,
          }),
        );
      } catch (err) {
        this.logger.warn(
          { shipmentId, shipmentItemId: item.id, err: (err as Error).message },
          'RTO finalize: unit restock failed — aggregate restock IS applied; discrepancy report will surface the units',
        );
      }
    }
    // R3 amortisation (founder's call): a written-off unit still owes its
    // share of the inbound freight — that money was genuinely spent
    // carrying the goods into India, and the unit was the seller's
    // property. Compensation for the LOST GOODS themselves is handled
    // separately (manually, or via an R7 damage ticket), which is why this
    // is a freight debit and not a stock credit.
    // Best-effort + gated on one INBOUND_FREIGHT entry per order, so a
    // re-run cannot double-charge; the finalize itself must not fail
    // because a wallet debit did.
    const writeOffSellerId = writeOffItems[0]?.orderItem.order.sellerId;
    if (writeOffSellerId !== undefined) {
      try {
        const charged = await this.prisma.client.$transaction((tx) =>
          this.freightAmortisation.debitForWrittenOffItems(tx, {
            orderId,
            sellerId: writeOffSellerId,
            shipmentItemIds: writeOffItems.map((i) => i.id),
          }),
        );
        if (Number(charged.amountInr) > 0) {
          this.logger.log(
            { orderId, shipmentId, freightChargedInr: charged.amountInr },
            'R3: charged inbound-freight share for written-off units',
          );
        }
      } catch (err) {
        this.logger.warn(
          { orderId, shipmentId, err: (err as Error).message },
          'RTO finalize: inbound-freight debit for written-off units failed — order IS finalized; charge it manually',
        );
      }
    }

    for (const item of writeOffItems) {
      try {
        await this.prisma.client.$transaction((tx) =>
          this.units.advanceUnitsForShipment(tx, {
            shipmentId,
            shipmentItemId: item.id,
            fromStatus: StockUnitStatus.RTO_RECEIVED,
            toStatus: StockUnitStatus.WRITTEN_OFF,
            gate: 'RTO_WRITE_OFF',
            actorType: ActorType.STAFF,
            actorId: staffId,
            writeOffReason: `RTO ${item.rtoCondition ?? 'UNKNOWN'}`,
          }),
        );
      } catch (err) {
        this.logger.warn(
          { shipmentId, shipmentItemId: item.id, err: (err as Error).message },
          'RTO finalize: unit write-off failed — order IS finalized; discrepancy report will surface the units',
        );
      }
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.finalized',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        restockedCount,
        writtenOffCount,
        movementsAlreadyApplied,
        // R6b: a return restocked at a warehouse other than origin is
        // worth seeing in the audit trail — the goods moved buildings.
        crossWarehouseRestock,
        restockWarehouseId,
        originWarehouseId: shipment.originWarehouseId,
        // 2026-09-13: where each restocked line was taken from. A line on
        // the hint alone had no pack evidence; a disagreement means the
        // picker's recorded shelf is not where PACK_CONFIRM took the
        // stock, and the restock followed the movement.
        restockedFromHintOnly,
        hintDisagreements,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentId,
      orderId,
      // The terminal actually written, not a hardcoded one — the caller
      // shows this to the supervisor who just finalised.
      status: finalStatus,
      restockedCount,
      writtenOffCount,
      items: itemSummaries,
      movementsAlreadyApplied,
      alreadyFinalized: false,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * The order's pack evidence, read by ORDER (CUR-3), then matched to the
   * lines by the pure resolver. Read-only and outside any transaction: the
   * ledger is append-only, so a retry computes the same answer.
   */
  private async resolveSources(
    orderId: string,
    originWarehouseId: string,
    restockItems: ReadonlyArray<{
      id: string;
      orderItemId: string;
      quantity: number;
      pickedBinId: string | null;
      pickedBatchId: string | null;
      orderItem: { variantId: string };
    }>,
  ): Promise<RestockSourceResolution> {
    const leftMovements = await this.prisma.client.stockMovement.findMany({
      where: {
        orderId,
        type: { in: [StockMovementType.PACK_CONFIRM, StockMovementType.DISPATCH] },
      },
      select: {
        id: true,
        warehouseId: true,
        binId: true,
        batchId: true,
        qtyChange: true,
        orderItemId: true,
        variantId: true,
      },
    });
    const reversed =
      leftMovements.length === 0
        ? []
        : await this.prisma.client.stockMovement.findMany({
            where: { orderId, type: StockMovementType.PACK_REVERSED },
            select: { metadata: true },
          });
    const reversedMovementIds = new Set(
      reversed
        .map((m) => (m.metadata as { reversesMovementId?: string } | null)?.reversesMovementId)
        .filter((id): id is string => typeof id === 'string'),
    );
    return resolveRestockSources({
      lines: restockItems.map((i) => ({
        shipmentItemId: i.id,
        orderItemId: i.orderItemId,
        variantId: i.orderItem.variantId,
        quantity: i.quantity,
        pickedBinId: i.pickedBinId,
        pickedBatchId: i.pickedBatchId,
      })),
      leftMovements,
      reversedMovementIds,
      originWarehouseId,
    });
  }

  private buildItemSummaries(
    items: ReadonlyArray<{
      id: string;
      orderItemId: string;
      quantity: number;
      rtoDisposition: RtoDisposition | null;
    }>,
    movementIdsByItem: Map<string, string[]> | null,
  ): FinalizeRtoItemSummary[] {
    return items.map((i) => {
      const ids = movementIdsByItem?.get(i.id) ?? [];
      return {
        shipmentItemId: i.id,
        orderItemId: i.orderItemId,
        disposition: i.rtoDisposition ?? RtoDisposition.WRITE_OFF,
        quantity: i.quantity,
        movementId: ids[0] ?? null,
        movementIds: ids,
      };
    });
  }
}
