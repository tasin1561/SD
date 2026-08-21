import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ActorType,
  Currency,
  InboundFreightBasis,
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

export interface PricedLineInput {
  readonly goodsReceiptLineId: string;
  readonly basis: InboundFreightBasis;
  /** Per kg, or per piece — whichever the basis says. */
  readonly rateInr: Prisma.Decimal;
  /** Required for PER_KG, refused for PER_PIECE. */
  readonly chargeableWeightKg: Prisma.Decimal | null;
}

export interface AllocationPlanLine {
  readonly goodsReceiptLineId: string;
  readonly variantId: string;
  readonly units: number;
  readonly unitWeightGrams: number | null;
  readonly basis: InboundFreightBasis;
  readonly rateInr: Prisma.Decimal;
  readonly chargeableWeightKg: Prisma.Decimal | null;
  readonly lineTotalInr: Prisma.Decimal;
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
   * Price the arrival from the forwarder's own invoice lines.
   *
   * This REPLACED a weight-based split: one total apportioned across the
   * receipt's lines by recorded SKU weight, with a count fallback for
   * anything unweighed. That was an inference standing in for a document
   * ops already has in front of them, and it disagreed with the invoice
   * whenever the forwarder used volumetric weight, rounded up to the next
   * half kilo, or priced part of the shipment per piece — all routine.
   * The old code also had to reconcile a weighed pool against an
   * unweighed one, arithmetic that existed only to paper over the guess.
   *
   * Every counted line must be priced. Silently skipping one would make
   * those units free forever: a unit's freight is charged from its
   * allocation row as it leaves, and the charge path skips a unit that
   * has none.
   */
  async planFromPricedLines(
    goodsReceiptId: string,
    priced: readonly PricedLineInput[],
  ): Promise<{
    lines: readonly AllocationPlanLine[];
    totalUnits: number;
    totalInr: Prisma.Decimal;
  }> {
    const lines = await this.prisma.client.goodsReceiptLine.findMany({
      where: { receiptId: goodsReceiptId },
      select: { id: true, variantId: true, receivedQty: true },
    });
    const stocked = lines.filter((l) => l.receivedQty > 0);
    if (stocked.length === 0) {
      throw new BadRequestException({
        code: 'FREIGHT_NOTHING_COUNTED',
        message: 'This arrival has no counted units, so there is nothing to price.',
      });
    }

    const byId = new Map(priced.map((p) => [p.goodsReceiptLineId, p]));
    const missing = stocked.filter((l) => !byId.has(l.id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'FREIGHT_LINE_MISSING',
        message:
          `Every counted product needs a price — ${missing.length} ` +
          `${missing.length === 1 ? 'is' : 'are'} unpriced. A product left out would ship ` +
          `freight-free permanently, because a unit with no allocation is skipped when it leaves.`,
      });
    }
    const known = new Set(stocked.map((l) => l.id));
    const stray = priced.filter((p) => !known.has(p.goodsReceiptLineId));
    if (stray.length > 0) {
      throw new BadRequestException({
        code: 'FREIGHT_LINE_UNKNOWN',
        message: `${stray.length} priced line(s) are not counted products on this arrival.`,
      });
    }

    const variants = await this.catalog.getVariantsByIds(stocked.map((l) => l.variantId));

    const out: AllocationPlanLine[] = [];
    let totalInr = ZERO;
    let totalUnits = 0;
    for (const line of stocked) {
      const p = byId.get(line.id);
      /* istanbul ignore next — the missing check above already proved it */
      if (p === undefined) continue;

      if (p.rateInr.lt(0)) {
        throw new BadRequestException({
          code: 'FREIGHT_RATE_INVALID',
          message: 'A freight rate cannot be negative.',
        });
      }

      let lineTotal: Prisma.Decimal;
      if (p.basis === InboundFreightBasis.PER_KG) {
        if (p.chargeableWeightKg === null || p.chargeableWeightKg.lte(0)) {
          throw new BadRequestException({
            code: 'FREIGHT_WEIGHT_REQUIRED',
            message:
              'A per-kg line needs the chargeable weight the forwarder billed for. ' +
              'Use their figure — volumetric weight and rounding up are both normal, so a ' +
              'weight worked out from the catalogue would not match the invoice.',
          });
        }
        lineTotal = p.rateInr.mul(p.chargeableWeightKg).toDecimalPlaces(2);
      } else {
        lineTotal = p.rateInr.mul(line.receivedQty).toDecimalPlaces(2);
      }

      out.push({
        goodsReceiptLineId: line.id,
        variantId: line.variantId,
        units: line.receivedQty,
        unitWeightGrams: variants.get(line.variantId)?.weightGrams ?? null,
        basis: p.basis,
        rateInr: p.rateInr,
        chargeableWeightKg: p.basis === InboundFreightBasis.PER_KG ? p.chargeableWeightKg : null,
        lineTotalInr: lineTotal,
        // The per-unit share is what the charge path actually reads as a
        // unit leaves. 4dp so a line spread over many units does not
        // drift visibly.
        perUnitInr: lineTotal.div(line.receivedQty).toDecimalPlaces(4),
      });
      totalInr = totalInr.add(lineTotal);
      totalUnits += line.receivedQty;
    }

    if (totalInr.lte(0)) {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message:
          'The priced lines come to zero. A freight bill of nothing is not a bill — leave it ' +
          'unrecorded rather than recording a zero.',
      });
    }

    return { lines: out, totalUnits, totalInr };
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
