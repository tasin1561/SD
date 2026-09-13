import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
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
  type RestockSourceResolution,
} from './rto-restock-sources';
import {
  effectiveRows,
  quantitiesByDisposition,
  splitSourcesAcrossRows,
  summarizeRows,
  type InspectionRow,
} from './rto-inspection-rows';
import { InboundFreightAmortisationService } from '../../inbound-freight/services/inbound-freight-amortisation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FinalizeRtoRowSummary {
  quantity: number;
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  /** Every RETURN_RESTOCK this row wrote (RESTOCK / HOLD_DAMAGED only). */
  movementIds: string[];
}

export interface FinalizeRtoItemSummary {
  shipmentItemId: string;
  orderItemId: string;
  /** The LINE summary (WMS-8d): a split line reads as its highest-ranked
   *  disposition — see `summarizeRows`. The truth per unit is `rows`. */
  disposition: RtoDisposition;
  quantity: number;
  /** The first RETURN_RESTOCK for the line (null when it wrote none — a
   *  write-off-only line, or a retry whose movement gate skipped). */
  movementId: string | null;
  /** Every RETURN_RESTOCK written for the line, across its rows — more than
   *  one when units left from more than one (bin, batch) or the line was
   *  split. Empty where movementId is null. */
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
  /** true ⇒ the gate-2 existence query fired — RETURN_RESTOCK rows
   *  already present for this shipment, so the movement tx was skipped
   *  on this call (recovery from a prior crash-after-movements). */
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
 * NOT touch reservations).
 *
 * ── Per ROW, not per line (WMS-8d, 2026-09-13) ─────────────────────────
 * A returned line is inspected BY QUANTITY (`shipment_item_rto_inspections`
 * — "1 good, 1 damaged"). Each row's disposition applies to that row's
 * units:
 *   - RESTOCK      : RETURN_RESTOCK +qty into the returns hold (BIN-3) —
 *                    sellable once shelved.
 *   - HOLD_DAMAGED : RETURN_RESTOCK +qty into the receiving warehouse's
 *                    DAMAGED bin — on hand, never sellable (BIN-2); no
 *                    freight charged (the unit has not left); refused
 *                    with RTO_NO_DAMAGED_BIN when there is no such bin.
 *   - WRITE_OFF    : NO movement — the unit left and never returned; the
 *                    original decrement stands. Its inbound-freight share
 *                    is charged for the written-off UNITS only.
 *   - INSPECT_LATER: blocks finalize.
 * Both stock-returning dispositions are sourced from where the units LEFT
 * (WMS-8c): the line's returning quantity is resolved once against the
 * order's pack movements — so RTO_RESTOCK_NEVER_LEFT_STOCK /
 * RTO_RESTOCK_EXCEEDS_STOCK_LEFT guard every row of the line together —
 * and the sources are handed to the rows in row order
 * (`splitSourcesAcrossRows`, deterministic). A line inspected before rows
 * existed is one row made of its summary columns (`effectiveRows`).
 *
 * ── SAGA (movements-first, transition-last; visible-vs-silent) ─────────
 *   1. Pre-flight: gate 1 (order already RTO_RESTOCKED / RTO_DAMAGED),
 *      ORDER_NOT_RTO_READY, RTO_NO_ITEMS, RTO_INSPECTION_INCOMPLETE,
 *      RTO_INSPECTION_QUANTITY_MISMATCH, RTO_DISPOSITION_UNDECIDED, and the
 *      source guards above.
 *   2. Gate 2 (movement idempotency): existence query on (shipmentId,
 *      type=RETURN_RESTOCK). Present ⇒ skip the movement tx
 *      (crash-after-movements recovery). stock_movements has no native
 *      dedup key — the explicit query IS the gate. Every RETURN_RESTOCK of
 *      the finalize — hold and damaged alike — is written in ONE tx, so the
 *      gate sees all of them or none.
 *   3. RETURN_RESTOCK movements: one runWithRetry((tx) => …) — atomic
 *      (INV-1/INV-6). A missing DAMAGED bin throws inside it and rolls the
 *      whole tx back.
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

    const lines: PlannedLine[] = (shipment.items as LoadedLine[]).map((line) => {
      const rows = effectiveRows(line);
      const qty = quantitiesByDisposition(rows);
      return {
        line,
        rows,
        qty,
        returningQty: qty[RtoDisposition.RESTOCK] + qty[RtoDisposition.HOLD_DAMAGED],
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
        ...this.counts(lines),
        items: this.buildItemSummaries(lines, null),
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
    if (lines.length === 0) {
      throw new ConflictException({
        code: 'RTO_NO_ITEMS',
        message: `Shipment ${shipmentId} has no items to finalize`,
      });
    }

    // ── Inspection-completeness check.
    const uninspected = lines.filter((l) => l.rows.length === 0);
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
    const mismatched = lines.filter(
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
    // The goods are safe meanwhile: they sit in RTO_HOLD, which BIN-2
    // keeps out of every availability sum, so nothing undecided sells.
    const undecided = lines.filter((l) => l.qty[RtoDisposition.INSPECT_LATER] > 0);
    if (undecided.length > 0) {
      throw new ConflictException({
        code: 'RTO_DISPOSITION_UNDECIDED',
        message:
          `${undecided.length} item(s) are still marked for later inspection. ` +
          'Inspect them again and choose what happens to them before finalizing.',
        cause: undecided.map((l) => l.line.id),
      });
    }

    const returningLines = lines.filter((l) => l.returningQty > 0);
    const writeOffLines = lines.filter((l) => l.qty[RtoDisposition.WRITE_OFF] > 0);

    // ── WHERE each returning unit comes back from (WMS-8c).
    //
    // The RETURN_RESTOCK movement targets a concrete (bin, batch), and the
    // authority on that is where the unit LEFT: the order's PACK_CONFIRM
    // movements (DISPATCH for pre-Model-C orders), net of PACK_REVERSED,
    // queried by ORDER — a supersede leaves them on the original shipment
    // (CUR-3). Resolved for the line's WHOLE returning quantity (RESTOCK +
    // HOLD_DAMAGED rows together), so the never-left / exceeds guards cover
    // every row of the line at once; the rows then share the sources.
    const sourcesByItem = new Map<string, ResolvedRestockLine>();
    if (returningLines.length > 0) {
      const resolution = await this.resolveSources(
        orderId,
        shipment.originWarehouseId,
        returningLines,
      );
      const skuOf = (id: string): string =>
        returningLines.find((l) => l.line.id === id)?.line.orderItem.skuCode ?? id;
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
      if (resolution.shortfalls.length > 0) {
        const detail = resolution.shortfalls
          .map(
            (s) => `${skuOf(s.shipmentItemId)}: ${s.quantity} coming back, ${s.leftQuantity} left`,
          )
          .join('; ');
        throw new ConflictException({
          code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT',
          message:
            `More units are marked to come back into stock than left our stock for this order (${detail}). ` +
            'Putting back the difference would add stock that was never taken out — ' +
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
    // When the parcel physically came back somewhere other than where it
    // shipped from, crediting the origin bin would book a unit into a
    // warehouse that does not hold it. `RtoRestockTargetService` resolves
    // a real target at the RECEIVING warehouse instead — a lineage-
    // preserving child batch plus a returns bin (RESTOCK) or its DAMAGED
    // bin (HOLD_DAMAGED) — and refuses when the bin it needs is missing.
    // WRITE_OFF never reaches this: it emits no movement.
    const restockWarehouseId = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;
    const crossWarehouseRestock =
      returningLines.length > 0 && restockWarehouseId !== shipment.originWarehouseId;

    // Where each (line, row) actually landed, so the unit ledger can follow
    // the aggregate rather than assuming the original bin/batch.
    const targetsByRow = new Map<string, RestockTarget>();

    // ── GATE 2: movement-level idempotency. RETURN_RESTOCK is the marker.
    let movementsAlreadyApplied = false;
    let movementIdsByRow: Map<string, string[]> | null = null;
    if (returningLines.length > 0) {
      const existing = await this.prisma.client.stockMovement.findFirst({
        where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
        select: { id: true },
      });
      movementsAlreadyApplied = existing !== null;

      if (!movementsAlreadyApplied) {
        movementIdsByRow = await this.mutation.runWithRetry(async (tx) => {
          // Cleared per attempt: runWithRetry may re-run the whole tx.
          targetsByRow.clear();
          const ids = new Map<string, string[]>();
          for (const planned of returningLines) {
            const { line } = planned;
            const resolved = sourcesByItem.get(line.id);
            if (resolved === undefined) {
              // Pre-flighted: every returning line resolved or we refused.
              throw new ConflictException({
                code: 'RTO_RESTOCK_NEVER_LEFT_STOCK',
                message: `item ${line.id} has no restock source`,
              });
            }
            // The line's sources, handed to its rows in row order. Largest
            // source first, so an unsplit line restocks as it always did.
            for (const { rowIndex, sources } of splitSourcesAcrossRows(
              planned.rows,
              resolved.sources,
            )) {
              const row = planned.rows[rowIndex];
              if (row === undefined) continue;
              const key = rowKey(line.id, rowIndex);
              const rowIds: string[] = [];
              for (const source of sources) {
                const targetInput = {
                  sellerId: line.orderItem.order.sellerId,
                  variantId: line.orderItem.variantId,
                  originWarehouseId: source.warehouseId,
                  receivedWarehouseId: restockWarehouseId,
                  pickedBinId: source.binId,
                  pickedBatchId: source.batchId,
                  quantity: source.quantity,
                  staffId,
                };
                const target =
                  row.disposition === RtoDisposition.HOLD_DAMAGED
                    ? await this.restockTargets.resolveDamagedHold(tx, targetInput)
                    : await this.restockTargets.resolve(tx, targetInput);
                // The unit ledger follows the LARGEST source (first).
                if (!targetsByRow.has(key)) targetsByRow.set(key, target);
                const result = await this.mutation.apply(tx, {
                  sellerId: line.orderItem.order.sellerId,
                  variantId: line.orderItem.variantId,
                  warehouseId: target.warehouseId,
                  binId: target.binId,
                  batchId: target.batchId,
                  qtyChange: source.quantity, // +qty — the unit returned
                  type: StockMovementType.RETURN_RESTOCK,
                  actorType: ActorType.STAFF,
                  actorId: staffId,
                  // RETURN_RESTOCK self-describes (INV-7 — no reasonCode req).
                  reasonCode: null,
                  reason:
                    row.disposition === RtoDisposition.HOLD_DAMAGED
                      ? `RTO kept aside (damaged): rtoCondition=${row.condition}`
                      : `RTO restock: rtoCondition=${row.condition}`,
                  orderId,
                  orderItemId: line.orderItemId,
                  shipmentId,
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
              ids.set(key, rowIds);
            }
          }
          return ids;
        });
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
    // (RTO_SPLIT_SERIALIZED_LINE), because which serial went which way
    // is not recorded on a row. Best-effort + guarded on fromStatus: the
    // aggregate movements and the order transition are the durable facts;
    // a unit-ledger failure must not undo a finalize.
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
        },
      );
    }

    // R3 amortisation (founder's call): a written-off unit still owes its
    // share of the inbound freight — that money was genuinely spent
    // carrying the goods into India. Charged for the written-off UNITS
    // only (WMS-8d): a unit restocked or kept aside has not left, so it
    // owes nothing yet. Best-effort + gated on one INBOUND_FREIGHT entry
    // per order, so a re-run cannot double-charge.
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
        // R6b: a return restocked at a warehouse other than origin is
        // worth seeing in the audit trail — the goods moved buildings.
        crossWarehouseRestock,
        restockWarehouseId,
        originWarehouseId: shipment.originWarehouseId,
        // WMS-8c: where each returning line was taken from.
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

  /** Move one unsplit line's serialized units to match its disposition. */
  private async settleUnits(
    shipmentId: string,
    line: LoadedLine,
    row: InspectionRow,
    target: RestockTarget | undefined,
    ctx: { restockWarehouseId: string; staffId: string },
  ): Promise<void> {
    const common = {
      shipmentId,
      shipmentItemId: line.id,
      fromStatus: StockUnitStatus.RTO_RECEIVED,
      actorType: ActorType.STAFF,
      actorId: ctx.staffId,
    };
    let input: Parameters<StockUnitService['advanceUnitsForShipment']>[1];
    switch (row.disposition) {
      case RtoDisposition.RESTOCK:
      case RtoDisposition.HOLD_DAMAGED:
        // Back IN_STOCK at the bin the aggregate was credited to — for a
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
   * The order's pack evidence, read by ORDER (CUR-3), then matched to the
   * lines by the pure resolver — each line asking for its RETURNING
   * quantity. Read-only and outside any transaction: the ledger is
   * append-only, so a retry computes the same answer.
   */
  private async resolveSources(
    orderId: string,
    originWarehouseId: string,
    returningLines: readonly PlannedLine[],
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
