import { Injectable } from '@nestjs/common';
import { BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BankLedgerService, type AccountBalance } from './bank-ledger.service';

const ZERO = new Prisma.Decimal(0);

export interface TreasuryOverview {
  readonly accounts: ReadonlyArray<
    AccountBalance & {
      readonly label: string;
      readonly bankName: string;
      readonly purpose: string | null;
      readonly courierAccountLabel: string | null;
    }
  >;
  readonly totals: {
    readonly byCurrency: ReadonlyArray<{
      readonly currency: Currency;
      readonly total: string;
      readonly capital: string;
      readonly sellerHeld: string;
    }>;
  };
  /**
   * What we OWE sellers against what we HOLD for them. The single
   * number that says whether client money is covered.
   */
  readonly clientMoney: {
    readonly owedToSellersInr: string;
    readonly heldForSellersInr: string;
    readonly gapInr: string;
    readonly covered: boolean;
  };
}

/**
 * Reading the treasury.
 *
 * Kept apart from the writers so a page cannot accidentally post an
 * entry, and so the read shapes can change without touching the
 * ledger's rules.
 */
@Injectable()
export class TreasuryReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
  ) {}

  async overview(): Promise<TreasuryOverview> {
    const [balances, accounts, owed, held] = await Promise.all([
      this.ledger.balances(),
      this.prisma.client.platformBankAccount.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          label: true,
          bankName: true,
          purpose: true,
          currency: true,
          courierAccount: { select: { label: true } },
        },
        orderBy: { displayOrder: 'asc' },
      }),
      // What we owe: the sum of every POSITIVE seller wallet balance.
      // A negative one is a receivable, not a debt we must fund, so it
      // must not net off and flatter the coverage figure.
      // Read from the maintained balance table, NOT by finding each
      // seller's newest entry with `_max: { id: true }` — Postgres has
      // no max() for uuid and refuses that outright. I wrote it that way
      // here anyway, two days after fixing the identical thing in the
      // admin wallet service, and only a real database caught it.
      //
      // Safe to trust now because applyEntry writes this row inside the
      // same transaction as the entry, so it cannot lag behind.
      this.prisma.client.sellerWalletBalance.findMany({
        where: { currency: Currency.INR, balance: { gt: 0 } },
        select: { balance: true },
      }),
      this.prisma.client.bankEntry.aggregate({
        where: { ownerKind: BankOwnerKind.SELLER, currency: Currency.INR },
        _sum: { signedAmount: true },
      }),
    ]);

    const byId = new Map(accounts.map((a) => [a.id, a]));
    const enriched = balances.map((b) => {
      const a = byId.get(b.accountId);
      return {
        ...b,
        label: a?.label ?? 'Unknown',
        bankName: a?.bankName ?? '',
        purpose: a?.purpose ?? null,
        courierAccountLabel: a?.courierAccount?.label ?? null,
      };
    });

    const byCurrency = [Currency.INR, Currency.BDT].map((currency) => {
      const rows = enriched.filter((e) => e.currency === currency);
      const sum = (pick: (r: (typeof rows)[number]) => string): string =>
        rows.reduce((acc, r) => acc.add(new Prisma.Decimal(pick(r))), ZERO).toFixed(2);
      return {
        currency,
        total: sum((r) => r.total),
        capital: sum((r) => r.capital),
        sellerHeld: sum((r) => r.sellerHeld),
      };
    });

    const owedInr = owed.reduce((acc, r) => acc.add(r.balance), ZERO);
    const heldInr = held._sum.signedAmount ?? ZERO;
    const gap = owedInr.sub(heldInr);

    return {
      accounts: enriched,
      totals: { byCurrency },
      clientMoney: {
        owedToSellersInr: owedInr.toFixed(2),
        heldForSellersInr: heldInr.toFixed(2),
        gapInr: gap.toFixed(2),
        // Covered means we hold at least what we owe. A gap is not
        // automatically wrong — money in transit from a courier is a
        // normal gap — but it is the number to watch.
        covered: gap.lte(0),
      },
    };
  }

  /** Where one seller's money is sitting, for a payout decision. */
  holdingsForSeller(sellerId: string): ReturnType<BankLedgerService['holdingsForSeller']> {
    return this.ledger.holdingsForSeller(sellerId);
  }

  async entries(query: { accountId?: string; sellerId?: string; limit?: number }): Promise<{
    items: Array<{
      id: string;
      accountLabel: string;
      type: string;
      signedAmount: string;
      currency: Currency;
      ownerKind: BankOwnerKind;
      sellerName: string | null;
      categoryName: string | null;
      reference: string | null;
      note: string | null;
      occurredAt: Date;
    }>;
  }> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      },
      // By id, not occurredAt: two entries of one transfer share a
      // timestamp, and a ledger that lists them in an arbitrary order
      // reads as though the money went the wrong way.
      orderBy: { id: 'desc' },
      take: Math.min(500, Math.max(1, query.limit ?? 100)),
      select: {
        id: true,
        type: true,
        signedAmount: true,
        currency: true,
        ownerKind: true,
        reference: true,
        note: true,
        occurredAt: true,
        account: { select: { label: true } },
        seller: { select: { companyName: true } },
        expenseCategory: { select: { name: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        accountLabel: r.account.label,
        type: r.type,
        signedAmount: r.signedAmount.toFixed(2),
        currency: r.currency,
        ownerKind: r.ownerKind,
        sellerName: r.seller?.companyName ?? null,
        categoryName: r.expenseCategory?.name ?? null,
        reference: r.reference,
        note: r.note,
        occurredAt: r.occurredAt,
      })),
    };
  }
}
