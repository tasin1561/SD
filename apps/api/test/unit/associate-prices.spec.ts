import { NotFoundException } from '@nestjs/common';
import type { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma, ResellerStockMode } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuthenticatedStoreUser } from '../../src/common/types/request';
import { AssociatePriceService } from '../../src/modules/reseller-associates/services/associate-price.service';
import { AssociateService } from '../../src/modules/reseller-associates/services/associate.service';

/**
 * ASSOC-1 — what one associate sells one product at.
 *
 * The three things worth pinning, each because getting it wrong is
 * silent: a price outside the SELLER's range must be refused at the
 * moment the reseller sets it (refused later, it is refused with a
 * customer on the phone); the roster's counts must say how many products
 * somebody has no price for, which is the thing that quietly stops them
 * selling; and copy-from must NAME every figure it replaces, because a
 * bulk write that silently overwrites negotiated prices is not something
 * anybody would press twice.
 */

const STORE = 'store-1';
const V1 = '0190f7a0-0000-7000-8000-00000000a001';
const V2 = '0190f7a0-0000-7000-8000-00000000a002';
const ANNA = '0190f7a0-0000-7000-8000-00000000b001';
const BRIJ = '0190f7a0-0000-7000-8000-00000000b002';

interface PriceRow {
  storeId: string;
  storeUserId: string;
  variantId: string;
  retailPriceInr: Prisma.Decimal;
  setByStoreUserId: string | null;
  updatedAt: Date;
}

/**
 * The `associate_prices` delegate, in memory and STATEFUL.
 *
 * Stateful on purpose: copy-from's whole contract is about what was
 * already there — created, overwritten or unchanged — and a mock that
 * answers every read the same way cannot tell those three apart.
 */
class PriceTable {
  readonly rows: PriceRow[] = [];

  seed(storeUserId: string, variantId: string, inr: string): void {
    this.rows.push({
      storeId: STORE,
      storeUserId,
      variantId,
      retailPriceInr: new Prisma.Decimal(inr),
      setByStoreUserId: 'seeded',
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    });
  }

  find(storeUserId: string, variantId: string): PriceRow | undefined {
    return this.rows.find((r) => r.storeUserId === storeUserId && r.variantId === variantId);
  }

  delegate(): Record<string, (args: Record<string, never>) => Promise<unknown>> {
    return {
      findMany: async (args: any) => {
        const w = args?.where ?? {};
        return this.rows.filter(
          (r) =>
            (w.storeUserId === undefined || r.storeUserId === w.storeUserId) &&
            (w.storeId === undefined || r.storeId === w.storeId) &&
            (w.variantId?.in === undefined || w.variantId.in.includes(r.variantId)),
        );
      },
      findUnique: async (args: any) => {
        const k = args.where.storeUserId_variantId;
        return this.find(k.storeUserId, k.variantId) ?? null;
      },
      upsert: async (args: any) => {
        const k = args.where.storeUserId_variantId;
        const hit = this.find(k.storeUserId, k.variantId);
        if (hit === undefined) {
          this.rows.push({ ...args.create, updatedAt: new Date() });
          return;
        }
        Object.assign(hit, args.update, { updatedAt: new Date() });
      },
    } as any;
  }
}

interface Range {
  readonly min: string | null;
  readonly max: string | null;
}

function setup(
  ranges: Record<string, Range> = {
    [V1]: { min: '100', max: '200' },
    [V2]: { min: null, max: null },
  },
  members: readonly string[] = [ANNA, BRIJ],
): {
  svc: AssociateService;
  prices: AssociatePriceService;
  table: PriceTable;
  audit: jest.Mock;
} {
  const table = new PriceTable();
  const names: Record<string, string> = { [ANNA]: 'Anna', [BRIJ]: 'Brij' };
  const client: any = {
    associatePrice: table.delegate(),
    sellerStore: {
      findFirst: async () => ({ id: STORE, sellerId: 'seller-1' }),
    },
    resellerStoreVariant: {
      findMany: async () => Object.keys(ranges).map((variantId) => ({ variantId })),
    },
    storeUserInvitation: { findMany: async () => pendingInvites },
    storeUser: {
      findFirst: async (args: any) =>
        members.includes(args.where.id) && args.where.storeId === STORE
          ? {
              id: args.where.id,
              fullName: names[args.where.id] ?? '?',
              emailDisplay: `${names[args.where.id] ?? 'x'}@store.test`.toLowerCase(),
              ordersPausedAt: null,
            }
          : null,
      findMany: async () =>
        members.map((id) => ({
          id,
          fullName: names[id] ?? '?',
          emailDisplay: `${names[id] ?? 'x'}@store.test`.toLowerCase(),
          ordersPausedAt: null,
          lastLoginAt: null,
        })),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  const prisma = { client } as unknown as PrismaService;
  const prices = new AssociatePriceService(prisma);
  const gate = {
    offersFor: async () =>
      new Map(
        Object.entries(ranges).map(([variantId, r]) => [
          variantId,
          {
            variantId,
            resellable: true,
            enabled: true,
            price: {
              transferPriceInr: new Prisma.Decimal('50'),
              minRetailInr: r.min === null ? null : new Prisma.Decimal(r.min),
              maxRetailInr: r.max === null ? null : new Prisma.Decimal(r.max),
              suggestedRetailInr: null,
            },
            stockMode: ResellerStockMode.SHARED,
            visibleQty: 10,
          },
        ]),
      ),
  };
  const catalog = {
    listResellableVariants: async () => ({
      variants: Object.keys(ranges).map((variantId, i) => ({
        variantId,
        productId: `p-${i}`,
        skuCode: `SKU-${i + 1}`,
        variantLabel: null,
        status: 'ACTIVE',
        productName: ['Alpha', 'Beta'][i] ?? 'Gamma',
        productDescription: null,
      })),
      truncated: false,
    }),
  };
  const audit = jest.fn();
  const svc = new AssociateService(
    prisma,
    prices,
    gate as never,
    catalog as never,
    { log: audit } as never,
  );
  return { svc, prices, table, audit };
}

function actor(): AuthenticatedStoreUser {
  return {
    id: 'owner-1',
    storeId: STORE,
    sellerId: 'seller-1',
    email: 'owner@store.test',
    fullName: 'Owner',
    emailVerifiedAt: null,
    jti: null,
    roleKey: 'owner',
    roleName: 'Owner',
    roleKeys: ['owner'],
    roleNames: ['Owner'],
    orderScope: 'ALL',
    ordersPausedAt: null,
    permissions: ['associates.manage'],
  };
}

async function refusal(run: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run;
  } catch (err) {
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error('expected a refusal');
}

/**
 * ASSOC-1 — invitations waiting to be accepted, which the roster now
 * carries. Mutable so one test can put somebody in it; every other test
 * sees an empty list, which is the state they were written against.
 */
let pendingInvites: Array<Record<string, unknown>> = [];
beforeEach(() => {
  pendingInvites = [];
});

describe('associate prices (ASSOC-1)', () => {
  it('refuses a price BELOW the seller’s minimum, and writes nothing', async () => {
    const { svc, table } = setup();
    const body = await refusal(svc.setPrice(actor(), ANNA, V1, '90.00'));
    expect(body['code']).toBe('ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE');
    expect(String(body['message'])).toContain('₹100.00');
    expect(table.rows).toHaveLength(0);
  });

  it('refuses a price ABOVE the seller’s maximum — the same rule, the other way', async () => {
    // Both directions, because a one-sided comparison passes every test
    // written for the side it checks and fails silently on the other.
    const { svc, table } = setup();
    const body = await refusal(svc.setPrice(actor(), ANNA, V1, '250.00'));
    expect(body['code']).toBe('ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE');
    expect(String(body['message'])).toContain('₹200.00');
    expect(table.rows).toHaveLength(0);
  });

  it('accepts a price ON the boundary, and records who set it', async () => {
    const { svc, table, audit } = setup();
    await svc.setPrice(actor(), ANNA, V1, '100.00');
    await svc.setPrice(actor(), ANNA, V2, '200.00');
    expect(table.find(ANNA, V1)?.retailPriceInr.toFixed(2)).toBe('100.00');
    expect(table.find(ANNA, V1)?.setByStoreUserId).toBe('owner-1');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'store.associate_price.set',
        severity: 'MEDIUM',
        changes: { before: null, after: '100.00' },
      }),
    );
  });

  it('a range with no bound on one side does not bound that side', async () => {
    // A missing maximum is the seller leaving that side open, not a
    // maximum of zero — read as zero it would refuse every price.
    const { svc, table } = setup();
    await svc.setPrice(actor(), ANNA, V2, '9999.00');
    expect(table.find(ANNA, V2)?.retailPriceInr.toFixed(2)).toBe('9999.00');
  });

  it('refuses a product the store may not sell, by name', async () => {
    const { svc } = setup();
    const body = await refusal(
      svc.setPrice(actor(), ANNA, '0190f7a0-0000-7000-8000-00000000a999', '150.00'),
    );
    expect(body['code']).toBe('ASSOCIATE_PRODUCT_NOT_SELLABLE');
  });

  it('somebody who is not on this store is a 404 that says nothing more', async () => {
    const { svc } = setup();
    await expect(
      svc.pricesOf(STORE, '0190f7a0-0000-7000-8000-00000000bfff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows somebody INVITED and not yet accepted — "no associates" must not mean "your invite failed"', async () => {
    /*
      Found by the owner on the real screen, not by a test. An invitation
      had been sent twenty minutes earlier; the page read "No associates
      yet" and showed no trace of it. Nothing on the page disagreed —
      `roster()` reads accepted MEMBERS, and an invitation is not one
      until it is used.

      But the roster is the screen somebody invites FROM, so it is the
      screen they return to in order to find out whether it worked, and
      the only place a store would think to look for the person they are
      waiting on. Telling them there is nobody is telling them it failed.
    */
    const future = new Date(Date.now() + 7 * 86_400_000);
    pendingInvites = [
      {
        id: 'inv-1',
        fullName: 'Waiting Wendy',
        email: 'wendy@store.test',
        createdAt: new Date('2026-10-08T10:34:53.000Z'),
        expiresAt: future,
      },
    ];
    const { svc } = setup();
    const view = await svc.list(STORE);
    expect(view.pendingInvitations).toEqual([
      {
        invitationId: 'inv-1',
        fullName: 'Waiting Wendy',
        email: 'wendy@store.test',
        invitedAt: '2026-10-08T10:34:53.000Z',
        expiresAt: future.toISOString(),
      },
    ]);
    // And they are NOT counted as an associate: no prices, nothing to
    // switch off, nothing to put in the table.
    expect(view.associates.map((a) => a.fullName)).not.toContain('Waiting Wendy');
  });

  it('counts what each person is priced for, and what the SELLER’s range left behind', async () => {
    // Anna is priced for one of the two products. Then the seller moves
    // the range up under her existing price — nobody here did anything,
    // and she can no longer sell it. Both numbers are on the roster
    // because both are the reason somebody stops selling.
    const first = setup();
    await first.svc.setPrice(actor(), ANNA, V1, '150.00');
    const before = await first.svc.list(STORE);
    expect(before.sellableProducts).toBe(2);
    expect(before.associates.find((a) => a.storeUserId === ANNA)).toMatchObject({
      fullName: 'Anna',
      pricedProducts: 1,
      unpricedProducts: 1,
      outOfRangePrices: 0,
    });
    expect(before.associates.find((a) => a.storeUserId === BRIJ)).toMatchObject({
      pricedProducts: 0,
      unpricedProducts: 2,
    });

    const moved = setup({ [V1]: { min: '160', max: '200' }, [V2]: { min: null, max: null } });
    moved.table.seed(ANNA, V1, '150.00');
    const after = await moved.svc.list(STORE);
    expect(after.associates.find((a) => a.storeUserId === ANNA)).toMatchObject({
      pricedProducts: 1,
      outOfRangePrices: 1,
    });
    // ...and the pricing screen says WHICH row, since that is where it
    // gets fixed. Never auto-adjusted: a negotiated price is not ours.
    const screen = await moved.svc.pricesOf(STORE, ANNA);
    expect(screen.rows.find((r) => r.variantId === V1)).toMatchObject({
      retailPriceInr: '150.00',
      minRetailInr: '160.00',
      outOfRange: true,
    });
    expect(moved.table.find(ANNA, V1)?.retailPriceInr.toFixed(2)).toBe('150.00');
  });

  it('an unpriced product is ABSENT from pricesFor — never zero, never a default', async () => {
    const { prices, table } = setup();
    table.seed(ANNA, V1, '150.00');
    const tx = { associatePrice: table.delegate() } as any;
    const map = await prices.pricesFor(tx, ANNA, [V1, V2]);
    expect(map.get(V1)?.toFixed(2)).toBe('150.00');
    expect(map.has(V2)).toBe(false);
  });

  describe('copy-from', () => {
    it('names every figure it replaces, and separates created from unchanged', async () => {
      const { svc, table } = setup();
      table.seed(ANNA, V1, '150.00');
      table.seed(ANNA, V2, '500.00');
      table.seed(BRIJ, V1, '120.00');
      table.seed(BRIJ, V2, '500.00');

      const result = await svc.copyPrices(actor(), BRIJ, ANNA);
      expect(result.from.fullName).toBe('Anna');
      expect(result.to.fullName).toBe('Brij');
      expect(result.overwritten).toEqual([
        { variantId: V1, skuCode: 'SKU-1', fromInr: '120.00', toInr: '150.00' },
      ]);
      expect(result.unchanged).toEqual([
        { variantId: V2, skuCode: 'SKU-2', retailPriceInr: '500.00' },
      ]);
      expect(result.created).toEqual([]);
      expect(table.find(BRIJ, V1)?.retailPriceInr.toFixed(2)).toBe('150.00');
    });

    it('creates the rows the target did not have', async () => {
      const { svc, table } = setup();
      table.seed(ANNA, V1, '150.00');
      table.seed(ANNA, V2, '500.00');
      const result = await svc.copyPrices(actor(), BRIJ, ANNA);
      expect(result.created.map((c) => c.skuCode)).toEqual(['SKU-1', 'SKU-2']);
      expect(result.overwritten).toEqual([]);
      expect(table.find(BRIJ, V2)?.retailPriceInr.toFixed(2)).toBe('500.00');
    });

    it('SKIPS a line the seller’s range no longer allows rather than forcing it through', async () => {
      // A copy can no more break the seller's terms than a typed price
      // can — and the source row may have been set when the range was
      // wider, so this is a real shape rather than a hypothetical.
      const { svc, table } = setup({
        [V1]: { min: '160', max: '200' },
        [V2]: { min: null, max: null },
      });
      table.seed(ANNA, V1, '150.00');
      table.seed(BRIJ, V1, '170.00');
      const result = await svc.copyPrices(actor(), BRIJ, ANNA);
      expect(result.skipped).toEqual([
        expect.objectContaining({ variantId: V1, code: 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE' }),
      ]);
      expect(result.overwritten).toEqual([]);
      expect(table.find(BRIJ, V1)?.retailPriceInr.toFixed(2)).toBe('170.00');
    });

    it('refuses copying onto the same person', async () => {
      const { svc } = setup();
      const body = await refusal(svc.copyPrices(actor(), ANNA, ANNA));
      expect(body['code']).toBe('ASSOCIATE_COPY_SAME_PERSON');
    });
  });

  it('pausing and resuming order creation is stamped and audited', async () => {
    const { svc, audit } = setup();
    const paused = await svc.setOrdersPaused(actor(), ANNA, true);
    expect(paused.ordersPausedAt).not.toBeNull();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'store.associate.orders_paused', entityId: ANNA }),
    );
    const resumed = await svc.setOrdersPaused(actor(), ANNA, false);
    expect(resumed.ordersPausedAt).toBeNull();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'store.associate.orders_resumed' }),
    );
  });
});

/**
 * ASSOC-1 — `GET /store/associates/analysis`.
 *
 * The owner's reason for the feature is a DECISION ("the reseller will
 * know which associate is performing how much and then he can decide
 * what to do"), so the numbers on it have to be the kind you can act on.
 * Three of these tests exist because the ways of getting that wrong all
 * produce a figure that reads as fact: a rate divided by parcels still
 * moving, a margin that counts a missing cost as zero, and orders
 * attributed to somebody who did not place them.
 */

const CARLA = '0190f7a0-0000-7000-8000-00000000b003';
const WINDOW = {
  from: new Date('2026-10-01T00:00:00.000+05:30'),
  to: new Date('2026-11-01T00:00:00.000+05:30'),
};

interface FakeLine {
  readonly quantity: number;
  readonly retail: string | null;
  readonly transfer: string | null;
}

interface FakeOrder {
  readonly id: string;
  readonly placedBy: string | null;
  readonly status: OrderStatus;
  readonly everConfirmed?: boolean;
  readonly failedDeliveries?: number;
  readonly lines?: readonly FakeLine[];
}

/**
 * The analysis reads four tables. Each stub branches on the SHAPE of the
 * query rather than on call order, because `loadOrderFacts` and this
 * service both read `order` and `order_events` and a counter-based stub
 * would answer whichever ran first.
 */
function analysisSetup(orders: readonly FakeOrder[]): {
  svc: AssociateService;
  /** How many times `stock_batches` was read — must stay 0 (boundary 1). */
  stockBatchReads: () => number;
} {
  const table = new PriceTable();
  const names: Record<string, string> = { [ANNA]: 'Anna', [BRIJ]: 'Brij' };
  let stockBatchReads = 0;
  const lineRows = orders.flatMap((o) =>
    (o.lines ?? []).map((l, i) => ({
      orderId: o.id,
      variantId: i === 0 ? V1 : V2,
      skuCode: `SKU-${i + 1}`,
      productName: 'Alpha',
      quantity: l.quantity,
      resellerRetailUnitInr: l.retail === null ? null : new Prisma.Decimal(l.retail),
      resellerTransferPriceInr: l.transfer === null ? null : new Prisma.Decimal(l.transfer),
      pickedBatchId: null,
    })),
  );
  const client: any = {
    associatePrice: table.delegate(),
    sellerStore: { findFirst: async () => ({ id: STORE, sellerId: 'seller-1' }) },
    resellerStoreVariant: { findMany: async () => [{ variantId: V1 }, { variantId: V2 }] },
    storeUserInvitation: { findMany: async () => pendingInvites },
    storeUser: {
      findMany: async () =>
        [ANNA, BRIJ].map((id) => ({
          id,
          fullName: names[id] ?? '?',
          emailDisplay: `${(names[id] ?? 'x').toLowerCase()}@store.test`,
          ordersPausedAt: null,
          lastLoginAt: null,
        })),
    },
    order: {
      // The FACTS loader asks for `status`; the attribution pass asks
      // for two columns. That is the only honest way to tell them apart.
      findMany: async (args: any) => {
        if (args?.select?.status === true) {
          const ids: string[] = args.where.id.in;
          return orders
            .filter((o) => ids.includes(o.id))
            .map((o) => ({
              id: o.id,
              orderNumber: o.id,
              storeId: STORE,
              sellerId: 'seller-1',
              status: o.status,
              createdAt: new Date('2026-10-05T00:00:00Z'),
              confirmedAt: o.everConfirmed === true ? new Date('2026-10-05T01:00:00Z') : null,
              paymentMode: 'COD',
              codAmountInr: null,
              recipientPostalCode: '560001',
              recipientPhoneE164: '+919000000000',
              resellerStoreCreditTrigger: null,
              resellerStoreCreditDays: null,
            }));
        }
        return orders.map((o) => ({ id: o.id, placedByStoreUserId: o.placedBy }));
      },
    },
    orderItem: {
      findMany: async (args: any) =>
        lineRows.filter((l) => (args.where.orderId.in as string[]).includes(l.orderId)),
    },
    orderEvent: {
      findMany: async (args: any) => {
        const ids: string[] = args.where.orderId.in;
        if (args.where.toStatus === OrderStatus.DELIVERY_FAILED) {
          // One row PER ATTEMPT, so the service has to dedupe by order.
          return orders
            .filter((o) => ids.includes(o.id))
            .flatMap((o) =>
              Array.from({ length: o.failedDeliveries ?? 0 }, () => ({ orderId: o.id })),
            );
        }
        return orders
          .filter((o) => ids.includes(o.id) && o.everConfirmed === true)
          .map((o) => ({
            orderId: o.id,
            toStatus: OrderStatus.CONFIRMED,
            createdAt: new Date('2026-10-05T01:00:00Z'),
          }));
      },
    },
    stockBatch: {
      findMany: async () => {
        stockBatchReads += 1;
        return [];
      },
    },
  };
  const prisma = { client } as unknown as PrismaService;
  const gate = {
    offersFor: async () =>
      new Map(
        [V1, V2].map((variantId) => [
          variantId,
          {
            variantId,
            resellable: true,
            enabled: true,
            price: {
              transferPriceInr: new Prisma.Decimal('100'),
              minRetailInr: null,
              maxRetailInr: null,
              suggestedRetailInr: null,
            },
            stockMode: ResellerStockMode.SHARED,
            visibleQty: 10,
          },
        ]),
      ),
  };
  const catalog = {
    listResellableVariants: async () => ({
      variants: [V1, V2].map((variantId, i) => ({
        variantId,
        productId: `p-${i}`,
        skuCode: `SKU-${i + 1}`,
        variantLabel: null,
        status: 'ACTIVE',
        productName: ['Alpha', 'Beta'][i] ?? 'Gamma',
        productDescription: null,
      })),
      truncated: false,
    }),
  };
  const svc = new AssociateService(
    prisma,
    new AssociatePriceService(prisma),
    gate as never,
    catalog as never,
    { log: jest.fn() } as never,
  );
  return { svc, stockBatchReads: () => stockBatchReads };
}

describe('associate analysis (ASSOC-1)', () => {
  const delivered: FakeOrder = {
    id: 'o-delivered',
    placedBy: ANNA,
    status: OrderStatus.DELIVERED,
    everConfirmed: true,
    failedDeliveries: 2,
    lines: [{ quantity: 2, retail: '150.00', transfer: '100.00' }],
  };
  const returned: FakeOrder = {
    id: 'o-returned',
    placedBy: ANNA,
    status: OrderStatus.RTO_RESTOCKED,
    everConfirmed: true,
    lines: [{ quantity: 1, retail: '150.00', transfer: '100.00' }],
  };
  const calledOff: FakeOrder = {
    id: 'o-cancelled',
    placedBy: ANNA,
    status: OrderStatus.CANCELLED,
    lines: [{ quantity: 1, retail: '150.00', transfer: '100.00' }],
  };
  const open: FakeOrder = {
    id: 'o-open',
    placedBy: ANNA,
    status: OrderStatus.PENDING_CONFIRMATION,
    lines: [{ quantity: 1, retail: '150.00', transfer: '100.00' }],
  };

  it('counts, ranks and prices one associate’s window', async () => {
    const { svc } = analysisSetup([delivered, returned, calledOff, open]);
    const view = await svc.analysis(STORE, WINDOW);
    expect(view.from).toBe(WINDOW.from.toISOString());
    expect(view.to).toBe(WINDOW.to.toISOString());
    const anna = view.rows.find((r) => r.storeUserId === ANNA);
    expect(anna).toMatchObject({
      ordersPlaced: 4,
      confirmed: 2,
      delivered: 1,
      cancelled: 1,
      rto: 1,
      // 2 × ₹150 on the one delivered order — never the cancelled or
      // open ones, which nobody has paid for.
      retailSoldInr: '300.00',
      // (150 − 100) × 2. The store's own transfer price, which is its
      // cost and the reseller's to see.
      storeMarginInr: '100.00',
      marginCoverage: { lines: 1, linesWithTransferPrice: 1 },
    });
    // Best-selling first: the screen exists to support a decision.
    expect(view.rows[0]?.storeUserId).toBe(ANNA);
    expect(view.rows[1]?.storeUserId).toBe(BRIJ);
  });

  it('divides every rate by orders whose outcome is KNOWN, and says what that was', async () => {
    const { svc } = analysisSetup([delivered, returned, calledOff, open]);
    const anna = (await svc.analysis(STORE, WINDOW)).rows.find((r) => r.storeUserId === ANNA);
    // decided = ever confirmed (2) + called off before confirmation (1).
    // The PENDING one is in neither — it is still with the call centre.
    expect(anna?.decidedCount).toBe(3);
    expect(anna?.confirmationRate).toBeCloseTo(66.7, 1);
    // outcomes = delivered + returned + lost. The open order is in none
    // of them: a delivery rate over parcels still moving is the exact
    // failure RS-9 exists for.
    expect(anna?.outcomeKnownCount).toBe(2);
    expect(anna?.deliveryRate).toBe(50);
    expect(anna?.returnRate).toBe(50);
  });

  it('a rate with no denominator is null, NOT zero', async () => {
    // Brij has placed nothing. 0% reads as "nothing works"; null reads
    // as "not enough yet", and only one of those is true.
    const { svc } = analysisSetup([delivered]);
    const brij = (await svc.analysis(STORE, WINDOW)).rows.find((r) => r.storeUserId === BRIJ);
    expect(brij).toMatchObject({
      ordersPlaced: 0,
      confirmationRate: null,
      deliveryRate: null,
      returnRate: null,
      decidedCount: 0,
      outcomeKnownCount: 0,
    });
  });

  it('counts an NDR once per order, however many attempts failed', async () => {
    // `delivered` carries TWO failed-delivery events and was delivered
    // in the end. Counted per attempt it would read as two failures;
    // counted on the current status it would vanish entirely.
    const { svc } = analysisSetup([delivered, returned, calledOff, open]);
    const anna = (await svc.analysis(STORE, WINDOW)).rows.find((r) => r.storeUserId === ANNA);
    expect(anna?.ndr).toBe(1);
  });

  it('leaves a line with no transfer snapshot OUT of the margin and says how many', async () => {
    // TRE-6's rule: a missing cost is UNCOVERED, never zero — zero here
    // would read as "we made the whole ₹150 of retail".
    const { svc } = analysisSetup([
      {
        id: 'o-mixed',
        placedBy: ANNA,
        status: OrderStatus.DELIVERED,
        everConfirmed: true,
        lines: [
          { quantity: 1, retail: '150.00', transfer: '100.00' },
          { quantity: 1, retail: '150.00', transfer: null },
        ],
      },
    ]);
    const anna = (await svc.analysis(STORE, WINDOW)).rows.find((r) => r.storeUserId === ANNA);
    expect(anna?.storeMarginInr).toBe('50.00');
    expect(anna?.marginCoverage).toEqual({ lines: 2, linesWithTransferPrice: 1 });
  });

  it('attributes nothing to an associate who did not place it, and counts the rest once', async () => {
    const { svc } = analysisSetup([
      delivered,
      { id: 'o-nobody', placedBy: null, status: OrderStatus.DELIVERED, everConfirmed: true },
      { id: 'o-owner', placedBy: CARLA, status: OrderStatus.DELIVERED, everConfirmed: true },
    ]);
    const view = await svc.analysis(STORE, WINDOW);
    expect(view.rows.find((r) => r.storeUserId === ANNA)?.ordersPlaced).toBe(1);
    // One placed by nobody (a seller-side CSV or an API key) and one by
    // somebody who is not on the roster. Its own key, because
    // attributing either to an associate would be a claim about who
    // sold something — and present so the page adds up.
    expect(view.ordersNotByAnAssociate).toBe(2);
  });

  it('never loads the SELLER’s unit cost, let alone reports it', async () => {
    // Boundary 1 (docs/associates.md): the seller's cost is withheld
    // from the store, structurally — `loadUnitCosts` is not called, so
    // `stock_batches` is never read, and the scorecard's own seller
    // margin is absent from the response rather than present at ₹0.00.
    const probe = analysisSetup([delivered]);
    const view = await probe.svc.analysis(STORE, WINDOW);
    expect(probe.stockBatchReads()).toBe(0);
    const body = JSON.stringify(view);
    expect(body).not.toContain('marginInr"');
    expect(body).not.toContain('unitCost');
    expect(body).not.toContain('transferDelivered');
  });

  it('the delivered set behind the money is the SCORECARD’s, not a second rule', async () => {
    // The drift guard. The money pass asks `scorecard()` per order
    // whether it is delivered; this pins that answer against the
    // aggregate count in the same response, so a future terminal that
    // moves cannot leave the margin counting a different set of orders
    // from the `delivered` figure printed beside it.
    const { svc } = analysisSetup([
      delivered,
      returned,
      calledOff,
      open,
      {
        id: 'o-lost',
        placedBy: ANNA,
        status: OrderStatus.LOST_IN_TRANSIT,
        everConfirmed: true,
        lines: [{ quantity: 1, retail: '150.00', transfer: '100.00' }],
      },
    ]);
    const anna = (await svc.analysis(STORE, WINDOW)).rows.find((r) => r.storeUserId === ANNA);
    // Five orders, four of them carrying a line, and the margin counted
    // exactly ONE line — the delivered order's. A LOST parcel shares the
    // delivery FATE and is deliberately not delivered money; a returned,
    // cancelled or open one never was.
    expect(anna?.ordersPlaced).toBe(5);
    expect(anna?.delivered).toBe(1);
    expect(Object.keys(anna ?? {})).not.toContain('lost');
    expect(anna?.marginCoverage).toEqual({ lines: 1, linesWithTransferPrice: 1 });
    expect(anna?.retailSoldInr).toBe('300.00');
    expect(anna?.outcomeKnownCount).toBe(3);
  });
});
