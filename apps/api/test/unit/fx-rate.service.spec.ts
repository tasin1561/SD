import { Currency, FxRateSource, Prisma } from '@skydrop/db';
import { FxRateService } from '../../src/modules/fx/services/fx-rate.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

function makeRow(overrides: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: 'fx-1',
    fromCurrency: Currency.INR,
    toCurrency: Currency.BDT,
    rate: new Prisma.Decimal('1.32'),
    source: FxRateSource.FALLBACK,
    sourceUrl: null,
    fetchedAt: new Date('2026-05-29T10:00:00Z'),
    isManualOverride: false,
    overrideByStaffId: null,
    overrideReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSut(opts: { rows?: AnyArgs[]; existing?: AnyArgs | null } = {}) {
  const findMany = jest.fn(async () => opts.rows ?? []);
  const findUnique = jest.fn(async (a: AnyArgs) => {
    const where = a.where as {
      fromCurrency_toCurrency: { fromCurrency: Currency; toCurrency: Currency };
    };
    if (opts.existing === undefined) {
      return makeRow({
        fromCurrency: where.fromCurrency_toCurrency.fromCurrency,
        toCurrency: where.fromCurrency_toCurrency.toCurrency,
      });
    }
    return opts.existing;
  });
  const upsert = jest.fn(async (a: AnyArgs) => ({
    ...makeRow({}),
    ...((a.create ?? a.update) as AnyArgs),
  }));
  // Phase 1B — fxRateHistory.create is called inside the same tx as the
  // upsert + audit. Stub it as a no-op for the existing test cases.
  const historyCreate = jest.fn(async () => ({ id: 'hist-1' }));
  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      fxRate: { findUnique, upsert },
      fxRateHistory: { create: historyCreate },
    }),
  );
  const client = {
    fxRate: { findMany, findUnique, upsert },
    fxRateHistory: { create: historyCreate, findMany: jest.fn() },
    $transaction,
  } as unknown as PrismaService['client'];
  const prisma = { client } as unknown as PrismaService;
  const auditLog = jest.fn<Promise<string>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;
  return { svc: new FxRateService(prisma, audit), findMany, findUnique, upsert, auditLog };
}

describe('FxRateService', () => {
  it('getRate returns 1 for same-currency', async () => {
    const { svc } = makeSut();
    const rate = await svc.getRate(Currency.INR, Currency.INR);
    expect(rate.toString()).toBe('1');
  });

  it('getRate returns the configured rate', async () => {
    const { svc } = makeSut();
    const rate = await svc.getRate(Currency.INR, Currency.BDT);
    expect(rate.toString()).toBe('1.32');
  });

  it('getRate reciprocates from the inverse when direct rate is missing', async () => {
    const { svc, findUnique } = makeSut();
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow({ rate: new Prisma.Decimal('2') }));
    const rate = await svc.getRate(Currency.BDT, Currency.INR);
    expect(rate.toFixed(4)).toBe('0.5000');
  });

  it('getRate throws FX_RATE_NOT_FOUND when neither direction is configured', async () => {
    const { svc } = makeSut({ existing: null });
    await expect(svc.getRate(Currency.INR, Currency.BDT)).rejects.toMatchObject({
      response: { code: 'FX_RATE_NOT_FOUND' },
    });
  });

  it('convert multiplies the amount by the rate', async () => {
    const { svc } = makeSut();
    const out = await svc.convert({ amount: 100, from: Currency.INR, to: Currency.BDT });
    expect(out.amount).toBe('132.00');
    expect(out.rate).toBe('1.320000');
  });

  it('REFUSES the derived direction — one number decides both', async () => {
    // Refused rather than discouraged: let someone type the inverse by
    // hand and the pair drifts apart again, which is exactly how
    // INR->BDT 1.23 came to sit beside BDT->INR 0.813 and short every
    // taka top-up by a paisa.
    const { svc, upsert } = makeSut();
    await expect(
      svc.setManualRate({
        from: 'BDT' as never,
        to: 'INR' as never,
        rate: '0.813',
        staffId: 'st-1',
        reason: 'trying to set the way back by hand',
      }),
    ).rejects.toMatchObject({ response: { code: 'FX_DERIVED_DIRECTION' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes the OTHER direction as the exact reciprocal', async () => {
    // The two directions used to be independent rows with nothing
    // keeping them consistent: INR->BDT 1.23 beside BDT->INR 0.813,
    // when the true inverse is 0.813008. A round trip then lost a
    // paisa — ₹1,000 -> ৳1,230 -> ₹999.99 — and lost it in OUR favour
    // every time, so a seller topping up ৳1,230 was credited short.
    const { svc, upsert } = makeSut();
    await svc.setManualRate({
      from: 'INR' as never,
      to: 'BDT' as never,
      rate: '1.23',
      staffId: 'st-1',
      reason: 'market move this morning',
    });
    const inverse = upsert.mock.calls[1]![0]! as {
      where: { fromCurrency_toCurrency: { fromCurrency: string; toCurrency: string } };
      create: { rate: unknown };
    };
    expect(inverse.where.fromCurrency_toCurrency).toEqual({
      fromCurrency: 'BDT',
      toCurrency: 'INR',
    });
    expect(String(inverse.create.rate)).toBe('0.813008');
    // The round trip now lands back where it started at 2dp, which is
    // all the money columns keep.
    expect(Number((1230 * 0.813008).toFixed(2))).toBe(1000);
  });

  it('setManualRate upserts MANUAL source + audits MEDIUM with before/after', async () => {
    const { svc, upsert, auditLog } = makeSut();
    const out = await svc.setManualRate({
      from: Currency.INR,
      to: Currency.BDT,
      rate: 1.45,
      staffId: 'staff-1',
      reason: 'Quarterly review per finance team',
    });
    // BOTH directions, in one transaction — see the reciprocal test
    // below for why.
    expect(upsert).toHaveBeenCalledTimes(2);
    const arg = upsert.mock.calls[0]![0]!;
    expect((arg.create as AnyArgs).source).toBe(FxRateSource.MANUAL);
    expect((arg.create as AnyArgs).isManualOverride).toBe(true);
    expect(out.source).toBe(FxRateSource.MANUAL);
    const auditCall = auditLog.mock.calls[0]![0]!;
    expect(auditCall.action).toBe('staff.fx_rate.manual_override');
    expect(auditCall.severity).toBe('MEDIUM');
    const changes = auditCall.changes as AnyArgs;
    expect(changes.before).toBe('1.32');
    expect(changes.after).toBe('1.45');
  });

  it('list orders by from then to', async () => {
    const { svc } = makeSut({
      rows: [
        makeRow({ fromCurrency: Currency.BDT, toCurrency: Currency.INR }),
        makeRow({ fromCurrency: Currency.INR, toCurrency: Currency.BDT }),
      ],
    });
    const out = await svc.list();
    expect(out).toHaveLength(2);
  });
});
