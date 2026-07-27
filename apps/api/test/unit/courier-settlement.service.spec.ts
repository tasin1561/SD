import { OrderStatus, Prisma } from '@skydrop/db';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

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
  } = {},
) {
  const accountFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.account === undefined ? { id: ACCOUNT } : opts.account,
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
  const prisma = { client } as unknown as PrismaService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  return {
    svc: new CourierSettlementService(prisma, audit),
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
