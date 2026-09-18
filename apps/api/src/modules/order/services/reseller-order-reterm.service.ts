import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, ResellerStockMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { ResellerStockGateService } from '../../reseller-order-gate/services/reseller-stock-gate.service';
import type { ResellerLineTerms } from '../reseller-order-snapshot';
import type { UpdateOrderDto } from '../dto/update-order.dto';

const D = Prisma.Decimal;

function inr(d: Prisma.Decimal): string {
  return `₹${d.toFixed(2)}`;
}

/**
 * The reseller TERMS for a replacement line set, when seller staff or the
 * store change what is IN a reseller store's order (owner, 2026-09-18).
 *
 * ── WHERE EACH FIGURE COMES FROM, AND WHY ────────────────────────────
 * A changed order is still the SAME deal under the SAME terms version —
 * ORD-6 / RS-4's "later edits never re-price". So:
 *
 *   the ORDER-LEVEL terms (the six fee shares, both credit timings, the
 *   version id) are NOT touched at all. They stay exactly as snapshotted
 *   at create. Nothing here reads `ResellerStoreTermsService`: re-pointing
 *   a placed order at a version published since would change a deal
 *   neither side agreed for it.
 *
 *   a line KEPT from the order keeps its own snapshotted transfer price
 *   and retail range, for the same reason.
 *
 *   a line ADDED has no snapshot to keep, so its transfer price and range
 *   come from the store's catalogue as it stands — the seller's own
 *   figure for that store. A variant the store is not offered, or offered
 *   with no price, is REFUSED BY NAME rather than given a price we made
 *   up: an invented transfer price is the seller being paid an amount
 *   nobody agreed, and it would be invisible in the money afterwards.
 *
 * ── THE RETAIL IS THE STORE'S, INSIDE THE SELLER'S RANGE ─────────────
 * `unitPriceInr` on the item IS the retail on a reseller order (the same
 * mapping `toCreateOrderDto` makes at create). Omitted, a kept line keeps
 * the retail it was placed at and an added line takes the catalogue's
 * suggested retail; with neither, it is refused rather than defaulted to
 * zero, which would tell the customer the goods were free.
 *
 * Every retail is checked against the range — the line's own snapshot for
 * a kept line, the catalogue's for a new one — for BOTH parties. Seller
 * staff set that range themselves, so it is not a restriction on the
 * store so much as the agreement both sides are working inside.
 */
export interface ResellerRetermInput {
  readonly orderId: string;
  readonly storeId: string;
  readonly sellerId: string;
  readonly items: NonNullable<UpdateOrderDto['items']>;
}

@Injectable()
export class ResellerOrderRetermService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: ResellerStockGateService,
    private readonly catalog: CatalogReadService,
  ) {}

  /**
   * One `ResellerLineTerms` per item, in the SAME order — the shape
   * `OrderService` writes onto `order_items`.
   */
  async retermLines(input: ResellerRetermInput): Promise<readonly ResellerLineTerms[]> {
    const variantIds = input.items.map((i) => i.variantId);
    const [existing, offers, names] = await Promise.all([
      this.prisma.client.orderItem.findMany({
        where: { orderId: input.orderId },
        select: {
          variantId: true,
          unitPriceInr: true,
          resellerTransferPriceInr: true,
          resellerRetailUnitInr: true,
          resellerMinRetailInr: true,
          resellerMaxRetailInr: true,
          resellerStockMode: true,
        },
      }),
      this.gate.offersFor({ id: input.storeId, sellerId: input.sellerId }, variantIds),
      this.catalog.getVariantsByIds([...new Set(variantIds)]),
    ]);
    const kept = new Map(existing.map((l) => [l.variantId, l]));
    const label = (variantId: string): string => {
      const v = names.get(variantId);
      return v !== undefined && v.sellerId === input.sellerId ? v.skuCode : 'This product';
    };

    return input.items.map((item) => {
      const was = kept.get(item.variantId);
      const offer = offers.get(item.variantId);
      const snapshotted =
        was?.resellerTransferPriceInr != null && was.resellerStockMode !== null ? was : null;

      const transferPriceInr =
        snapshotted?.resellerTransferPriceInr ?? offer?.price?.transferPriceInr ?? null;
      if (transferPriceInr === null) {
        // Never invented. The seller has not set a price for this product
        // in this store, so there is no figure either side agreed to.
        throw new ConflictException({
          code: 'RESELLER_VARIANT_NOT_OFFERED',
          message:
            `${label(item.variantId)} has no transfer price in this store’s catalogue, so it cannot be ` +
            'added to one of its orders. Set a price for it first, or leave the line off.',
          details: { variantId: item.variantId },
        });
      }
      if (snapshotted === null && (offer === undefined || !offer.enabled || !offer.resellable)) {
        throw new ConflictException({
          code: 'RESELLER_VARIANT_NOT_OFFERED',
          message: `${label(item.variantId)} is not in this store’s catalogue. Pick from the products the seller has turned on for you.`,
          details: { variantId: item.variantId },
        });
      }

      const minRetailInr = snapshotted?.resellerMinRetailInr ?? offer?.price?.minRetailInr ?? null;
      const maxRetailInr = snapshotted?.resellerMaxRetailInr ?? offer?.price?.maxRetailInr ?? null;

      const retail =
        item.unitPriceInr !== undefined
          ? new D(item.unitPriceInr)
          : (snapshotted?.resellerRetailUnitInr ?? offer?.price?.suggestedRetailInr ?? null);
      if (retail === null) {
        throw new BadRequestException({
          code: 'RESELLER_RETAIL_REQUIRED',
          message:
            `Say what ${label(item.variantId)} is being sold to the customer for. It was not on this ` +
            'order before and the seller has suggested no retail price for it.',
          details: { variantId: item.variantId },
        });
      }
      const tooLow = minRetailInr !== null && retail.lt(minRetailInr);
      const tooHigh = maxRetailInr !== null && retail.gt(maxRetailInr);
      if (tooLow || tooHigh) {
        const range =
          minRetailInr !== null && maxRetailInr !== null
            ? `between ${inr(minRetailInr)} and ${inr(maxRetailInr)}`
            : minRetailInr !== null
              ? `at ${inr(minRetailInr)} or more`
              : `at ${inr(maxRetailInr ?? new D(0))} or less`;
        throw new BadRequestException({
          code: 'RETAIL_OUT_OF_RANGE',
          message: `${label(item.variantId)} must be sold ${range}; ${inr(retail)} is outside it.`,
          details: {
            variantId: item.variantId,
            minRetailInr: minRetailInr?.toFixed(2) ?? null,
            maxRetailInr: maxRetailInr?.toFixed(2) ?? null,
          },
        });
      }

      const terms: ResellerLineTerms = {
        transferPriceInr,
        retailUnitInr: retail,
        minRetailInr,
        maxRetailInr,
        stockMode: snapshotted?.resellerStockMode ?? offer?.stockMode ?? ResellerStockMode.SHARED,
      };
      return terms;
    });
  }
}
