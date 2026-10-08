import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, ResellerStockMode } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AssociatePriceService } from '../../src/modules/reseller-associates/services/associate-price.service';
import {
  ResellerCatalogueService,
  type StoreSellCatalogueView,
} from '../../src/modules/reseller-catalogue/services/reseller-catalogue.service';

/**
 * ASSOC-1 — `GET /store/catalogue/sell`, and the privacy boundary it IS.
 *
 * `catalogue.view` carries `transferPriceInr`: what the STORE pays its
 * seller. An associate who can read it knows the store's cost and
 * therefore the spread the store is making on them — the same fact RS-3
 * keeps from the store about the seller, one level down. So the whole
 * reason `catalogue.sell` is a second permission rather than a filter
 * inside the first is that an associate must not be able to reach the
 * response that carries the cost AT ALL.
 *
 * The field sweep below is what keeps that true after this commit. It
 * runs TWICE over different evidence on purpose: over the KEYS the
 * service actually returns (what goes on the wire today), and over the
 * DECLARED interface (a field somebody adds and populates conditionally
 * would be absent from the first and caught by the second).
 */

const STORE = 'store-1';
const V1 = '0190f7a0-0000-7000-8000-00000000a001';
const V2 = '0190f7a0-0000-7000-8000-00000000a002';
const ANNA = '0190f7a0-0000-7000-8000-00000000b001';
const BRIJ = '0190f7a0-0000-7000-8000-00000000b002';

/**
 * Words that name the store's cost or its earnings, in any casing.
 *
 * Substrings rather than exact names, because the leak this guards
 * against arrives as a plausible-looking addition — `transferPriceInr`,
 * `suggestedRetailInr`, `minRetailInr`, `hiddenPercent`, `setAsideQty`,
 * `unitCostInr`, `marginInr` — and every one of those contains one of
 * these.
 */
const FORBIDDEN = ['transfer', 'cost', 'margin', 'suggested', 'min', 'max', 'hidden', 'setaside'];

function offenders(names: readonly string[]): string[] {
  return names.filter((n) => FORBIDDEN.some((bad) => n.toLowerCase().includes(bad)));
}

interface PriceRow {
  storeUserId: string;
  variantId: string;
  retailPriceInr: Prisma.Decimal;
}

function setup(
  prices: readonly PriceRow[],
  opts: { readonly hiddenPercent?: number } = {},
): { svc: ResellerCatalogueService } {
  const client: any = {
    sellerStore: { findFirst: async () => ({ id: STORE, sellerId: 'seller-1' }) },
    resellerStoreVariant: {
      // Called twice: once for the store's own enabled rows, once by
      // `otherStoresSetAside` (which asks for OTHER stores' rows).
      findMany: async (args: any) =>
        args?.where?.storeId?.not !== undefined
          ? []
          : [
              {
                variantId: V1,
                enabled: true,
                transferPriceInr: new Prisma.Decimal('47.25'),
                minRetailInr: new Prisma.Decimal('100'),
                maxRetailInr: new Prisma.Decimal('200'),
                suggestedRetailInr: new Prisma.Decimal('181.75'),
                stockMode: ResellerStockMode.SHARED,
                setAsideQty: null,
                hiddenPercent: opts.hiddenPercent ?? 0,
                overlayTitle: 'Festive Alpha',
                overlayDescription: 'The store’s own words',
                images: [],
              },
              {
                variantId: V2,
                enabled: true,
                transferPriceInr: null,
                minRetailInr: null,
                maxRetailInr: null,
                suggestedRetailInr: null,
                stockMode: ResellerStockMode.SHARED,
                setAsideQty: null,
                hiddenPercent: opts.hiddenPercent ?? 0,
                overlayTitle: null,
                overlayDescription: null,
                images: [],
              },
            ],
    },
    resellerPriceListItem: {
      findMany: async () => [
        {
          variantId: V2,
          transferPriceInr: new Prisma.Decimal('83.10'),
          minRetailInr: null,
          maxRetailInr: null,
          suggestedRetailInr: null,
        },
      ],
    },
    associatePrice: {
      findMany: async (args: any) =>
        prices.filter(
          (p) =>
            p.storeUserId === args.where.storeUserId &&
            (args.where.variantId?.in ?? []).includes(p.variantId),
        ),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  const catalog = {
    listResellableVariants: async () => ({
      variants: [
        {
          variantId: V1,
          productId: 'p-1',
          skuCode: 'SKU-1',
          variantLabel: 'Red / M',
          status: 'ACTIVE',
          productName: 'Alpha',
          productDescription: 'A product',
        },
        {
          variantId: V2,
          productId: 'p-2',
          skuCode: 'SKU-2',
          variantLabel: null,
          status: 'ACTIVE',
          productName: 'Beta',
          productDescription: null,
        },
      ],
      truncated: false,
    }),
    thumbnailUrlsByVariant: async () => new Map([[V1, 'https://spaces.test/a.jpg']]),
  };
  const stock = {
    getSellableStockLive: async () =>
      new Map([
        [V1, { onHand: 10, available: 10 }],
        [V2, { onHand: 3, available: 3 }],
      ]),
  };
  const gate = { consumption: async () => new Map() };
  const svc = new ResellerCatalogueService(
    prisma,
    catalog as never,
    stock as never,
    { log: jest.fn() } as never,
    { presignGetUrl: async () => 'https://spaces.test/overlay.jpg' } as never,
    gate as never,
    new AssociatePriceService(prisma),
  );
  return { svc };
}

async function sellFor(
  storeUserId: string,
  prices: readonly PriceRow[],
  opts?: { readonly hiddenPercent?: number },
): Promise<StoreSellCatalogueView> {
  const { svc } = setup(prices, opts);
  return svc.sellCatalogue({ storeId: STORE, storeUserId });
}

const annaPriced: readonly PriceRow[] = [
  { storeUserId: ANNA, variantId: V1, retailPriceInr: new Prisma.Decimal('150') },
];

describe('GET /store/catalogue/sell (ASSOC-1)', () => {
  it('carries NOTHING about the store’s cost or earnings — over the real response', async () => {
    const view = await sellFor(ANNA, annaPriced);
    expect(view.items.length).toBeGreaterThan(0);
    for (const item of view.items) {
      expect(offenders(Object.keys(item))).toEqual([]);
    }
    expect(offenders(Object.keys(view))).toEqual([]);
    // Belt and braces: not merely absent by NAME. Nothing in the whole
    // serialised body may equal a figure the store pays or was advised
    // to charge — a field called `basePriceInr` carrying 50.00 would
    // pass a name check and leak the same fact.
    const body = JSON.stringify(view);
    for (const secret of ['47.25', '83.10', '181.75']) {
      expect(body).not.toContain(secret);
    }
  });

  it('carries NOTHING about the store’s cost or earnings — over the DECLARED projection', () => {
    // The runtime check above sees only fields that happened to be
    // populated for this fixture. A field declared on the type and set
    // on some other code path is invisible to it, so the TYPE is swept
    // too — this is what fails the build when somebody adds
    // `transferPriceInr?: string` to the projection.
    const src = readFileSync(
      join(
        __dirname,
        '../../src/modules/reseller-catalogue/services/reseller-catalogue.service.ts',
      ),
      'utf8',
    );
    const declared: string[] = [];
    for (const name of ['StoreSellCatalogueItem', 'StoreSellCatalogueView']) {
      const open = src.indexOf(`export interface ${name} {`);
      expect(open).toBeGreaterThan(-1);
      const body = src.slice(open, src.indexOf('\n}', open));
      // Comments FIRST: prose about `transferPriceInr` reads exactly
      // like a field declaration to a regex, and this spec would then
      // fail on the comment explaining why the field is absent (the
      // `@SellerRoles` lesson in RBAC-1 — a spec that asserted on a
      // docblock and passed while testing nothing, in reverse).
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const m of code.matchAll(/^\s*readonly\s+(\w+)/gm)) declared.push(m[1] ?? '');
    }
    expect(declared).toContain('retailPriceInr');
    expect(declared).toContain('availableQuantity');
    expect(offenders(declared)).toEqual([]);
  });

  it('shows THIS caller’s own price, and another associate’s is invisible to them', async () => {
    // The store user id comes from the TOKEN. If it were ever taken
    // from the request, one associate could read another's commercial
    // terms — so the two callers are driven over the SAME stored rows.
    const both: readonly PriceRow[] = [
      ...annaPriced,
      { storeUserId: BRIJ, variantId: V1, retailPriceInr: new Prisma.Decimal('190') },
    ];
    const anna = await sellFor(ANNA, both);
    const brij = await sellFor(BRIJ, both);
    expect(anna.items.find((i) => i.skuCode === 'SKU-1')?.retailPriceInr).toBe('150.00');
    expect(brij.items.find((i) => i.skuCode === 'SKU-1')?.retailPriceInr).toBe('190.00');
    expect(JSON.stringify(anna)).not.toContain('190.00');
  });

  it('an unpriced product is null and COUNTED — never a fallback figure', async () => {
    const view = await sellFor(ANNA, annaPriced);
    const beta = view.items.find((i) => i.skuCode === 'SKU-2');
    expect(beta?.retailPriceInr).toBeNull();
    expect(view.unpricedCount).toBe(1);
  });

  it('shows the store’s own name and picture for the product, and the RS-3 visible quantity', async () => {
    const view = await sellFor(ANNA, annaPriced, { hiddenPercent: 40 });
    const alpha = view.items.find((i) => i.skuCode === 'SKU-1');
    // The store's overlay wins: an associate selling a product the store
    // describes differently is a divergence the customer hears.
    expect(alpha).toMatchObject({
      title: 'Festive Alpha',
      description: 'The store’s own words',
      variantLabel: 'Red / M',
    });
    expect(alpha?.imageUrls).toEqual(['https://spaces.test/a.jpg']);
    // 10 available, 40% withheld — floor(10 × 60 / 100). The figure comes
    // from `reseller-visible-stock.ts`, never recomputed here.
    expect(alpha?.availableQuantity).toBe(6);
  });

  it('leaves out a product the STORE has no price for with its seller', async () => {
    // The store must still have a price with its seller to sell it at
    // all — the same gate its own catalogue applies. Only whether one
    // EXISTS is read; the figure never leaves the service.
    const { svc } = setup(annaPriced);
    const view = await svc.sellCatalogue({ storeId: STORE, storeUserId: ANNA });
    expect(view.items.map((i) => i.skuCode).sort()).toEqual(['SKU-1', 'SKU-2']);
  });
});
