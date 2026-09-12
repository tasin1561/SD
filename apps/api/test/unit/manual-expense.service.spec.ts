import { BankEntryType, BankOwnerKind, Currency } from '@skydrop/db';
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
function makeSut(category: { id: string } | null = { id: 'cat-1' }) {
  const post = jest.fn(async (_i: Record<string, unknown>) => ({ id: 'be-1' }));
  const svc = new ManualExpenseService(
    {
      client: { expenseCategory: { findFirst: jest.fn(async () => category) } },
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
