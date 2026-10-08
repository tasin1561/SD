import {
  PaymentMode,
  Prisma,
  ResellerCreditTrigger,
  ResellerStockMode,
  ResellerStoreActionMode,
  ResellerStoreStatus,
  SellerStatus,
  StoreOrderScope,
} from '@skydrop/db';
import { storeOrderScope } from '../../src/common/auth/store-order-scope';
import { ResellerOrderService } from '../../src/modules/order/services/reseller-order.service';
import {
  StoreOrdersService,
  viewerFor,
} from '../../src/modules/reseller-order/services/store-orders.service';
import type { CreateStoreOrderDto } from '../../src/modules/order/dto/create-store-order.dto';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

/**
 * ASSOC-1 — the NARROWING: what an associate may place, at what price,
 * and how much of their store's work they then see.
 *
 * ── WHY THESE ASSERT ON THE ARGUMENTS HANDED TO PRISMA ───────────────
 * A mocked Prisma has no WHERE engine: it returns whatever the test told
 * it to, whatever it was asked. So a scope "applied" by filtering the
 * RESULT in JavaScript would pass every behavioural assertion here while
 * leaving the real query unnarrowed — and the real query is the whole
 * rule, because a filter in application code is one `findFirst` away
 * from being skipped and a 404 that depends on it leaks whether the row
 * exists. The assertions are therefore on the `where` the service builds.
 */

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const CTX = { ipAddress: null, userAgent: null, requestId: 'r1' };
const ASSOCIATE = { kind: 'STORE_USER' as const, storeId: 'store-1', storeUserId: 'su-1' };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return ((e as { response?: { code?: string } }).response?.code ?? 'THREW') as string;
  }
}

// ─────────────────────────────────────────────────────────────────────
// The create path: the pause, the stamp, the fixed price.
// ─────────────────────────────────────────────────────────────────────

interface CreateOpts {
  /** Every live role this person holds, as the roles table carries them. */
  roles?: Array<{ isOwner: boolean; orderScope: StoreOrderScope; deletedAt: Date | null }>;
  pausedAt?: Date | null;
  /** This associate's own rows: variantId → retail. */
  prices?: Array<{ variantId: string; retailPriceInr: Prisma.Decimal }>;
  min?: string | null;
  max?: string | null;
  /** The store user row is gone (the CSV worker places long after the upload). */
  missing?: boolean;
}

function makeCreate(opts: CreateOpts = {}) {
  const storeUserFindFirst = jest.fn(async () =>
    opts.missing === true
      ? null
      : {
          ordersPausedAt: opts.pausedAt ?? null,
          roles: (
            opts.roles ?? [{ isOwner: false, orderScope: StoreOrderScope.OWN, deletedAt: null }]
          ).map((role) => ({ role })),
        },
  );
  const pricesFor = jest.fn(
    async () => new Map((opts.prices ?? []).map((p) => [p.variantId, p.retailPriceInr])),
  );
  const client = {
    sellerStore: {
      findFirst: jest.fn(async () => ({
        id: 'store-1',
        sellerId: 's1',
        name: 'Rang Store',
        displayName: 'Rang',
        status: ResellerStoreStatus.ACTIVE,
        seller: { status: SellerStatus.APPROVED, deletedAt: null },
      })),
    },
    storeUser: { findFirst: storeUserFindFirst },
  };
  /** Typed with its arguments so the options object can be read back. */
  const create = jest.fn(async (..._args: unknown[]) => ({ id: 'o-new' }));
  const settings = { resolve: jest.fn(async () => ({ value: true })) };
  const terms = {
    orderReadiness: jest.fn(async () => ({
      ready: true,
      termsVersionId: 'tv-1',
      reasons: [],
      message: null,
    })),
    currentTerms: jest.fn(async () => ({
      termsVersionId: 'tv-1',
      storePercents: {
        deliveryFeeStorePercent: D(80),
        returnFeeStorePercent: D(100),
        customerReturnFeeStorePercent: D(100),
        codFeeStorePercent: D(0),
        codTaxStorePercent: D(100),
        instantPayFeeStorePercent: D(50),
      },
      storeCredit: { trigger: ResellerCreditTrigger.ON_PAYOUT, days: 2 },
      sellerCredit: { trigger: ResellerCreditTrigger.AFTER_DELIVERY, days: 7 },
    })),
  };
  const gate = {
    offersFor: jest.fn(
      async () =>
        new Map([
          [
            'v1',
            {
              variantId: 'v1',
              resellable: true,
              enabled: true,
              price: {
                transferPriceInr: D('300.00'),
                minRetailInr:
                  opts.min === undefined ? D('400.00') : opts.min === null ? null : D(opts.min),
                maxRetailInr:
                  opts.max === undefined ? D('600.00') : opts.max === null ? null : D(opts.max),
                suggestedRetailInr: D('499.00'),
              },
              stockMode: ResellerStockMode.SET_ASIDE,
              visibleQty: 5,
            },
          ],
        ]),
    ),
  };
  const catalog = {
    getVariantsByIds: jest.fn(
      async () => new Map([['v1', { sellerId: 's1', skuCode: 'KURTA-M' }]]),
    ),
  };
  const svc = new ResellerOrderService(
    { client } as unknown as PrismaService,
    { create } as never,
    settings as never,
    terms as never,
    gate as never,
    catalog as never,
    { assertPrepaidCovered: jest.fn(async () => undefined) } as never,
    { pricesFor } as never,
  );
  return { svc, create, storeUserFindFirst, pricesFor };
}

function input(over: Partial<CreateStoreOrderDto> = {}): CreateStoreOrderDto {
  return {
    recipientName: 'Asha Verma',
    recipientPhoneE164: '+919876543210',
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: 'Near City Hospital',
    recipientPostalCode: '560001',
    paymentMode: PaymentMode.COD,
    items: [{ variantId: 'v1', quantity: 2, retailUnitPriceInr: 450 }],
    ...over,
  } as CreateStoreOrderDto;
}

describe('ASSOC-1 — the scope is resolved from the live roles, widest wins', () => {
  it('ALL beside OWN is ALL, and an owner role is ALL whatever its column says', () => {
    // The pure resolver. Adding a role must never take something away.
    expect(
      storeOrderScope([
        { isOwner: false, orderScope: StoreOrderScope.OWN },
        { isOwner: false, orderScope: StoreOrderScope.ALL },
      ]),
    ).toBe(StoreOrderScope.ALL);
    expect(storeOrderScope([{ isOwner: true, orderScope: StoreOrderScope.OWN }])).toBe(
      StoreOrderScope.ALL,
    );
    expect(storeOrderScope([{ isOwner: false, orderScope: StoreOrderScope.OWN }])).toBe(
      StoreOrderScope.OWN,
    );
  });

  it('the create path resolves it the same way — and ignores a DELETED role', async () => {
    /*
      The portal has the guard's answer on the request; the CSV worker
      places its rows hours later with no request at all. So the create
      path reads the roles itself, and it must read them the way the
      guard does — live ones only. A scope read off a role somebody
      deleted this morning would widen the person their store narrowed.
    */
    const wide = makeCreate({
      roles: [
        { isOwner: false, orderScope: StoreOrderScope.OWN, deletedAt: null },
        { isOwner: false, orderScope: StoreOrderScope.ALL, deletedAt: null },
      ],
    });
    expect(
      await wide.svc.assertMayPlaceOrders({ storeId: 'store-1', storeUserId: 'su-1' }),
    ).toEqual({ storeUserId: 'su-1', scope: StoreOrderScope.ALL });

    const revoked = makeCreate({
      roles: [
        { isOwner: false, orderScope: StoreOrderScope.OWN, deletedAt: null },
        { isOwner: false, orderScope: StoreOrderScope.ALL, deletedAt: new Date() },
      ],
    });
    expect(
      await revoked.svc.assertMayPlaceOrders({ storeId: 'store-1', storeUserId: 'su-1' }),
    ).toEqual({ storeUserId: 'su-1', scope: StoreOrderScope.OWN });
  });
});

describe('ASSOC-1 — the order records WHO placed it', () => {
  it('stamps the store user on every store caller, inside the create', async () => {
    const { svc, create } = makeCreate({
      roles: [{ isOwner: true, orderScope: StoreOrderScope.ALL, deletedAt: null }],
    });
    await svc.create(ASSOCIATE, input(), CTX);
    // Handed to `OrderService.create` as part of the reseller context, so
    // it is written in the same transaction as the order — never stamped
    // on afterwards by a second write that can fail on its own.
    const options = create.mock.calls[0]![4] as {
      reseller: { placedByStoreUserId: string | null };
    };
    expect(options.reseller.placedByStoreUserId).toBe('su-1');
  });

  it('a store API key stamps NOBODY — a key carries no person', async () => {
    const { svc, create, storeUserFindFirst } = makeCreate();
    await svc.create({ kind: 'STORE_API_KEY', storeId: 'store-1', apiKeyId: 'k-1' }, input(), CTX);
    const options = create.mock.calls[0]![4] as {
      reseller: { placedByStoreUserId: string | null };
    };
    expect(options.reseller.placedByStoreUserId).toBeNull();
    // And nobody is looked up to be paused or priced.
    expect(storeUserFindFirst).not.toHaveBeenCalled();
  });
});

describe('ASSOC-1 — the pause gates CREATION, and only creation', () => {
  it('refuses to place, by name, before anything is written', async () => {
    const { svc, create } = makeCreate({ pausedAt: new Date('2026-10-01T00:00:00Z') });
    expect(await code(svc.create(ASSOCIATE, input(), CTX))).toBe('ASSOCIATE_ORDERS_PAUSED');
    expect(create).not.toHaveBeenCalled();
  });

  it('does NOT touch what they already placed — the cancel path never reads the pause', async () => {
    /*
      This is the half that makes a pause a pause rather than a removal.
      A switched-off associate keeps reading, tracking, cancelling and
      chasing their orders; only placing a NEW one is refused. If the
      gate ever moves into a guard or a decorator it will reach this path
      too, and this test is what says so.
    */
    const { svc, orderWrite, prismaOrderFindFirst } = makeStoreOrders({
      order: { id: 'order-1', sellerId: 'seller-1' },
    });
    const paused = { id: 'su-1', storeId: 'store-1', orderScope: StoreOrderScope.OWN };
    const out = await svc.cancel(paused, 'order-1', {}, {} as ClientContext);
    expect(out.applied).toBe(true);
    expect(orderWrite.cancelBySeller).toHaveBeenCalledTimes(1);
    // ...and it is still THEIR order it cancelled, not the store's.
    expect(prismaOrderFindFirst.mock.calls[0]![0].where).toMatchObject({
      placedByStoreUserId: 'su-1',
    });
  });
});

describe('ASSOC-1 — an associate sells at the price their store set for them', () => {
  const PRICED = [{ variantId: 'v1', retailPriceInr: D('450.00') }];

  it('uses their own row, and does not need the caller to state it', async () => {
    const { svc, create } = makeCreate({ prices: PRICED });
    await svc.create(ASSOCIATE, input({ items: [{ variantId: 'v1', quantity: 2 }] } as never), CTX);
    const options = create.mock.calls[0]![4] as {
      reseller: { lines: Array<{ retailUnitInr: Prisma.Decimal }> };
    };
    expect(options.reseller.lines[0]!.retailUnitInr.toFixed(2)).toBe('450.00');
  });

  it('ASSOCIATE_PRICE_NOT_SET — never the store’s suggested retail instead', async () => {
    // A fallback would sell this person's customer at a figure nobody
    // chose for them, and nobody would find out until the money split.
    const { svc, create } = makeCreate({ prices: [] });
    expect(
      await code(
        svc.create(ASSOCIATE, input({ items: [{ variantId: 'v1', quantity: 1 }] } as never), CTX),
      ),
    ).toBe('ASSOCIATE_PRICE_NOT_SET');
    expect(create).not.toHaveBeenCalled();
  });

  it('ASSOCIATE_PRICE_FIXED — a different figure sent is refused, not accepted', async () => {
    const { svc, create } = makeCreate({ prices: PRICED });
    expect(
      await code(
        svc.create(
          ASSOCIATE,
          input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 520 }] } as never),
          CTX,
        ),
      ),
    ).toBe('ASSOCIATE_PRICE_FIXED');
    expect(create).not.toHaveBeenCalled();
  });

  it('ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE — no associate can break the seller’s terms', async () => {
    // The seller moved the range after the price was agreed. Nothing
    // adjusts it for them: a negotiated price is not ours to change, so
    // the order is refused and the STORE is told to put it right — which
    // is why it is not `RETAIL_OUT_OF_RANGE`, whose advice ("sell inside
    // the range") this person cannot act on.
    const { svc } = makeCreate({ prices: PRICED, min: '500.00', max: '600.00' });
    expect(
      await code(
        svc.create(ASSOCIATE, input({ items: [{ variantId: 'v1', quantity: 1 }] } as never), CTX),
      ),
    ).toBe('ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE');
  });

  it('a store user with ALL scope is priced exactly as before — no row is even read', async () => {
    // Every order a store already places stays byte-identical: the rule
    // keys off the RESOLVED SCOPE, not off "does this person have prices".
    const { svc, create, pricesFor } = makeCreate({
      roles: [{ isOwner: false, orderScope: StoreOrderScope.ALL, deletedAt: null }],
    });
    await svc.create(ASSOCIATE, input(), CTX);
    expect(pricesFor).not.toHaveBeenCalled();
    const options = create.mock.calls[0]![4] as {
      reseller: { lines: Array<{ retailUnitInr: Prisma.Decimal }> };
    };
    expect(options.reseller.lines[0]!.retailUnitInr.toFixed(2)).toBe('450.00');
  });

  it('a store user who no longer exists is named, not an FK failure', async () => {
    const { svc } = makeCreate({ missing: true });
    expect(await code(svc.create(ASSOCIATE, input(), CTX))).toBe('STORE_USER_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────
// The reads: the filter is in the WHERE clause, or it is not a filter.
// ─────────────────────────────────────────────────────────────────────

function makeStoreOrders(opts: { order?: { id: string; sellerId: string } | null } = {}) {
  const row = 'order' in opts ? opts.order : { id: 'order-1', sellerId: 'seller-1' };
  /*
    Typed with their ARGUMENTS, not just their answers: the assertions
    below are on the `where` these were handed, which is the only thing
    that distinguishes a scope applied in the query from one applied in
    JavaScript after the rows came back.
  */
  type Args = { where: Record<string, unknown> };
  const findFirst = jest.fn(async (_args: Args) => row);
  const findMany = jest.fn(async (_args: Args) => []);
  const count = jest.fn(async (_args: Args) => 0);
  const prisma = {
    client: { order: { findFirst, findMany, count } },
  } as unknown as PrismaService;
  const orderWrite = { cancelBySeller: jest.fn(async () => undefined) };
  const svc = new StoreOrdersService(
    prisma,
    {} as unknown as CatalogReadService,
    {} as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    {
      forStore: jest.fn(async () => ({ cancel: ResellerStoreActionMode.DIRECT })),
    } as unknown as ResellerStoreActionPolicyService,
    { hold: jest.fn() } as unknown as StoreOrderRequestService,
  );
  jest.spyOn(svc, 'detail').mockResolvedValue({ id: 'order-1' } as never);
  return { svc, findFirst, findMany, count, orderWrite, prismaOrderFindFirst: findFirst };
}

describe('ASSOC-1 — the store’s order reads, narrowed in the query', () => {
  it('an OWN caller’s list carries the person; an ALL caller’s does not', async () => {
    const own = makeStoreOrders();
    await own.svc.list('store-1', viewerFor({ id: 'su-1', orderScope: StoreOrderScope.OWN }), {});
    expect(own.findMany.mock.calls[0]![0].where).toMatchObject({
      storeId: 'store-1',
      placedByStoreUserId: 'su-1',
    });
    // The COUNT is narrowed too — a total that counts the whole store
    // beside a page that does not is a paginator that pages into nothing.
    expect(own.count.mock.calls[0]![0].where).toMatchObject({ placedByStoreUserId: 'su-1' });

    const all = makeStoreOrders();
    await all.svc.list('store-1', viewerFor({ id: 'su-1', orderScope: StoreOrderScope.ALL }), {});
    // Not `placedByStoreUserId: undefined` — the key is ABSENT, because
    // an undefined filter and no filter read the same at the call site
    // and only one of them survives a refactor.
    expect(all.findMany.mock.calls[0]![0].where).not.toHaveProperty('placedByStoreUserId');
  });

  it('the detail, the timeline and the ownership check all carry it', async () => {
    const { svc, findFirst } = makeStoreOrders();
    const viewer = viewerFor({ id: 'su-1', orderScope: StoreOrderScope.OWN });
    jest.spyOn(svc, 'detail').mockRestore();
    await code(svc.detail('store-1', viewer, 'order-1'));
    await code(svc.events('store-1', viewer, 'order-1'));
    await code(svc.assertOwned('store-1', viewer, 'order-1'));
    for (const call of findFirst.mock.calls) {
      expect(call[0].where).toMatchObject({
        id: 'order-1',
        storeId: 'store-1',
        placedByStoreUserId: 'su-1',
      });
    }
    expect(findFirst.mock.calls.length).toBe(3);
  });

  it('a colleague’s order is a 404 that says nothing more', async () => {
    // The scope is IN the query, so the miss is indistinguishable from
    // an order that does not exist — a refusal naming it would confirm
    // its existence to somebody guessing ids.
    const { svc } = makeStoreOrders({ order: null });
    expect(
      await code(
        svc.assertOwned('store-1', viewerFor({ id: 'su-1', orderScope: StoreOrderScope.OWN }), 'x'),
      ),
    ).toBe('ORDER_NOT_FOUND');
  });

  it('an API key reads the whole store — it placed none of them itself', async () => {
    const { svc, findMany } = makeStoreOrders();
    await svc.list('store-1', { kind: 'STORE_API_KEY' }, {});
    expect(findMany.mock.calls[0]![0].where).not.toHaveProperty('placedByStoreUserId');
  });
});
