import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ActorType,
  Prisma,
  ResellerStockMode,
  ResellerStoreStatus,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  CatalogReadService,
  type ResellableVariant,
} from '../../catalog-read/services/catalog-read.service';
import { StockReadService } from '../../inventory-stock/services/stock-read.service';
import { checkPrice, normaliseAmount, type PriceInput } from './reseller-price-rules';
import {
  CONSUMED_BY_STORE_BEFORE_ORDERS,
  MAX_HIDDEN_PERCENT,
  freeToSetAside,
  othersUnusedSetAside,
  visibleQuantity,
} from './reseller-visible-stock';

/**
 * Store statuses whose set-asides HOLD stock. A pending store may be set
 * up before the seller approves it, so its commitment counts; a closed or
 * rejected store's never does (and its terms can no longer be edited).
 */
export const COMMITTING_STORE_STATUSES: readonly ResellerStoreStatus[] = [
  ResellerStoreStatus.PENDING_SELLER_APPROVAL,
  ResellerStoreStatus.ACTIVE,
  ResellerStoreStatus.PAUSED,
];

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_MAX_BYTES = 2 * 1_048_576;
const IMAGES_PER_VARIANT = 5;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;

export interface PriceTermsView {
  readonly transferPriceInr: string;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
}

export interface PriceListRow {
  readonly variantId: string;
  readonly productId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly thumbnailUrl: string | null;
  /** Pickable on-hand across fulfilling warehouses (the set-aside basis). */
  readonly onHand: number;
  /** INV-3 availability across fulfilling warehouses. */
  readonly available: number;
  readonly price: PriceTermsView | null;
  /** Live stores that sell this variant (enabled). */
  readonly enabledInStores: number;
}

export interface PriceListView {
  readonly rows: readonly PriceListRow[];
  readonly truncated: boolean;
}

export type NotSellableReason = 'NOT_ENABLED' | 'NO_TRANSFER_PRICE' | 'VARIANT_NOT_RESELLABLE';

export interface StoreTermsRow {
  readonly variantId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly resellable: boolean;
  readonly defaultPrice: PriceTermsView | null;
  readonly override: PriceTermsView | null;
  readonly effective: PriceTermsView | null;
  readonly priceSource: 'OVERRIDE' | 'DEFAULT' | null;
  readonly enabled: boolean;
  readonly stockMode: ResellerStockMode;
  readonly setAsideQty: number | null;
  readonly hiddenPercent: number;
  readonly overlayTitle: string | null;
  readonly overlayDescription: string | null;
  readonly overlayImages: ReadonlyArray<{ readonly id: string; readonly url: string | null }>;
  readonly onHand: number;
  readonly realAvailable: number;
  /** Σ set-aside for this seller's OTHER live stores. */
  readonly otherStoresSetAside: number;
  /** How much this store could be given as a set-aside right now. */
  readonly freeToSetAside: number;
  /** What the store is shown — the same arithmetic the store's own page uses. */
  readonly visibleQty: number;
  readonly sellable: boolean;
  readonly notSellableReason: NotSellableReason | null;
}

export interface SetAsideShrinkView {
  readonly id: string;
  readonly variantId: string;
  readonly skuCode: string | null;
  readonly fromQty: number;
  readonly toQty: number;
  readonly onHand: number;
  readonly createdAt: string;
}

export interface StoreTermsView {
  readonly storeId: string;
  readonly storeName: string;
  readonly storeStatus: ResellerStoreStatus | null;
  readonly rows: readonly StoreTermsRow[];
  readonly truncated: boolean;
  readonly recentShrinks: readonly SetAsideShrinkView[];
}

/** What the STORE sees of one product — nothing about cost, stock or other stores. */
export interface StoreCatalogueItem {
  readonly variantId: string;
  readonly skuCode: string;
  readonly title: string;
  readonly variantLabel: string | null;
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly transferPriceInr: string;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
  readonly availableQty: number;
}

export interface StoreCatalogueView {
  readonly items: readonly StoreCatalogueItem[];
}

export interface SellerActor {
  readonly sellerId: string;
  readonly sellerUserId: string;
}

export interface SaveStoreTermsInput {
  readonly enabled: boolean;
  /** null / absent ⇒ no override: the seller's default applies. */
  readonly priceOverride?: PriceInput | null;
  readonly stockMode: ResellerStockMode;
  readonly setAsideQty?: number | null;
  readonly hiddenPercent: number;
  readonly overlayTitle?: string | null;
  readonly overlayDescription?: string | null;
}

export interface OverlayImagePresign {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  readonly maxSizeBytes: number;
}

type PriceRow = {
  transferPriceInr: Prisma.Decimal | null;
  minRetailInr: Prisma.Decimal | null;
  maxRetailInr: Prisma.Decimal | null;
  suggestedRetailInr: Prisma.Decimal | null;
};

function money(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

function priceView(row: PriceRow | null | undefined): PriceTermsView | null {
  if (row === null || row === undefined || row.transferPriceInr === null) return null;
  return {
    transferPriceInr: row.transferPriceInr.toFixed(2),
    minRetailInr: money(row.minRetailInr),
    maxRetailInr: money(row.maxRetailInr),
    suggestedRetailInr: money(row.suggestedRetailInr),
  };
}

/** A price for an audit row's JSON (a spread is an index-compatible object). */
function priceJson(p: PriceTermsView | null): Prisma.InputJsonObject | null {
  return p === null ? null : { ...p };
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t === undefined || t === '' ? null : t;
}

/**
 * RS-3 — a seller's reseller catalogue: the default price list, each
 * store's terms per variant, the store's own view, and the overlay.
 *
 * ── SCOPE IS ALWAYS IN THE WHERE ─────────────────────────────────────
 * Seller calls carry the seller id from the token and every store read
 * includes it; the store's view takes the store id from ITS token. A
 * miss is a 404 that says nothing about whether the row exists.
 *
 * ── STOCK IS READ, NEVER WRITTEN ─────────────────────────────────────
 * Availability comes live from `StockReadService.getSellableStockLive`
 * (inventory-stock's sanctioned surface, INV-2/INV-3); this module
 * writes only its own rows. The visible quantity is computed on every
 * read by `reseller-visible-stock.ts` and never stored.
 */
@Injectable()
export class ResellerCatalogueService {
  private readonly logger = new Logger(ResellerCatalogueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogReadService,
    private readonly stock: StockReadService,
    private readonly audit: AuditLogService,
    private readonly spaces: SpacesService,
  ) {}

  // ── The seller's default price list ────────────────────────────────

  async sellerPriceList(sellerId: string): Promise<PriceListView> {
    const { variants, truncated } = await this.catalog.listResellableVariants(sellerId);
    const ids = variants.map((v) => v.variantId);
    const [prices, stock, thumbs, enabledCounts] = await Promise.all([
      this.prisma.client.resellerPriceListItem.findMany({ where: { sellerId } }),
      this.stock.getSellableStockLive(sellerId, ids),
      this.thumbnails(ids),
      this.prisma.client.resellerStoreVariant.groupBy({
        by: ['variantId'],
        where: {
          sellerId,
          enabled: true,
          store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
        },
        _count: { _all: true },
      }),
    ]);
    const priceBy = new Map(prices.map((p) => [p.variantId, p]));
    const countBy = new Map(enabledCounts.map((c) => [c.variantId, c._count._all]));
    return {
      truncated,
      rows: variants.map((v) => {
        const s = stock.get(v.variantId);
        return {
          variantId: v.variantId,
          productId: v.productId,
          productName: v.productName,
          skuCode: v.skuCode,
          variantLabel: v.variantLabel,
          thumbnailUrl: thumbs.get(v.variantId) ?? null,
          onHand: s?.onHand ?? 0,
          available: s?.available ?? 0,
          price: priceView(priceBy.get(v.variantId)),
          enabledInStores: countBy.get(v.variantId) ?? 0,
        };
      }),
    };
  }

  async setDefaultPrice(
    actor: SellerActor,
    variantId: string,
    input: PriceInput,
  ): Promise<PriceTermsView> {
    await this.requireResellable(actor.sellerId, variantId);
    this.assertPrice(input);
    const data = {
      transferPriceInr: normaliseAmount(input.transferPriceInr) ?? '0',
      minRetailInr: normaliseAmount(input.minRetailInr),
      maxRetailInr: normaliseAmount(input.maxRetailInr),
      suggestedRetailInr: normaliseAmount(input.suggestedRetailInr),
    };
    const before = await this.prisma.client.resellerPriceListItem.findUnique({
      where: { sellerId_variantId: { sellerId: actor.sellerId, variantId } },
    });
    const row = await this.prisma.client.resellerPriceListItem.upsert({
      where: { sellerId_variantId: { sellerId: actor.sellerId, variantId } },
      create: { sellerId: actor.sellerId, variantId, ...data },
      update: data,
    });
    const after = priceView(row);
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId: actor.sellerId,
      action: 'seller.reseller_price.set',
      entityType: 'reseller_price_list_item',
      entityId: row.id,
      severity: 'MEDIUM',
      changes: { before: priceJson(priceView(before)), after: priceJson(after) },
      metadata: { variantId },
    });
    if (after === null) {
      throw new ConflictException({ code: 'PRICE_NOT_SAVED', message: 'The price was not saved' });
    }
    return after;
  }

  async removeDefaultPrice(actor: SellerActor, variantId: string): Promise<void> {
    const relying = await this.prisma.client.resellerStoreVariant.findMany({
      where: {
        sellerId: actor.sellerId,
        variantId,
        enabled: true,
        transferPriceInr: null,
        store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
      },
      select: { store: { select: { name: true } } },
    });
    if (relying.length > 0) {
      const names = relying.map((r) => `“${r.store.name}”`).join(', ');
      throw new ConflictException({
        code: 'DEFAULT_PRICE_IN_USE',
        message:
          `${names} sell this product at your default price. Give ${relying.length === 1 ? 'it' : 'them'} ` +
          'a price of its own, or turn the product off there, before removing the default.',
      });
    }
    const before = await this.prisma.client.resellerPriceListItem.findUnique({
      where: { sellerId_variantId: { sellerId: actor.sellerId, variantId } },
    });
    if (before === null) {
      throw new NotFoundException({
        code: 'PRICE_NOT_FOUND',
        message: 'This product has no default reseller price',
      });
    }
    await this.prisma.client.resellerPriceListItem.deleteMany({
      where: { sellerId: actor.sellerId, variantId },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId: actor.sellerId,
      action: 'seller.reseller_price.removed',
      entityType: 'reseller_price_list_item',
      entityId: before.id,
      severity: 'MEDIUM',
      changes: { before: priceJson(priceView(before)), after: null },
      metadata: { variantId },
    });
  }

  // ── One store's terms (the seller's and Skydrop's view) ────────────

  /** `sellerId` null is the admin read (any seller, read-only). */
  async storeTerms(storeId: string, sellerId: string | null): Promise<StoreTermsView> {
    const store = await this.loadStore(storeId, sellerId);
    const { variants, truncated } = await this.catalog.listResellableVariants(store.sellerId);
    const rows = await this.prisma.client.resellerStoreVariant.findMany({
      where: { storeId: store.id },
      include: {
        images: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      },
    });
    const rowBy = new Map(rows.map((r) => [r.variantId, r]));
    const resellableIds = new Set(variants.map((v) => v.variantId));

    // Rows for variants that stopped being resellable (archived since)
    // stay visible to the seller, named, so a term is never lost silently.
    const orphanIds = rows.map((r) => r.variantId).filter((id) => !resellableIds.has(id));
    const orphans =
      orphanIds.length === 0 ? new Map() : await this.catalog.getVariantsByIds(orphanIds);
    const listed: Array<{
      readonly variantId: string;
      readonly productName: string;
      readonly skuCode: string;
      readonly variantLabel: string | null;
      readonly resellable: boolean;
    }> = [
      ...variants.map((v) => ({ ...v, resellable: true })),
      ...orphanIds.flatMap((id) => {
        const v = orphans.get(id);
        return v === undefined || v.sellerId !== store.sellerId
          ? []
          : [
              {
                variantId: id,
                productName: v.productName,
                skuCode: v.skuCode,
                variantLabel: v.variantLabel,
                resellable: false,
              },
            ];
      }),
    ];
    const ids = listed.map((v) => v.variantId);

    const [prices, stock, thumbs, others, shrinks] = await Promise.all([
      this.prisma.client.resellerPriceListItem.findMany({
        where: { sellerId: store.sellerId, variantId: { in: ids } },
      }),
      this.stock.getSellableStockLive(store.sellerId, ids),
      this.thumbnails(ids),
      this.otherStoresSetAside(store.sellerId, store.id, ids),
      this.prisma.client.resellerSetAsideShrink.findMany({
        where: { storeId: store.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const priceBy = new Map(prices.map((p) => [p.variantId, p]));

    const out: StoreTermsRow[] = [];
    for (const v of listed) {
      const row = rowBy.get(v.variantId);
      const defaultPrice = priceView(priceBy.get(v.variantId));
      const override = priceView(row);
      const effective = override ?? defaultPrice;
      const enabled = row?.enabled ?? false;
      const stockMode = row?.stockMode ?? ResellerStockMode.SHARED;
      const hiddenPercent = row?.hiddenPercent ?? 0;
      const s = stock.get(v.variantId) ?? { onHand: 0, available: 0 };
      const otherRows = others.get(v.variantId) ?? [];
      const otherSum = otherRows.reduce((sum, r) => sum + r.setAsideQty, 0);
      const reason: NotSellableReason | null = !v.resellable
        ? 'VARIANT_NOT_RESELLABLE'
        : !enabled
          ? 'NOT_ENABLED'
          : effective === null
            ? 'NO_TRANSFER_PRICE'
            : null;
      out.push({
        variantId: v.variantId,
        productName: v.productName,
        skuCode: v.skuCode,
        variantLabel: v.variantLabel,
        thumbnailUrl: thumbs.get(v.variantId) ?? null,
        resellable: v.resellable,
        defaultPrice,
        override,
        effective,
        priceSource: override !== null ? 'OVERRIDE' : defaultPrice !== null ? 'DEFAULT' : null,
        enabled,
        stockMode,
        setAsideQty: row?.setAsideQty ?? null,
        hiddenPercent,
        overlayTitle: row?.overlayTitle ?? null,
        overlayDescription: row?.overlayDescription ?? null,
        overlayImages: await Promise.all(
          (row?.images ?? []).map(async (img) => ({
            id: img.id,
            url: await this.presignSafe(img.storageKey),
          })),
        ),
        onHand: s.onHand,
        realAvailable: s.available,
        otherStoresSetAside: otherSum,
        freeToSetAside: freeToSetAside(s.onHand, otherSum),
        visibleQty: this.visibleFor(store.id, v.variantId, {
          stockMode,
          setAsideQty: row?.setAsideQty ?? null,
          hiddenPercent,
          available: s.available,
          otherRows,
        }),
        sellable: reason === null,
        notSellableReason: reason,
      });
    }

    const skuBy = new Map(listed.map((v) => [v.variantId, v.skuCode]));
    return {
      storeId: store.id,
      storeName: store.name,
      storeStatus: store.status,
      truncated,
      rows: out,
      recentShrinks: shrinks.map((s) => ({
        id: s.id,
        variantId: s.variantId,
        skuCode: skuBy.get(s.variantId) ?? null,
        fromQty: s.fromQty,
        toQty: s.toQty,
        onHand: s.onHand,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Save one store's terms for one variant — a PUT: the whole set is
   * written, idempotent by shape (upsert on (store, variant)).
   *
   * The set-aside guard runs under `AdvisoryLock.RESELLER_SET_ASIDE` on
   * (seller, variant), INSIDE the transaction that writes, and only when
   * the save GROWS the commitment: Σ set-asides of the seller's live
   * stores may not exceed pickable on-hand. A decrease is always allowed
   * — refusing somebody who is trying to promise LESS, because stock fell
   * after they last saved, would only leave the over-commitment in place
   * for the sweep to cut.
   */
  async saveStoreTerms(
    actor: SellerActor,
    storeId: string,
    variantId: string,
    input: SaveStoreTermsInput,
  ): Promise<StoreTermsView> {
    const store = await this.loadStore(storeId, actor.sellerId);
    this.assertNotFinal(store.status);
    await this.requireOwnVariant(actor.sellerId, variantId);
    const resellable =
      (await this.catalog.listResellableVariants(actor.sellerId, [variantId])).variants.length > 0;
    if (input.enabled && !resellable) {
      throw new ConflictException({
        code: 'VARIANT_NOT_RESELLABLE',
        message:
          'This product is archived, deleted or not active, so no store can be given it. Turn it off here instead.',
      });
    }

    const override =
      input.priceOverride === null || input.priceOverride === undefined
        ? null
        : input.priceOverride;
    if (override !== null) this.assertPrice(override);

    const hidden = input.hiddenPercent;
    if (!Number.isInteger(hidden) || hidden < 0 || hidden > MAX_HIDDEN_PERCENT) {
      throw new BadRequestException({
        code: 'HIDDEN_PERCENT_OUT_OF_RANGE',
        message: `The hidden share must be a whole percentage from 0 to ${MAX_HIDDEN_PERCENT}.`,
      });
    }
    const newQty = input.stockMode === ResellerStockMode.SET_ASIDE ? input.setAsideQty : null;
    if (
      input.stockMode === ResellerStockMode.SET_ASIDE &&
      (newQty === null || newQty === undefined || !Number.isInteger(newQty) || newQty < 0)
    ) {
      throw new BadRequestException({
        code: 'SET_ASIDE_QTY_REQUIRED',
        message: 'Say how many units to set aside for this store (0 or more).',
      });
    }
    const title = trimOrNull(input.overlayTitle);
    const description = trimOrNull(input.overlayDescription);
    if ((title?.length ?? 0) > TITLE_MAX || (description?.length ?? 0) > DESCRIPTION_MAX) {
      throw new BadRequestException({
        code: 'OVERLAY_TOO_LONG',
        message: `A title may be ${TITLE_MAX} characters and a description ${DESCRIPTION_MAX}.`,
      });
    }

    if (input.enabled) {
      const def = await this.prisma.client.resellerPriceListItem.findUnique({
        where: { sellerId_variantId: { sellerId: actor.sellerId, variantId } },
        select: { transferPriceInr: true },
      });
      if (override === null && def === null) {
        throw new ConflictException({
          code: 'TRANSFER_PRICE_REQUIRED',
          message:
            'This product has no reseller price. Set one on your price list, or give this store its own, before turning it on.',
        });
      }
    }

    const priceData =
      override === null
        ? {
            transferPriceInr: null,
            minRetailInr: null,
            maxRetailInr: null,
            suggestedRetailInr: null,
          }
        : {
            transferPriceInr: normaliseAmount(override.transferPriceInr),
            minRetailInr: normaliseAmount(override.minRetailInr),
            maxRetailInr: normaliseAmount(override.maxRetailInr),
            suggestedRetailInr: normaliseAmount(override.suggestedRetailInr),
          };

    const { before, after } = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.RESELLER_SET_ASIDE, `${actor.sellerId}|${variantId}`);
      const prior = await tx.resellerStoreVariant.findUnique({
        where: { storeId_variantId: { storeId: store.id, variantId } },
      });
      const qty = newQty ?? null;
      const grows =
        qty !== null &&
        (prior === null ||
          prior.stockMode !== ResellerStockMode.SET_ASIDE ||
          qty > (prior.setAsideQty ?? 0));
      if (grows) {
        const others = await tx.resellerStoreVariant.aggregate({
          where: {
            sellerId: actor.sellerId,
            variantId,
            stockMode: ResellerStockMode.SET_ASIDE,
            storeId: { not: store.id },
            store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
          },
          _sum: { setAsideQty: true },
        });
        const othersSum = others._sum.setAsideQty ?? 0;
        const onHand =
          (await this.stock.getSellableStockLive(actor.sellerId, [variantId])).get(variantId)
            ?.onHand ?? 0;
        const free = freeToSetAside(onHand, othersSum);
        if (qty > free) {
          throw new ConflictException({
            code: 'SET_ASIDE_EXCEEDS_STOCK',
            message:
              `Only ${free} can be set aside for this store: ${onHand} on hand, ` +
              `${othersSum} already set aside for your other stores.`,
            free,
            onHand,
            otherStoresSetAside: othersSum,
          });
        }
      }
      const setAsideAt =
        qty === null ? null : grows ? new Date() : (prior?.setAsideAt ?? new Date());
      const data = {
        enabled: input.enabled,
        ...priceData,
        stockMode: input.stockMode,
        setAsideQty: qty,
        setAsideAt,
        hiddenPercent: hidden,
        overlayTitle: title,
        overlayDescription: description,
      };
      const saved = await tx.resellerStoreVariant.upsert({
        where: { storeId_variantId: { storeId: store.id, variantId } },
        create: { storeId: store.id, sellerId: actor.sellerId, variantId, ...data },
        update: data,
      });
      return { before: prior, after: saved };
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId: actor.sellerId,
      action: 'seller.reseller_store_terms.saved',
      entityType: 'reseller_store_variant',
      entityId: after.id,
      severity: 'MEDIUM',
      changes: {
        before: before === null ? null : termsForAudit(before),
        after: termsForAudit(after),
      },
      metadata: { storeId: store.id, variantId },
    });
    return this.storeTerms(store.id, actor.sellerId);
  }

  // ── The overlay's pictures ─────────────────────────────────────────

  async presignOverlayImage(
    actor: SellerActor,
    storeId: string,
    variantId: string,
    mimeType: string,
  ): Promise<OverlayImagePresign> {
    const store = await this.loadStore(storeId, actor.sellerId);
    this.assertNotFinal(store.status);
    await this.requireOwnVariant(actor.sellerId, variantId);
    this.assertMime(mimeType);
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
    const token = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
    const storageKey = `${overlayPrefix(store.id, variantId)}${token}.${ext}`;
    return {
      storageKey,
      uploadUrl: await this.spaces.presignPutUrl(storageKey, mimeType, 300),
      expiresInSeconds: 300,
      maxSizeBytes: IMAGE_MAX_BYTES,
    };
  }

  async registerOverlayImage(
    actor: SellerActor,
    storeId: string,
    variantId: string,
    storageKey: string,
    mimeType: string,
  ): Promise<StoreTermsView> {
    const store = await this.loadStore(storeId, actor.sellerId);
    this.assertNotFinal(store.status);
    await this.requireOwnVariant(actor.sellerId, variantId);
    this.assertMime(mimeType);
    // Under THIS store's and THIS variant's prefix only — a key from
    // another store's upload is refused, not adopted.
    if (!storageKey.startsWith(overlayPrefix(store.id, variantId)) || storageKey.includes('..')) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'storageKey must be one this store and product were given by /presign',
      });
    }
    const head = await this.spaces.headObject(storageKey);
    if (head === null) {
      throw new BadRequestException({
        code: 'IMAGE_NOT_UPLOADED',
        message: 'Upload the file first',
      });
    }
    if (head.size > IMAGE_MAX_BYTES) {
      throw new BadRequestException({
        code: 'IMAGE_TOO_LARGE',
        message: 'A picture may be at most 2 MB',
      });
    }
    const image = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.RESELLER_SET_ASIDE, `${actor.sellerId}|${variantId}`);
      // The overlay hangs off the store's row for the variant; one is
      // created (sold nowhere, SHARED) when a picture comes first.
      const row = await tx.resellerStoreVariant.upsert({
        where: { storeId_variantId: { storeId: store.id, variantId } },
        create: { storeId: store.id, sellerId: actor.sellerId, variantId },
        update: {},
        select: { id: true },
      });
      const count = await tx.resellerStoreVariantImage.count({
        where: { storeVariantId: row.id, deletedAt: null },
      });
      if (count >= IMAGES_PER_VARIANT) {
        throw new ConflictException({
          code: 'IMAGE_LIMIT',
          message: `A store may have at most ${IMAGES_PER_VARIANT} pictures of one product. Remove one first.`,
        });
      }
      return tx.resellerStoreVariantImage.create({
        data: { storeVariantId: row.id, storageKey, mimeType, position: count },
      });
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId: actor.sellerId,
      action: 'seller.reseller_overlay_image.added',
      entityType: 'reseller_store_variant_image',
      entityId: image.id,
      severity: 'LOW',
      metadata: { storeId: store.id, variantId, storageKey },
    });
    return this.storeTerms(store.id, actor.sellerId);
  }

  async removeOverlayImage(
    actor: SellerActor,
    storeId: string,
    variantId: string,
    imageId: string,
  ): Promise<StoreTermsView> {
    const store = await this.loadStore(storeId, actor.sellerId);
    // Soft delete, scoped in the WHERE by store, variant AND seller.
    const changed = await this.prisma.client.resellerStoreVariantImage.updateMany({
      where: {
        id: imageId,
        deletedAt: null,
        storeVariant: { storeId: store.id, variantId, sellerId: actor.sellerId },
      },
      data: { deletedAt: new Date() },
    });
    if (changed.count === 0) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: 'No such picture' });
    }
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId: actor.sellerId,
      action: 'seller.reseller_overlay_image.removed',
      entityType: 'reseller_store_variant_image',
      entityId: imageId,
      severity: 'LOW',
      metadata: { storeId: store.id, variantId },
    });
    return this.storeTerms(store.id, actor.sellerId);
  }

  // ── The store's own catalogue ──────────────────────────────────────

  /**
   * What a store user sees: ONLY variants enabled for their store that
   * still have an effective transfer price and are still resellable.
   * Deliberately absent: the seller's cost, real stock, set-aside and
   * hidden figures, other stores — none is even read into this shape.
   * `storeId` is the one on the caller's token (StoreJwtGuard).
   */
  async storeCatalogue(storeId: string): Promise<StoreCatalogueView> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    const rows = await this.prisma.client.resellerStoreVariant.findMany({
      where: { storeId: store.id, enabled: true },
      include: {
        images: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      },
    });
    if (rows.length === 0) return { items: [] };
    const rowBy = new Map(rows.map((r) => [r.variantId, r]));
    const { variants } = await this.catalog.listResellableVariants(
      store.sellerId,
      rows.map((r) => r.variantId),
    );
    const ids = variants.map((v) => v.variantId);
    const [prices, stock, thumbs, others] = await Promise.all([
      this.prisma.client.resellerPriceListItem.findMany({
        where: { sellerId: store.sellerId, variantId: { in: ids } },
      }),
      this.stock.getSellableStockLive(store.sellerId, ids),
      this.thumbnails(ids),
      this.otherStoresSetAside(store.sellerId, store.id, ids),
    ]);
    const priceBy = new Map(prices.map((p) => [p.variantId, p]));

    const items: StoreCatalogueItem[] = [];
    for (const v of variants) {
      const row = rowBy.get(v.variantId);
      if (row === undefined) continue;
      const effective = priceView(row) ?? priceView(priceBy.get(v.variantId));
      if (effective === null) continue;
      const overlay = (
        await Promise.all(row.images.map((img) => this.presignSafe(img.storageKey)))
      ).filter((u): u is string => u !== null);
      const thumb = thumbs.get(v.variantId);
      items.push({
        variantId: v.variantId,
        skuCode: v.skuCode,
        title: row.overlayTitle ?? v.productName,
        variantLabel: v.variantLabel,
        description: row.overlayDescription ?? v.productDescription,
        imageUrls: overlay.length > 0 ? overlay : thumb === undefined ? [] : [thumb],
        transferPriceInr: effective.transferPriceInr,
        minRetailInr: effective.minRetailInr,
        maxRetailInr: effective.maxRetailInr,
        suggestedRetailInr: effective.suggestedRetailInr,
        availableQty: this.visibleFor(store.id, v.variantId, {
          stockMode: row.stockMode,
          setAsideQty: row.setAsideQty,
          hiddenPercent: row.hiddenPercent,
          available: stock.get(v.variantId)?.available ?? 0,
          otherRows: others.get(v.variantId) ?? [],
        }),
      });
    }
    items.sort((a, b) => a.title.localeCompare(b.title) || a.skuCode.localeCompare(b.skuCode));
    return { items };
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * THE PHASE-3 SEAM: how much of a store's set-aside it has already
   * used. Store orders do not exist yet, so nothing is consumed; phase 3
   * answers from the store's own ACTIVE reservations here, and every
   * visible quantity (the seller's preview and the store's page alike)
   * follows because both come through `visibleFor`.
   */
  private consumedByStore(key: { readonly storeId: string; readonly variantId: string }): number {
    void key;
    return CONSUMED_BY_STORE_BEFORE_ORDERS;
  }

  private visibleFor(
    storeId: string,
    variantId: string,
    input: {
      readonly stockMode: ResellerStockMode;
      readonly setAsideQty: number | null;
      readonly hiddenPercent: number;
      readonly available: number;
      readonly otherRows: ReadonlyArray<{ readonly storeId: string; readonly setAsideQty: number }>;
    },
  ): number {
    return visibleQuantity({
      mode: input.stockMode === ResellerStockMode.SET_ASIDE ? 'SET_ASIDE' : 'SHARED',
      setAsideQty: input.setAsideQty,
      hiddenPercent: input.hiddenPercent,
      realAvailable: input.available,
      othersUnusedSetAside: othersUnusedSetAside(
        input.otherRows.map((r) => ({
          setAsideQty: r.setAsideQty,
          consumedByStore: this.consumedByStore({ storeId: r.storeId, variantId }),
        })),
      ),
      consumedByStore: this.consumedByStore({ storeId, variantId }),
    });
  }

  /** Set-asides of the seller's OTHER live stores, per variant. */
  private async otherStoresSetAside(
    sellerId: string,
    storeId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, Array<{ storeId: string; setAsideQty: number }>>> {
    const out = new Map<string, Array<{ storeId: string; setAsideQty: number }>>();
    if (variantIds.length === 0) return out;
    const rows = await this.prisma.client.resellerStoreVariant.findMany({
      where: {
        sellerId,
        variantId: { in: [...variantIds] },
        storeId: { not: storeId },
        stockMode: ResellerStockMode.SET_ASIDE,
        store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
      },
      select: { storeId: true, variantId: true, setAsideQty: true },
    });
    for (const r of rows) {
      const list = out.get(r.variantId) ?? [];
      list.push({ storeId: r.storeId, setAsideQty: r.setAsideQty ?? 0 });
      out.set(r.variantId, list);
    }
    return out;
  }

  private async loadStore(
    storeId: string,
    sellerId: string | null,
  ): Promise<{ id: string; name: string; sellerId: string; status: ResellerStoreStatus | null }> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: {
        id: storeId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        ...(sellerId === null ? {} : { sellerId }),
      },
      select: { id: true, name: true, sellerId: true, status: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }

  private assertNotFinal(status: ResellerStoreStatus | null): void {
    if (status === ResellerStoreStatus.CLOSED || status === ResellerStoreStatus.REJECTED) {
      throw new ConflictException({
        code: 'STORE_FINAL',
        message: 'This store is closed or rejected; its catalogue can no longer change.',
      });
    }
  }

  private assertPrice(input: PriceInput): void {
    const refusal = checkPrice(input);
    if (refusal !== null) throw new BadRequestException(refusal);
  }

  private assertMime(mimeType: string): void {
    if (!IMAGE_MIME.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
  }

  private async requireResellable(sellerId: string, variantId: string): Promise<ResellableVariant> {
    const { variants } = await this.catalog.listResellableVariants(sellerId, [variantId]);
    const v = variants[0];
    if (v === undefined) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_RESELLABLE',
        message: 'No active product of yours with that id',
      });
    }
    return v;
  }

  private async requireOwnVariant(sellerId: string, variantId: string): Promise<void> {
    const v = await this.catalog.getVariantById(variantId);
    if (v === null || v.sellerId !== sellerId) {
      throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'No such product' });
    }
  }

  /** Thumbnails for display; a lookup failure costs the pictures, never the screen. */
  private async thumbnails(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    try {
      return await this.catalog.thumbnailUrlsByVariant(ids);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Reseller catalogue thumbnails unavailable; showing none',
      );
      return new Map();
    }
  }

  private async presignSafe(key: string): Promise<string | null> {
    try {
      return await this.spaces.presignGetUrl(key);
    } catch {
      return null;
    }
  }
}

function overlayPrefix(storeId: string, variantId: string): string {
  return `stores/${storeId}/catalogue/${variantId}/`;
}

function termsForAudit(row: {
  enabled: boolean;
  transferPriceInr: Prisma.Decimal | null;
  minRetailInr: Prisma.Decimal | null;
  maxRetailInr: Prisma.Decimal | null;
  suggestedRetailInr: Prisma.Decimal | null;
  stockMode: ResellerStockMode;
  setAsideQty: number | null;
  hiddenPercent: number;
  overlayTitle: string | null;
  overlayDescription: string | null;
}): Prisma.InputJsonObject {
  return {
    enabled: row.enabled,
    priceOverride: priceJson(priceView(row)),
    stockMode: row.stockMode,
    setAsideQty: row.setAsideQty,
    hiddenPercent: row.hiddenPercent,
    overlayTitle: row.overlayTitle,
    overlayDescriptionLength: row.overlayDescription?.length ?? 0,
  };
}
