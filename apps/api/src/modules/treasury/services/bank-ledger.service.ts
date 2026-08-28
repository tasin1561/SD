import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

const ZERO = new Prisma.Decimal(0);

export interface OwnerRef {
  readonly kind: BankOwnerKind;
  /** Required when kind is SELLER — the pair is what makes an account
   *  able to say how much of itself is spoken for, and by whom. */
  readonly sellerId?: string | null;
}

export interface PostEntryInput {
  readonly accountId: string;
  readonly type: BankEntryType;
  /** Negative for money leaving. Always the ACCOUNT's own currency. */
  readonly signedAmount: Prisma.Decimal | string;
  readonly owner: OwnerRef;
  readonly occurredAt: Date;
  readonly reference?: string | null;
  readonly note?: string | null;
  readonly transferId?: string | null;
  readonly expenseCategoryId?: string | null;
  readonly investmentId?: string | null;
  readonly settlementId?: string | null;
  readonly topupRequestId?: string | null;
  readonly withdrawalRequestId?: string | null;
  readonly staffId?: string | null;
}

export interface AccountBalance {
  readonly accountId: string;
  readonly currency: Currency;
  readonly total: string;
  readonly capital: string;
  readonly sellerHeld: string;
  readonly bySeller: ReadonlyArray<{
    readonly sellerId: string;
    readonly companyName: string;
    readonly amount: string;
  }>;
}

/**
 * The only writer of `bank_entries`, and the only place a balance is
 * computed.
 *
 * WHY BALANCES ARE SUMMED, NOT CACHED: the seller wallet cached its
 * balance and left the refresh to each caller — of fourteen money paths,
 * six remembered, and an admin page reported a seller owing ₹3,000 as
 * ₹0.00. Money read wrong is worse than money read slowly, so this sums
 * the entries every time. When a report is genuinely slow, cache it with
 * the newest entry id as the staleness gate — never on a promise that
 * every future writer will remember.
 *
 * WHY SIGNED AMOUNTS: a balance is then a SUM. A debit/credit pair plus
 * a direction column can disagree with itself; a sum cannot.
 *
 * APPEND-ONLY. There is no update or delete path by construction. A
 * mistake is corrected with a RECONCILIATION_ADJUSTMENT that says who
 * corrected it and by how much — which is the difference between a book
 * you can audit and a number somebody changed.
 */
@Injectable()
export class BankLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Post one movement.
   *
   * Takes an optional tx so a caller settling a business event — a
   * settlement, a topup approval — can record the money in the SAME
   * transaction as the event. A bank line that commits without its cause
   * is how a statement stops matching the story.
   */
  async post(input: PostEntryInput, tx?: Prisma.TransactionClient): Promise<{ id: string }> {
    const db = tx ?? this.prisma.client;
    const amount = new Prisma.Decimal(input.signedAmount);
    if (amount.isZero()) {
      throw new BadRequestException({
        code: 'BANK_ZERO_AMOUNT',
        message: 'A zero movement is not a movement',
      });
    }
    if (input.owner.kind === BankOwnerKind.SELLER && !input.owner.sellerId) {
      throw new BadRequestException({
        code: 'BANK_SELLER_REQUIRED',
        message: 'Money held for a seller must say which seller',
      });
    }
    if (input.owner.kind === BankOwnerKind.CAPITAL && input.owner.sellerId) {
      // Refused rather than ignored: a row that claims both is one
      // somebody will later read as either.
      throw new BadRequestException({
        code: 'BANK_CAPITAL_HAS_SELLER',
        message: 'Capital is ours — it cannot also belong to a seller',
      });
    }

    const account = await db.platformBankAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, currency: true, deletedAt: true },
    });
    if (!account || account.deletedAt !== null) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }

    const created = await db.bankEntry.create({
      data: {
        accountId: input.accountId,
        type: input.type,
        signedAmount: amount,
        // Never converted. The column matches the statement, always.
        currency: account.currency,
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        transferId: input.transferId ?? null,
        expenseCategoryId: input.expenseCategoryId ?? null,
        investmentId: input.investmentId ?? null,
        settlementId: input.settlementId ?? null,
        topupRequestId: input.topupRequestId ?? null,
        withdrawalRequestId: input.withdrawalRequestId ?? null,
        reference: input.reference ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
        createdByStaffId: input.staffId ?? null,
      },
      select: { id: true },
    });
    return created;
  }

  /** Every account with its balance, split by whose money it is. */
  async balances(): Promise<AccountBalance[]> {
    const accounts = await this.prisma.client.platformBankAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, currency: true },
      orderBy: { displayOrder: 'asc' },
    });
    if (accounts.length === 0) return [];

    const grouped = await this.prisma.client.bankEntry.groupBy({
      by: ['accountId', 'ownerKind', 'sellerId'],
      _sum: { signedAmount: true },
    });
    const sellerIds = [
      ...new Set(grouped.map((g) => g.sellerId).filter((s): s is string => s !== null)),
    ];
    const sellers = await this.prisma.client.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, companyName: true },
    });
    const nameOf = new Map(sellers.map((s) => [s.id, s.companyName]));

    return accounts.map((a) => {
      const rows = grouped.filter((g) => g.accountId === a.id);
      let capital = ZERO;
      let sellerHeld = ZERO;
      const bySeller: Array<{ sellerId: string; companyName: string; amount: string }> = [];

      for (const r of rows) {
        const sum = r._sum.signedAmount ?? ZERO;
        if (r.ownerKind === BankOwnerKind.CAPITAL) {
          capital = capital.add(sum);
          continue;
        }
        sellerHeld = sellerHeld.add(sum);
        if (r.sellerId !== null) {
          bySeller.push({
            sellerId: r.sellerId,
            companyName: nameOf.get(r.sellerId) ?? 'Unknown seller',
            amount: sum.toFixed(2),
          });
        }
      }
      // Largest holding first: the question asked of this list is
      // "whose money is in here", and that is answered by the top rows.
      bySeller.sort((x, y) => Number(y.amount) - Number(x.amount));

      return {
        accountId: a.id,
        currency: a.currency,
        total: capital.add(sellerHeld).toFixed(2),
        capital: capital.toFixed(2),
        sellerHeld: sellerHeld.toFixed(2),
        bySeller,
      };
    });
  }

  /**
   * What we hold for one seller, per account.
   *
   * The question a payout asks: is their money in one place, and is that
   * place the currency we are paying from.
   */
  async holdingsForSeller(
    sellerId: string,
  ): Promise<Array<{ accountId: string; label: string; currency: Currency; amount: string }>> {
    const rows = await this.prisma.client.bankEntry.groupBy({
      by: ['accountId'],
      where: { sellerId, ownerKind: BankOwnerKind.SELLER },
      _sum: { signedAmount: true },
    });
    if (rows.length === 0) return [];
    const accounts = await this.prisma.client.platformBankAccount.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, label: true, currency: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows
      .map((r) => {
        const a = byId.get(r.accountId);
        return {
          accountId: r.accountId,
          label: a?.label ?? 'Unknown account',
          currency: a?.currency ?? Currency.INR,
          amount: (r._sum.signedAmount ?? ZERO).toFixed(2),
        };
      })
      .filter((r) => Number(r.amount) !== 0);
  }

  /**
   * A human correcting the book against a real statement.
   *
   * Posts the DIFFERENCE as an entry rather than setting the balance.
   * Overwriting would make the discrepancy disappear instead of being
   * investigated, and a bank book whose history can be edited is not
   * evidence of anything.
   */
  async reconcile(input: {
    accountId: string;
    owner: OwnerRef;
    statedBalance: Prisma.Decimal | string;
    reason: string;
    staffId: string;
  }): Promise<{ delta: string; entryId: string | null }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'BANK_REASON_TOO_SHORT',
        message: 'Say why the book was wrong — at least 10 characters',
      });
    }
    const current = await this.ownerBalance(input.accountId, input.owner);
    const stated = new Prisma.Decimal(input.statedBalance);
    const delta = stated.sub(current);
    if (delta.isZero()) return { delta: '0.00', entryId: null };

    const entry = await this.post({
      accountId: input.accountId,
      type: BankEntryType.RECONCILIATION_ADJUSTMENT,
      signedAmount: delta,
      owner: input.owner,
      occurredAt: new Date(),
      note: input.reason,
      staffId: input.staffId,
    });

    await this.audit.log({
      actorType: 'STAFF',
      staffUserId: input.staffId,
      action: 'staff.bank_account.reconciled',
      entityType: 'platform_bank_account',
      entityId: input.accountId,
      // A book that disagreed with the bank is worth a person's
      // attention even after it is corrected.
      severity: 'HIGH',
      metadata: {
        was: current.toFixed(2),
        stated: stated.toFixed(2),
        delta: delta.toFixed(2),
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        reason: input.reason,
      },
    });
    return { delta: delta.toFixed(2), entryId: entry.id };
  }

  private async ownerBalance(accountId: string, owner: OwnerRef): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.bankEntry.aggregate({
      where: {
        accountId,
        ownerKind: owner.kind,
        ...(owner.kind === BankOwnerKind.SELLER && owner.sellerId
          ? { sellerId: owner.sellerId }
          : {}),
      },
      _sum: { signedAmount: true },
    });
    return agg._sum.signedAmount ?? ZERO;
  }
}
