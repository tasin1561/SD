import {
  ActorType,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerCreditTrigger,
  ResellerStockMode,
  ResellerStoreStatus,
  SellerStatus,
} from '@skydrop/db';
import {
  ResellerOrderService,
  toCreateOrderDto,
} from '../../src/modules/order/services/reseller-order.service';
import type { CreateStoreOrderDto } from '../../src/modules/order/dto/create-store-order.dto';
import type { ResellerCreateContext } from '../../src/modules/order/reseller-order-snapshot';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

const CTX = { ipAddress: null, userAgent: null, requestId: 'r1' };
const ACTOR = { kind: 'STORE_USER' as const, storeId: 'store-1', storeUserId: 'su-1' };

interface Opts {
  storeStatus?: ResellerStoreStatus;
  sellerStatus?: SellerStatus;
  enabled?: boolean | 'throws';
  ready?: boolean;
  /** RS-6 phase 3c — the store's wallet cannot pay for a prepaid order. */
  prepaidShort?: boolean;
  offered?: boolean;
  min?: string | null;
  max?: string | null;
  /** RS-5 (2026-09-19) — the seller's suggested retail for this store. */
  suggested?: string | null;
  visible?: number;
}

function makeService(opts: Opts = {}) {
  const sellerStoreFindFirst = jest.fn(async () => ({
    id: 'store-1',
    sellerId: 's1',
    name: 'Rang Store',
    displayName: 'Rang',
    status: opts.storeStatus ?? ResellerStoreStatus.ACTIVE,
    seller: { status: opts.sellerStatus ?? SellerStatus.APPROVED, deletedAt: null },
  }));
  const client = { sellerStore: { findFirst: sellerStoreFindFirst } };
  const create = jest.fn(
    async (_sellerId: string, _dto: AnyArgs, _actor: AnyArgs, _ctx: unknown, _o: AnyArgs) => ({
      id: 'o-new',
    }),
  );
  const settings = {
    resolve: jest.fn(async () => {
      if (opts.enabled === 'throws') throw new Error('settings down');
      return { value: opts.enabled ?? true };
    }),
  };
  const snapshot = {
    termsVersionId: 'tv-1',
    storeId: 'store-1',
    version: 3,
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
    publishedAt: new Date(),
    acceptedAt: new Date(),
  };
  const terms = {
    orderReadiness: jest.fn(async () =>
      opts.ready === false
        ? {
            ready: false,
            termsVersionId: 'tv-1',
            reasons: ['TERMS_NOT_ACCEPTED'],
            message: 'The store has not accepted version 3 of the terms yet.',
          }
        : { ready: true, termsVersionId: 'tv-1', reasons: [], message: null },
    ),
    currentTerms: jest.fn(async () => snapshot),
  };
  const gate = {
    offersFor: jest.fn(async () =>
      opts.offered === false
        ? new Map()
        : new Map([
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
                  suggestedRetailInr:
                    opts.suggested === undefined
                      ? D('499.00')
                      : opts.suggested === null
                        ? null
                        : D(opts.suggested),
                },
                stockMode: ResellerStockMode.SET_ASIDE,
                visibleQty: opts.visible ?? 5,
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
  // RS-6 phase 3c — the store-wallet check a prepaid order runs inside the
  // create transaction; refused as the real one refuses when asked to.
  const prepaidCheck = jest.fn(async () => {
    if (opts.prepaidShort === true) {
      throw Object.assign(new Error('short'), {
        response: { code: 'STORE_BALANCE_INSUFFICIENT' },
      });
    }
  });
  const svc = new ResellerOrderService(
    { client } as unknown as PrismaService,
    { create } as never,
    settings as never,
    terms as never,
    gate as never,
    catalog as never,
    { assertPrepaidCovered: prepaidCheck } as never,
  );
  return { svc, create, settings, terms, gate, snapshot, prepaidCheck };
}

function input(over: Partial<CreateStoreOrderDto> = {}): CreateStoreOrderDto {
  return {
    recipientName: 'Asha Verma',
    recipientPhoneE164: '+919876543210',
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: 'Near City Hospital',
    recipientPostalCode: '560001',
    paymentMode: PaymentMode.COD,
    items: [{ variantId: 'v1', quantity: 2, retailUnitPriceInr: 499 }],
    ...over,
  } as CreateStoreOrderDto;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return ((e as { response?: { code?: string } }).response?.code ?? 'THREW') as string;
  }
}

describe('ResellerOrderService.create — the refusals, IN ORDER (RS-5)', () => {
  it('1. a paused store is refused before anything else is asked', async () => {
    const { svc, settings } = makeService({
      storeStatus: ResellerStoreStatus.PAUSED,
      enabled: false,
      ready: false,
    });
    expect(await code(svc.create(ACTOR, input({ paymentMode: PaymentMode.PREPAID }), CTX))).toBe(
      'RESELLER_STORE_PAUSED',
    );
    expect(settings.resolve).not.toHaveBeenCalled();
  });

  it('1. a store whose seller is not approved takes no orders', async () => {
    const { svc } = makeService({ sellerStatus: SellerStatus.SUSPENDED });
    expect(await code(svc.create(ACTOR, input(), CTX))).toBe('RESELLER_STORE_NOT_ACTIVE');
  });

  it('2. the master switch — off, and FAILS CLOSED when unreadable', async () => {
    const off = makeService({ enabled: false, ready: false });
    expect(await code(off.svc.create(ACTOR, input(), CTX))).toBe('RESELLER_ORDERS_DISABLED');
    expect(off.terms.orderReadiness).not.toHaveBeenCalled();
    const down = makeService({ enabled: 'throws' });
    expect(await code(down.svc.create(ACTOR, input(), CTX))).toBe('RESELLER_ORDERS_DISABLED');
  });

  it('3. the terms must be ready (and the refusal carries the reasons)', async () => {
    const { svc, gate } = makeService({ ready: false, offered: false });
    expect(await code(svc.create(ACTOR, input(), CTX))).toBe('RESELLER_TERMS_NOT_READY');
    expect(gate.offersFor).not.toHaveBeenCalled();
  });

  it('4. a product not offered to the store is refused before its retail is judged', async () => {
    const { svc } = makeService({ offered: false });
    expect(
      await code(
        svc.create(
          ACTOR,
          input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 1 }] }),
          CTX,
        ),
      ),
    ).toBe('RESELLER_VARIANT_NOT_OFFERED');
  });

  it('5. retail outside [min, max] is refused, naming the range', async () => {
    const { svc } = makeService();
    const low = svc.create(
      ACTOR,
      input({
        paymentMode: PaymentMode.PREPAID,
        items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 399.99 }],
      }),
      CTX,
    );
    await expect(low).rejects.toMatchObject({
      response: {
        code: 'RETAIL_OUT_OF_RANGE',
        message: expect.stringContaining('₹400.00 and ₹600.00'),
      },
    });
    expect(
      await code(
        svc.create(
          ACTOR,
          input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 600.01 }] }),
          CTX,
        ),
      ),
    ).toBe('RETAIL_OUT_OF_RANGE');
  });

  it('5. no range set means any retail', async () => {
    const { svc } = makeService({ min: null, max: null });
    expect(
      await code(
        svc.create(
          ACTOR,
          input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 1 }] }),
          CTX,
        ),
      ),
    ).toBe('OK');
  });

  it('6. PREPAID is paid from the store wallet — checked INSIDE the create transaction', async () => {
    // RS-6 phase 3c: prepaid is ON. It passes every refusal before the write,
    // and the store's wallet is asked, under the lock, whether it can pay the
    // transfer price (2 × ₹300) and its delivery share.
    const tx = (): unknown => ({ $queryRaw: jest.fn(async () => [{ status: 'active' }]) });
    const ok = makeService();
    expect(await code(ok.svc.create(ACTOR, input({ paymentMode: PaymentMode.PREPAID }), CTX))).toBe(
      'OK',
    );
    const reseller = ok.create.mock.calls[0]![4]['reseller'] as ResellerCreateContext;
    await reseller.lockAndReadTerms(tx() as never);
    expect(ok.prepaidCheck).toHaveBeenCalledTimes(1);
    const asked = (ok.prepaidCheck.mock.calls[0] as unknown as [unknown, AnyArgs])[1];
    expect(asked).toMatchObject({ storeId: 'store-1', sellerId: 's1' });
    expect((asked['transferTotal'] as Prisma.Decimal).toFixed(2)).toBe('600.00');
    expect((asked['deliveryFeeStorePercent'] as Prisma.Decimal).toFixed(2)).toBe('80.00');

    // A wallet that cannot pay refuses the order inside its transaction.
    const short = makeService({ prepaidShort: true });
    await short.svc.create(ACTOR, input({ paymentMode: PaymentMode.PREPAID }), CTX);
    const shortCtx = short.create.mock.calls[0]![4]['reseller'] as ResellerCreateContext;
    expect(await code(shortCtx.lockAndReadTerms(tx() as never))).toBe('STORE_BALANCE_INSUFFICIENT');

    // A COD order never asks the store's wallet.
    const cod = makeService();
    await cod.svc.create(ACTOR, input(), CTX);
    const codCtx = cod.create.mock.calls[0]![4]['reseller'] as ResellerCreateContext;
    await codCtx.lockAndReadTerms(tx() as never);
    expect(cod.prepaidCheck).not.toHaveBeenCalled();
  });

  it('7. no more than the store is SHOWN — summed across lines of the same product', async () => {
    const { svc, create } = makeService({ visible: 3 });
    expect(
      await code(
        svc.create(
          ACTOR,
          input({
            items: [
              { variantId: 'v1', quantity: 2, retailUnitPriceInr: 499 },
              { variantId: 'v1', quantity: 2, retailUnitPriceInr: 499 },
            ],
          }),
          CTX,
        ),
      ),
    ).toBe('RESELLER_QTY_EXCEEDS_VISIBLE');
    expect(create).not.toHaveBeenCalled();
  });
});

/*
  THE SELLING PRICE, AND THE FALLBACK (owner, 2026-09-19).

  Asked for so a store's CSV row need not restate a price the seller
  already set, but decided in `ResellerOrderService` so the portal, the
  CSV worker and the API key cannot disagree about what an absent price
  means. Three cases, and the third is the one that matters: with no
  suggestion either, it is REFUSED rather than priced at nothing.
*/
describe('ResellerOrderService.create — a line with NO selling price stated (2026-09-19)', () => {
  const noPrice = (): CreateStoreOrderDto =>
    input({ items: [{ variantId: 'v1', quantity: 2 }] } as Partial<CreateStoreOrderDto>);

  it('takes the seller’s SUGGESTED retail for this store, and snapshots it', async () => {
    const { svc, create } = makeService({ suggested: '499.00' });
    await svc.create(ACTOR, noPrice(), CTX);
    const reseller = create.mock.calls[0]![4]['reseller'] as ResellerCreateContext;
    expect(reseller.lines[0]!.retailUnitInr.toFixed(2)).toBe('499.00');
    // And the unit price every existing reader shows is the RESOLVED one,
    // not the (absent) requested one — a null there would disagree with
    // the snapshot beside it.
    expect((create.mock.calls[0]![1]['items'] as AnyArgs[])[0]!['unitPriceInr']).toBe(499);
  });

  it('the COD total is built from the resolved retail, not from nothing', async () => {
    const { svc, create } = makeService({ suggested: '499.00' });
    await svc.create(ACTOR, noPrice(), CTX);
    // 2 × 499, no delivery fee, no discount, no advance.
    expect(create.mock.calls[0]![1]['codAmountInr']).toBe(998);
  });

  it('with NO suggested retail either, it is refused BY NAME — never ₹0', async () => {
    const { svc, create } = makeService({ suggested: null, min: null, max: null });
    expect(await code(svc.create(ACTOR, noPrice(), CTX))).toBe('RESELLER_RETAIL_REQUIRED');
    expect(create).not.toHaveBeenCalled();
  });

  it('a suggested retail OUTSIDE the seller’s own range is still refused', async () => {
    // The seller set both, and they disagree. We do not quietly ship the
    // one that breaks the agreement just because we chose it ourselves.
    const { svc, create } = makeService({ suggested: '900.00', min: '400.00', max: '600.00' });
    expect(await code(svc.create(ACTOR, noPrice(), CTX))).toBe('RETAIL_OUT_OF_RANGE');
    expect(create).not.toHaveBeenCalled();
  });

  it('a STATED price still wins, and is still range-checked', async () => {
    const { svc, create } = makeService({ suggested: '499.00' });
    await svc.create(ACTOR, input({ items: [{ variantId: 'v1', quantity: 1 }] }), CTX);
    expect(
      (
        create.mock.calls[0]![4]['reseller'] as ResellerCreateContext
      ).lines[0]!.retailUnitInr.toFixed(2),
    ).toBe('499.00');

    const second = makeService({ suggested: '499.00' });
    await second.svc.create(
      ACTOR,
      input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 550 }] }),
      CTX,
    );
    expect(
      (
        second.create.mock.calls[0]![4]['reseller'] as ResellerCreateContext
      ).lines[0]!.retailUnitInr.toFixed(2),
    ).toBe('550.00');

    const third = makeService({ suggested: '499.00' });
    expect(
      await code(
        third.svc.create(
          ACTOR,
          input({ items: [{ variantId: 'v1', quantity: 1, retailUnitPriceInr: 900 }] }),
          CTX,
        ),
      ),
    ).toBe('RETAIL_OUT_OF_RANGE');
  });
});

describe('ResellerOrderService.create — what is written (RS-5 snapshot)', () => {
  it('files the order under the store, PENDING_CONFIRMATION, with each line’s terms', async () => {
    const { svc, create } = makeService();
    await svc.create(ACTOR, input(), CTX, { source: OrderSource.API });
    expect(create).toHaveBeenCalledTimes(1);
    const [sellerId, dto, actor, , options] = create.mock.calls[0]!;
    expect(sellerId).toBe('s1');
    expect(actor).toEqual({ type: ActorType.STORE, id: 'su-1' });
    expect(options['source']).toBe(OrderSource.API);
    expect(options['initialStatus']).toBe(OrderStatus.PENDING_CONFIRMATION);
    const reseller = options['reseller'] as ResellerCreateContext;
    expect(reseller.storeId).toBe('store-1');
    // What the customer sees: display_name ?? name (RS-10 reads it).
    expect(reseller.storeName).toBe('Rang');
    expect(reseller.lines).toHaveLength(1);
    const line = reseller.lines[0]!;
    expect(line.transferPriceInr.toFixed(2)).toBe('300.00');
    expect(line.retailUnitInr.toFixed(2)).toBe('499.00');
    expect(line.minRetailInr?.toFixed(2)).toBe('400.00');
    expect(line.maxRetailInr?.toFixed(2)).toBe('600.00');
    expect(line.stockMode).toBe(ResellerStockMode.SET_ASIDE);
    // Retail IS the unit price every existing reader shows.
    expect((dto['items'] as AnyArgs[])[0]!['unitPriceInr']).toBe(499);
  });

  it('an API key places it as the key', async () => {
    const { svc, create } = makeService();
    await svc.create({ kind: 'STORE_API_KEY', storeId: 'store-1', apiKeyId: 'k-1' }, input(), CTX);
    expect(create.mock.calls[0]![2]).toEqual({ type: ActorType.API, id: 'k-1' });
  });

  it('lockAndReadTerms: FOR SHARE, re-checks ACTIVE, snapshots the version in force', async () => {
    const { svc, create } = makeService();
    await svc.create(ACTOR, input(), CTX);
    const reseller = create.mock.calls[0]![4]['reseller'] as ResellerCreateContext;

    const sqlSeen: string[] = [];
    const tx = (status: string): unknown => ({
      $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
        sqlSeen.push(sql.strings.join('?'));
        return [{ status }];
      }),
    });
    const terms = await reseller.lockAndReadTerms(tx('active') as never);
    expect(sqlSeen[0]).toMatch(/FOR SHARE/);
    expect(terms).toMatchObject({
      termsVersionId: 'tv-1',
      storeCreditTrigger: ResellerCreditTrigger.ON_PAYOUT,
      storeCreditDays: 2,
      sellerCreditTrigger: ResellerCreditTrigger.AFTER_DELIVERY,
      sellerCreditDays: 7,
    });
    expect(terms.deliveryFeeStorePercent.toFixed(2)).toBe('80.00');
    expect(terms.instantPayFeeStorePercent.toFixed(2)).toBe('50.00');

    // Paused or closed a moment ago → the order is refused inside its tx.
    expect(await code(reseller.lockAndReadTerms(tx('paused') as never))).toBe(
      'RESELLER_STORE_PAUSED',
    );
    expect(await code(reseller.lockAndReadTerms(tx('closed') as never))).toBe(
      'RESELLER_STORE_NOT_ACTIVE',
    );
  });
});

describe('toCreateOrderDto (RS-5)', () => {
  const lines = [
    {
      transferPriceInr: D(300),
      retailUnitInr: D('499.50'),
      minRetailInr: null,
      maxRetailInr: null,
      stockMode: ResellerStockMode.SHARED,
    },
  ];

  it('a COD order with no amount collects retail × qty + delivery − discount − advance', () => {
    const dto = toCreateOrderDto(
      input({
        items: [{ variantId: 'v1', quantity: 2, retailUnitPriceInr: 499.5 }],
        deliveryFeeInr: 60,
        discountInr: 9,
        advanceAmountInr: 50,
      }),
      lines,
    );
    expect(dto.codAmountInr).toBe(1000);
  });

  it('a stated COD amount is kept as stated, and notes become the order’s notes', () => {
    const dto = toCreateOrderDto(input({ codAmountInr: 750, notes: 'Call before 6pm' }), lines);
    expect(dto.codAmountInr).toBe(750);
    expect(dto.sellerNotes).toBe('Call before 6pm');
    expect((dto as unknown as AnyArgs)['notes']).toBeUndefined();
  });
});
