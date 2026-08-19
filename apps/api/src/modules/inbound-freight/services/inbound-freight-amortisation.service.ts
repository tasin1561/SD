import { Injectable } from '@nestjs/common';
import {
  ActorType,
  Currency,
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

export interface AllocationPlanLine {
  readonly goodsReceiptLineId: string;
  readonly variantId: string;
  readonly units: number;
  readonly unitWeightGrams: number | null;
  readonly perUnitInr: Prisma.Decimal;
}

export interface DebitResult {
  /** Rupees actually debited (0 ⇒ nothing was owed / already charged). */
  readonly amountInr: string;
  readonly unitsCharged: number;
  /** true ⇒ a prior INBOUND_FREIGHT entry for this order already existed. */
  readonly alreadyCharged: boolean;
}

const ZERO = new Prisma.Decimal(0);

/**
 * R3 amortisation — freight is a per-unit LANDED COST.
 *
 * The founder's model, and the correct one: 100 units of a SKU arrive on
 * one freight bill. When ONE unit is delivered, the seller pays that
 * unit's share; the other 99 are still sitting in stock and still owe.
 * Charging the whole bill at once would bill a seller for freight on goods
 * they have not sold yet.
 *
 * ── HOW A UNIT IS ATTRIBUTED TO A BILL ────────────────────────────────
 * The chain already existed in the data; nothing new is guessed:
 *
 *   shipment_item.pickedBatchId → stock_batch
 *     → goods_receipt_lines.batchId (the consignment LINE)
 *       → inbound_freight_allocations.goodsReceiptLineId (the rate)
 *
 * For an R6b cross-warehouse RTO child batch there is no receipt line of
 * its own, so the lookup walks `parentBatchId` — which is exactly why that
 * column carries lineage. A unit that came back, was restocked elsewhere
 * and later sold still charges freight to the consignment that actually
 * carried it into India.
 *
 * ── SPLIT BASIS: WEIGHT ───────────────────────────────────────────────
 * Freight is priced by weight, so the bill is split by total line weight
 * (unit weight × units). A line whose SKU has no recorded weight falls
 * back to a COUNT-based share rather than being treated as weightless —
 * a missing weight must not make freight free. Effective weight comes from
 * `CatalogReadService` so the variant → product inheritance chain is
 * honoured (MUST #13).
 *
 * ── WHAT IS NOT AMORTISED ─────────────────────────────────────────────
 * PAY_NOW bills. Those were charged in full when ops recorded them, so
 * amortising them again would double-bill.
 */
@Injectable()
export class InboundFreightAmortisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogReadService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Split a bill across the receipt's lines by weight. Called at record
   * time; the resulting rates are snapshotted and never recomputed.
   */
  async planAllocation(
    /**
     * The receipt legs whose COUNTED lines this bill covers. A two-leg
     * consignment passes its India arrivals, not its Bangladesh intake:
     * freight has to be amortised over the units that actually landed,
     * or the share of a unit lost in transit is money nothing will ever
     * settle.
     */
    goodsReceiptIds: readonly string[],
    totalInr: Prisma.Decimal,
  ): Promise<{ lines: readonly AllocationPlanLine[]; totalUnits: number }> {
    const lines = await this.prisma.client.goodsReceiptLine.findMany({
      where: { receiptId: { in: [...goodsReceiptIds] } },
      select: { id: true, variantId: true, receivedQty: true },
    });
    const stocked = lines.filter((l) => l.receivedQty > 0);
    const totalUnits = stocked.reduce((sum, l) => sum + l.receivedQty, 0);
    if (stocked.length === 0 || totalUnits === 0) {
      return { lines: [], totalUnits: 0 };
    }

    const variants = await this.catalog.getVariantsByIds(stocked.map((l) => l.variantId));

    // Weight basis per line. A line with no usable weight contributes
    // nothing to the weight pool and is handled by the count fallback.
    const weightByLine = new Map<string, number | null>();
    let weightPool = 0;
    let countPoolUnits = 0;
    for (const line of stocked) {
      const grams = variants.get(line.variantId)?.weightGrams ?? null;
      const usable = grams !== null && grams > 0 ? grams : null;
      weightByLine.set(line.id, usable);
      if (usable === null) {
        countPoolUnits += line.receivedQty;
      } else {
        weightPool += usable * line.receivedQty;
      }
    }

    // When SOME lines have weights and others don't, the two pools have to
    // share the bill. Split it in proportion to units first (the only
    // common denominator available), then apply weight WITHIN the weighted
    // pool. Fully-weighed and fully-unweighed consignments — the normal
    // cases — reduce to a pure weight or pure count split.
    const weightedUnits = totalUnits - countPoolUnits;
    const weightPoolShare =
      countPoolUnits === 0
        ? totalInr
        : weightedUnits === 0
          ? ZERO
          : totalInr.mul(weightedUnits).div(totalUnits);
    const countPoolShare = totalInr.sub(weightPoolShare);

    const out: AllocationPlanLine[] = [];
    for (const line of stocked) {
      const grams = weightByLine.get(line.id) ?? null;
      let perUnit: Prisma.Decimal;
      if (grams === null) {
        perUnit =
          countPoolUnits === 0 ? ZERO : countPoolShare.div(countPoolUnits).toDecimalPlaces(4);
      } else {
        const lineWeight = grams * line.receivedQty;
        perUnit =
          weightPool === 0
            ? ZERO
            : weightPoolShare
                .mul(lineWeight)
                .div(weightPool)
                .div(line.receivedQty)
                .toDecimalPlaces(4);
      }
      out.push({
        goodsReceiptLineId: line.id,
        variantId: line.variantId,
        units: line.receivedQty,
        unitWeightGrams: grams,
        perUnitInr: perUnit,
      });
    }
    return { lines: out, totalUnits };
  }

  /**
   * Charge the freight share for every unit in a DELIVERED order.
   *
   * ONE wallet entry per order (the sum across its lines), which is also
   * the idempotency gate — an order can carry items from several
   * consignments, so per-charge entries would have no clean dedup key.
   * Runs inside the caller's accrual transaction.
   */
  async debitForDeliveredOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerId: string,
  ): Promise<DebitResult> {
    const already = await tx.sellerWalletEntry.findFirst({
      where: {
        linkedOrderId: orderId,
        direction: WalletEntryDirection.INBOUND_FREIGHT,
      },
      select: { id: true },
    });
    if (already) {
      return { amountInr: '0', unitsCharged: 0, alreadyCharged: true };
    }

    const items = await tx.shipmentItem.findMany({
      where: {
        pickedBatchId: { not: null },
        shipment: { orderShipments: { some: { orderId } } },
      },
      select: { id: true, quantity: true, pickedBatchId: true },
    });

    return this.chargeItems(tx, {
      orderId,
      sellerId,
      items,
      note: 'Inbound freight share (units delivered)',
    });
  }

  /**
   * Charge the freight share for units written off at RTO disposition.
   *
   * Founder's call: the freight was genuinely spent carrying those goods
   * into India, so it is payable even though the unit never sold —
   * compensation for the lost goods themselves is handled separately
   * (manually, or via an R7 damage ticket). Same one-entry-per-order gate.
   */
  async debitForWrittenOffItems(
    tx: Prisma.TransactionClient,
    input: {
      readonly orderId: string;
      readonly sellerId: string;
      readonly shipmentItemIds: readonly string[];
    },
  ): Promise<DebitResult> {
    if (input.shipmentItemIds.length === 0) {
      return { amountInr: '0', unitsCharged: 0, alreadyCharged: false };
    }
    const already = await tx.sellerWalletEntry.findFirst({
      where: {
        linkedOrderId: input.orderId,
        direction: WalletEntryDirection.INBOUND_FREIGHT,
      },
      select: { id: true },
    });
    if (already) {
      return { amountInr: '0', unitsCharged: 0, alreadyCharged: true };
    }

    const items = await tx.shipmentItem.findMany({
      where: {
        id: { in: [...input.shipmentItemIds] },
        pickedBatchId: { not: null },
      },
      select: { id: true, quantity: true, pickedBatchId: true },
    });

    return this.chargeItems(tx, {
      orderId: input.orderId,
      sellerId: input.sellerId,
      items,
      note: 'Inbound freight share (units written off at RTO)',
    });
  }

  // ── internal ──────────────────────────────────────────────────────

  private async chargeItems(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      sellerId: string;
      items: ReadonlyArray<{ id: string; quantity: number; pickedBatchId: string | null }>;
      note: string;
    },
  ): Promise<DebitResult> {
    let total = ZERO;
    let unitsCharged = 0;
    const touched = new Map<string, { units: number; amount: Prisma.Decimal }>();

    for (const item of input.items) {
      if (item.pickedBatchId === null) continue;
      const alloc = await this.resolveAllocation(tx, item.pickedBatchId);
      if (!alloc) continue;

      const amount = alloc.perUnitInr.mul(item.quantity).toDecimalPlaces(2);
      if (amount.lte(0)) continue;

      await tx.inboundFreightAllocation.update({
        where: { id: alloc.id },
        data: {
          unitsSettled: { increment: item.quantity },
          amountSettledInr: { increment: amount },
        },
      });
      const prior = touched.get(alloc.freightChargeId);
      touched.set(alloc.freightChargeId, {
        units: (prior?.units ?? 0) + item.quantity,
        amount: (prior?.amount ?? ZERO).add(amount),
      });
      total = total.add(amount);
      unitsCharged += item.quantity;
    }

    if (total.lte(0)) {
      return { amountInr: '0', unitsCharged: 0, alreadyCharged: false };
    }

    for (const [chargeId, agg] of touched) {
      await this.rollUpCharge(tx, chargeId, agg.units, agg.amount);
    }

    await this.wallet.applyEntry(tx, {
      sellerId: input.sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.INBOUND_FREIGHT,
      amount: total,
      linkedOrderId: input.orderId,
      actorType: ActorType.SYSTEM,
      note: input.note,
    });

    return {
      amountInr: total.toString(),
      unitsCharged,
      alreadyCharged: false,
    };
  }

  /**
   * batch → consignment line → rate. Walks `parentBatchId` once so an R6b
   * cross-warehouse RTO child batch resolves to its parent's line.
   * Returns null when the goods did not come from a billed consignment
   * (no freight recorded, or a PAY_NOW bill — already paid in full).
   */
  private async resolveAllocation(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<{ id: string; freightChargeId: string; perUnitInr: Prisma.Decimal } | null> {
    const batch = await tx.stockBatch.findUnique({
      where: { id: batchId },
      select: { id: true, parentBatchId: true },
    });
    if (!batch) return null;

    for (const candidate of [batch.id, batch.parentBatchId]) {
      if (candidate === null) continue;
      const line = await tx.goodsReceiptLine.findFirst({
        where: { batchId: candidate },
        select: {
          freightAllocation: {
            select: {
              id: true,
              freightChargeId: true,
              perUnitInr: true,
              freightCharge: { select: { mode: true, status: true } },
            },
          },
        },
      });
      const alloc = line?.freightAllocation;
      if (!alloc) continue;
      // PAY_NOW was settled in full at record time — amortising it too
      // would charge the seller twice for the same freight.
      if (alloc.freightCharge.mode === InboundFreightMode.PAY_NOW) return null;
      if (alloc.freightCharge.status === InboundFreightStatus.WAIVED) return null;
      return {
        id: alloc.id,
        freightChargeId: alloc.freightChargeId,
        perUnitInr: alloc.perUnitInr,
      };
    }
    return null;
  }

  /** Roll the line-level settlement up onto the bill and advance status. */
  private async rollUpCharge(
    tx: Prisma.TransactionClient,
    chargeId: string,
    units: number,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const updated = await tx.inboundFreightCharge.update({
      where: { id: chargeId },
      data: {
        unitsSettled: { increment: units },
        amountSettledInr: { increment: amount },
      },
      select: { unitsSettled: true, totalUnits: true, status: true },
    });

    // Fully consumed ⇒ SETTLED; otherwise PARTIALLY_SETTLED. Never
    // downgrade a bill an operator already settled or waived by hand.
    if (
      updated.status === InboundFreightStatus.SETTLED ||
      updated.status === InboundFreightStatus.WAIVED
    ) {
      return;
    }
    const done = updated.totalUnits > 0 && updated.unitsSettled >= updated.totalUnits;
    await tx.inboundFreightCharge.update({
      where: { id: chargeId },
      data: {
        status: done ? InboundFreightStatus.SETTLED : InboundFreightStatus.PARTIALLY_SETTLED,
        ...(done ? { settledAt: new Date() } : {}),
      },
    });
  }
}
