import { Injectable, Logger } from '@nestjs/common';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { StockAvailabilityService } from '../../inventory-shared/stock-availability.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import type { CoercedOrderGroup } from './order-csv-parser.service';

/** `inventory.early_reservation_enabled` — "Book Stock At Order Placement". */
export const EARLY_RESERVATION_KEY = 'inventory.early_reservation_enabled';

/** The seller-facing name of that setting. Spelt once, used in every sentence. */
export const EARLY_RESERVATION_LABEL = 'Book Stock At Order Placement';

/** At most this many SKUs are named; the rest are counted. */
const NAMED_SKU_LIMIT = 10;

/** How many SKU lookups run at once — this serves an HTTP request (SCALE-1). */
const SKU_LOOKUP_CONCURRENCY = 8;

export interface CsvStockShortfall {
  readonly skuCode: string;
  /** Units this FILE orders of it, summed across every row. */
  readonly requested: number;
  /** INV-3 `qtyAvailable` at the fulfilling warehouse, read once. */
  readonly available: number;
  readonly shortfall: number;
}

/**
 * What the client is told about stock before a single order is placed.
 *
 * `headline` / `waysForward` / `lasting` are the WHOLE of `message`, in
 * that order — the console emphasises the lasting part without
 * re-authoring any of it, so there is no second copy of this copy to
 * drift (FE-2: the server's words, surfaced verbatim).
 */
export interface OrderCsvStockCheck {
  /** `inventory.early_reservation_enabled` as resolved for this client. */
  readonly holdsAtPlacement: boolean;
  readonly oversold: readonly CsvStockShortfall[];
  /**
   * true ⇒ `/process` refuses this file unless the client switches the
   * setting. A `null` check (no oversell at all) is the quiet case.
   */
  readonly blocksImport: boolean;
  readonly headline: string;
  readonly waysForward: string | null;
  readonly lasting: string | null;
  /** The three above joined — the one string a non-UI caller gets. */
  readonly message: string;
}

function namedShortfalls(oversold: readonly CsvStockShortfall[]): string {
  const named = oversold
    .slice(0, NAMED_SKU_LIMIT)
    .map((s) => `${s.skuCode}: ${s.requested} ordered, ${s.available} available`)
    .join('; ');
  const unlisted = oversold.length - Math.min(oversold.length, NAMED_SKU_LIMIT);
  return unlisted > 0 ? `${named}; and ${unlisted} more SKU${unlisted === 1 ? '' : 's'}` : named;
}

/**
 * Does this file order more units than the client holds, and is that a
 * WARNING or a REFUSAL?
 *
 * ── WHY THE TWO MODES DIFFER (owner, 2026-11-09) ─────────────────────
 * `inventory.early_reservation_enabled` decides WHEN stock is claimed, and
 * that is what makes one oversell a note and the other a refusal:
 *
 *  - OFF (the default) — stock is claimed at CONFIRMED (ORD-10). Placing
 *    orders ahead of stock is legitimate here and happens every day: an
 *    Indian COD order is phoned before it is confirmed, and the stock for
 *    it may well land in the warehouse first. So an oversell is a
 *    WARNING — the SKUs and the shortfall are named on the preview and the
 *    client decides.
 *  - ON — the client has explicitly asked us to hold stock the MOMENT an
 *    order lands (R5). A file that oversells is asking for something we
 *    cannot do, so the import does not run.
 *
 * ── THE REFUSAL IS A DECISION, NOT A DEAD END (owner, 2026-11-09) ─────
 * Telling a client to go and find a setting is not an answer. The refusal
 * names the shortfall AND the two ways forward, and the second one is
 * takeable on the import page: proceeding switches their own override of
 * the setting to false and then imports. The copy has to say that the
 * switch is ACCOUNT-WIDE and LASTING — a client who reads it as "just for
 * this upload" has been misled by us — which is why `lasting` is a field
 * of its own rather than a clause somewhere in the middle of a paragraph.
 *
 * ── READS ONLY ───────────────────────────────────────────────────────
 * Nothing here writes `stock_movements`, `stock_levels` or
 * `stock_reservations`, and nothing here changes how the at-placement hold
 * itself behaves (`EarlyReservationService` stays best-effort, per line,
 * never throwing). Availability is the INV-3 scalar from
 * `StockAvailabilityService.computeBulk` — read ONCE per variant for the
 * whole file, never per row.
 *
 * ── FAILING OPEN ─────────────────────────────────────────────────────
 * Any failure in here returns `null` ("nothing to say") rather than
 * breaking the preview or refusing the import. The same argument
 * `EarlyReservationService` makes: the hold is best-effort, so a check in
 * front of it must not be the thing that turns an optimisation into an
 * outage. An unconfigured default warehouse is the same case — with no
 * warehouse there is no at-placement hold to be unable to honour.
 *
 * ── WHAT IT COUNTS, SAID PLAINLY ─────────────────────────────────────
 * The demand is THIS FILE's, summed per variant across every row (five
 * rows of 100 against 300 on hand is an oversell even though no single row
 * is). A re-upload that PATCHES orders already placed (ORD-9) therefore
 * counts those units again, while the stock they already hold is already
 * out of `qtyAvailable`. That is deliberate: the sentence the client reads
 * is about what the FILE orders, which stays true either way, and
 * resolving it would mean an order-existence query per group at preview
 * time. The refusal has a proceed route, so the worst case is a question,
 * not a wall.
 */
@Injectable()
export class OrderCsvStockCheckService {
  private readonly logger = new Logger(OrderCsvStockCheckService.name);

  constructor(
    private readonly catalog: CatalogReadService,
    private readonly availability: StockAvailabilityService,
    private readonly warehouses: WarehouseResolverService,
    private readonly settings: SettingsResolverService,
  ) {}

  async check(
    sellerId: string,
    groups: readonly CoercedOrderGroup[],
  ): Promise<OrderCsvStockCheck | null> {
    try {
      const demandBySku = new Map<string, number>();
      for (const g of groups) {
        for (const line of g.lines) {
          const sku = line.productSku.trim();
          if (sku === '' || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
          demandBySku.set(sku, (demandBySku.get(sku) ?? 0) + line.quantity);
        }
      }
      if (demandBySku.size === 0) return null;

      // Per VARIANT, not per SKU cell: two spellings of the same SKU are
      // one claim on one pile of stock.
      const demandByVariant = new Map<string, { skuCode: string; requested: number }>();
      const skus = [...demandBySku.keys()];
      for (let i = 0; i < skus.length; i += SKU_LOOKUP_CONCURRENCY) {
        const slice = skus.slice(i, i + SKU_LOOKUP_CONCURRENCY);
        const resolved = await Promise.all(
          slice.map(async (sku) => ({
            sku,
            variant: await this.catalog.getVariantBySku(sellerId, sku),
          })),
        );
        for (const { sku, variant } of resolved) {
          // A SKU that resolves to nothing is already refused BY NAME by
          // the row processor. Reporting it here too would say the same
          // thing twice in different words.
          if (variant === null) continue;
          const held = demandByVariant.get(variant.variantId);
          demandByVariant.set(variant.variantId, {
            skuCode: variant.skuCode,
            requested: (held?.requested ?? 0) + (demandBySku.get(sku) ?? 0),
          });
        }
      }
      if (demandByVariant.size === 0) return null;

      const warehouseId = await this.warehouses.getDefaultWarehouseId();
      const available = await this.availability.computeBulk({
        sellerId,
        variantIds: [...demandByVariant.keys()],
        warehouseId,
      });

      const oversold: CsvStockShortfall[] = [];
      for (const [variantId, { skuCode, requested }] of demandByVariant) {
        const have = available.get(variantId) ?? 0;
        if (requested > have) {
          oversold.push({ skuCode, requested, available: have, shortfall: requested - have });
        }
      }
      // Biggest gap first: the SKU that needs restocking most is the one
      // worth naming when only ten fit.
      oversold.sort((a, b) => b.shortfall - a.shortfall || a.skuCode.localeCompare(b.skuCode));

      // Nothing to say, and the setting is not even read: the common case
      // costs two aggregate queries and no more.
      if (oversold.length === 0) return null;

      const resolved = await this.settings.resolve(sellerId, EARLY_RESERVATION_KEY);
      return resolved.value === true ? this.refusal(oversold) : this.warning(oversold);
    } catch (err) {
      this.logger.warn(
        { sellerId, err: (err as Error).message },
        'Order CSV stock check could not be completed; import continues unchecked',
      );
      return null;
    }
  }

  /** Setting ON: the import does not run until the client decides. */
  private refusal(oversold: readonly CsvStockShortfall[]): OrderCsvStockCheck {
    const headline =
      `Your account is set to ${EARLY_RESERVATION_LABEL}, so stock is held the moment an order ` +
      `lands — and this file orders more units than you have available: ${namedShortfalls(oversold)}.`;
    const waysForward =
      'Either reduce the quantities in the file and upload it again, or import anyway — ' +
      `importing anyway switches ${EARLY_RESERVATION_LABEL} OFF for your account, so stock is ` +
      'reserved when the call centre confirms an order instead.';
    const lasting =
      'That switch applies to EVERY FUTURE ORDER, not only this file, and stays off until ' +
      'someone turns it back on. Stock already held for earlier orders stays held.';
    return {
      holdsAtPlacement: true,
      oversold,
      blocksImport: true,
      headline,
      waysForward,
      lasting,
      message: [headline, waysForward, lasting].join(' '),
    };
  }

  /** Setting OFF: a note, never a block — stock is claimed at CONFIRMED. */
  private warning(oversold: readonly CsvStockShortfall[]): OrderCsvStockCheck {
    const headline =
      `This file orders more units than you have available: ${namedShortfalls(oversold)}. ` +
      'Stock is reserved when the call centre confirms an order, not when it is placed, so these ' +
      'orders can still be imported — they will wait for stock, and a confirmation will be ' +
      'refused while there is none.';
    return {
      holdsAtPlacement: false,
      oversold,
      blocksImport: false,
      headline,
      waysForward: null,
      lasting: null,
      message: headline,
    };
  }
}
