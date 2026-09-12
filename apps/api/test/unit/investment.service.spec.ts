import { Prisma } from '@skydrop/db';
import { InvestmentService } from '../../src/modules/treasury/services/investment.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const KEY = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

function inv(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'inv-1',
    label: '6-month FD',
    counterparty: 'HDFC Bank',
    currency: 'INR',
    placedInr: D('200000.00'),
    returnedInr: D('0.00'),
    closedAt: null,
    note: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

function makeSut(
  opts: {
    investment?: AnyArgs | null;
    accountCurrency?: 'INR' | 'BDT';
    claimCount?: number;
    /** What an idempotency key already created, per lookup (in order). */
    priorEntry?: Array<AnyArgs | null>;
    priorInvestment?: Array<AnyArgs | null>;
    postThrows?: unknown;
    /** The INVESTMENT_OUT entry — where and when the money was placed. */
    placedEntry?: AnyArgs | null;
    /** The investment as it stands after a return (what a replay reads). */
    afterReturn?: AnyArgs;
  } = {},
) {
  const priorEntry = [...(opts.priorEntry ?? [])];
  const priorInvestment = [...(opts.priorInvestment ?? [])];
  const updateMany = jest.fn(async (_a: AnyArgs) => ({ count: opts.claimCount ?? 1 }));
  const create = jest.fn(async (a: AnyArgs) => ({ ...inv(), ...(a['data'] as AnyArgs) }));
  const client: AnyArgs = {
    investment: {
      findUnique: jest.fn(async (a: AnyArgs) =>
        (a['where'] as AnyArgs)['idempotencyKey'] !== undefined
          ? (priorInvestment.shift() ?? null)
          : opts.investment === undefined
            ? inv()
            : opts.investment,
      ),
      findUniqueOrThrow: jest.fn(
        async () => opts.afterReturn ?? inv({ returnedInr: D('8000.00') }),
      ),
      create,
      updateMany,
    },
    platformBankAccount: {
      findFirst: jest.fn(async () => ({ id: 'ba-1', currency: opts.accountCurrency ?? 'INR' })),
    },
    bankEntry: {
      findUnique: jest.fn(async () => priorEntry.shift() ?? null),
      findFirst: jest.fn(async () =>
        opts.placedEntry === undefined
          ? { accountId: 'ba-1', occurredAt: new Date('2026-09-01T00:00:00Z') }
          : opts.placedEntry,
      ),
    },
  };
  // The account's reconcile key is an advisory lock (lockAccountsForPosting).
  client['$executeRaw'] = jest.fn(async () => 1);
  client['$transaction'] = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  const post = jest.fn(async (_i: AnyArgs, _tx?: unknown) => {
    if (opts.postThrows !== undefined) throw opts.postThrows;
    return { id: 'be-1' };
  });
  const svc = new InvestmentService(
    { client } as unknown as PrismaService,
    { post } as unknown as BankLedgerService,
  );
  return { svc, post, updateMany, create };
}

const RETURN = { toAccountId: 'ba-1', amount: '8000', receivedAt: '2026-09-10T00:00:00Z' };

/** What a key's first return posted — the entry a replay is compared to. */
function priorReturn(over: AnyArgs = {}): AnyArgs {
  return {
    investmentId: 'inv-1',
    type: 'INVESTMENT_RETURN',
    accountId: 'ba-1',
    signedAmount: D('8000.00'),
    occurredAt: new Date(RETURN.receivedAt),
    ...over,
  };
}

describe('InvestmentService.recordReturn', () => {
  // The close-date guard reads the clock; pin it so these do not depend
  // on the machine's date.
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T12:00:00Z').getTime());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses a return into an account of ANOTHER currency', async () => {
    // returnedInr accumulates in the investment's currency; taka added to
    // rupees in one column is wrong by the exchange rate.
    const { svc, post } = makeSut({ accountCurrency: 'BDT' });
    await expect(svc.recordReturn('st-1', 'inv-1', RETURN)).rejects.toMatchObject({
      response: { code: 'INVESTMENT_CURRENCY_MISMATCH' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a return on a CLOSED investment', async () => {
    const { svc, post } = makeSut({
      investment: inv({ closedAt: new Date('2026-09-05T00:00:00Z') }),
    });
    await expect(svc.recordReturn('st-1', 'inv-1', RETURN)).rejects.toMatchObject({
      response: { code: 'INVESTMENT_CLOSED' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('guards the write on closedAt still being null, so the close date never moves', async () => {
    const { svc, updateMany } = makeSut();
    await svc.recordReturn('st-1', 'inv-1', { ...RETURN, close: true });
    expect(updateMany.mock.calls[0]![0]['where']).toEqual({ id: 'inv-1', closedAt: null });
  });

  it('loses the race to a concurrent close without posting', async () => {
    const { svc, post } = makeSut({ claimCount: 0 });
    await expect(svc.recordReturn('st-1', 'inv-1', RETURN)).rejects.toMatchObject({
      response: { code: 'INVESTMENT_CLOSED' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the return with its idempotency key', async () => {
    const { svc, post } = makeSut();
    await svc.recordReturn('st-1', 'inv-1', { ...RETURN, idempotencyKey: KEY });
    expect(post.mock.calls[0]![0]).toMatchObject({
      type: 'INVESTMENT_RETURN',
      investmentId: 'inv-1',
      idempotencyKey: KEY,
    });
  });

  it('a replay with the same key records nothing and returns the investment', async () => {
    const { svc, post, updateMany } = makeSut({ priorEntry: [priorReturn()] });
    const view = await svc.recordReturn('st-1', 'inv-1', { ...RETURN, idempotencyKey: KEY });
    expect(post).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(view.returned).toBe('8000.00');
  });

  it('refuses a key that was used for something else', async () => {
    const { svc } = makeSut({ priorEntry: [priorReturn({ investmentId: 'inv-2' })] });
    await expect(
      svc.recordReturn('st-1', 'inv-1', { ...RETURN, idempotencyKey: KEY }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it.each([
    ['amount', { signedAmount: D('9000.00') }],
    ['account', { accountId: 'ba-2' }],
    ['date', { occurredAt: new Date('2026-09-11T00:00:00Z') }],
  ])('the same key on a return with a different %s is 409', async (_what, over) => {
    const { svc, post } = makeSut({ priorEntry: [priorReturn(over)] });
    await expect(
      svc.recordReturn('st-1', 'inv-1', { ...RETURN, idempotencyKey: KEY }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(post).not.toHaveBeenCalled();
  });

  it('a closing replay of a return that did NOT close the investment is 409', async () => {
    const { svc } = makeSut({ priorEntry: [priorReturn()] });
    await expect(
      svc.recordReturn('st-1', 'inv-1', { ...RETURN, close: true, idempotencyKey: KEY }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('two identical CLOSING returns at once: the loser replays the winner, not INVESTMENT_CLOSED', async () => {
    // Both pass the pre-checks; the twin closes it first, so this copy's
    // claim on `closedAt: null` finds nothing. It is the same request, so
    // it answers with what the twin recorded.
    const closedAt = new Date(RETURN.receivedAt);
    const { svc, post } = makeSut({
      claimCount: 0,
      priorEntry: [null, priorReturn()],
      afterReturn: inv({ returnedInr: D('8000.00'), closedAt }),
    });
    const view = await svc.recordReturn('st-1', 'inv-1', {
      ...RETURN,
      close: true,
      idempotencyKey: KEY,
    });
    expect(view.closedAt).toBe(closedAt.toISOString());
    expect(post).not.toHaveBeenCalled();
  });

  it('without a key, losing the close race is still INVESTMENT_CLOSED', async () => {
    const { svc } = makeSut({ claimCount: 0 });
    await expect(
      svc.recordReturn('st-1', 'inv-1', { ...RETURN, close: true }),
    ).rejects.toMatchObject({ response: { code: 'INVESTMENT_CLOSED' } });
  });

  it('refuses a close dated in the future', async () => {
    const { svc, updateMany } = makeSut();
    await expect(
      svc.recordReturn('st-1', 'inv-1', {
        ...RETURN,
        receivedAt: '2026-09-20T00:00:00Z',
        close: true,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVESTMENT_CLOSE_IN_FUTURE' } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses a close dated before the money was placed', async () => {
    const { svc, updateMany } = makeSut({
      placedEntry: { accountId: 'ba-1', occurredAt: new Date('2026-09-11T00:00:00Z') },
    });
    await expect(
      svc.recordReturn('st-1', 'inv-1', { ...RETURN, close: true }),
    ).rejects.toMatchObject({ response: { code: 'INVESTMENT_CLOSE_BEFORE_PLACEMENT' } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a partial return is not held to the close-date rules', async () => {
    const { svc, post } = makeSut({
      placedEntry: { accountId: 'ba-1', occurredAt: new Date('2026-09-11T00:00:00Z') },
    });
    await svc.recordReturn('st-1', 'inv-1', RETURN);
    expect(post).toHaveBeenCalled();
  });
});

describe('InvestmentService.place', () => {
  const PLACE = {
    label: '6-month FD',
    counterparty: 'HDFC Bank',
    fromAccountId: 'ba-1',
    amount: '200000',
    placedAt: '2026-09-01T00:00:00Z',
  };

  it('stores the key on the investment it creates', async () => {
    const { svc, create } = makeSut();
    await svc.place('st-1', { ...PLACE, idempotencyKey: KEY });
    expect((create.mock.calls[0]![0]['data'] as AnyArgs)['idempotencyKey']).toBe(KEY);
  });

  it('a replay places nothing and returns the original investment', async () => {
    const { svc, post, create } = makeSut({ priorInvestment: [inv()] });
    const view = await svc.place('st-1', { ...PLACE, idempotencyKey: KEY });
    expect(create).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(view.id).toBe('inv-1');
  });

  it('two copies racing: the loser answers with the winner', async () => {
    const { svc } = makeSut({
      priorInvestment: [null, inv()],
      postThrows: new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    const view = await svc.place('st-1', { ...PLACE, idempotencyKey: KEY });
    expect(view.id).toBe('inv-1');
  });

  it.each([
    ['amount', { amount: '250000' }],
    ['account', { fromAccountId: 'ba-2' }],
    ['date', { placedAt: '2026-09-02T00:00:00Z' }],
    ['counterparty', { counterparty: 'ICICI Bank' }],
  ])('the same key on a placement with a different %s is 409', async (_what, over) => {
    const { svc, create, post } = makeSut({ priorInvestment: [inv()] });
    await expect(
      svc.place('st-1', { ...PLACE, ...over, idempotencyKey: KEY }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(create).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
