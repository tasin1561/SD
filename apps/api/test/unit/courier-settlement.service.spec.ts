import { OrderStatus, Prisma } from '@skydrop/db';
import type { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

type AnyArgs = Record<string, unknown>;

const STAFF = 'staff-1';
const ACCOUNT = 'acct-1';
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const DAY = 86_400_000;

function makeSut(
  opts: {
    account?: AnyArgs | null;
    duplicate?: AnyArgs | null;
    orders?: Array<{ id: string; orderNumber: string; codAmountInr: Prisma.Decimal | null }>;
    delivered?: AnyArgs[];
    shortfallThreshold?: string;
    receivingAccount?: null;
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
      receivedAt: data['receivedAt'],
      note: data['note'] ?? null,
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      lines: lines.map((l) => ({ ...l, order: { orderNumber: 'SD-2026-07-000001' } })),
    };
  });
  const orderFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async (args) => {
    const where = (args['where'] ?? {}) as AnyArgs;
    // The reconciliation query filters on status; the record path filters on id.
    if (where['status'] === OrderStatus.DELIVERED) return opts.delivered ?? [];
    return opts.orders ?? [];
  });

  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    courierAccount: { findFirst: accountFindFirst },
    courierSettlement: {
      findUnique: settlementFindUnique,
      create: settlementCreate,
      findMany: jest.fn(async () => []),
    },
    order: { findMany: orderFindMany },
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
  const creditForOrder = jest.fn(async () => ({ credited: true }));
  const codCredit = {
    resolveMode: jest.fn(async () => 'SETTLEMENT' as const),
    creditForOrder,
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

  return {
    svc: new CourierSettlementService(prisma, audit, codCredit, wallet, bank),
    creditForOrder,
    bankPost,
    auditLog,
    created,
    settlementCreate,
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

    expect(seller).toHaveLength(1); // both orders belong to one seller
    expect(String(seller[0]?.['signedAmount'])).toBe('1000');
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
      existingOrders?: string[];
      orders?: Array<{ id: string; sellerId: string; codAmountInr: Prisma.Decimal | null }>;
    } = {},
  ) {
    const bankPost = jest.fn<Promise<{ id: string }>, [AnyArgs, unknown?]>(async () => ({
      id: 'be-1',
    }));
    const createMany = jest.fn(async () => ({ count: 1 }));
    const update = jest.fn(async () => ({}));
    const client = {
      courierSettlement: {
        findUnique: jest.fn(async () => ({
          id: SETTLEMENT,
          reference: 'DLV-PAYOUT-0001',
          amountInr: D(opts.amount ?? '1000.00'),
          allocatedInr: D(opts.allocated ?? '600.00'),
          receivedAt: new Date('2026-07-20T10:00:00.000Z'),
          courierAccount: {
            id: ACCOUNT,
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
      courierSettlementLine: { createMany },
      order: {
        findMany: jest.fn(
          async () => opts.orders ?? [{ id: 'o-2', sellerId: 's-1', codAmountInr: D('400.00') }],
        ),
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
    } as AnyArgs;
    const prisma = { client } as unknown as PrismaService;
    const svc = new CourierSettlementService(
      prisma,
      { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
      {
        resolveMode: jest.fn(async () => 'SETTLEMENT' as const),
        creditForOrder: jest.fn(async () => ({ credited: true })),
      } as unknown as CodCreditService,
      { recomputeCacheAfterCommit: jest.fn(async () => undefined) } as unknown as WalletService,
      { post: bankPost } as unknown as BankLedgerService,
    );
    // getById reads back through the same client; stub it out — the
    // return shape is pinned by record()'s own tests.
    jest.spyOn(svc, 'getById').mockResolvedValue({} as never);
    return { svc, bankPost, createMany, update };
  }

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
