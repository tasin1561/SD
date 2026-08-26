import { Injectable, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, TopupRequestStatus, WithdrawalRequestStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

const ZERO = new Prisma.Decimal(0);
const MIN_BALANCE_KEY = 'wallet.minimum_balance_inr';

/**
 * The wallet settings that decide how this seller's money behaves.
 *
 * Shown on their wallet page RESOLVED — the value actually in force,
 * whether it came from their own override or the system default (SET-1)
 * — because an operator asking "why was that refused" needs the number
 * being applied, not the two places it might have come from.
 *
 * Read-only here. They are edited where they are owned: globally at
 * /settings, per seller on the seller's own detail page.
 */
const WALLET_SETTINGS = [
  [
    'wallet.minimum_balance_inr',
    'Minimum balance',
    'Must stay in the wallet — our only security against an unpaid delivery fee.',
  ],
  ['wallet.withdrawal_min_threshold_inr', 'Smallest payout', 'A request below this is refused.'],
  ['wallet.withdrawal_max_per_day', 'Payouts per day', 'How OFTEN, never how much.'],
  ['wallet.withdrawal_max_per_month', 'Payouts per month', 'Rolling 30 days.'],
  [
    'wallet.withdrawal_sla_hours',
    'Payout SLA (hours)',
    'What we promise once a request is raised.',
  ],
  ['wallet.auto_withdraw_enabled', 'Auto payout', 'Raises a request for them on a schedule.'],
  ['wallet.auto_withdraw_hour_local', 'Auto payout hour', "In the SELLER's timezone, not ours."],
  ['wallet.accrual_timing_tier', 'COD credit timing', 'INSTANT, or T+N days after delivery.'],
  ['wallet.accrual_delay_days', 'Credit delay (days)', 'The N in T+N.'],
  [
    'wallet.cod_credit_mode',
    'COD credited on',
    'SETTLEMENT when the courier pays us, or INSTANT_PAY at delivery.',
  ],
  [
    'wallet.instant_pay_fee_percent',
    'Instant-pay fee %',
    'Charged on the post-GST amount when fronting COD.',
  ],
  [
    'wallet.cod_gst_percent',
    'GST withheld on COD %',
    'Extracted from a tax-inclusive price, never added on top.',
  ],
  ['wallet.cod_collection_fee_percent', 'COD collection fee %', ''],
  ['wallet.courier_fee_deduction_timing', 'Courier fee charged', 'AT_AWB or AT_DELIVERY.'],
  [
    'wallet.inbound_freight_mode',
    'Inbound freight terms',
    'PAY_NOW, or PAY_LATER amortised as stock sells.',
  ],
  ['wallet.inbound_freight_service_charge_percent', 'Pay-later service charge %', ''],
] as const;

export interface SellerWalletRow {
  readonly sellerId: string;
  readonly companyName: string;
  readonly email: string;
  readonly status: string;
  readonly balanceInr: string;
  /** Asked for and not yet paid. Already inside `balanceInr`. */
  readonly pendingWithdrawalInr: string;
  /** Claimed and not yet verified. NOT inside `balanceInr`. */
  readonly pendingTopupInr: string;
  readonly updatedAt: Date | null;
}

export interface SellerWalletTotals {
  /**
   * What we owe, and what is owed to us — kept apart on purpose.
   *
   * Netting them produces one number that is true of nobody: a seller
   * ₹50,000 in credit and another ₹50,000 in debt are not a business
   * with nothing outstanding. One is money we must be able to pay on
   * demand; the other is money we may never see.
   */
  readonly owedToSellersInr: string;
  readonly owedBySellersInr: string;
  readonly netInr: string;
  /** Of what we owe, how much has already been asked for. */
  readonly pendingWithdrawalInr: string;
  /** Claimed but unverified — not in any balance yet. */
  readonly pendingTopupInr: string;
  readonly sellersInCredit: number;
  readonly sellersInDebt: number;
}

/**
 * Every seller's wallet, from our side of it.
 *
 * Read-only by construction: this module has no writer, and money moves
 * only through the paths that already own it (WAL-1). A page that both
 * reports balances and adjusts them is one where a mis-click looks like
 * a report.
 */
@Injectable()
export class AdminSellerWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  async overview(): Promise<{ totals: SellerWalletTotals; rows: SellerWalletRow[] }> {
    // Driven from SELLERS, not from balance rows.
    //
    // A balance row is only written once money has moved, so listing
    // balances hid every seller who has not transacted yet — which, on a
    // young system, is all of them. The page then said "No seller
    // wallets yet" while three approved sellers existed, and an admin
    // looking for one of them reasonably concludes the wallet is broken
    // or the seller is missing.
    //
    // A seller with no movement does not have "no wallet". They have an
    // empty one, and that is a different sentence.
    const sellers = await this.prisma.client.seller.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        companyName: true,
        email: true,
        status: true,
        createdAt: true,
        // The cached balance rather than a balance call per seller: one
        // query for the whole estate instead of N, and it is the same
        // number the seller is shown (WAL-7 keeps it in step).
        walletBalances: {
          where: { currency: Currency.INR },
          select: { balance: true, updatedAt: true },
          take: 1,
        },
      },
    });

    // The balance comes from the LEDGER, not the cache table.
    //
    // sellerWalletBalance is refreshed by each money path calling
    // recomputeCacheAfterCommit, and only 6 of the 14 services that
    // write entries actually do — so the row is missing or stale more
    // often than not. Reading it raw showed a seller who owes ₹3,000 as
    // ₹0.00, and the estate total as "0 in debt". A wrong number is
    // worse here than a missing screen: nobody chases a debt the system
    // says does not exist.
    //
    // WAL-7 defines the balance as the LAST entry's running balance, so
    // that is what this reads. Two queries whatever the seller count:
    // the newest entry id per seller (ids are uuidv7, so max id IS the
    // latest), then those rows.
    const ids = sellers.map((x) => x.id);
    const newest =
      ids.length === 0
        ? []
        : await this.prisma.client.sellerWalletEntry.groupBy({
            by: ['sellerId'],
            where: { sellerId: { in: ids }, currency: Currency.INR },
            _max: { id: true },
          });
    const newestIds = newest.map((n) => n._max.id).filter((v): v is string => v !== null);
    const latestEntries =
      newestIds.length === 0
        ? []
        : await this.prisma.client.sellerWalletEntry.findMany({
            where: { id: { in: newestIds } },
            select: { sellerId: true, runningBalanceAfter: true, createdAt: true },
          });
    const ledger = new Map(latestEntries.map((e) => [e.sellerId, e]));

    const balances = sellers.map((x) => {
      const last = ledger.get(x.id);
      return {
        sellerId: x.id,
        // No entries yet means nothing has moved, which is a balance of
        // zero — not an absence.
        balance: last?.runningBalanceAfter ?? ZERO,
        // Falls back to when the seller was created, so the column reads
        // as "nothing since then" rather than as a blank.
        updatedAt: last?.createdAt ?? x.createdAt,
        seller: { companyName: x.companyName, email: x.email, status: x.status },
      };
    });

    const [withdrawals, topups] = await Promise.all([
      this.prisma.client.withdrawalRequest.groupBy({
        by: ['sellerId'],
        where: { status: WithdrawalRequestStatus.PENDING },
        _sum: { amountRequested: true },
      }),
      this.prisma.client.walletTopupRequest.groupBy({
        by: ['sellerId'],
        where: { status: TopupRequestStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);
    const pendingOut = new Map(
      withdrawals.map((w) => [w.sellerId, w._sum.amountRequested ?? ZERO]),
    );
    const pendingIn = new Map(topups.map((t) => [t.sellerId, t._sum.amount ?? ZERO]));

    let owedTo = ZERO;
    let owedBy = ZERO;
    let inCredit = 0;
    let inDebt = 0;
    const rows: SellerWalletRow[] = balances.map((b) => {
      if (b.balance.gt(0)) {
        owedTo = owedTo.add(b.balance);
        inCredit += 1;
      } else if (b.balance.lt(0)) {
        // Held as a POSITIVE figure: "they owe us 3,000" reads better
        // than "minus 3,000 of what we owe".
        owedBy = owedBy.add(b.balance.abs());
        inDebt += 1;
      }
      return {
        sellerId: b.sellerId,
        companyName: b.seller.companyName,
        email: b.seller.email,
        status: b.seller.status,
        balanceInr: b.balance.toFixed(2),
        pendingWithdrawalInr: (pendingOut.get(b.sellerId) ?? ZERO).toFixed(2),
        pendingTopupInr: (pendingIn.get(b.sellerId) ?? ZERO).toFixed(2),
        updatedAt: b.updatedAt,
      };
    });
    rows.sort((a, b) => Number(a.balanceInr) - Number(b.balanceInr));

    const totalOut = withdrawals.reduce((s, w) => s.add(w._sum.amountRequested ?? ZERO), ZERO);
    const totalIn = topups.reduce((s, t) => s.add(t._sum.amount ?? ZERO), ZERO);

    return {
      totals: {
        owedToSellersInr: owedTo.toFixed(2),
        owedBySellersInr: owedBy.toFixed(2),
        netInr: owedTo.sub(owedBy).toFixed(2),
        pendingWithdrawalInr: totalOut.toFixed(2),
        pendingTopupInr: totalIn.toFixed(2),
        sellersInCredit: inCredit,
        sellersInDebt: inDebt,
      },
      rows,
    };
  }

  /**
   * One seller's wallet in full — the same view they have, minus the
   * two buttons that move money.
   */
  async detail(sellerId: string): Promise<{
    seller: { id: string; companyName: string; email: string; status: string };
    balanceInr: string;
    /** Balance minus the floor this account must leave behind. */
    withdrawableInr: string;
    minimumBalanceInr: string;
    pendingWithdrawalInr: string;
    pendingTopupInr: string;
    settings: Array<{
      key: string;
      label: string;
      hint: string;
      value: string;
      /** SELLER_OVERRIDE or SYSTEM_DEFAULT — which one is in force. */
      source: string;
    }>;
  }> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, companyName: true, email: true, status: true },
    });
    if (seller === null) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    // Same reasoning as the list: the ledger is authoritative, the cache
    // table is only as fresh as whichever path last remembered to
    // refresh it.
    const last = await this.prisma.client.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      // uuidv7 ids are monotonic and, unlike createdAt, distinct within
      // one transaction — so this is the last entry, not merely one of
      // the last (WAL-7).
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    const balance = last?.runningBalanceAfter ?? ZERO;

    const floor = await this.settings.resolve(sellerId, MIN_BALANCE_KEY);
    const min = new Prisma.Decimal(String(floor.value ?? 0));
    const available = balance.minus(min);

    const [out, incoming] = await Promise.all([
      this.prisma.client.withdrawalRequest.aggregate({
        where: { sellerId, status: WithdrawalRequestStatus.PENDING },
        _sum: { amountRequested: true },
      }),
      this.prisma.client.walletTopupRequest.aggregate({
        where: { sellerId, status: TopupRequestStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);

    const settings = await Promise.all(
      WALLET_SETTINGS.map(async ([key, label, hint]) => {
        try {
          const r = await this.settings.resolve(sellerId, key);
          return { key, label, hint, value: String(r.value ?? ''), source: String(r.source) };
        } catch {
          // A key that cannot be resolved is reported as unknown rather
          // than defaulted: showing a number we did not read is how an
          // operator ends up explaining the wrong rule to a seller.
          return { key, label, hint, value: '—', source: 'UNRESOLVED' };
        }
      }),
    );

    return {
      seller,
      settings,
      balanceInr: balance.toFixed(2),
      withdrawableInr: (available.isNegative() ? ZERO : available).toFixed(2),
      minimumBalanceInr: min.toFixed(2),
      pendingWithdrawalInr: (out._sum.amountRequested ?? ZERO).toFixed(2),
      pendingTopupInr: (incoming._sum.amount ?? ZERO).toFixed(2),
    };
  }
}
