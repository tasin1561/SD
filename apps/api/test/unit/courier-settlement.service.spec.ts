import { OrderStatus, Prisma } from '@skydrop/db';
import type { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import {
  CourierSettlementService,
  recognisedShortfall,
} from '../../src/modules/courier-settlement/services/courier-settlement.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';
import type { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';
import { AdvisoryLock, advisoryKey } from '../../src/common/db/advisory-lock';

type AnyArgs = Record<string, unknown>;

const STAFF = 'staff-1';
const ACCOUNT = 'acct-1';
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const DAY = 86_400_000;

function makeSut(
  opts: {
    account?: AnyArgs | null;
    duplicate?: AnyArgs | null;
    orders?: Array<{
      id: string;
      orderNumber: string;
      codAmountInr: Prisma.Decimal | null;
      sellerId?: string;
    }>;
    delivered?: AnyArgs[];
    shortfallThreshold?: string;
    receivingAccount?: null;
    /** Orders already credited (on an earlier payout). */
    alreadyCredited?: string[];
    /** What each order was paid on earlier payouts, net. */
    priorSettled?: Record<string, string>;
    /** The shortfall already recognised on each order by earlier lines. */
    priorRecognised?: Record<string, string>;
    /** What reverseForOrder answers for a reversed order. */
    reverse?: { reversed: boolean; reason?: string; grossInr?: string };
    /** Cash the reversed order's seller holds with us, across accounts. */
    sellerHeld?: string;
    /** Their wallet balance just before a reversal (defaults to `sellerHeld`). */
    walletBefore?: string;
    /** What each seller owes us before this payout (a positive number). */
    debt?: Record<string, string>;
    /** Waybill-bearing shipments of the payout's orders. */
    shipments?: AnyArgs[];
  } = {},
) {
  // ONE lookup: the courier exists, and this is where its cash lands.
  // The link is on the COURIER because a courier pays into one account
  // of ours while one account of ours receives from every courier.
  // `receivingAccount: null` exercises the refusal — a settlement with
  // no cash behind it is not recordable.
  const accountFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.account === undefined
      ? {
          id: ACCOUNT,
          payoutBankAccount:
            opts.receivingAccount === null
              ? null
              : { id: 'bank-inr-1', currency: 'INR', isActive: true, deletedAt: null },
        }
      : opts.account,
  );
  const settlementFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => opts.duplicate ?? null,
  );
  const created: AnyArgs[] = [];
  const settlementCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    const data = args['data'] as AnyArgs;
    created.push(data);
    const lines = ((data['lines'] as AnyArgs | undefined)?.['create'] ?? []) as AnyArgs[];
    return {
      id: 'stl-1',
      courierAccountId: data['courierAccountId'],
      reference: data['reference'],
      amountInr: data['amountInr'],
      allocatedInr: data['allocatedInr'],
      earlyCodFeeInr: data['earlyCodFeeInr'] ?? D('0'),
      freightDeductedInr: data['freightDeductedInr'] ?? D('0'),
      rtoReversalInr: data['rtoReversalInr'] ?? D('0'),
      receivedAt: data['receivedAt'],
      note: data['note'] ?? null,
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      lines: lines.map((l) => ({ ...l, order: { orderNumber: 'SD-2026-07-000001' } })),
    };
  });
  const rechargeCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'rc-1' }));
  const orderFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async (args) => {
    const where = (args['where'] ?? {}) as AnyArgs;
    // The reconciliation query filters on status; the record path filters on id.
    if (where['status'] === OrderStatus.DELIVERED) return opts.delivered ?? [];
    const ids = (where['id'] as { in?: string[] } | undefined)?.in;
    return (opts.orders ?? []).filter((o) => ids === undefined || ids.includes(o.id));
  });

  // The per-order and wallet advisory locks: (strings, namespace, key).
  const executeRaw = jest.fn(async (..._args: unknown[]) => 1);
  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    $executeRaw: executeRaw,
    shipment: { findMany: jest.fn(async () => opts.shipments ?? []) },
    courierAccount: { findFirst: accountFindFirst },
    courierSettlement: {
      findUnique: settlementFindUnique,
      create: settlementCreate,
      findMany: jest.fn(async () => []),
    },
    order: {
      findMany: orderFindMany,
      // An RTO reversal names its order; this is its seller.
      findUnique: jest.fn(async (args: AnyArgs) => ({
        id: (args['where'] as AnyArgs)['id'],
        sellerId: 's-rto',
      })),
    },
    // What each order was paid, and what was recognised, on EARLIER payouts.
    courierSettlementLine: {
      groupBy: jest.fn(async () =>
        Object.entries(opts.priorSettled ?? {}).map(([orderId, v]) => ({
          orderId,
          _sum: {
            settledInr: D(v),
            shortfallInr: D(opts.priorRecognised?.[orderId] ?? '0'),
          },
        })),
      ),
    },
    // The early-COD fee's category, found or created on first use.
    expenseCategory: { upsert: jest.fn(async () => ({ id: 'cat-cod-fee' })) },
    // A COD-funded wallet top-up's recharge record.
    courierWalletRecharge: { create: rechargeCreate },
  };
  // The shortfall circuit breaker reads its threshold from settings.
  const client2 = {
    ...client,
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueDecimal: opts.shortfallThreshold ?? '5.00' })),
    },
  };
  const prisma = { client: client2 } as unknown as PrismaService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  // The credit itself is pinned in cod-credit.service.spec and end to
  // end. Here the default SETTLEMENT mode means the recorder DOES try to
  // credit, so the stub records the calls without doing wallet maths.
  const creditForOrder = jest.fn(async (_tx: unknown, input: { orderId: string }) => ({
    credited: !(opts.alreadyCredited ?? []).includes(input.orderId),
  }));
  const reverseForOrder = jest.fn(async () => ({
    grossInr: '0.00',
    returnedInr: '0.00',
    ...(opts.reverse ?? { reversed: true }),
  }));
  // No longer asked by the recorder: an uncredited order is credited
  // whatever the seller's mode is now. Kept so a test can prove that.
  const resolveMode = jest.fn<Promise<string>, [string]>(async () => 'SETTLEMENT');
  const codCredit = {
    resolveMode,
    isCredited: jest.fn(async (_tx: unknown, orderId: string) =>
      (opts.alreadyCredited ?? []).includes(orderId),
    ),
    creditForOrder,
    reverseForOrder,
  } as unknown as CodCreditService;
  const wallet = {
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  } as unknown as WalletService;

  // The bank side. Its own maths is pinned in the treasury e2e against a
  // real database; here we only care THAT it is written, and with what.
  const bankPost = jest.fn<Promise<{ id: string }>, [AnyArgs, unknown?]>(async () => ({
    id: 'be-1',
  }));
  const bank = { post: bankPost } as unknown as BankLedgerService;

  // The debt a seller's incoming cash repays, consumed as it is repaid.
  // The real split is pinned in seller-cash-attribution.service.spec and
  // end to end in settlement-bank-invariant.spec.
  const debt = new Map(Object.entries(opts.debt ?? {}).map(([k, v]) => [k, D(v)]));
  // A reversed credit's cash stops being the seller's: up to the amount
  // asked, capped at what they hold (pinned for real in
  // seller-cash-attribution.service.spec and settlement-bank-invariant.spec).
  const takeToCapital = jest.fn(
    async (_tx: unknown, input: { sellerId: string; amount: Prisma.Decimal }) => {
      const held = D(opts.sellerHeld ?? '0');
      return held.lt(input.amount) ? held : input.amount;
    },
  );
  const attribution = {
    takeToCapital,
    walletBalance: jest.fn(async () => D(opts.walletBefore ?? opts.sellerHeld ?? '0')),
    sellerHeld: jest.fn(async () => ({
      total: D(opts.sellerHeld ?? '0'),
      accountId: 'bank-inr-1',
    })),
    debtSplit: jest.fn(async (_tx: unknown, sellerId: string, amount: Prisma.Decimal) => {
      const owed = debt.get(sellerId) ?? D('0');
      const toCapital = owed.lt(amount) ? owed : amount;
      debt.set(sellerId, owed.sub(toCapital));
      return { toCapital, toSeller: amount.sub(toCapital) };
    }),
  } as unknown as SellerCashAttributionService;

  return {
    svc: new CourierSettlementService(prisma, audit, codCredit, wallet, bank, attribution),
    wallet: wallet as unknown as { recomputeCacheAfterCommit: jest.Mock },
    executeRaw,
    creditForOrder,
    reverseForOrder,
    resolveMode,
    takeToCapital,
    bankPost,
    auditLog,
    created,
    settlementCreate,
    rechargeCreate,
  };
}

const BASE = {
  courierAccountId: ACCOUNT,
  reference: 'DLV-PAYOUT-0001',
  amountInr: '1000.00',
  receivedAt: '2026-07-20T10:00:00.000Z',
};

describe('CourierSettlementService.record', () => {
  const orders = [
    { id: 'o-1', orderNumber: 'SD-2026-07-000001', codAmountInr: D('600.00') },
    { id: 'o-2', orderNumber: 'SD-2026-07-000002', codAmountInr: D('400.00') },
  ];

  it('records the payout and snapshots each order’s expected COD', async () => {
    const sut = makeSut({ orders });
    const view = await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });

    expect(view.amountInr).toBe('1000');
    expect(view.allocatedInr).toBe('1000');
    expect(view.unallocatedInr).toBe('0');
    expect(view.lines).toHaveLength(2);
    // Expected comes from the ORDER, not from the caller — a payout cannot
    // redefine what it was supposed to cover.
    const line = sut.created[0]!['lines'] as AnyArgs;
    const createdLines = line['create'] as AnyArgs[];
    expect(createdLines[0]!['expectedInr']).toEqual(D('600.00'));
  });

  it('surfaces a SHORT payment as a negative variance', async () => {
    const sut = makeSut({ orders });
    const view = await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '950.00',
      lines: [
        { orderId: 'o-1', settledInr: '550.00' }, // 50 short
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const short = view.lines.find((l) => l.orderId === 'o-1');
    expect(short?.varianceInr).toBe('-50');
  });

  it('audits HIGH when the payout does not add up to its allocation', async () => {
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '1000.00',
      lines: [{ orderId: 'o-1', settledInr: '600.00' }], // 400 unexplained
    });
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.courier_settlement.recorded',
        severity: 'HIGH',
        metadata: expect.objectContaining({ unallocatedInr: '400' }),
      }),
      expect.anything(),
    );
  });

  it('audits MEDIUM when it balances', async () => {
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'MEDIUM' }),
      expect.anything(),
    );
  });

  it('refuses the same bank credit twice — double-counting what we were paid', async () => {
    const sut = makeSut({ orders, duplicate: { id: 'stl-existing' } });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ALREADY_RECORDED' } });
    expect(sut.settlementCreate).not.toHaveBeenCalled();
  });

  it('rejects an order listed twice in one payout', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [
          { orderId: 'o-1', settledInr: '300.00' },
          { orderId: 'o-1', settledInr: '300.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ORDER_REPEATED' } });
  });

  it('rejects an unknown order rather than allocating into the void', async () => {
    const sut = makeSut({ orders: [] });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [{ orderId: 'ghost', settledInr: '100.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ORDER_NOT_FOUND' } });
  });

  it('requires a payout reference — it is the idempotency key', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        reference: '   ',
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_REFERENCE_REQUIRED' } });
  });

  it('404s on an unknown courier account', async () => {
    const sut = makeSut({ account: null });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'COURIER_ACCOUNT_NOT_FOUND' } });
  });

  it.each(['-5', 'abc'])('rejects the invalid amount %s', async (amt) => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: amt,
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_AMOUNT_INVALID' } });
  });

  it('rejects an invalid receivedAt', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        receivedAt: 'not-a-date',
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RECEIVED_AT_INVALID' } });
  });
});

describe('recognisedShortfall', () => {
  const rs = (
    expected: string,
    priorPaid: string,
    priorRecognised: string,
    settled: string,
    reversal = false,
  ): string =>
    recognisedShortfall({
      expected: D(expected),
      priorPaid: D(priorPaid),
      priorRecognised: D(priorRecognised),
      settled: D(settled),
      reversal,
    }).toString();

  it('the first line for an order recognises its whole gap', () => {
    expect(rs('600', '0', '0', '550')).toBe('50');
  });
  it('a line that makes a gap up recognises a recovery', () => {
    expect(rs('600', '550', '50', '50')).toBe('-50');
  });
  it('overpayment is never a negative shortfall on a first line', () => {
    expect(rs('600', '0', '0', '700')).toBe('0');
  });
  it('a second payment on an order already paid in full recognises nothing', () => {
    expect(rs('600', '600', '0', '20')).toBe('0');
  });
  it('a reversal of a short-paid order recovers what was absorbed', () => {
    // Paid 550 of 600 (50 absorbed), then the courier takes the 550 back:
    // the seller's credit is reversed too, so nothing is lost any more.
    expect(rs('600', '550', '50', '-550', true)).toBe('-50');
  });
  it('a re-payment after a reversal starts afresh', () => {
    // Paid, reversed (recognised back to 0, paid net 0), now paid 500 of 600.
    expect(rs('600', '0', '0', '500')).toBe('100');
  });
  it('across an order’s lines the recognised amounts sum to the true gap', () => {
    const first = rs('600', '0', '0', '300'); // 300
    const second = rs('600', '300', first, '200'); // 100 − 300 = −200
    expect(D(first).add(D(second)).toString()).toBe('100');
  });
});

describe('CourierSettlementService.reconciliation', () => {
  const deliveredOrder = (over: AnyArgs = {}): AnyArgs => ({
    id: 'o-1',
    orderNumber: 'SD-2026-07-000001',
    sellerId: 'seller-1',
    codAmountInr: D('1000.00'),
    updatedAt: new Date(Date.now() - 20 * DAY),
    courierSettlementLines: [],
    ...over,
  });

  it('counts unsettled COD as outstanding float and ages it as overdue', async () => {
    const sut = makeSut({ delivered: [deliveredOrder()] });
    const r = await sut.svc.reconciliation();

    expect(r.outstandingFloatInr).toBe('1000');
    expect(r.overdueInr).toBe('1000');
    expect(r.overdueOrders).toHaveLength(1);
    expect(r.overdueOrders[0]).toMatchObject({
      orderNumber: 'SD-2026-07-000001',
      shortfallInr: '1000',
    });
    expect(r.overdueOrders[0]?.ageDays).toBeGreaterThanOrEqual(19);
  });

  it('a fully settled order is not float at all', async () => {
    const sut = makeSut({
      delivered: [deliveredOrder({ courierSettlementLines: [{ settledInr: D('1000.00') }] })],
    });
    const r = await sut.svc.reconciliation();
    expect(r.outstandingFloatInr).toBe('0');
    expect(r.overdueOrders).toHaveLength(0);
    expect(r.shortPaidOrders).toHaveLength(0);
  });

  it('a PART-paid order is flagged as short-paid, with only the gap counted', async () => {
    const sut = makeSut({
      delivered: [deliveredOrder({ courierSettlementLines: [{ settledInr: D('700.00') }] })],
    });
    const r = await sut.svc.reconciliation();
    expect(r.outstandingFloatInr).toBe('300');
    expect(r.shortPaidOrders).toHaveLength(1);
    expect(r.shortPaidOrders[0]?.shortfallInr).toBe('300');
  });

  it('a recent unsettled order is float but NOT yet overdue', async () => {
    const sut = makeSut({
      delivered: [deliveredOrder({ updatedAt: new Date(Date.now() - 2 * DAY) })],
    });
    const r = await sut.svc.reconciliation();
    expect(r.outstandingFloatInr).toBe('1000');
    expect(r.overdueInr).toBe('0');
    expect(r.overdueOrders).toHaveLength(0);
  });

  it('honours a custom overdue window', async () => {
    const sut = makeSut({
      delivered: [deliveredOrder({ updatedAt: new Date(Date.now() - 4 * DAY) })],
    });
    const strict = await sut.svc.reconciliation({ overdueAfterDays: 3 });
    expect(strict.overdueOrders).toHaveLength(1);
    const lax = await sut.svc.reconciliation({ overdueAfterDays: 30 });
    expect(lax.overdueOrders).toHaveLength(0);
  });

  it('sorts the oldest debt first — that is the one to chase', async () => {
    const sut = makeSut({
      delivered: [
        deliveredOrder({ id: 'o-new', updatedAt: new Date(Date.now() - 12 * DAY) }),
        deliveredOrder({ id: 'o-old', updatedAt: new Date(Date.now() - 40 * DAY) }),
      ],
    });
    const r = await sut.svc.reconciliation();
    expect(r.overdueOrders.map((o) => o.orderId)).toEqual(['o-old', 'o-new']);
  });
});

describe('CourierSettlementService.record — the cash behind the credit', () => {
  const ownerKind = (p: AnyArgs): string => (p['owner'] as { kind: string }).kind;

  const orders = [
    { id: 'o-1', orderNumber: 'SD-2026-07-000001', codAmountInr: D('600.00') },
    { id: 'o-2', orderNumber: 'SD-2026-07-000002', codAmountInr: D('400.00') },
  ];
  // An order paid out on an earlier payout, now reversed.
  const withReversed = [
    ...orders,
    { id: 'o-9', orderNumber: 'SD-2026-07-000009', codAmountInr: D('300.00'), sellerId: 's-rto' },
  ];

  it('holds each seller what we CREDITED them, not what the courier remitted', async () => {
    // The courier pays 950 against 1000 of orders. The sellers are still
    // credited 1000 (WAL-6), so the bank must show 1000 held for them —
    // and the 50 we absorbed sitting against our own money, where the
    // dispute is visible instead of quietly shrinking someone's balance.
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '950.00',
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '350.00' },
      ],
    });

    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const seller = posts.filter((p) => ownerKind(p) === 'SELLER');
    const capital = posts.filter((p) => ownerKind(p) === 'CAPITAL');

    // One entry per order credited, posted before its credit.
    expect(seller.map((p) => String(p['signedAmount']))).toEqual(['600', '400']);
    expect(capital).toHaveLength(1);
    expect(String(capital[0]?.['signedAmount'])).toBe('-50');
  });

  it('every entry names its currency, so none can be relabelled by the account', async () => {
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) expect(p['amountCurrency']).toBe('INR');
  });

  it('an exactly-paid settlement leaves nothing against capital', async () => {
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    expect(posts.filter((p) => ownerKind(p) === 'CAPITAL')).toHaveLength(0);
  });

  it('grosses up an early-COD fee and books it as an expense — the account moves by exactly what landed', async () => {
    // Shiprocket collected ₹1,000, kept ₹90 as its early-COD fee and paid
    // ₹910. The fee is a real cost the wallet never sees; it must reach
    // /expenses and the P&L, and the bank must still read ₹910.
    const sut = makeSut({ orders });
    const view = await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '910.00',
      deductions: { earlyCodFeeInr: '90.00' },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });

    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const expense = posts.filter((p) => p['type'] === 'EXPENSE');
    expect(expense).toHaveLength(1);
    expect(expense[0]).toMatchObject({
      settlementId: 'stl-1',
      expenseCategoryId: 'cat-cod-fee',
      owner: { kind: 'CAPITAL' },
    });
    expect(String(expense[0]?.['signedAmount'])).toBe('-90');
    // Sellers held what they were credited; nothing absorbed by capital.
    expect(
      posts.filter((p) => p['type'] === 'COURIER_SETTLEMENT' && ownerKind(p) === 'CAPITAL'),
    ).toHaveLength(0);
    const net = posts.reduce((t, p) => t.add(p['signedAmount'] as Prisma.Decimal), D('0'));
    expect(net.toString()).toBe('910');

    expect(sut.created[0]?.['earlyCodFeeInr']).toEqual(D('90.00'));
    expect(view).toMatchObject({ keptBackInr: '90', unallocatedInr: '0' });
    // Explained: landed + kept back = the COD it covers.
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.courier_settlement.recorded', severity: 'MEDIUM' }),
      expect.anything(),
    );
  });

  it('books freight kept back as a TOP-UP of the courier wallet — never a cost, never a shortfall', async () => {
    // Shiprocket Postpaid: ₹50 of the COD went into our Shiprocket wallet
    // and paid for freight there, where each parcel's cost already
    // records it. Costing it again here would count it twice.
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '950.00',
      deductions: { freightInr: '50.00' },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    expect(posts.filter((p) => p['type'] === 'EXPENSE')).toHaveLength(0);
    // Nothing absorbed by capital: the payout is explained in full.
    expect(
      posts.filter((p) => p['type'] === 'COURIER_SETTLEMENT' && ownerKind(p) === 'CAPITAL'),
    ).toHaveLength(0);
    const topUp = posts.filter((p) => p['type'] === 'COURIER_WALLET_RECHARGE');
    expect(topUp).toHaveLength(1);
    expect(String(topUp[0]?.['signedAmount'])).toBe('-50');
    expect(topUp[0]?.['reference']).toBe('COD-DLV-PAYOUT-0001');
    // Its recharge record, matched to that entry — or the "paid but
    // never arrived" check would call it money lost.
    expect(sut.rechargeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalTxnId: 'COD-DLV-PAYOUT-0001',
        bankEntryId: 'be-1',
        matchState: 'MATCHED',
      }),
    });
    const net = posts.reduce((t, p) => t.add(p['signedAmount'] as Prisma.Decimal), D('0'));
    expect(net.toString()).toBe('950');
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'MEDIUM' }),
      expect.anything(),
    );
  });

  it('is still HIGH when landed + kept back does not reach what it covers', async () => {
    const sut = makeSut({ orders });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '900.00',
      deductions: { earlyCodFeeInr: '50.00' },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'HIGH',
        metadata: expect.objectContaining({ unallocatedInr: '-50', earlyCodFeeInr: '50' }),
      }),
      expect.anything(),
    );
  });

  it('refuses a negative deduction', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        deductions: { earlyCodFeeInr: '-5' },
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_AMOUNT_INVALID' } });
  });

  it('holds a seller only the COD THIS payout credited — an order credited earlier is not held twice', async () => {
    // o-1 was credited on an earlier part-payment; this payout carries the
    // rest of it. Its seller was held the whole COD then, so this cash
    // repays what we fronted — capital's, not the seller's again.
    const sut = makeSut({ orders, alreadyCredited: ['o-1'] });
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const seller = posts.filter((p) => ownerKind(p) === 'SELLER');
    const capital = posts.filter((p) => ownerKind(p) === 'CAPITAL');
    expect(seller.map((p) => String(p['signedAmount']))).toEqual(['400']);
    expect(capital.map((p) => String(p['signedAmount']))).toEqual(['600']);
  });

  it('takes a reversed COD back from the seller who holds it — the account moves by what landed', async () => {
    // ₹1,000 of COD collected, ₹300 clawed back for an order paid out
    // earlier that then returned: ₹700 lands.
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      sellerHeld: '5000',
      reverse: { reversed: true, grossInr: '300.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '700.00',
      deductions: {
        rtoReversalInr: '300.00',
        rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }],
      },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.reverseForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'o-9', sellerId: 's-rto' }),
    );
    // Their part stops being theirs WHEREVER they hold it (up to the
    // reversed credit's gross), and the cash leaves as ours from this
    // account — one clawback entry, capital's.
    expect(sut.takeToCapital).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: 's-rto', amount: D('300.00') }),
    );
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    expect(
      posts.filter((p) => ownerKind(p) === 'CAPITAL').map((p) => String(p['signedAmount'])),
    ).toEqual(['-300']);
    const net = posts.reduce((t, p) => t.add(p['signedAmount'] as Prisma.Decimal), D('0'));
    expect(net.toString()).toBe('700');
    expect(sut.created[0]?.['rtoReversalInr']).toEqual(D('300.00'));
    // The reversal is a NEGATIVE line, so the payout is explained in full.
    expect(sut.created[0]?.['allocatedInr']).toEqual(D('700.00'));
    const lines = (sut.created[0]!['lines'] as AnyArgs)['create'] as AnyArgs[];
    const rev = lines.find((l) => l['orderId'] === 'o-9');
    expect(String(rev?.['settledInr'])).toBe('-300');
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.courier_settlement.recorded', severity: 'MEDIUM' }),
      expect.anything(),
    );
  });

  it('beyond what the seller holds, a reversal leaves capital — their wallet shows the debt', async () => {
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      sellerHeld: '250',
      reverse: { reversed: true, grossInr: '300.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '700.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const rto = posts.filter((p) => String(p['note']).startsWith('COD reversed'));
    // ₹250 of their cash became ours (all they hold); the ₹300 leaves as
    // ours, and the note says how much of it they held.
    expect(rto.map((p) => [ownerKind(p), String(p['signedAmount'])])).toEqual([
      ['CAPITAL', '-300'],
    ]);
    expect(String(rto[0]?.['note'])).toContain('held 250.00');
  });

  it('a short-paid reversal takes up to the credit’s GROSS from the seller, not the courier’s figure', async () => {
    // o-9 (COD 300) was paid 250; the courier takes the 250 back. The whole
    // ₹300 credit went, so up to ₹300 of their cash stops being theirs —
    // capped at the courier's 250, ₹50 stayed "theirs" for a wallet owing
    // nothing. Worked end to end in settlement-bank-invariant.spec.
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '250.00' },
      priorRecognised: { 'o-9': '50.00' },
      sellerHeld: '5000',
      reverse: { reversed: true, grossInr: '300.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '750.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '250.00' }] },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.takeToCapital).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: 's-rto', amount: D('300.00') }),
    );
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const rto = posts.filter((p) => String(p['note']).startsWith('COD reversed'));
    expect(rto.map((p) => [ownerKind(p), String(p['signedAmount'])])).toEqual([
      ['CAPITAL', '-250'],
    ]);
  });

  it('takes only what the reversal took off their wallet — not the tax it gave back', async () => {
    // Owed ₹100 before a ₹300 reversal: the most that stops being theirs
    // is ₹100 (max(0, 100) − max(0, 100 − 300)). The returned tax moved
    // back to them as its own entry; taking the whole ₹300 took it too.
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      sellerHeld: '5000',
      walletBefore: '100',
      reverse: { reversed: true, grossInr: '300.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '700.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.takeToCapital).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: 's-rto', amount: D('100') }),
    );
  });

  it('a payout that only takes a COD back still refreshes that seller’s cached balance', async () => {
    // TRE-7's credit block at order create reads the cache: left stale, a
    // seller whose COD was just reversed keeps trading on the old figure.
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      sellerHeld: '5000',
      reverse: { reversed: true, grossInr: '300.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '0.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
      lines: [],
    });
    expect(sut.wallet.recomputeCacheAfterCommit).toHaveBeenCalledWith(
      's-rto',
      'INR',
      expect.any(String),
    );
  });

  it('locks every seller’s wallet up front, in ONE sorted order, whatever order the lines are in', async () => {
    // Line by line, two payouts covering the same two sellers in opposite
    // orders each held one wallet and waited on the other (40P01).
    const sut = makeSut({
      orders: [
        { id: 'o-1', orderNumber: 'SD-1', codAmountInr: D('600.00'), sellerId: 's-b' },
        { id: 'o-2', orderNumber: 'SD-2', codAmountInr: D('400.00'), sellerId: 's-a' },
      ],
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '1000.00',
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const walletKeys = sut.executeRaw.mock.calls
      .filter((c) => c[1] === AdvisoryLock.WALLET)
      .map((c) => c[2]);
    expect(walletKeys.slice(0, 2)).toEqual([advisoryKey('s-a|INR'), advisoryKey('s-b|INR')]);
  });

  it('credits an order nobody has credited yet, whatever the seller’s mode is now', async () => {
    // A seller switched to Instant Pay after o-1 was delivered: its credit
    // never ran at delivery, so this payout owes it. o-2 WAS credited at
    // delivery and is left alone — its cash repays our front.
    const sut = makeSut({ orders, alreadyCredited: ['o-2'] });
    sut.resolveMode.mockResolvedValue('INSTANT_PAY');
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(
      sut.creditForOrder.mock.calls.map((c) => [c[1].orderId, (c[1] as AnyArgs)['mode']]),
    ).toEqual([['o-1', 'SETTLEMENT']]);
    expect(sut.resolveMode).not.toHaveBeenCalled();
  });

  it('a reversal of an order never credited comes out of capital', async () => {
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      reverse: { reversed: false, reason: 'NEVER_CREDITED' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '700.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    const rto = posts.filter((p) => String(p['note']).startsWith('COD reversed'));
    expect(rto.map((p) => [ownerKind(p), String(p['signedAmount'])])).toEqual([
      ['CAPITAL', '-300'],
    ]);
  });

  it('refuses an RTO reversal that names no orders — it cannot be booked exactly', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '700.00',
        deductions: { rtoReversalInr: '300.00' },
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RTO_REVERSAL_ORDERS_REQUIRED' } });
  });

  it('refuses reversal orders that do not add up to the stated total', async () => {
    const sut = makeSut({ orders });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '700.00',
        deductions: {
          rtoReversalInr: '300.00',
          rtoReversals: [{ orderId: 'o-9', amountInr: '250.00' }],
        },
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RTO_REVERSAL_TOTAL_MISMATCH' } });
  });

  it('refuses to reverse the same COD twice', async () => {
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '300.00' },
      reverse: { reversed: false, reason: 'ALREADY_REVERSED' },
    });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '700.00',
        deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RTO_ALREADY_REVERSED' } });
  });

  it('records each line’s shortfall as the CHANGE — a later top-up is a recovery', async () => {
    // o-1 was paid ₹550 of ₹600 before (₹50 short, recognised then).
    // This payout brings the last ₹50: the line recognises −₹50.
    const sut = makeSut({
      orders,
      priorSettled: { 'o-1': '550.00' },
      priorRecognised: { 'o-1': '50.00' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '350.00',
      lines: [
        { orderId: 'o-1', settledInr: '50.00' },
        { orderId: 'o-2', settledInr: '300.00' },
      ],
    });
    const created = (sut.created[0]!['lines'] as AnyArgs)['create'] as AnyArgs[];
    const byOrder = new Map(created.map((l) => [l['orderId'], String(l['shortfallInr'])]));
    expect(byOrder.get('o-1')).toBe('-50');
    expect(byOrder.get('o-2')).toBe('100');
  });

  it('refuses a reversal of an order no recorded payout paid', async () => {
    const sut = makeSut({ orders: withReversed });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '700.00',
        deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '300.00' }] },
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RTO_REVERSAL_NOT_PAID' } });
  });

  it('refuses a reversal that is not exactly what the courier paid on the order', async () => {
    const sut = makeSut({ orders: withReversed, priorSettled: { 'o-9': '300.00' } });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '750.00',
        deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '250.00' }] },
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_RTO_REVERSAL_AMOUNT_MISMATCH' } });
  });

  it('a reversal of a SHORT-PAID order is booked at what was paid, and recovers the absorbed gap', async () => {
    // o-9 (COD 300) was paid 250 — 50 absorbed as a short-payment. The
    // courier now takes the 250 back. The seller's whole ₹300 credit goes,
    // so the ₹50 loss no longer exists: the line recognises −50.
    const sut = makeSut({
      orders: withReversed,
      priorSettled: { 'o-9': '250.00' },
      priorRecognised: { 'o-9': '50.00' },
      sellerHeld: '5000',
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '750.00',
      deductions: { rtoReversals: [{ orderId: 'o-9', amountInr: '250.00' }] },
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const lines = (sut.created[0]!['lines'] as AnyArgs)['create'] as AnyArgs[];
    const rev = lines.find((l) => l['orderId'] === 'o-9');
    expect(String(rev?.['settledInr'])).toBe('-250');
    expect(String(rev?.['shortfallInr'])).toBe('-50');
  });

  it('refuses an order that is both paid and reversed in one payout', async () => {
    const sut = makeSut({ orders: withReversed, priorSettled: { 'o-1': '600.00' } });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        amountInr: '400.00',
        deductions: { rtoReversals: [{ orderId: 'o-1', amountInr: '600.00' }] },
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ORDER_REPEATED' } });
  });

  it('a seller in debt has it repaid from the COD — only the rest is held for them', async () => {
    // The seller owes ₹700 (charges taken while they held nothing). Of
    // ₹1,000 of their COD arriving, ₹700 settles that debt and is ours;
    // ₹300 is theirs.
    const sut = makeSut({
      orders: orders.map((o) => ({ ...o, sellerId: 's-1' })),
      debt: { 's-1': '700' },
    });
    await sut.svc.record(STAFF, {
      ...BASE,
      lines: [
        { orderId: 'o-1', settledInr: '600.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    const posts = sut.bankPost.mock.calls.map((c) => c[0] as AnyArgs);
    expect(
      posts.filter((p) => ownerKind(p) === 'SELLER').map((p) => String(p['signedAmount'])),
    ).toEqual(['300']);
    expect(
      posts.filter((p) => ownerKind(p) === 'CAPITAL').map((p) => String(p['signedAmount'])),
    ).toEqual(['700']);
    // Seller cash is posted BEFORE the credit, so the credit's tax and fee
    // find it (the order the fix depends on). o-1's COD all went to the
    // debt, so the one seller post is o-2's — ahead of o-2's credit.
    const o2Credit = sut.creditForOrder.mock.invocationCallOrder[1] ?? 0;
    const o2Post = sut.bankPost.mock.invocationCallOrder[0] ?? Infinity;
    expect(o2Post).toBeLessThan(o2Credit);
  });

  it('refuses an order a different courier account carried', async () => {
    const sut = makeSut({
      orders,
      shipments: [
        {
          courierAccountId: 'acct-shiprocket',
          courierCode: 'shiprocket',
          orderShipments: [{ orderId: 'o-1' }],
        },
      ],
    });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ORDER_OTHER_COURIER' } });
  });

  it('accepts an order this account carried, even after a failover off another', async () => {
    const sut = makeSut({
      orders,
      shipments: [
        {
          courierAccountId: 'acct-other',
          courierCode: 'delhivery',
          orderShipments: [{ orderId: 'o-1' }],
        },
        {
          courierAccountId: ACCOUNT,
          courierCode: 'delhivery',
          orderShipments: [{ orderId: 'o-1' }],
        },
      ],
    });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [
          { orderId: 'o-1', settledInr: '600.00' },
          { orderId: 'o-2', settledInr: '400.00' },
        ],
      }),
    ).resolves.toBeDefined();
  });

  it('measures the shortfall alert against the WHOLE payout, not the short lines', async () => {
    // ₹50 short on ₹1,000 is 5%. Over the short line alone it read 8.3%,
    // and a 6% threshold called it a CRITICAL breach.
    const sut = makeSut({ orders, shortfallThreshold: '6.00' });
    await sut.svc.record(STAFF, {
      ...BASE,
      amountInr: '950.00',
      lines: [
        { orderId: 'o-1', settledInr: '550.00' },
        { orderId: 'o-2', settledInr: '400.00' },
      ],
    });
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.courier_settlement.shortfall',
        severity: 'MEDIUM',
        metadata: expect.objectContaining({ shortfallPercent: '5.00' }),
      }),
    );
  });

  it('refuses to record a payout with no bank account behind it', async () => {
    // Refused, not skipped. A settlement whose cash was never recorded
    // reads on the coverage page as money we hold and do not.
    const sut = makeSut({ orders, receivingAccount: null });
    await expect(
      sut.svc.record(STAFF, {
        ...BASE,
        lines: [{ orderId: 'o-1', settledInr: '600.00' }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'SETTLEMENT_NO_RECEIVING_ACCOUNT' },
    });
    expect(sut.bankPost).not.toHaveBeenCalled();
  });
});

/**
 * A statement covers ten orders and only eight are recognised at the
 * time. `record` handles that safely — the bank takes the full credit,
 * the eight sellers are paid, and the remainder sits against capital —
 * but until this existed nothing could finish the job, and the two
 * missing orders read as unpaid while their money sat under capital.
 *
 * The thing that must be impossible is inventing cash. `amountInr` is
 * what the bank statement says, so this never touches it: the cash side
 * is a zero-sum pair, and the allocation ceiling is what actually
 * landed.
 */
describe('CourierSettlementService.allocateMore', () => {
  const SETTLEMENT = '01a05612-747e-727c-b350-b38dfd9703aa';

  function makeAllocSut(
    opts: {
      amount?: string;
      allocated?: string;
      /** Early-COD fee the courier kept back from this payout. */
      fee?: string;
      existingOrders?: string[];
      orders?: Array<{ id: string; sellerId: string; codAmountInr: Prisma.Decimal | null }>;
      /** What the payout reads as allocated INSIDE the transaction — another operator's allocation landed meanwhile. */
      allocatedInTx?: string;
    } = {},
  ) {
    let reads = 0;
    const executeRaw = jest.fn(async (..._args: unknown[]) => 1);
    const bankPost = jest.fn<Promise<{ id: string }>, [AnyArgs, unknown?]>(async () => ({
      id: 'be-1',
    }));
    const createMany = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ count: 1 }));
    const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
    const client = {
      courierSettlement: {
        findUnique: jest.fn(async () => ({
          id: SETTLEMENT,
          reference: 'DLV-PAYOUT-0001',
          amountInr: D(opts.amount ?? '1000.00'),
          // The first read is outside the transaction; later ones inside it.
          allocatedInr: D(
            (reads += 1) > 1 && opts.allocatedInTx !== undefined
              ? opts.allocatedInTx
              : (opts.allocated ?? '600.00'),
          ),
          earlyCodFeeInr: D(opts.fee ?? '0'),
          freightDeductedInr: D('0'),
          rtoReversalInr: D('0'),
          receivedAt: new Date('2026-07-20T10:00:00.000Z'),
          courierAccount: {
            id: ACCOUNT,
            courier: { code: 'delhivery' },
            payoutBankAccount: {
              id: 'bank-inr-1',
              currency: 'INR',
              isActive: true,
              deletedAt: null,
            },
          },
          lines: (opts.existingOrders ?? ['o-1']).map((orderId) => ({ orderId })),
        })),
        update,
        findFirst: jest.fn(async () => null),
      },
      courierSettlementLine: { createMany, groupBy: jest.fn(async () => []) },
      order: {
        findMany: jest.fn(
          async () => opts.orders ?? [{ id: 'o-2', sellerId: 's-1', codAmountInr: D('400.00') }],
        ),
      },
      shipment: { findMany: jest.fn(async () => []) },
      $executeRaw: executeRaw,
      $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
    } as AnyArgs;
    const prisma = { client } as unknown as PrismaService;
    const svc = new CourierSettlementService(
      prisma,
      { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
      {
        resolveMode: jest.fn(async () => 'SETTLEMENT' as const),
        isCredited: jest.fn(async () => false),
        creditForOrder: jest.fn(async () => ({ credited: true })),
      } as unknown as CodCreditService,
      { recomputeCacheAfterCommit: jest.fn(async () => undefined) } as unknown as WalletService,
      { post: bankPost } as unknown as BankLedgerService,
      {
        debtSplit: jest.fn(async (_tx: unknown, _s: string, amount: Prisma.Decimal) => ({
          toCapital: D('0'),
          toSeller: amount,
        })),
      } as unknown as SellerCashAttributionService,
    );
    // getById reads back through the same client; stub it out — the
    // return shape is pinned by record()'s own tests.
    jest.spyOn(svc, 'getById').mockResolvedValue({} as never);
    return { svc, bankPost, createMany, update, executeRaw };
  }

  it('re-reads what is left INSIDE the transaction, under the payout’s lock', async () => {
    // Both operators read ₹400 left; the other's ₹300 landed first. Checked
    // against the stale figure, both passed and together allocated ₹700
    // of ₹400 — and each wrote stale + adding, so one vanished.
    const { svc, createMany, executeRaw } = makeAllocSut({
      amount: '1000.00',
      allocated: '600.00',
      allocatedInTx: '900.00',
    });
    await expect(
      svc.allocateMore('staff-1', SETTLEMENT, {
        lines: [{ orderId: 'o-2', settledInr: '400.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_OVER_ALLOCATED' } });
    expect(createMany).not.toHaveBeenCalled();
    expect(executeRaw.mock.calls.some((c) => c[1] === AdvisoryLock.SETTLEMENT)).toBe(true);
  });

  it('refuses to allocate more than actually landed', async () => {
    // The one thing this must not be able to do. Past the ceiling it
    // would hold sellers more money than the courier sent, which reads
    // on the coverage page as cash we have and do not.
    const { svc } = makeAllocSut({ amount: '1000.00', allocated: '600.00' });
    await expect(
      svc.allocateMore('staff-1', SETTLEMENT, {
        lines: [{ orderId: 'o-2', settledInr: '500.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_OVER_ALLOCATED' } });
  });

  it('counts what the courier kept back as covered — the ceiling is the COD, not the cash', async () => {
    // ₹910 landed with a ₹90 fee kept back: the payout covers ₹1,000 of
    // COD, so ₹400 more can be allocated on top of the ₹600.
    const { svc, createMany } = makeAllocSut({
      amount: '910.00',
      fee: '90.00',
      allocated: '600.00',
    });
    await svc.allocateMore('staff-1', SETTLEMENT, {
      lines: [{ orderId: 'o-2', settledInr: '400.00' }],
    });
    expect(createMany).toHaveBeenCalled();
  });

  it('allows exactly the remainder', async () => {
    const { svc, createMany } = makeAllocSut({ amount: '1000.00', allocated: '600.00' });
    await svc.allocateMore('staff-1', SETTLEMENT, {
      lines: [{ orderId: 'o-2', settledInr: '400.00' }],
    });
    expect(createMany).toHaveBeenCalled();
  });

  it('moves cash from capital to the seller and leaves the account total alone', async () => {
    const { svc, bankPost } = makeAllocSut({ amount: '1000.00', allocated: '600.00' });
    await svc.allocateMore('staff-1', SETTLEMENT, {
      lines: [{ orderId: 'o-2', settledInr: '400.00' }],
    });
    const entries = bankPost.mock.calls.map((c) => c[0]);
    const total = entries.reduce((sum, e) => sum.add(e['signedAmount'] as Prisma.Decimal), D('0'));
    // No new cash arrived, so the balance must be byte-identical after.
    // A single entry would move it and make the book disagree with the
    // statement.
    expect(total.toString()).toBe('0');
    expect(entries.some((e) => (e['owner'] as AnyArgs)['kind'] === 'SELLER')).toBe(true);
    expect(entries.some((e) => (e['owner'] as AnyArgs)['kind'] === 'CAPITAL')).toBe(true);
  });

  it('never rewrites the payout total', async () => {
    const { svc, update } = makeAllocSut({ amount: '1000.00', allocated: '600.00' });
    await svc.allocateMore('staff-1', SETTLEMENT, {
      lines: [{ orderId: 'o-2', settledInr: '400.00' }],
    });
    const data = (update.mock.calls[0]?.[0] as AnyArgs)['data'] as AnyArgs;
    // amountInr is what the bank statement says; only attribution moves.
    expect(data['amountInr']).toBeUndefined();
    expect(String(data['allocatedInr'])).toBe('1000');
  });

  it('refuses an order already allocated on this payout', async () => {
    const { svc } = makeAllocSut({ existingOrders: ['o-1', 'o-2'] });
    await expect(
      svc.allocateMore('staff-1', SETTLEMENT, {
        lines: [{ orderId: 'o-2', settledInr: '100.00' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SETTLEMENT_ORDER_ALREADY_ALLOCATED' } });
  });

  it('refuses an empty allocation rather than writing nothing quietly', async () => {
    const { svc } = makeAllocSut({});
    await expect(svc.allocateMore('staff-1', SETTLEMENT, { lines: [] })).rejects.toMatchObject({
      response: { code: 'SETTLEMENT_NO_LINES' },
    });
  });
});
