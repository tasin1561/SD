import { Injectable } from '@nestjs/common';
import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
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
   * Capital sitting in a courier's PREPAID wallet.
   *
   * It is ours and it is not in the bank. We paid it across, they have
   * not spent it yet, and it comes back to us as carriage rather than as
   * cash — so leaving it out of the totals makes the business look
   * poorer than it is by exactly the float we are carrying.
   *
   * NOT a double count: the recharge already debited the bank account
   * when it was recorded, so the money left one asset and arrived in
   * another. Counting both sides of that is what makes them add up.
   *
   * `capturedAt` is on every line because this is the one figure here
   * that is not derived from our own ledger — it is what the courier
   * said when we last looked, and how stale that is changes how much
   * weight it can carry.
   */
  readonly courierWallets: {
    readonly accounts: ReadonlyArray<{
      readonly courierAccountId: string;
      readonly label: string;
      readonly balanceInr: string;
      readonly capturedAt: string | null;
    }>;
    readonly totalInr: string;
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
          // A LIST now. One current account can receive from every
          // courier, so naming a single one would have shown whichever
          // came back first and hidden the rest.
          courierPayouts: { select: { label: true }, orderBy: { label: 'asc' } },
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
        courierAccountLabel:
          a === undefined || a.courierPayouts.length === 0
            ? null
            : a.courierPayouts.map((c) => c.label).join(', '),
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

    /*
      THE LATEST balance per courier account, not every snapshot.

      `courier_wallet_balances` keeps one row per read so the burn rate
      is answerable; the treasury wants only the newest per account.
      Taken by `capturedAt DESC` within each account rather than by a
      global max, which would show one account's figure and drop the
      others.
    */
    const courierAccounts = await this.prisma.client.courierAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        label: true,
        walletBalances: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { balanceInr: true, capturedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const walletLines = courierAccounts
      // An account we have never read is left OUT rather than shown as
      // zero: "we do not know" and "it is empty" are different, and only
      // one of them should reduce the money we think we have.
      .filter((a) => a.walletBalances.length > 0)
      .map((a) => ({
        courierAccountId: a.id,
        label: a.label,
        balanceInr: (a.walletBalances[0]?.balanceInr ?? ZERO).toFixed(2),
        capturedAt: a.walletBalances[0]?.capturedAt.toISOString() ?? null,
      }));
    const walletTotal = walletLines.reduce(
      (acc, l) => acc.add(new Prisma.Decimal(l.balanceInr)),
      ZERO,
    );

    const owedInr = owed.reduce((acc, r) => acc.add(r.balance), ZERO);
    const heldInr = held._sum.signedAmount ?? ZERO;
    const gap = owedInr.sub(heldInr);

    return {
      accounts: enriched,
      totals: { byCurrency },
      courierWallets: { accounts: walletLines, totalInr: walletTotal.toFixed(2) },
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

  async entries(query: {
    accountId?: string;
    sellerId?: string;
    limit?: number;
    /** One entry TYPE, so a page can show its own ledger rather than all money. */
    type?: BankEntryType;
    expenseCategoryId?: string;
    from?: Date;
    to?: Date;
  }): Promise<{
    items: Array<{
      id: string;
      accountLabel: string;
      type: string;
      signedAmount: string;
      currency: Currency;
      ownerKind: BankOwnerKind;
      sellerName: string | null;
      categoryName: string | null;
      categoryCode: string | null;
      reference: string | null;
      note: string | null;
      occurredAt: Date;
      /**
       * WHO recorded it and WHEN they did, which is a different fact
       * from when the money moved: an entry dated Tuesday may have been
       * typed in on Friday, and only one of those two answers "who
       * should I ask about this line".
       */
      recordedByName: string | null;
      recordedAt: Date;
      /** The consignment this payment was attributed to, if any. */
      inboundFreightChargeId: string | null;
    }>;
  }> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: {
        ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.expenseCategoryId === undefined
          ? {}
          : { expenseCategoryId: query.expenseCategoryId }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              occurredAt: {
                ...(query.from === undefined ? {} : { gte: query.from }),
                ...(query.to === undefined ? {} : { lte: query.to }),
              },
            }),
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
        createdAt: true,
        inboundFreightChargeId: true,
        account: { select: { label: true } },
        seller: { select: { companyName: true } },
        expenseCategory: { select: { name: true, code: true } },
        createdBy: { select: { emailDisplay: true } },
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
        categoryCode: r.expenseCategory?.code ?? null,
        reference: r.reference,
        note: r.note,
        occurredAt: r.occurredAt,
        // Null for the many entries a FLOW wrote rather than a person —
        // a settlement landing, an attribution pair. Shown as "system"
        // rather than blank, so "nobody" and "we did not record it" stay
        // distinguishable.
        recordedByName: r.createdBy?.emailDisplay ?? null,
        recordedAt: r.createdAt,
        inboundFreightChargeId: r.inboundFreightChargeId,
      })),
    };
  }
}
