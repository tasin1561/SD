import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  type Prisma,
  type RtoItemCondition,
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
  type RestockShortfall,
  type RestockSourceResolution,
} from './rto-restock-sources';
import {
  effectiveRows,
  quantitiesByDisposition,
  splitSourcesAcrossRows,
  summarizeRows,
  type InspectionRow,
} from './rto-inspection-rows';
import {
  heldByLine,
  heldQuantity,
  splitHeldAcrossRows,
  writeOffReasonCode,
  type HeldSource,
} from './rto-held-returns';
import { FINALIZE_MOVEMENT_TYPES, loadHeldReturns, loadPackEvidence } from './rto-stock-evidence';
import { InboundFreightAmortisationService } from '../../inbound-freight/services/inbound-freight-amortisation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FinalizeRtoRowSummary {
  quantity: number;
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  /** Every movement that settled this row's units: the TRANSFER_IN that put
   *  a booked unit on a sellable / DAMAGED bin, the ADJUSTMENT_DECREASE that
   *  wrote a booked unit off, or (a line not booked at receive) the
   *  RETURN_RESTOCK that put it back. */
  movementIds: string[];
}

export interface FinalizeRtoItemSummary {
  shipmentItemId: string;
  orderItemId: string;
  /** The LINE summary (WMS-8d): a split line reads as its highest-ranked
   *  disposition — see `summarizeRows`. The truth per unit is `rows`. */
  disposition: RtoDisposition;
  quantity: number;
  /** The first settling movement for the line (null when it wrote none — a
   *  write-off-only line that was never booked, or a retry whose movement
   *  gate skipped). */
  movementId: string | null;
  /** Every settling movement written for the line, across its rows. */
  movementIds: string[];
  /** WMS-8d — the line by quantity; one row for an unsplit line. */
  rows: FinalizeRtoRowSummary[];
}

export interface FinalizeRtoResult {
  shipmentId: string;
  orderId: string;
  status: OrderStatus;
  /** LINES with at least one unit restocked / written off / kept aside. */
  restockedCount: number;
  writtenOffCount: number;
  heldDamagedCount: number;
  /** UNITS per outcome, across every line (WMS-8d). */
  restockedUnits: number;
  writtenOffUnits: number;
  heldDamagedUnits: number;
  items: FinalizeRtoItemSummary[];
  /** true ⇒ the gate-2 existence query fired — finalize movements already
   *  present for this shipment, so the movement tx was skipped on this call
   *  (recovery from a prior crash-after-movements). */
  movementsAlreadyApplied: boolean;
  /** true ⇒ idempotent no-op (order already RTO_RESTOCKED / RTO_DAMAGED). */
  alreadyFinalized: boolean;
}

interface LoadedLine {
  id: string;
  orderItemId: string;
  quantity: number;
  rtoCondition: RtoItemCondition | null;
  rtoDisposition: RtoDisposition | null;
  rtoInspectionNotes: string | null;
  pickedBinId: string | null;
  pickedBatchId: string | null;
  rtoInspections?: InspectionRow[];
  orderItem: {
    id: string;
    variantId: string;
    skuCode: string;
    order: { sellerId: string };
  };
}

interface PlannedLine {
  readonly line: LoadedLine;
  readonly rows: readonly InspectionRow[];
  readonly qty: Readonly<Record<RtoDisposition, number>>;
  /** Units that come back into our stock: RESTOCK + HOLD_DAMAGED. */
  readonly returningQty: number;
  /** WMS-8e — what receive booked into the returns hold for this line;
   *  null when the line was not booked (it finalizes the pre-WMS-8e way). */
  readonly held: readonly HeldSource[] | null;
}

/**
 * RTO disposition finalize (WMS-8, WMS-8c, WMS-8d, WMS-8e).
 *
 * ── qtyOnHand decrements ONCE, before finalize ever runs ───────────────
 * `DISPATCH_STOCK` decrements `stock_levels.qtyOnHand` and `fulfill()`s the
 * phase-2 reservation exactly once per shipment — at PICKED → PACKED since
 * Model C (CUR-3). Every RTO order has passed through it by RTO_RECEIVED,
 * so finalize never touches reservations.
 *
 * ── Booked at RECEIVE, moved at FINALIZE (WMS-8e, 2026-09-14) ──────────
 * `RtoReceiptService.receive` books each line's units into the receiving
 * warehouse's RTO_HOLD bin (`RETURN_RECEIVE` +qty, per (bin, batch) the unit
 * left from). For a line so booked, finalize moves the held units OUT, per
 * inspection row (WMS-8d), as paired TRANSFER_OUT / TRANSFER_IN or an
 * adjustment, all through `StockMutationService` (INV-1):
 *   - RESTOCK      : hold → a SELLABLE bin — FLOOR when bin tracking is off;
 *                    when on, the shelf the unit was picked from if it is in
 *                    this warehouse and still pickable, else FLOOR.
 *                    Sellable at once (BIN-2).
 *   - HOLD_DAMAGED : hold → the DAMAGED bin (`RTO_NO_DAMAGED_BIN` if none).
 *   - WRITE_OFF    : `ADJUSTMENT_DECREASE` out of the hold, reasonCode from
 *                    the condition (INV-7): DAMAGED → DAMAGED_IN_WAREHOUSE,
 *                    MISSING → LOST, GOOD → OTHER. Its inbound-freight share
 *                    is charged for the written-off units, as before.
 *   - INSPECT_LATER: blocks finalize; the units stay in the hold.
 * The units keep the batch they were booked in (a cross-warehouse return's
 * R6b child batch was made at receive).
 *
 * ── A line NOT booked at receive (the pre-WMS-8e path) ─────────────────
 * Received before WMS-8e, received where there was no hold bin, or a line
 * that never left our stock. Detected by the ABSENCE of its receive booking,
 * never by a date. As before, RESTOCK / HOLD_DAMAGED rows are sourced from
 * where the units LEFT (WMS-8c), refused when they never left
 * (`RTO_RESTOCK_NEVER_LEFT_STOCK`) or when more come back than left
 * (`RTO_RESTOCK_EXCEEDS_STOCK_LEFT`), and credited with RETURN_RESTOCK +qty —
 * RESTOCK now into the same SELLABLE destination as a booked line (it used
 * to land in the hold and wait for a putaway), HOLD_DAMAGED into the DAMAGED
 * bin. WRITE_OFF writes nothing: the pack decrement stands.
 *
 * ── SAGA (movements-first, transition-last; visible-vs-silent) ─────────
 *   1. Pre-flight: gate 1 (order already RTO_RESTOCKED / RTO_DAMAGED),
 *      ORDER_NOT_RTO_READY, RTO_NO_ITEMS, RTO_INSPECTION_INCOMPLETE,
 *      RTO_INSPECTION_QUANTITY_MISMATCH, RTO_DISPOSITION_UNDECIDED, and the
 *      source guards above.
 *   2. Gate 2: an existence query for ANY finalize movement on the shipment
 *      (RETURN_RESTOCK, TRANSFER_OUT, ADJUSTMENT_DECREASE — nothing else
 *      writes those with a shipment id). Present ⇒ skip the movement tx
 *      (crash-after-movements recovery). stock_movements has no native
 *      dedup key — the explicit query IS the gate.
 *   3. Every movement of the finalize — booked and unbooked lines alike — in
 *      ONE runWithRetry tx (INV-1/INV-6), so gate 2 sees all or none.
 *   4. Authoritative transition RTO_RECEIVED → RTO_RESTOCKED when any unit
 *      was restocked, else RTO_DAMAGED (own tx).
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
            rtoInspectionNotes: true,
            pickedBinId: true,
            pickedBatchId: true,
            rtoInspections: {
              select: { quantity: true, condition: true, disposition: true, notes: true },
              orderBy: { position: 'asc' },
            },
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

    const inspected: PlannedLine[] = (shipment.items as LoadedLine[]).map((line) => {
      const rows = effectiveRows(line);
      const qty = quantitiesByDisposition(rows);
      return {
        line,
        rows,
        qty,
        returningQty: qty[RtoDisposition.RESTOCK] + qty[RtoDisposition.HOLD_DAMAGED],
        held: null,
      };
    });

    // ── GATE 1: idempotency short-circuit on already-finalized.
    // BOTH terminals count: a fully written-off return lands RTO_DAMAGED,
    // and treating only RTO_RESTOCKED as "done" would let a retry try to
    // transition an already-finalised order.
    if (order.status === OrderStatus.RTO_RESTOCKED || order.status === OrderStatus.RTO_DAMAGED) {
      return {
        shipmentId,
        orderId,
        status: order.status,
        ...this.counts(inspected),
        items: this.buildItemSummaries(inspected, null),
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
    if (inspected.length === 0) {
      throw new ConflictException({
        code: 'RTO_NO_ITEMS',
        message: `Shipment ${shipmentId} has no items to finalize`,
      });
    }

    // ── Inspection-completeness check.
    const uninspected = inspected.filter((l) => l.rows.length === 0);
    if (uninspected.length > 0) {
      throw new ConflictException({
        code: 'RTO_INSPECTION_INCOMPLETE',
        message: `${uninspected.length} shipment item(s) have not been inspected`,
        cause: uninspected.map((l) => l.line.id),
      });
    }
    // The inspection write enforces this; re-asserted because finalize
    // moves real stock per row, and rows that do not cover the line would
    // restock or charge for units nobody decided about.
    const mismatched = inspected.filter(
      (l) => l.rows.reduce((sum, r) => sum + r.quantity, 0) !== l.line.quantity,
    );
    if (mismatched.length > 0) {
      throw new ConflictException({
        code: 'RTO_INSPECTION_QUANTITY_MISMATCH',
        message:
          `${mismatched.length} line(s) have inspection rows that do not add up to the line's ` +
          'quantity. Inspect them again.',
        cause: mismatched.map((l) => l.line.id),
      });
    }

    // Undecided items block the finalize, and that is the point of the
    // disposition existing at all. Finalizing around them would force
    // the same guess the operator declined to make at the bench — and
    // WMS-8 is conservation-critical, so a guess here moves real stock.
    // The goods are safe meanwhile: they sit in RTO_HOLD (booked at
    // receive, WMS-8e), which BIN-2 keeps out of every availability sum.
    const undecided = inspected.filter((l) => l.qty[RtoDisposition.INSPECT_LATER] > 0);
    if (undecided.length > 0) {
      throw new ConflictException({
        code: 'RTO_DISPOSITION_UNDECIDED',
        message:
          `${undecided.length} item(s) are still marked for later inspection. ` +
          'Inspect them again and choose what happens to them before finalizing.',
        cause: undecided.map((l) => l.line.id),
      });
    }

    // ── WMS-8e: which lines receive BOOKED into the returns hold. Detected
    // from the ledger (the line's RETURN_RECEIVE), never from a date.
    const heldBooked = heldByLine(await loadHeldReturns(this.prisma.client, shipmentId));
    const lines: PlannedLine[] = inspected.map((l) => {
      const held = heldBooked.get(l.line.id);
      return { ...l, held: held !== undefined && heldQuantity(held) > 0 ? held : null };
    });
    const bookedLines = lines.filter((l) => l.held !== null);
    const legacyReturning = lines.filter((l) => l.held === null && l.returningQty > 0);
    const writeOffLines = lines.filter((l) => l.qty[RtoDisposition.WRITE_OFF] > 0);
    const skuOf = (id: string): string =>
      lines.find((l) => l.line.id === id)?.line.orderItem.skuCode ?? id;

    // A booked line can put back no more than was booked (= what left).
    const shortfalls: RestockShortfall[] = bookedLines
      .filter((l) => l.returningQty > heldQuantity(l.held ?? []))
      .map((l) => ({
        shipmentItemId: l.line.id,
        quantity: l.returningQty,
        leftQuantity: heldQuantity(l.held ?? []),
      }));

    // ── WHERE each returning unit of an UNBOOKED line comes back from
    // (WMS-8c): the order's pack movements, net of PACK_REVERSED, read by
    // ORDER (CUR-3), resolved for the line's WHOLE returning quantity.
    const sourcesByItem = new Map<string, ResolvedRestockLine>();
    if (legacyReturning.length > 0) {
      const resolution = await this.resolveSources(
        orderId,
        shipment.originWarehouseId,
        legacyReturning,
      );
      if (resolution.neverLeft.length > 0) {
        const skus = resolution.neverLeft.map(skuOf).join(', ');
        throw new ConflictException({
          code: 'RTO_RESTOCK_NEVER_LEFT_STOCK',
          message:
            `${resolution.neverLeft.length} line(s) marked Restock or Keep aside never left our stock (${skus}): ` +
            'no pick location was recorded and no pack movement took them off a shelf. ' +
            'Putting them back would add stock that was never taken out — re-inspect them as Write off instead.',
          cause: resolution.neverLeft,
        });
      }
      shortfalls.push(...resolution.shortfalls);
      for (const r of resolution.resolved) sourcesByItem.set(r.shipmentItemId, r);
    }
    if (shortfalls.length > 0) {
      const detail = shortfalls
        .map((s) => `${skuOf(s.shipmentItemId)}: ${s.quantity} coming back, ${s.leftQuantity} left`)
        .join('; ');
      throw new ConflictException({
        code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT',
        message:
          `More units are marked to come back into stock than left our stock for this order (${detail}). ` +
          'Putting back the difference would add stock that was never taken out — ' +
          'check the inspection, and write off what did not leave through us.',
        cause: shortfalls.map((s) => s.shipmentItemId),
      });
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

    // ── R6/R6b: the goods are in the RECEIVING warehouse. A booked line was
    // booked there; an unbooked one is credited there by
    // `RtoRestockTargetService` (a lineage child batch cross-warehouse).
    const restockWarehouseId = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;
    const crossWarehouseRestock =
      (legacyReturning.length > 0 || bookedLines.length > 0) &&
      restockWarehouseId !== shipment.originWarehouseId;

    // Where each (line, row) actually landed, so the unit ledger can follow
    // the aggregate rather than assuming the original bin/batch.
    const targetsByRow = new Map<string, RestockTarget>();
    // Held units no row claimed (a booking larger than its line — should
    // never happen; left in hold and reported rather than guessed at).
    const unclaimedHeld: Array<{ shipmentItemId: string; quantity: number }> = [];

    // ── GATE 2: movement-level idempotency over every finalize type.
    let movementsAlreadyApplied = false;
    let movementIdsByRow: Map<string, string[]> | null = null;
    if (legacyReturning.length > 0 || bookedLines.length > 0) {
      const existing = await this.prisma.client.stockMovement.findFirst({
        where: { shipmentId, type: { in: [...FINALIZE_MOVEMENT_TYPES] } },
        select: { id: true },
      });
      movementsAlreadyApplied = existing !== null;

      if (!movementsAlreadyApplied) {
        movementIdsByRow = await this.mutation.runWithRetry(async (tx) => {
          // Cleared per attempt: runWithRetry may re-run the whole tx.
          targetsByRow.clear();
          unclaimedHeld.length = 0;
          const ids = new Map<string, string[]>();
          for (const planned of legacyReturning) {
            await this.restockUnbookedLine(tx, planned, sourcesByItem.get(planned.line.id), {
              orderId,
              shipmentId,
              staffId,
              restockWarehouseId,
              ids,
              targetsByRow,
            });
          }
          for (const planned of bookedLines) {
            await this.moveBookedLine(tx, planned, {
              orderId,
              shipmentId,
              staffId,
              originWarehouseId: shipment.originWarehouseId,
              ids,
              targetsByRow,
              unclaimedHeld,
            });
          }
          return ids;
        });
        if (unclaimedHeld.length > 0) {
          this.logger.warn(
            { shipmentId, orderId, unclaimedHeld },
            'RTO finalize: held units no inspection row claimed are left in the returns hold',
          );
        }
      }
    }
    const itemSummaries = this.buildItemSummaries(lines, movementIdsByRow);
    const totals = this.counts(lines);

    // ── Authoritative transition (its own tx).
    //
    // RTO_DAMAGED when NOTHING came back sellable — every unit written off
    // or kept aside damaged. A mixed parcel that saved even one unit is a
    // restock with losses, and calling it damaged would overstate the
    // damage rate as badly as the old "always RESTOCKED" understated it.
    const finalStatus =
      totals.restockedUnits === 0 ? OrderStatus.RTO_DAMAGED : OrderStatus.RTO_RESTOCKED;

    await this.orderWrite.transitionStatus({
      orderId,
      to: finalStatus,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: OrderStatus.RTO_RECEIVED,
      reason: `RTO finalize on shipment ${shipmentId}`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    // R4 — settle the serialized units, mirroring the aggregate decision
    // that just committed. Only a line with ONE row can carry serials
    // here: the inspection refuses to split a line that has units
    // (RTO_SPLIT_SERIALIZED_LINE). A line booked at receive has its units
    // IN_STOCK at the hold bin (WMS-8e); one that was not is RTO_RECEIVED.
    // Best-effort + guarded on fromStatus: the aggregate movements and the
    // order transition are the durable facts.
    for (const planned of lines) {
      const row = planned.rows.length === 1 ? planned.rows[0] : undefined;
      if (row === undefined) continue;
      await this.settleUnits(
        shipmentId,
        planned.line,
        row,
        targetsByRow.get(rowKey(planned.line.id, 0)),
        {
          restockWarehouseId,
          staffId,
          fromStatus:
            planned.held !== null ? StockUnitStatus.IN_STOCK : StockUnitStatus.RTO_RECEIVED,
        },
      );
    }

    // R3 amortisation (founder's call): a written-off unit still owes its
    // share of the inbound freight — that money was genuinely spent
    // carrying the goods into India. Charged for the written-off UNITS
    // only (WMS-8d): a unit restocked or kept aside has not left, so it
    // owes nothing yet. Unchanged by WMS-8e (the ADJUSTMENT_DECREASE out of
    // the hold moves stock, not money). Best-effort + gated on one
    // INBOUND_FREIGHT entry per order, so a re-run cannot double-charge.
    const writeOffSellerId = writeOffLines[0]?.line.orderItem.order.sellerId;
    if (writeOffSellerId !== undefined) {
      try {
        const charged = await this.prisma.client.$transaction((tx) =>
          this.freightAmortisation.debitForWrittenOffItems(tx, {
            orderId,
            sellerId: writeOffSellerId,
            lines: writeOffLines.map((l) => ({
              shipmentItemId: l.line.id,
              quantity: l.qty[RtoDisposition.WRITE_OFF],
            })),
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

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.finalized',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        ...totals,
        // WMS-8d: lines whose units went more than one way.
        splitLines: lines.filter((l) => l.rows.length > 1).map((l) => l.line.id),
        movementsAlreadyApplied,
        // WMS-8e: which lines moved out of the returns hold, which were
        // finalized the pre-WMS-8e way, and any held stock left behind.
        bookedAtReceiveLines: bookedLines.map((l) => l.line.id),
        unbookedReturningLines: legacyReturning.map((l) => l.line.id),
        unclaimedHeld,
        // R6b: a return restocked at a warehouse other than origin is
        // worth seeing in the audit trail — the goods moved buildings.
        crossWarehouseRestock,
        restockWarehouseId,
        originWarehouseId: shipment.originWarehouseId,
        // WMS-8c: where each unbooked returning line was taken from.
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
      ...totals,
      items: itemSummaries,
      movementsAlreadyApplied,
      alreadyFinalized: false,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * An UNBOOKED line's returning rows: RETURN_RESTOCK +qty per source, into
   * the sellable destination (RESTOCK) or the DAMAGED bin (HOLD_DAMAGED) of
   * the receiving warehouse. The line's sources are handed to its rows in
   * row order, largest source first (WMS-8d).
   */
  private async restockUnbookedLine(
    tx: Prisma.TransactionClient,
    planned: PlannedLine,
    resolved: ResolvedRestockLine | undefined,
    ctx: {
      readonly orderId: string;
      readonly shipmentId: string;
      readonly staffId: string;
      readonly restockWarehouseId: string;
      readonly ids: Map<string, string[]>;
      readonly targetsByRow: Map<string, RestockTarget>;
    },
  ): Promise<void> {
    const { line } = planned;
    if (resolved === undefined) {
      // Pre-flighted: every returning line resolved or we refused.
      throw new ConflictException({
        code: 'RTO_RESTOCK_NEVER_LEFT_STOCK',
        message: `item ${line.id} has no restock source`,
      });
    }
    for (const { rowIndex, sources } of splitSourcesAcrossRows(planned.rows, resolved.sources)) {
      const row = planned.rows[rowIndex];
      if (row === undefined) continue;
      const key = rowKey(line.id, rowIndex);
      const rowIds: string[] = [];
      for (const source of sources) {
        const targetInput = {
          sellerId: line.orderItem.order.sellerId,
          variantId: line.orderItem.variantId,
          originWarehouseId: source.warehouseId,
          receivedWarehouseId: ctx.restockWarehouseId,
          pickedBinId: source.binId,
          pickedBatchId: source.batchId,
          quantity: source.quantity,
          staffId: ctx.staffId,
        };
        const target =
          row.disposition === RtoDisposition.HOLD_DAMAGED
            ? await this.restockTargets.resolveDamagedHold(tx, targetInput)
            : await this.restockTargets.resolve(tx, targetInput);
        // The unit ledger follows the LARGEST source (first).
        if (!ctx.targetsByRow.has(key)) ctx.targetsByRow.set(key, target);
        const result = await this.mutation.apply(tx, {
          sellerId: line.orderItem.order.sellerId,
          variantId: line.orderItem.variantId,
          warehouseId: target.warehouseId,
          binId: target.binId,
          batchId: target.batchId,
          qtyChange: source.quantity, // +qty — the unit returned
          type: StockMovementType.RETURN_RESTOCK,
          actorType: ActorType.STAFF,
          actorId: ctx.staffId,
          // RETURN_RESTOCK self-describes (INV-7 — no reasonCode req).
          reasonCode: null,
          reason:
            row.disposition === RtoDisposition.HOLD_DAMAGED
              ? `RTO kept aside (damaged): rtoCondition=${row.condition}`
              : `RTO restock: rtoCondition=${row.condition}`,
          orderId: ctx.orderId,
          orderItemId: line.orderItemId,
          shipmentId: ctx.shipmentId,
          metadata: {
            restockSource: resolved.origin,
            disposition: row.disposition,
            inspectionRow: rowIndex + 1,
            leftFromWarehouseId: source.warehouseId,
            leftFromBinId: source.binId,
            leftFromBatchId: source.batchId,
          },
        });
        rowIds.push(result.movementId);
      }
      ctx.ids.set(key, rowIds);
    }
  }

  /**
   * WMS-8e — a line BOOKED into the returns hold at receive: move every held
   * unit out of the hold, per inspection row (`splitHeldAcrossRows` —
   * returning rows first and in full, write-off rows from what is left).
   */
  private async moveBookedLine(
    tx: Prisma.TransactionClient,
    planned: PlannedLine,
    ctx: {
      readonly orderId: string;
      readonly shipmentId: string;
      readonly staffId: string;
      readonly originWarehouseId: string;
      readonly ids: Map<string, string[]>;
      readonly targetsByRow: Map<string, RestockTarget>;
      readonly unclaimedHeld: Array<{ shipmentItemId: string; quantity: number }>;
    },
  ): Promise<void> {
    const { line } = planned;
    const { allocations, leftover } = splitHeldAcrossRows(planned.rows, planned.held ?? []);
    if (leftover > 0) ctx.unclaimedHeld.push({ shipmentItemId: line.id, quantity: leftover });
    const sellerId = line.orderItem.order.sellerId;
    const variantId = line.orderItem.variantId;

    for (const { rowIndex, sources } of allocations) {
      const row = planned.rows[rowIndex];
      if (row === undefined) continue;
      const key = rowKey(line.id, rowIndex);
      const rowIds: string[] = [];
      for (const source of sources) {
        const common = {
          sellerId,
          variantId,
          warehouseId: source.warehouseId,
          batchId: source.batchId,
          quantity: source.quantity,
          staffId: ctx.staffId,
          orderId: ctx.orderId,
          orderItemId: line.orderItemId,
          shipmentId: ctx.shipmentId,
          holdBinId: source.binId,
        };
        const meta = {
          disposition: row.disposition,
          inspectionRow: rowIndex + 1,
          bookedAtReceive: true,
        };
        const land = (binId: string): void => {
          if (!ctx.targetsByRow.has(key)) {
            ctx.targetsByRow.set(key, {
              warehouseId: source.warehouseId,
              binId,
              batchId: source.batchId,
              crossWarehouse: source.warehouseId !== ctx.originWarehouseId,
            });
          }
        };
        switch (row.disposition) {
          case RtoDisposition.RESTOCK: {
            const destination = await this.restockTargets.sellableDestination(tx, {
              warehouseId: source.warehouseId,
              candidateBinIds: [...source.leftFromBinIds, line.pickedBinId],
            });
            rowIds.push(
              await this.moveOutOfHold(tx, {
                ...common,
                toBinId: destination.binId,
                reason: `RTO restock: rtoCondition=${row.condition}`,
                metadata: { ...meta, destination: destination.reason },
              }),
            );
            land(destination.binId);
            break;
          }
          case RtoDisposition.HOLD_DAMAGED: {
            const damagedBinId = await this.restockTargets.damagedBinId(tx, source.warehouseId);
            rowIds.push(
              await this.moveOutOfHold(tx, {
                ...common,
                toBinId: damagedBinId,
                reason: `RTO kept aside (damaged): rtoCondition=${row.condition}`,
                metadata: meta,
              }),
            );
            land(damagedBinId);
            break;
          }
          case RtoDisposition.WRITE_OFF: {
            const result = await this.mutation.apply(tx, {
              sellerId,
              variantId,
              warehouseId: source.warehouseId,
              binId: source.binId,
              batchId: source.batchId,
              qtyChange: -source.quantity, // −qty — leaves the returns hold for good
              type: StockMovementType.ADJUSTMENT_DECREASE,
              actorType: ActorType.STAFF,
              actorId: ctx.staffId,
              // INV-7: an adjustment carries its reason.
              reasonCode: writeOffReasonCode(row.condition),
              reason: `RTO write-off: rtoCondition=${row.condition}`,
              orderId: ctx.orderId,
              orderItemId: line.orderItemId,
              shipmentId: ctx.shipmentId,
              metadata: meta,
            });
            rowIds.push(result.movementId);
            break;
          }
          case RtoDisposition.INSPECT_LATER:
            // Refused before any movement (RTO_DISPOSITION_UNDECIDED).
            throw new ConflictException({
              code: 'RTO_DISPOSITION_UNDECIDED',
              message: `item ${line.id} is still marked for later inspection`,
            });
        }
      }
      ctx.ids.set(key, rowIds);
    }
  }

  /**
   * A paired TRANSFER_OUT (from the returns hold) / TRANSFER_IN (to the
   * destination) through the sole stock writer (INV-1), same batch — the
   * move changes WHERE the goods are, never what they are. Returns the
   * TRANSFER_IN id, the movement that says where the unit landed.
   */
  private async moveOutOfHold(
    tx: Prisma.TransactionClient,
    input: {
      readonly sellerId: string;
      readonly variantId: string;
      readonly warehouseId: string;
      readonly holdBinId: string;
      readonly toBinId: string;
      readonly batchId: string;
      readonly quantity: number;
      readonly staffId: string;
      readonly orderId: string;
      readonly orderItemId: string;
      readonly shipmentId: string;
      readonly reason: string;
      readonly metadata: Prisma.InputJsonValue;
    },
  ): Promise<string> {
    const transferGroupId = randomUUID();
    const common = {
      sellerId: input.sellerId,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      batchId: input.batchId,
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      reasonCode: null,
      reason: input.reason,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      shipmentId: input.shipmentId,
      transferGroupId,
      fromBinId: input.holdBinId,
      toBinId: input.toBinId,
      metadata: input.metadata,
    };
    await this.mutation.apply(tx, {
      ...common,
      binId: input.holdBinId,
      qtyChange: -input.quantity,
      type: StockMovementType.TRANSFER_OUT,
    });
    const landed = await this.mutation.apply(tx, {
      ...common,
      binId: input.toBinId,
      qtyChange: input.quantity,
      type: StockMovementType.TRANSFER_IN,
    });
    return landed.movementId;
  }

  /** Move one unsplit line's serialized units to match its disposition. */
  private async settleUnits(
    shipmentId: string,
    line: LoadedLine,
    row: InspectionRow,
    target: RestockTarget | undefined,
    ctx: { restockWarehouseId: string; staffId: string; fromStatus: StockUnitStatus },
  ): Promise<void> {
    const common = {
      shipmentId,
      shipmentItemId: line.id,
      fromStatus: ctx.fromStatus,
      actorType: ActorType.STAFF,
      actorId: ctx.staffId,
    };
    let input: Parameters<StockUnitService['advanceUnitsForShipment']>[1];
    switch (row.disposition) {
      case RtoDisposition.RESTOCK:
      case RtoDisposition.HOLD_DAMAGED:
        // IN_STOCK at the bin the aggregate was credited to — for a
        // kept-aside unit that is the DAMAGED bin, whose type is what keeps
        // it unsellable (BIN-2); the unit's status says where it is.
        input = {
          ...common,
          toStatus: StockUnitStatus.IN_STOCK,
          gate: row.disposition === RtoDisposition.RESTOCK ? 'RTO_RESTOCK' : 'RTO_HOLD_DAMAGED',
          warehouseId: target?.warehouseId ?? ctx.restockWarehouseId,
          binId: target?.binId ?? line.pickedBinId,
          batchId: target?.batchId ?? line.pickedBatchId,
        };
        break;
      case RtoDisposition.WRITE_OFF:
        input = {
          ...common,
          toStatus: StockUnitStatus.WRITTEN_OFF,
          gate: 'RTO_WRITE_OFF',
          writeOffReason: `RTO ${row.condition}`,
        };
        break;
      case RtoDisposition.INSPECT_LATER:
        return; // refused before any movement
    }
    try {
      await this.prisma.client.$transaction((tx) => this.units.advanceUnitsForShipment(tx, input));
    } catch (err) {
      this.logger.warn(
        { shipmentId, shipmentItemId: line.id, err: (err as Error).message },
        'RTO finalize: unit ledger update failed — the aggregate IS applied; the discrepancy report will surface the units',
      );
    }
  }

  /**
   * The order's pack evidence (read by ORDER, CUR-3), matched to the
   * unbooked lines by the pure resolver — each line asking for its
   * RETURNING quantity.
   */
  private async resolveSources(
    orderId: string,
    originWarehouseId: string,
    returningLines: readonly PlannedLine[],
  ): Promise<RestockSourceResolution> {
    const { leftMovements, reversedMovementIds } = await loadPackEvidence(
      this.prisma.client,
      orderId,
    );
    return resolveRestockSources({
      lines: returningLines.map(({ line, returningQty }) => ({
        shipmentItemId: line.id,
        orderItemId: line.orderItemId,
        variantId: line.orderItem.variantId,
        quantity: returningQty,
        pickedBinId: line.pickedBinId,
        pickedBatchId: line.pickedBatchId,
      })),
      leftMovements,
      reversedMovementIds,
      originWarehouseId,
    });
  }

  private counts(lines: readonly PlannedLine[]): {
    restockedCount: number;
    writtenOffCount: number;
    heldDamagedCount: number;
    restockedUnits: number;
    writtenOffUnits: number;
    heldDamagedUnits: number;
  } {
    const sum = (d: RtoDisposition): number => lines.reduce((s, l) => s + l.qty[d], 0);
    const count = (d: RtoDisposition): number => lines.filter((l) => l.qty[d] > 0).length;
    return {
      restockedCount: count(RtoDisposition.RESTOCK),
      writtenOffCount: count(RtoDisposition.WRITE_OFF),
      heldDamagedCount: count(RtoDisposition.HOLD_DAMAGED),
      restockedUnits: sum(RtoDisposition.RESTOCK),
      writtenOffUnits: sum(RtoDisposition.WRITE_OFF),
      heldDamagedUnits: sum(RtoDisposition.HOLD_DAMAGED),
    };
  }

  private buildItemSummaries(
    lines: readonly PlannedLine[],
    movementIdsByRow: Map<string, string[]> | null,
  ): FinalizeRtoItemSummary[] {
    return lines.map(({ line, rows }) => {
      const rowSummaries = rows.map((r, i) => ({
        quantity: r.quantity,
        condition: r.condition,
        disposition: r.disposition,
        movementIds: movementIdsByRow?.get(rowKey(line.id, i)) ?? [],
      }));
      const ids = rowSummaries.flatMap((r) => r.movementIds);
      return {
        shipmentItemId: line.id,
        orderItemId: line.orderItemId,
        disposition:
          rows.length === 0
            ? (line.rtoDisposition ?? RtoDisposition.WRITE_OFF)
            : summarizeRows(rows).disposition,
        quantity: line.quantity,
        movementId: ids[0] ?? null,
        movementIds: ids,
        rows: rowSummaries,
      };
    });
  }
}

function rowKey(shipmentItemId: string, rowIndex: number): string {
  return `${shipmentItemId}#${rowIndex}`;
}
