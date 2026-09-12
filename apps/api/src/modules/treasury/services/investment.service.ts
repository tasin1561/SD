import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { isUniqueViolation } from '../../../common/db/unique-violation';
import { BankLedgerService } from './bank-ledger.service';

export interface InvestmentView {
  readonly id: string;
  readonly label: string;
  readonly counterparty: string;
  /**
   * The account's currency, and therefore the currency of every amount
   * below. The columns are named `*Inr` in the schema for historical
   * reasons and a BDT deposit stores BDT in them, so the view names them
   * plainly — a figure labelled INR that is not INR is worse than an
   * unlabelled one, because nobody thinks to check it.
   */
  readonly currency: Currency;
  readonly placed: string;
  readonly returned: string;
  /** returned − placed. Negative while the money is still out. */
  readonly net: string;
  readonly closedAt: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

type InvestmentRow = {
  id: string;
  label: string;
  counterparty: string;
  currency: Currency;
  placedInr: Prisma.Decimal;
  returnedInr: Prisma.Decimal;
  closedAt: Date | null;
  note: string | null;
  createdAt: Date;
};

/**
 * Money parked somewhere it can earn — a deposit, a loan out, a stake.
 *
 * The point of modelling this at all is that it leaves the bank without
 * being spent. Without it, placing a fixed deposit reads on the treasury
 * page as the money vanishing, and the coverage check would say we no
 * longer hold what sellers are owed.
 *
 * ONLY capital may be invested. Client money is not ours to place, and
 * refusing here rather than trusting the operator to notice is the
 * difference between a rule and a hope.
 *
 * ── ONE CURRENCY, AND CLOSED MEANS CLOSED ────────────────────────────
 * An investment is denominated in the currency of the account it left.
 * `returnedInr` accumulates in THAT currency, so a return landing in an
 * account of another currency would add taka to rupees in one column and
 * the P&L's "returned − placed" would be wrong by the exchange rate. It
 * is refused; money that comes back into a different account is a
 * return into the original currency followed by a transfer.
 *
 * A closed investment takes no further returns, and `closedAt` is set
 * ONCE: the P&L recognises investment income in the window the
 * investment closed in, so moving the date re-opens a month somebody
 * may already have reported on.
 *
 * ── IDEMPOTENT ON THE CLIENT'S KEY ───────────────────────────────────
 * A placement is keyed on `investments.idempotency_key`, a return on the
 * `bank_entries.idempotency_key` of the entry it posts. A replay returns
 * the investment as it now stands and moves nothing.
 */
@Injectable()
export class InvestmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
  ) {}

  async list(includeClosed: boolean): Promise<InvestmentView[]> {
    const rows = await this.prisma.client.investment.findMany({
      where: includeClosed ? {} : { closedAt: null },
      orderBy: [{ closedAt: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async place(
    staffId: string,
    input: {
      label: string;
      counterparty: string;
      fromAccountId: string;
      amount: string;
      placedAt: string;
      note?: string;
      idempotencyKey?: string;
    },
  ): Promise<InvestmentView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVESTMENT_AMOUNT_INVALID',
        message: 'Place something more than nothing',
      });
    }

    const replay = await this.replayPlacement(input.idempotencyKey);
    if (replay !== null) return replay;

    const account = await this.prisma.client.platformBankAccount.findFirst({
      where: { id: input.fromAccountId, deletedAt: null },
      select: { id: true, currency: true },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const inv = await tx.investment.create({
          data: {
            label: input.label.trim(),
            counterparty: input.counterparty.trim(),
            currency: account.currency,
            placedInr: amount,
            note: input.note?.trim() ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
        // Owner CAPITAL, always. The ledger refuses a seller here anyway,
        // but stating it at the call site is what makes the intent
        // reviewable rather than inferred.
        await this.ledger.post(
          {
            accountId: account.id,
            type: BankEntryType.INVESTMENT_OUT,
            signedAmount: amount.neg(),
            amountCurrency: account.currency,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: new Date(input.placedAt),
            investmentId: inv.id,
            staffId,
            note: `Placed with ${inv.counterparty}`,
          },
          tx,
        );
        return this.toView(inv);
      });
    } catch (err) {
      // The same request racing itself: the loser answers with the
      // winner's investment rather than an error.
      if (input.idempotencyKey !== undefined && isUniqueViolation(err)) {
        const again = await this.replayPlacement(input.idempotencyKey);
        if (again !== null) return again;
      }
      throw err;
    }
  }

  async recordReturn(
    staffId: string,
    investmentId: string,
    input: {
      toAccountId: string;
      amount: string;
      receivedAt: string;
      close?: boolean;
      idempotencyKey?: string;
    },
  ): Promise<InvestmentView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVESTMENT_RETURN_INVALID',
        message: 'A return of nothing is not a return',
      });
    }

    const replay = await this.replayReturn(input.idempotencyKey, investmentId);
    if (replay !== null) return replay;

    const inv = await this.prisma.client.investment.findUnique({ where: { id: investmentId } });
    if (!inv) {
      throw new NotFoundException({
        code: 'INVESTMENT_NOT_FOUND',
        message: 'No such investment',
      });
    }
    if (inv.closedAt !== null) {
      throw new ConflictException({
        code: 'INVESTMENT_CLOSED',
        message: `This investment was closed on ${inv.closedAt.toISOString().slice(0, 10)}. A closed investment takes no further returns.`,
      });
    }
    const account = await this.prisma.client.platformBankAccount.findFirst({
      where: { id: input.toAccountId, deletedAt: null },
      select: { id: true, currency: true },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }
    if (account.currency !== inv.currency) {
      throw new BadRequestException({
        code: 'INVESTMENT_CURRENCY_MISMATCH',
        message:
          `This investment is in ${inv.currency}; that account is held in ${account.currency}. ` +
          `Record the return into a ${inv.currency} account, then move it with a transfer — ` +
          'otherwise the two currencies are added together in one figure.',
      });
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // A partial return is normal — interest arrives before principal,
        // a loan repays in instalments. `returnedInr` accumulates and the
        // investment closes only when somebody says it has.
        //
        // Guarded on `closedAt` still being null, INSIDE the write: two
        // closing returns recorded at once must not both land, and the
        // second must never move the close date the first set.
        const claimed = await tx.investment.updateMany({
          where: { id: investmentId, closedAt: null },
          data: {
            returnedInr: { increment: amount },
            ...(input.close === true ? { closedAt: new Date(input.receivedAt) } : {}),
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException({
            code: 'INVESTMENT_CLOSED',
            message: 'This investment was closed by somebody else while you were on this page.',
          });
        }
        const updated = await tx.investment.findUniqueOrThrow({ where: { id: investmentId } });
        await this.ledger.post(
          {
            accountId: account.id,
            type: BankEntryType.INVESTMENT_RETURN,
            signedAmount: amount,
            amountCurrency: account.currency,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: new Date(input.receivedAt),
            investmentId: updated.id,
            staffId,
            idempotencyKey: input.idempotencyKey ?? null,
            note: `Returned by ${updated.counterparty}`,
          },
          tx,
        );
        return this.toView(updated);
      });
    } catch (err) {
      if (input.idempotencyKey !== undefined && isUniqueViolation(err)) {
        const again = await this.replayReturn(input.idempotencyKey, investmentId);
        if (again !== null) return again;
      }
      throw err;
    }
  }

  /** The investment a key already placed, or null for a new key. */
  private async replayPlacement(idempotencyKey?: string): Promise<InvestmentView | null> {
    if (idempotencyKey === undefined) return null;
    const prior = await this.prisma.client.investment.findUnique({ where: { idempotencyKey } });
    return prior === null ? null : this.toView(prior);
  }

  /**
   * The investment as it stands, when this key already recorded a return
   * against it. A key that created something else is a client bug, and
   * answering it with this investment would say the second request worked.
   */
  private async replayReturn(
    idempotencyKey: string | undefined,
    investmentId: string,
  ): Promise<InvestmentView | null> {
    if (idempotencyKey === undefined) return null;
    const prior = await this.prisma.client.bankEntry.findUnique({
      where: { idempotencyKey },
      select: { investmentId: true, type: true },
    });
    if (prior === null) return null;
    if (prior.investmentId !== investmentId || prior.type !== BankEntryType.INVESTMENT_RETURN) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This request key was already used for a different entry.',
      });
    }
    const inv = await this.prisma.client.investment.findUniqueOrThrow({
      where: { id: investmentId },
    });
    return this.toView(inv);
  }

  private toView(r: InvestmentRow): InvestmentView {
    return {
      id: r.id,
      label: r.label,
      counterparty: r.counterparty,
      currency: r.currency,
      placed: r.placedInr.toFixed(2),
      returned: r.returnedInr.toFixed(2),
      net: r.returnedInr.sub(r.placedInr).toFixed(2),
      closedAt: r.closedAt?.toISOString() ?? null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
