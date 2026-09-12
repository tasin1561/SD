import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { isUniqueViolation } from '../../../common/db/unique-violation';
import { BankLedgerService, idempotencyKeyReused } from './bank-ledger.service';

/** The material fields an expense's idempotency key vouches for. */
interface ExpenseShape {
  readonly accountId: string;
  readonly signedAmount: Prisma.Decimal;
  readonly currency: Currency;
  readonly occurredAt: Date;
  readonly expenseCategoryId: string;
  readonly reference: string | null;
}

export interface ManualEntryInput {
  readonly accountId: string;
  readonly type: BankEntryType;
  readonly signedAmount: string;
  readonly amountCurrency: Currency;
  readonly ownerKind: BankOwnerKind;
  readonly sellerId?: string;
  readonly expenseCategoryId?: string;
  readonly investmentId?: string;
  readonly occurredAt: string;
  readonly reference?: string;
  readonly note?: string;
  /** One per opening of the form (IDEM-1); a replay posts nothing. */
  readonly idempotencyKey?: string;
}

/**
 * Where a movement of this type is recorded instead, when it is not an
 * expense. F2-exhaustive: a new `BankEntryType` fails to compile until
 * somebody decides whether the raw form may post it — and the answer for
 * everything but an expense is "no, it has its own flow", because each of
 * those flows carries a guard this form does not.
 */
function purposeBuiltRoute(type: BankEntryType): string | null {
  switch (type) {
    case BankEntryType.EXPENSE:
      return null;
    case BankEntryType.OPENING_BALANCE:
    case BankEntryType.RECONCILIATION_ADJUSTMENT:
      return 'POST /admin/treasury/accounts/:accountId/reconcile — it holds the reconcile lock, demands a reason and is audited';
    case BankEntryType.OWNER_CONTRIBUTION:
    case BankEntryType.OWNER_DRAWING:
      return 'POST /admin/treasury/accounts/:accountId/owner-money';
    case BankEntryType.TRANSFER_IN:
    case BankEntryType.TRANSFER_OUT:
    case BankEntryType.FX_SPREAD:
      return 'POST /admin/treasury/transfers — the spread is derived from the two amounts, never typed';
    case BankEntryType.INVESTMENT_OUT:
    case BankEntryType.INVESTMENT_RETURN:
      return 'POST /admin/treasury/investments (and …/:investmentId/return)';
    case BankEntryType.SELLER_TOPUP:
      return 'accepting the seller’s top-up request, which credits their wallet in the same transaction';
    case BankEntryType.SELLER_WITHDRAWAL:
      return 'recording a remittance, which debits their wallet in the same transaction';
    case BankEntryType.COURIER_SETTLEMENT:
      return 'recording the courier’s payout on /settlements';
    case BankEntryType.COURIER_WALLET_RECHARGE:
      return 'POST /admin/courier-wallet/payments';
    case BankEntryType.RECLASSIFICATION:
      return 'POST /admin/treasury/accounts/:accountId/reclassify-seller-cash';
    default: {
      const never: never = type;
      return String(never);
    }
  }
}

/**
 * The raw "record one movement" form, narrowed to the ONE thing it is for:
 * money of OURS leaving an account for something we bought.
 *
 * It used to post anything the `BankEntryType` enum allowed, which made
 * it a way round every guard the purpose-built flows carry: an
 * `FX_SPREAD` typed in read as FX revenue with no transfer behind it; a
 * `SELLER_TOPUP` put cash "held for a seller" in the book with no wallet
 * credit, so client money read as covered when it was not; a
 * `RECONCILIATION_ADJUSTMENT` skipped the reconcile lock, its reason and
 * its audit; a positive `EXPENSE` was income filed as spending; an
 * `INVESTMENT_RETURN` bypassed the investment it claimed to return. The
 * admin screen only ever sent a capital, negative, categorised expense —
 * so that is now all the server accepts, and everything else is refused
 * with the flow it belongs to.
 */
@Injectable()
export class ManualExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
  ) {}

  async record(staffId: string, input: ManualEntryInput): Promise<{ id: string }> {
    const elsewhere = purposeBuiltRoute(input.type);
    if (elsewhere !== null) {
      throw new BadRequestException({
        code: 'TREASURY_ENTRY_NOT_ALLOWED',
        message:
          `This form records expenses only. A ${input.type} movement is recorded through ` +
          `${elsewhere}.`,
      });
    }
    if (input.ownerKind !== BankOwnerKind.CAPITAL || input.sellerId !== undefined) {
      throw new BadRequestException({
        code: 'TREASURY_EXPENSE_NOT_CAPITAL',
        message:
          'An expense is always ours. Paying for something out of a seller’s money would be ' +
          'spending their balance — their wallet is charged through its own flows.',
      });
    }
    if (input.investmentId !== undefined) {
      throw new BadRequestException({
        code: 'TREASURY_ENTRY_NOT_ALLOWED',
        message: 'An expense is not tied to an investment — record returns on the investment.',
      });
    }
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(input.signedAmount);
    } catch {
      throw new BadRequestException({
        code: 'TREASURY_EXPENSE_AMOUNT_INVALID',
        message: `'${input.signedAmount}' is not an amount`,
      });
    }
    if (!amount.isNegative()) {
      throw new BadRequestException({
        code: 'TREASURY_EXPENSE_NOT_NEGATIVE',
        message:
          'An expense is money leaving the account, so its amount is negative. Money coming ' +
          'in is recorded by the flow that brought it.',
      });
    }
    if (input.expenseCategoryId === undefined) {
      throw new BadRequestException({
        code: 'TREASURY_EXPENSE_CATEGORY_REQUIRED',
        message:
          'Say what the money was spent on — an uncategorised expense cannot be told apart later.',
      });
    }
    // IDEM-1: a double-click, or a retry after a timeout, must not pay
    // the same bill twice. Checked before the category, so a replay of a
    // request that already landed still answers after the category is
    // retired.
    const expected: ExpenseShape = {
      accountId: input.accountId,
      signedAmount: amount,
      currency: input.amountCurrency,
      occurredAt: new Date(input.occurredAt),
      expenseCategoryId: input.expenseCategoryId,
      reference: input.reference ?? null,
    };
    const replay = await this.replay(input.idempotencyKey, expected);
    if (replay !== null) return replay;

    const category = await this.prisma.client.expenseCategory.findFirst({
      where: { id: input.expenseCategoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (category === null) {
      throw new NotFoundException({
        code: 'EXPENSE_CATEGORY_NOT_FOUND',
        message: 'No such active expense category',
      });
    }

    try {
      return await this.ledger.post({
        accountId: input.accountId,
        type: BankEntryType.EXPENSE,
        signedAmount: amount,
        amountCurrency: input.amountCurrency,
        owner: { kind: BankOwnerKind.CAPITAL },
        actorType: ActorType.STAFF,
        staffId,
        occurredAt: expected.occurredAt,
        expenseCategoryId: category.id,
        idempotencyKey: input.idempotencyKey ?? null,
        ...(input.reference === undefined ? {} : { reference: input.reference }),
        ...(input.note === undefined ? {} : { note: input.note }),
      });
    } catch (err) {
      // The same request racing itself: the loser answers with the winner.
      if (input.idempotencyKey !== undefined && isUniqueViolation(err)) {
        const again = await this.replay(input.idempotencyKey, expected);
        if (again !== null) return again;
      }
      throw err;
    }
  }

  /**
   * The entry a key already posted, or null for a new key. A key whose
   * entry is not THIS expense — account, amount, currency, date, category
   * or reference — is refused (IDEM-1) rather than answered with it.
   */
  private async replay(
    idempotencyKey: string | undefined,
    expected: ExpenseShape,
  ): Promise<{ id: string } | null> {
    if (idempotencyKey === undefined) return null;
    const prior = await this.prisma.client.bankEntry.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        type: true,
        accountId: true,
        signedAmount: true,
        currency: true,
        occurredAt: true,
        expenseCategoryId: true,
        reference: true,
      },
    });
    if (prior === null) return null;
    if (
      prior.type !== BankEntryType.EXPENSE ||
      prior.accountId !== expected.accountId ||
      !prior.signedAmount.equals(expected.signedAmount) ||
      prior.currency !== expected.currency ||
      prior.occurredAt.getTime() !== expected.occurredAt.getTime() ||
      prior.expenseCategoryId !== expected.expenseCategoryId ||
      (prior.reference ?? '').trim() !== (expected.reference ?? '').trim()
    ) {
      throw idempotencyKeyReused('expense');
    }
    return { id: prior.id };
  }
}
