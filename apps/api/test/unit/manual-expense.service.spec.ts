import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import {
  ManualExpenseService,
  type ManualEntryInput,
} from '../../src/modules/treasury/services/manual-expense.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

/**
 * POST /admin/treasury/entries used to post any BankEntryType, which made
 * it a way round every guard the purpose-built flows carry. It is now the
 * one thing the admin screen sends: our money, leaving, with a category.
 */
function makeSut(
  category: { id: string } | null = { id: 'cat-1' },
  opts: { prior?: Array<Record<string, unknown> | null>; postThrows?: unknown } = {},
) {
  const queue = [...(opts.prior ?? [])];
  const post = jest.fn(async (_i: Record<string, unknown>) => {
    if (opts.postThrows !== undefined) throw opts.postThrows;
    return { id: 'be-1' };
  });
  const svc = new ManualExpenseService(
    {
      client: {
        expenseCategory: { findFirst: jest.fn(async () => category) },
        bankEntry: { findUnique: jest.fn(async () => queue.shift() ?? null) },
      },
    } as unknown as PrismaService,
    { post } as unknown as BankLedgerService,
  );
  return { svc, post };
}

const EXPENSE: ManualEntryInput = {
  accountId: 'ba-1',
  type: BankEntryType.EXPENSE,
  signedAmount: '-1500.00',
  amountCurrency: Currency.INR,
  ownerKind: BankOwnerKind.CAPITAL,
  expenseCategoryId: 'cat-1',
  occurredAt: '2026-09-10T00:00:00Z',
};

describe('ManualExpenseService.record', () => {
  it('posts a capital, negative, categorised expense', async () => {
    const { svc, post } = makeSut();
    await svc.record('st-1', EXPENSE);
    expect(post.mock.calls[0]![0]).toMatchObject({
      type: 'EXPENSE',
      owner: { kind: 'CAPITAL' },
      expenseCategoryId: 'cat-1',
    });
  });

  it.each([
    BankEntryType.FX_SPREAD,
    BankEntryType.SELLER_TOPUP,
    BankEntryType.RECONCILIATION_ADJUSTMENT,
    BankEntryType.OPENING_BALANCE,
    BankEntryType.INVESTMENT_RETURN,
    BankEntryType.COURIER_SETTLEMENT,
    BankEntryType.OWNER_CONTRIBUTION,
  ])('refuses %s, naming the flow it belongs to', async (type) => {
    const { svc, post } = makeSut();
    await expect(svc.record('st-1', { ...EXPENSE, type })).rejects.toMatchObject({
      response: { code: 'TREASURY_ENTRY_NOT_ALLOWED' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a POSITIVE expense — income filed as spending', async () => {
    const { svc } = makeSut();
    await expect(svc.record('st-1', { ...EXPENSE, signedAmount: '1500.00' })).rejects.toMatchObject(
      { response: { code: 'TREASURY_EXPENSE_NOT_NEGATIVE' } },
    );
  });

  it("refuses a seller's money", async () => {
    const { svc } = makeSut();
    await expect(
      svc.record('st-1', { ...EXPENSE, ownerKind: BankOwnerKind.SELLER, sellerId: 's-1' }),
    ).rejects.toMatchObject({ response: { code: 'TREASURY_EXPENSE_NOT_CAPITAL' } });
    await expect(svc.record('st-1', { ...EXPENSE, sellerId: 's-1' })).rejects.toMatchObject({
      response: { code: 'TREASURY_EXPENSE_NOT_CAPITAL' },
    });
  });

  it('requires a category, and an active one', async () => {
    const { svc } = makeSut();
    const { expenseCategoryId: _omit, ...uncategorised } = EXPENSE;
    await expect(svc.record('st-1', uncategorised)).rejects.toMatchObject({
      response: { code: 'TREASURY_EXPENSE_CATEGORY_REQUIRED' },
    });
    const gone = makeSut(null);
    await expect(gone.svc.record('st-1', EXPENSE)).rejects.toMatchObject({
      response: { code: 'EXPENSE_CATEGORY_NOT_FOUND' },
    });
  });

  it('refuses an investment link', async () => {
    const { svc } = makeSut();
    await expect(svc.record('st-1', { ...EXPENSE, investmentId: 'inv-1' })).rejects.toMatchObject({
      response: { code: 'TREASURY_ENTRY_NOT_ALLOWED' },
    });
  });
});

describe('ManualExpenseService.record — idempotent on the client key (IDEM-1)', () => {
  const KEY = '7c1b1f0e-3d9a-4a51-8a3e-2f0d6b9c1e42';
  const prior = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'be-first',
    type: 'EXPENSE',
    accountId: 'ba-1',
    signedAmount: new Prisma.Decimal('-1500.00'),
    currency: 'INR',
    occurredAt: new Date('2026-09-10T00:00:00Z'),
    expenseCategoryId: 'cat-1',
    reference: null,
    ...over,
  });

  it('posts the key with the entry', async () => {
    const { svc, post } = makeSut(undefined, { prior: [null] });
    await svc.record('st-1', { ...EXPENSE, idempotencyKey: KEY });
    expect(post.mock.calls[0]![0]).toMatchObject({ idempotencyKey: KEY });
  });

  it('a replay posts nothing and returns the original entry', async () => {
    const { svc, post } = makeSut(undefined, { prior: [prior()] });
    await expect(svc.record('st-1', { ...EXPENSE, idempotencyKey: KEY })).resolves.toEqual({
      id: 'be-first',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('two copies racing: the loser answers with the winner', async () => {
    const { svc } = makeSut(undefined, {
      prior: [null, prior()],
      postThrows: new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    await expect(svc.record('st-1', { ...EXPENSE, idempotencyKey: KEY })).resolves.toEqual({
      id: 'be-first',
    });
  });

  it.each([
    ['amount', { signedAmount: new Prisma.Decimal('-1600.00') }],
    ['account', { accountId: 'ba-2' }],
    ['currency', { currency: 'BDT' }],
    ['date', { occurredAt: new Date('2026-09-11T00:00:00Z') }],
    ['category', { expenseCategoryId: 'cat-2' }],
    ['reference', { reference: 'INV-9' }],
    ['entry type', { type: 'COURIER_WALLET_RECHARGE' }],
  ])('the same key on an expense with a different %s is 409', async (_what, over) => {
    const { svc, post } = makeSut(undefined, { prior: [prior(over)] });
    await expect(svc.record('st-1', { ...EXPENSE, idempotencyKey: KEY })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(post).not.toHaveBeenCalled();
  });
});
