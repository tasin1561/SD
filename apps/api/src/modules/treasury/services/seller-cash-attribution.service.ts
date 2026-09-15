import { Injectable } from '@nestjs/common';
import {
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  TopupRequestStatus,
  WalletEntryDirection,
} from '@skydrop/db';
import { BankLedgerService } from './bank-ledger.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

const positive = (d: Prisma.Decimal): Prisma.Decimal => (d.lessThan(0) ? ZERO : d);

type TxClient = Prisma.TransactionClient;

/** Which way the CASH behind a wallet movement changes hands. */
type Reclassification = 'TO_CAPITAL' | 'TO_SELLER' | 'NONE';

/**
 * Rupees per unit of another currency, as a FRACTION: `inr` rupees for
 * `local` units — so ৳1,300 credited as ₹1,000 converts back to exactly
 * ₹1,000, not ₹999.99. TOPUP when read off the seller's own accepted
 * top-up into that account; FX when there was none and today's rate
 * stood in.
 */
export interface InrRate {
  readonly inr: Prisma.Decimal;
  readonly local: Prisma.Decimal;
  readonly source: 'INR' | 'TOPUP' | 'FX';
}

interface Holding {
  readonly accountId: string;
  readonly currency: Currency;
  /** In the account's own currency. Always positive. */
  readonly amount: Prisma.Decimal;
  /** Null for rupees, or for a currency nothing could value. */
  readonly rate: InrRate | null;
  /** What the holding is worth in rupees; zero when it cannot be valued. */
  readonly inrValue: Prisma.Decimal;
}

/**
 * Whose money is it, after a wallet entry.
 *
 * A seller's balance and the cash behind it are two different things,
 * and only some wallet movements are also cash movements:
 *
 *   - A TOP-UP and a COD credit bring real cash in, and it is THEIRS.
 *     Those are posted by the flows that receive the money.
 *   - A REMITTANCE takes real cash out. Posted by the flow that pays it.
 *   - A CHARGE moves nothing between banks — but it changes WHOSE the
 *     cash already sitting there is. A delivery fee, an RTO fee, inbound
 *     freight: the seller's balance falls and that money becomes OURS.
 *     Without this step the bank book would go on reporting it as held
 *     for them, and the coverage page would say we are holding money we
 *     have already earned.
 *
 * Seller money is EXACTLY two things: what they topped up, and what the
 * courier collected on their behalf. Everything else in the account is
 * capital.
 *
 * The reclassification is CLAMPED to what they actually hold, and that
 * is the important part. A seller with no cash with us who is charged a
 * freight bill produces NO bank entry at all — there is no cash to
 * reclassify, and the debt is a receivable rather than a movement. A
 * negative wallet has nothing behind it in any account, and inventing an
 * entry for it would put a number in the bank book that no statement
 * will ever agree with.
 *
 * ── EVERY CURRENCY THEY HOLD, NOT ONLY RUPEES ───────────────────────
 * The wallet is rupees; a seller's cash need not be. A taka top-up is
 * posted as taka in the taka account. Looking only at rupee accounts, a
 * seller who paid in taka and was then charged kept every taka "held for
 * the seller" forever while their wallet fell. When their rupees run out
 * a charge continues into their other currencies, converting the rupee
 * amount at the rate their money there was CREDITED at (`rateToInr`) —
 * the one rate at which the wallet and the cash were ever equal.
 */
@Injectable()
export class SellerCashAttributionService {
  // No PrismaService: every method works on the CALLER's transaction, so
  // the cash side commits with the wallet entry or not at all (TRE-3).
  // Holding a second client here would make it possible to write one
  // outside that transaction by accident.
  constructor(private readonly ledger: BankLedgerService) {}

  /**
   * F2-exhaustive: a new `WalletEntryDirection` fails to compile until
   * somebody decides which way its cash goes. That decision is exactly
   * the one that gets forgotten — WAL-1 has been missed twice already
   * on the credit/debit half alone.
   */
  private direction(d: WalletEntryDirection): Reclassification {
    switch (d) {
      // Charges. The seller's balance falls and the cash becomes ours.
      // CUSTOMER_RETURN_FEE belongs here for the same reason as the
      // rest: a charge moves nothing between banks, it changes whose
      // the cash already sitting there is.
      //
      // GST_WITHHOLDING moves the same way: the cash sits in our
      // account and stops being the seller's, which is what keeps
      // seller-held cash equal to the wallet liability (TRE-4).
      //
      // This used to carry a caveat — that the capital side was really
      // owed to the government and the bank book could not model it.
      // That caveat is GONE as of 2026-09-07: the courier bills GST on
      // the shipping alongside their charge and remits it, so no return
      // of ours sits behind this deduction. TO_CAPITAL is now simply
      // true rather than true-with-an-asterisk.
      case WalletEntryDirection.ORDER_CHARGES:
      case WalletEntryDirection.RTO_FEE:
      case WalletEntryDirection.CUSTOMER_RETURN_FEE:
      case WalletEntryDirection.INBOUND_FREIGHT:
      case WalletEntryDirection.INSTANT_PAY_FEE:
      case WalletEntryDirection.COD_COLLECTION_FEE:
      case WalletEntryDirection.GST_WITHHOLDING:
        return 'TO_CAPITAL';

      // Giving it back. The cash was ours; now it is theirs again. The
      // tax and fee on a reversed COD (COD_DEDUCTION_REFUND) go back the
      // same way: the cash the charge made ours returns to the seller,
      // whose COD it was taken from.
      case WalletEntryDirection.ORDER_CHARGES_REFUND:
      case WalletEntryDirection.SCRAP_REFUND:
      case WalletEntryDirection.COD_DEDUCTION_REFUND:
        return 'TO_SELLER';

      // Real cash crossing the bank, posted by the flow that moved it.
      // Reclassifying here as well would double-count the movement. The
      // courier taking a COD back out of a payout (COD_REVERSAL) is the
      // same: the settlement posts that cash leaving, exactly as it
      // posted it arriving.
      case WalletEntryDirection.TOPUP:
      case WalletEntryDirection.COD_COLLECTION:
      case WalletEntryDirection.REMITTANCE_OUT:
      case WalletEntryDirection.REMITTANCE_FX:
      case WalletEntryDirection.COD_REVERSAL:
        return 'NONE';

      // An operator correcting a wallet. Whether any cash is implicated
      // is exactly what they are correcting, and guessing would put an
      // entry in the bank book nobody can match. The bank is reconciled
      // on its own (TRE-1), which is the honest instrument for this.
      case WalletEntryDirection.ADJUSTMENT_CREDIT:
      case WalletEntryDirection.ADJUSTMENT_DEBIT:
      case WalletEntryDirection.OPENING_BALANCE:
        return 'NONE';
    }
  }

  /**
   * Called inside the wallet's own transaction, so the balance and the
   * ownership of the cash behind it can never disagree (TRE-3).
   *
   * Best-effort by design at the EDGES only: if there is no account, or
   * the seller holds nothing, nothing is written. It never throws on
   * "there was no cash" because that is a normal state, not a fault.
   */
  async apply(
    tx: TxClient,
    input: {
      sellerId: string;
      currency: Currency;
      direction: WalletEntryDirection;
      amount: Prisma.Decimal;
      walletEntryId: string;
      /**
       * The wallet's running balance AFTER this entry. `applyEntry` has
       * just computed it and passes it; when absent it is read back from
       * the ledger, where the entry is already written.
       */
      balanceAfter?: Prisma.Decimal;
    },
  ): Promise<void> {
    const which = this.direction(input.direction);
    if (which === 'NONE') return;

    if (which === 'TO_CAPITAL') {
      // Clamped. Charging ₹200 to a seller holding ₹50 makes ₹50 ours
      // and leaves ₹150 as a receivable — there is no third ₹150 in any
      // account to move, and writing one would be inventing cash. Rupees
      // first, then any other currency they hold (see the class comment).
      await this.moveToCapital(tx, {
        sellerId: input.sellerId,
        unit: input.currency,
        amount: input.amount,
        reference: input.walletEntryId,
        note: 'Charged — cash now ours',
        includeUnitCurrency: true,
      });
      return;
    }

    // TO_SELLER: a refund. Only the part that lifts the wallet ABOVE ZERO
    // becomes cash of theirs. A seller in debt holds nothing (TRE-8), so a
    // refund that only shrinks the debt shrinks a receivable — moving the
    // whole of it would hold them cash their wallet does not show.
    // Refunding ₹200 to a seller at −₹150 moves ₹50; at −₹300, nothing.
    const after =
      input.balanceAfter ?? (await this.walletBalance(tx, input.sellerId, input.currency));
    const lift = positive(after).sub(positive(after.sub(input.amount)));
    if (lift.lessThanOrEqualTo(0)) return;

    // Land it where their money already is; failing that, the account we
    // most recently used for them. If neither exists there is no bank
    // book for this seller yet and the wallet credit stands alone until
    // one is reconciled.
    const held = await this.heldBySeller(tx, input.sellerId, input.currency);
    const accountId = held.accountId ?? (await this.anyAccount(tx, input.currency));
    if (accountId === null) return;
    await this.pair(tx, {
      accountId,
      currency: input.currency,
      sellerId: input.sellerId,
      fromSeller: lift.neg(),
      walletEntryId: input.walletEntryId,
      note: 'Refunded — cash theirs again',
    });
  }

  /** What this seller holds in `currency` across every live account, and where most of it is. */
  async sellerHeld(
    tx: TxClient,
    sellerId: string,
    currency: Currency,
  ): Promise<{ total: Prisma.Decimal; accountId: string | null }> {
    return this.heldBySeller(tx, sellerId, currency);
  }

  /**
   * Everything this seller holds with us, valued in RUPEES: rupee
   * accounts at face value, every other currency at the rate their money
   * there was credited at (`rateToInr`). A holding nothing can value
   * counts as nothing — left alone rather than guessed at.
   */
  async sellerHeldAll(
    tx: TxClient,
    sellerId: string,
  ): Promise<{ inr: Prisma.Decimal; otherInr: Prisma.Decimal; totalInr: Prisma.Decimal }> {
    let inr = ZERO;
    let otherInr = ZERO;
    for (const h of await this.holdings(tx, sellerId)) {
      if (h.currency === Currency.INR) inr = inr.add(h.amount);
      else otherInr = otherInr.add(h.inrValue);
    }
    return { inr, otherInr, totalInr: inr.add(otherInr) };
  }

  /**
   * Make up to `amountInr` of what this seller holds OURS, as zero-sum
   * pairs in the accounts it sits in: rupee accounts first (unless
   * `skipInr` — a caller that has already taken the rupees its own way),
   * then other currencies at their credited rate. Never more than they
   * hold. Returns the rupee value actually moved.
   */
  async takeFromSeller(
    tx: TxClient,
    input: {
      sellerId: string;
      amountInr: Prisma.Decimal;
      reference: string;
      note: string;
      skipInr?: boolean;
    },
  ): Promise<Prisma.Decimal> {
    return this.moveToCapital(tx, {
      sellerId: input.sellerId,
      unit: Currency.INR,
      amount: input.amountInr,
      reference: input.reference,
      note: input.note,
      includeUnitCurrency: input.skipInr !== true,
    });
  }

  /**
   * How many rupees a unit of `currency` in `accountId` is worth, for
   * THIS seller: the rate their money there was credited at. That is the
   * latest ACCEPTED top-up into the account — rupees credited to the
   * wallet over what landed in the bank — because the wallet and the
   * cash must be valued at the same rate or they drift apart the moment
   * either moves. Only when no such top-up exists does today's rate
   * (`fx_rates`) stand in, and `source` says which was used. Null when
   * there is no rate at all.
   */
  async rateToInr(
    tx: TxClient,
    sellerId: string,
    accountId: string,
    currency: Currency,
  ): Promise<InrRate | null> {
    if (currency === Currency.INR) return { inr: ONE, local: ONE, source: 'INR' };
    const topup = await tx.walletTopupRequest.findFirst({
      where: {
        sellerId,
        bankAccountId: accountId,
        currency,
        status: TopupRequestStatus.ACCEPTED,
        walletEntryId: { not: null },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      select: { amount: true, walletEntry: { select: { amount: true } } },
    });
    const credited = topup?.walletEntry?.amount ?? null;
    if (topup && credited !== null && credited.greaterThan(0) && topup.amount.greaterThan(0)) {
      return { inr: credited, local: topup.amount, source: 'TOPUP' };
    }
    const direct = await tx.fxRate.findUnique({
      where: { fromCurrency_toCurrency: { fromCurrency: currency, toCurrency: Currency.INR } },
      select: { rate: true },
    });
    if (direct && direct.rate.greaterThan(0)) return { inr: direct.rate, local: ONE, source: 'FX' };
    const inverse = await tx.fxRate.findUnique({
      where: { fromCurrency_toCurrency: { fromCurrency: Currency.INR, toCurrency: currency } },
      select: { rate: true },
    });
    if (inverse && inverse.rate.greaterThan(0)) {
      return { inr: ONE, local: inverse.rate, source: 'FX' };
    }
    return null;
  }

  /**
   * How much of cash arriving for a seller REPAYS what they owe us.
   *
   * A charge taken while a seller held nothing wrote no bank entry — the
   * debt was a receivable (TRE-8). When their cash later arrives (a COD
   * payout, a top-up), the part of it that settles that debt is ours: it
   * repays the receivable. Posting all of it as theirs held them money
   * their wallet does not show. Read against the balance BEFORE the
   * credit this cash backs, under the wallet lock (re-entrant within the
   * transaction) so no concurrent write can move it underneath.
   *
   * The seller's share is what brings their holding — in EVERY currency,
   * valued at its credited rate — up to what the wallet will owe them
   * after the credit: `max(0, balance + amount) − held`, kept within
   * [0, amount]. When the book agrees with the wallet that is exactly
   * `amount − min(debt, amount)`; when it does not (taka they still hold
   * from before charges could reach it), the inflow is not stacked on top.
   */
  async debtSplit(
    tx: TxClient,
    sellerId: string,
    amount: Prisma.Decimal,
  ): Promise<{ toCapital: Prisma.Decimal; toSeller: Prisma.Decimal }> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);
    const balance = await this.walletBalance(tx, sellerId, Currency.INR);
    const held = (await this.sellerHeldAll(tx, sellerId)).totalInr;
    const wanted = positive(balance.add(amount)).sub(held).toDecimalPlaces(2);
    const toSeller = wanted.lessThan(0) ? ZERO : wanted.greaterThan(amount) ? amount : wanted;
    return { toCapital: amount.sub(toSeller), toSeller };
  }

  /**
   * Hold a seller cash that has not arrived yet, out of OUR money — the
   * COD paid under Instant Pay before the courier settles. A zero-sum pair
   * (capital → seller), so the account total does not move, posted BEFORE
   * the credit so its tax and fee find cash to take. The payout later
   * lands as capital's, repaying the front.
   */
  async front(
    tx: TxClient,
    input: {
      sellerId: string;
      amount: Prisma.Decimal;
      accountId: string | null;
      reference: string;
    },
  ): Promise<void> {
    if (input.amount.lessThanOrEqualTo(0)) return;
    const accountId = input.accountId ?? (await this.anyAccount(tx, Currency.INR));
    if (accountId === null) return;
    await this.pair(tx, {
      accountId,
      currency: Currency.INR,
      sellerId: input.sellerId,
      fromSeller: input.amount.neg(),
      walletEntryId: input.reference,
      note: 'Fronted from our money until the courier pays',
    });
  }

  /**
   * Cash that arrived as the seller's but repays what they owed: ours.
   * A zero-sum pair in the account, and the currency, it landed in.
   */
  async repayDebt(
    tx: TxClient,
    input: {
      sellerId: string;
      accountId: string;
      currency: Currency;
      amount: Prisma.Decimal;
      reference: string;
    },
  ): Promise<void> {
    if (input.amount.lessThanOrEqualTo(0)) return;
    await this.pair(tx, {
      accountId: input.accountId,
      currency: input.currency,
      sellerId: input.sellerId,
      fromSeller: input.amount,
      walletEntryId: input.reference,
      note: 'Repays what the seller owed — cash now ours',
    });
  }

  /**
   * The one place seller cash becomes ours. `amount` is in `unit`, the
   * wallet's currency. For rupees (every wallet today) it walks their
   * rupee accounts, largest first, then every other currency they hold,
   * largest first, converting at the credited rate; a legacy non-rupee
   * wallet only ever touches accounts of its own currency. Each account
   * gives at most what it holds for them, so no account's seller figure
   * can go negative. Returns what was moved, in `unit`.
   */
  private async moveToCapital(
    tx: TxClient,
    input: {
      sellerId: string;
      unit: Currency;
      amount: Prisma.Decimal;
      reference: string;
      note: string;
      includeUnitCurrency: boolean;
    },
  ): Promise<Prisma.Decimal> {
    if (input.amount.lessThanOrEqualTo(0)) return ZERO;
    const converts = input.unit === Currency.INR;
    const all = await this.holdings(tx, input.sellerId, converts);
    const same = all
      .filter((h) => h.currency === input.unit)
      .sort((a, b) => b.amount.comparedTo(a.amount));
    const other = converts
      ? all
          .filter((h) => h.currency !== Currency.INR && h.inrValue.greaterThan(0))
          .sort((a, b) => b.inrValue.comparedTo(a.inrValue))
      : [];

    let remaining = input.amount;
    if (input.includeUnitCurrency) {
      for (const h of same) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const take = h.amount.lessThan(remaining) ? h.amount : remaining;
        await this.pair(tx, {
          accountId: h.accountId,
          currency: h.currency,
          sellerId: input.sellerId,
          fromSeller: take,
          walletEntryId: input.reference,
          note: input.note,
        });
        remaining = remaining.sub(take);
      }
    }
    for (const h of other) {
      if (remaining.lessThanOrEqualTo(0)) break;
      if (h.rate === null) continue;
      const takeInr = h.inrValue.lessThan(remaining) ? h.inrValue : remaining;
      // All of it when that is what it takes; otherwise the rupees
      // converted back at the credited rate — and never past what is there.
      const converted = takeInr.mul(h.rate.local).div(h.rate.inr).toDecimalPlaces(2);
      const local =
        takeInr.equals(h.inrValue) || converted.greaterThan(h.amount) ? h.amount : converted;
      if (local.lessThanOrEqualTo(0)) continue;
      await this.pair(tx, {
        accountId: h.accountId,
        currency: h.currency,
        sellerId: input.sellerId,
        fromSeller: local,
        walletEntryId: input.reference,
        note:
          `${input.note} — ${local.toFixed(2)} ${h.currency} for ₹${takeInr.toFixed(2)}, ` +
          (h.rate.source === 'TOPUP'
            ? `at the rate their top-up here was credited at (₹${h.rate.inr.toFixed(2)} for ` +
              `${h.rate.local.toFixed(2)} ${h.currency})`
            : "at today's rate — no accepted top-up into this account to take a rate from"),
      });
      remaining = remaining.sub(takeInr);
    }
    return input.amount.sub(remaining);
  }

  /** Every positive holding, per account, with its rupee value when `value`. */
  private async holdings(tx: TxClient, sellerId: string, value = true): Promise<Holding[]> {
    const grouped = await tx.bankEntry.groupBy({
      by: ['accountId', 'currency'],
      where: {
        sellerId,
        ownerKind: BankOwnerKind.SELLER,
        // Never reclassify into a retired account — see heldBySeller.
        account: { deletedAt: null },
      },
      _sum: { signedAmount: true },
    });
    const out: Holding[] = [];
    for (const g of grouped) {
      const amount = g._sum.signedAmount ?? ZERO;
      if (amount.lessThanOrEqualTo(0)) continue;
      if (g.currency === Currency.INR) {
        out.push({
          accountId: g.accountId,
          currency: g.currency,
          amount,
          rate: null,
          inrValue: amount,
        });
        continue;
      }
      const rate = value ? await this.rateToInr(tx, sellerId, g.accountId, g.currency) : null;
      out.push({
        accountId: g.accountId,
        currency: g.currency,
        amount,
        rate,
        inrValue: rate === null ? ZERO : amount.mul(rate.inr).div(rate.local).toDecimalPlaces(2),
      });
    }
    return out;
  }

  /** The wallet's balance as of its last entry (WAL-7). */
  private async walletBalance(
    tx: TxClient,
    sellerId: string,
    currency: Currency,
  ): Promise<Prisma.Decimal> {
    const last = await tx.sellerWalletEntry.findFirst({
      where: { sellerId, currency },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? ZERO;
  }

  /**
   * Two entries, never one.
   *
   * The cash does not leave the account, so a single entry would change
   * the account's total and make it disagree with the statement. What
   * changes is whose it is, which is two rows summing to zero.
   *
   * Both go through `BankLedgerService.post()` rather than an INSERT of
   * their own. That is TRE-1 and it is not ceremony: post() is where the
   * account is checked for existence and soft-deletion, where the
   * currency is checked against the account, and where a capital row
   * carrying a seller is refused. A direct write inherits none of it,
   * and the first thing it would let through is cash posted into a
   * retired account — money that then vanishes from every balance the
   * page shows.
   */
  private async pair(
    tx: TxClient,
    input: {
      accountId: string;
      currency: Currency;
      sellerId: string;
      /** Positive: leaving the seller's pot. Negative: entering it. */
      fromSeller: Prisma.Decimal;
      walletEntryId: string;
      note: string;
    },
  ): Promise<void> {
    const base = {
      accountId: input.accountId,
      type: BankEntryType.RECLASSIFICATION,
      amountCurrency: input.currency,
      occurredAt: new Date(),
      reference: input.walletEntryId,
      note: input.note,
    } as const;

    await this.ledger.post(
      {
        ...base,
        signedAmount: input.fromSeller.neg(),
        owner: { kind: BankOwnerKind.SELLER, sellerId: input.sellerId },
      },
      tx,
    );
    await this.ledger.post(
      { ...base, signedAmount: input.fromSeller, owner: { kind: BankOwnerKind.CAPITAL } },
      tx,
    );
  }

  /** What this seller holds, and the account holding most of it. */
  private async heldBySeller(
    tx: TxClient,
    sellerId: string,
    currency: Currency,
  ): Promise<{ total: Prisma.Decimal; accountId: string | null }> {
    const grouped = await tx.bankEntry.groupBy({
      by: ['accountId'],
      where: {
        sellerId,
        currency,
        ownerKind: BankOwnerKind.SELLER,
        // Never reclassify into a retired account. `post()` would refuse
        // it and take the whole wallet write down with it, which would
        // block a charge over a bookkeeping decision made months ago.
        // Excluded here instead, so the charge lands as a receivable —
        // conservative, and the seller is not stopped from trading.
        account: { deletedAt: null },
      },
      _sum: { signedAmount: true },
    });

    let total = ZERO;
    let best: { id: string; amount: Prisma.Decimal } | null = null;
    for (const g of grouped) {
      const amount = g._sum.signedAmount ?? ZERO;
      total = total.add(amount);
      if (amount.greaterThan(0) && (best === null || amount.greaterThan(best.amount))) {
        best = { id: g.accountId, amount };
      }
    }
    return { total: total.lessThan(0) ? ZERO : total, accountId: best?.id ?? null };
  }

  private async anyAccount(tx: TxClient, currency: Currency): Promise<string | null> {
    const a = await tx.platformBankAccount.findFirst({
      where: { currency, deletedAt: null, isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true },
    });
    return a?.id ?? null;
  }
}
