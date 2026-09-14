import { Injectable } from '@nestjs/common';
import { Prisma, ResellerStockMode, ResellerStoreStatus, SellerStoreKind } from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { StockReadService } from '../../inventory-stock/services/stock-read.service';
import { InsufficientStockError } from '../../inventory-stock/services/stock-reservation.service';
import {
  othersUnusedSetAside,
  visibleQuantity,
} from '../../reseller-catalogue/services/reseller-visible-stock';
import { allowanceForLine, type SetAsideCommitment } from '../reseller-set-aside-rules';

/**
 * Store statuses whose set-asides HOLD stock (RS-3). A pending store may
 * be set up before the seller approves it, so its commitment counts; a
 * closed or rejected store's never does. Restated from the catalogue
 * module on purpose: this primitive is imported BY that module, so it
 * cannot import it back — `reseller-stock-gate.service.spec.ts` pins the
 * two lists equal.
 */
export const GATE_COMMITTING_STORE_STATUSES: readonly ResellerStoreStatus[] = [
  ResellerStoreStatus.PENDING_SELLER_APPROVAL,
  ResellerStoreStatus.ACTIVE,
  ResellerStoreStatus.PAUSED,
];

type Db = Prisma.TransactionClient;

/** What ONE store may sell of ONE variant right now, and at what terms. */
export interface ResellerOffer {
  readonly variantId: string;
  /** The seller's, not archived or deleted, product active. */
  readonly resellable: boolean;
  readonly enabled: boolean;
  /** Override row if the store has one, else the seller's default — per ROW (RS-3). */
  readonly price: {
    readonly transferPriceInr: Prisma.Decimal;
    readonly minRetailInr: Prisma.Decimal | null;
    readonly maxRetailInr: Prisma.Decimal | null;
    readonly suggestedRetailInr: Prisma.Decimal | null;
  } | null;
  readonly stockMode: ResellerStockMode;
  /** What the store is SHOWN — the catalogue's own figure (RS-3). */
  readonly visibleQty: number;
}

/**
 * RS-5 — the ONE place a reseller set-aside is turned into "may this
 * order have these units", and the one place a store's consumption of
 * its set-aside is read.
 *
 * ── A DEPENDENCY-FREE PRIMITIVE (R3) ─────────────────────────────────
 * Three callers need it: order confirmation (`OrderWriteService`), store
 * order create (`ResellerOrderService`) and the store catalogue
 * (`ResellerCatalogueService`, for `consumedByStore`). It imports neither
 * the order module nor the catalogue module — only the catalogue read
 * boundary and inventory-stock's sanctioned read surface — so all three
 * can import it without a cycle and without `forwardRef`.
 *
 * ── STOCK IS READ, NEVER WRITTEN ─────────────────────────────────────
 * It never reserves: M5's `reserve()` does, with this module's guard
 * running inside the reservation's own transaction (see `guardFor`).
 */
@Injectable()
export class ResellerStockGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockReadService,
    private readonly catalog: CatalogReadService,
  ) {}

  /**
   * How much of each variant each of the seller's reseller stores is
   * holding right now (Σ its orders' ACTIVE reservations) — RS-3's
   * `consumedByStore`, answered.
   */
  async consumption(
    sellerId: string,
    variantIds: readonly string[],
    db?: Db,
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    return this.stock.activeReservedByResellerStore(sellerId, variantIds, db);
  }

  /** Every live store's set-aside of these variants, with what it has used. */
  async commitments(
    sellerId: string,
    variantIds: readonly string[],
    db?: Db,
  ): Promise<ReadonlyMap<string, readonly SetAsideCommitment[]>> {
    const ids = [...new Set(variantIds)];
    const out = new Map<string, SetAsideCommitment[]>();
    if (ids.length === 0) return out;
    const client = db ?? this.prisma.client;
    const [rows, used] = await Promise.all([
      client.resellerStoreVariant.findMany({
        where: {
          sellerId,
          variantId: { in: ids },
          stockMode: ResellerStockMode.SET_ASIDE,
          store: {
            kind: SellerStoreKind.RESELLER,
            status: { in: [...GATE_COMMITTING_STORE_STATUSES] },
            deletedAt: null,
          },
        },
        select: { storeId: true, variantId: true, setAsideQty: true },
      }),
      this.consumption(sellerId, ids, db),
    ]);
    for (const r of rows) {
      const list = out.get(r.variantId) ?? [];
      list.push({
        storeId: r.storeId,
        setAsideQty: r.setAsideQty ?? 0,
        consumed: used.get(r.storeId)?.get(r.variantId) ?? 0,
      });
      out.set(r.variantId, list);
    }
    return out;
  }

  /**
   * The guard M5's `reserve()` runs for ONE order line at confirmation,
   * inside the reservation's own transaction (RS-5).
   *
   * Takes `AdvisoryLock.RESELLER_SET_ASIDE` on (seller, variant) — the
   * SAME key the set-aside save and the shrink sweep take — then reads
   * the commitments and real availability INSIDE that transaction and
   * refuses with `InsufficientStockError` (which the order saga already
   * routes to OUT_OF_STOCK, visibly) when the line may not have the units.
   * The lock is held until the reservation commits, so the next confirm
   * for the same variant counts it as consumed.
   *
   * A CHANNEL line of a variant no live store has set anything aside for
   * returns straight after the read: there is nothing to protect, and the
   * seller's orders behave exactly as they did before RS-5.
   */
  guardFor(line: {
    readonly sellerId: string;
    readonly variantId: string;
    readonly qty: number;
    /** The order's store when it is a RESELLER order; null for a channel order. */
    readonly resellerStoreId: string | null;
  }): (tx: Db) => Promise<void> {
    return async (tx: Db): Promise<void> => {
      await takeAdvisoryLock(
        tx,
        AdvisoryLock.RESELLER_SET_ASIDE,
        `${line.sellerId}|${line.variantId}`,
      );
      const commitments = (await this.commitments(line.sellerId, [line.variantId], tx)).get(
        line.variantId,
      );
      if (line.resellerStoreId === null && (commitments ?? []).length === 0) return;
      const real =
        (await this.stock.getSellableStockLive(line.sellerId, [line.variantId], tx)).get(
          line.variantId,
        )?.available ?? 0;
      const { allowance } = allowanceForLine({
        orderStoreId: line.resellerStoreId,
        realAvailable: real,
        commitments: commitments ?? [],
      });
      if (line.qty > allowance) {
        throw new InsufficientStockError(line.qty, allowance);
      }
    };
  }

  /**
   * What ONE store may sell of these variants right now: enabled,
   * resellable, the effective price (override row ?? default row — per
   * ROW, RS-3) and the quantity it is SHOWN. The same inputs the store's
   * catalogue page is built from, so "the qty you may order" and "the
   * qty you were shown" are one figure.
   */
  async offersFor(
    store: { readonly id: string; readonly sellerId: string },
    variantIds: readonly string[],
  ): Promise<ReadonlyMap<string, ResellerOffer>> {
    const ids = [...new Set(variantIds)];
    const out = new Map<string, ResellerOffer>();
    if (ids.length === 0) return out;
    const [rows, defaults, resellable, stock, commitments] = await Promise.all([
      this.prisma.client.resellerStoreVariant.findMany({
        where: { storeId: store.id, variantId: { in: ids } },
        select: {
          variantId: true,
          enabled: true,
          transferPriceInr: true,
          minRetailInr: true,
          maxRetailInr: true,
          suggestedRetailInr: true,
          stockMode: true,
          setAsideQty: true,
          hiddenPercent: true,
        },
      }),
      this.prisma.client.resellerPriceListItem.findMany({
        where: { sellerId: store.sellerId, variantId: { in: ids } },
        select: {
          variantId: true,
          transferPriceInr: true,
          minRetailInr: true,
          maxRetailInr: true,
          suggestedRetailInr: true,
        },
      }),
      this.catalog.listResellableVariants(store.sellerId, ids),
      this.stock.getSellableStockLive(store.sellerId, ids),
      this.commitments(store.sellerId, ids),
    ]);
    const rowBy = new Map(rows.map((r) => [r.variantId, r]));
    const defaultBy = new Map(defaults.map((d) => [d.variantId, d]));
    const resellableIds = new Set(resellable.variants.map((v) => v.variantId));
    for (const id of ids) {
      const row = rowBy.get(id);
      const def = defaultBy.get(id);
      const override =
        row !== undefined && row.transferPriceInr !== null
          ? {
              transferPriceInr: row.transferPriceInr,
              minRetailInr: row.minRetailInr,
              maxRetailInr: row.maxRetailInr,
              suggestedRetailInr: row.suggestedRetailInr,
            }
          : null;
      const price =
        override ??
        (def === undefined
          ? null
          : {
              transferPriceInr: def.transferPriceInr,
              minRetailInr: def.minRetailInr,
              maxRetailInr: def.maxRetailInr,
              suggestedRetailInr: def.suggestedRetailInr,
            });
      const list = commitments.get(id) ?? [];
      const own = list.find((c) => c.storeId === store.id);
      const stockMode = row?.stockMode ?? ResellerStockMode.SHARED;
      out.set(id, {
        variantId: id,
        resellable: resellableIds.has(id),
        enabled: row?.enabled ?? false,
        price,
        stockMode,
        visibleQty: visibleQuantity({
          mode: stockMode === ResellerStockMode.SET_ASIDE ? 'SET_ASIDE' : 'SHARED',
          setAsideQty: row?.setAsideQty ?? null,
          hiddenPercent: row?.hiddenPercent ?? 0,
          realAvailable: stock.get(id)?.available ?? 0,
          othersUnusedSetAside: othersUnusedSetAside(
            list
              .filter((c) => c.storeId !== store.id)
              .map((c) => ({ setAsideQty: c.setAsideQty, consumedByStore: c.consumed })),
          ),
          consumedByStore: own?.consumed ?? 0,
        }),
      });
    }
    return out;
  }
}
