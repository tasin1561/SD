import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BankLedgerService } from './bank-ledger.service';

export interface InvestmentView {
  readonly id: string;
  readonly label: string;
  readonly counterparty: string;
  readonly currency: Currency;
  readonly placedInr: string;
  readonly returnedInr: string;
  /** returned − placed. Negative while the money is still out. */
  readonly netInr: string;
  readonly closedAt: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

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
    },
  ): Promise<InvestmentView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVESTMENT_AMOUNT_INVALID',
        message: 'Place something more than nothing',
      });
    }
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

    return this.prisma.client.$transaction(async (tx) => {
      const inv = await tx.investment.create({
        data: {
          label: input.label.trim(),
          counterparty: input.counterparty.trim(),
          currency: account.currency,
          placedInr: amount,
          note: input.note?.trim() ?? null,
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
  }

  async recordReturn(
    staffId: string,
    investmentId: string,
    input: { toAccountId: string; amount: string; receivedAt: string; close?: boolean },
  ): Promise<InvestmentView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVESTMENT_RETURN_INVALID',
        message: 'A return of nothing is not a return',
      });
    }
    const inv = await this.prisma.client.investment.findUnique({ where: { id: investmentId } });
    if (!inv) {
      throw new NotFoundException({
        code: 'INVESTMENT_NOT_FOUND',
        message: 'No such investment',
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

    return this.prisma.client.$transaction(async (tx) => {
      // A partial return is normal — interest arrives before principal,
      // a loan repays in instalments. `returnedInr` accumulates and the
      // investment closes only when somebody says it has.
      const updated = await tx.investment.update({
        where: { id: investmentId },
        data: {
          returnedInr: { increment: amount },
          ...(input.close === true ? { closedAt: new Date(input.receivedAt) } : {}),
        },
      });
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
          note: `Returned by ${updated.counterparty}`,
        },
        tx,
      );
      return this.toView(updated);
    });
  }

  private toView(r: {
    id: string;
    label: string;
    counterparty: string;
    currency: Currency;
    placedInr: Prisma.Decimal;
    returnedInr: Prisma.Decimal;
    closedAt: Date | null;
    note: string | null;
    createdAt: Date;
  }): InvestmentView {
    return {
      id: r.id,
      label: r.label,
      counterparty: r.counterparty,
      currency: r.currency,
      placedInr: r.placedInr.toFixed(2),
      returnedInr: r.returnedInr.toFixed(2),
      netInr: r.returnedInr.sub(r.placedInr).toFixed(2),
      closedAt: r.closedAt?.toISOString() ?? null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
