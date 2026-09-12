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

type TxClient = Prisma.TransactionClient;

/** Which way the CASH behind a wallet movement changes hands. */
type Reclassification = 'TO_CAPITAL' | 'TO_SELLER' | 'NONE';

/**
 * What one unit of a seller's holding in an account is worth in rupees.
 * `TOPUP`: the rate of the latest accepted top-up into that account — the
 * rate their wallet was credited at, so valuing the holding at it keeps
 * the book equal to the wallet. `CURRENT`: no top-up has ever landed
 * there, so today's rate is the only figure there is.
 */
export interface InrRate {
  readonly rate: Prisma.Decimal;
  readonly source: 'INR' | 'TOPUP' | 'CURRENT';
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
    },
  ): Promise<void> {
    const which = this.direction(input.direction);
    if (which === 'NONE') return;

    if (which === 'TO_CAPITAL') {
      // Clamped. Charging ₹200 to a seller holding ₹50 makes ₹50 ours
      // and leaves ₹150 as a receivable — there is no third ₹150 in any
      // account to move, and writing one would be inventing cash. "What
      // they hold" is EVERY account, taka included: a seller whose rupees
      // have run out but who topped up in taka still holds that money,
      // and stopping at the rupees left it "theirs" while their wallet
      // said it was spent.
      await this.takeToCapital(tx, {
        sellerId: input.sellerId,
        currency: input.currency,
        amount: input.amount,
        reference: input.walletEntryId,
        note: 'Charged — cash now ours',
      });
      return;
    }

    // TO_SELLER: a refund. Only the part that lifts the balance ABOVE zero
    // is cash of theirs again. A seller in debt is owed nothing until the
    // debt is cleared — the refund repays it first, and the cash repaying
    // a receivable is ours (TRE-8). Handing all of it back held them money
    // their wallet does not show. The entry this follows is already
    // written, under the wallet lock, so its running balance is `after`.
    const last = await tx.sellerWalletEntry.findFirst({
      where: { sellerId: input.sellerId, currency: input.currency },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    const after = last?.runningBalanceAfter ?? input.amount;
    const before = after.sub(input.amount);
    const movable = positive(after).sub(positive(before));
    if (movable.lessThanOrEqualTo(0)) return;
    // Land it where their money already is; failing that, the account we
    // most recently used for them. If neither exists there is no bank book
    // for this seller yet and the wallet credit stands alone until one is
    // reconciled.
    const held = await this.heldBySeller(tx, input.sellerId, input.currency);
    const accountId = held.accountId ?? (await this.anyAccount(tx, input.currency));
    if (accountId === null) return;
    await this.pair(tx, {
      accountId,
      currency: input.currency,
      sellerId: input.sellerId,
      fromSeller: movable.neg(),
      walletEntryId: input.walletEntryId,
      note: movable.lessThan(input.amount)
        ? `Refunded — ${movable.toFixed(2)} of ${input.amount.toFixed(2)} is theirs again; the rest repaid their debt`
        : 'Refunded — cash theirs again',
    });
  }

  /**
   * Make up to `amount` of the seller's cash ours, wherever they hold it,
   * and return how much (in `currency`) actually moved. Never more than
   * they hold: the rest is a receivable, not cash.
   *
   * Same-currency holdings first, the largest first. For a rupee amount it
   * then continues into their other currencies, each converted at the rate
   * their wallet was credited at when that money landed (`inrPerUnit`) —
   * valued any other way, the book and the wallet stop agreeing the moment
   * the market moves.
   */
  async takeToCapital(
    tx: TxClient,
    input: {
      sellerId: string;
      amount: Prisma.Decimal;
      reference: string;
      note: string;
      currency?: Currency;
    },
  ): Promise<Prisma.Decimal> {
    const currency = input.currency ?? Currency.INR;
    if (input.amount.lessThanOrEqualTo(0)) return ZERO;
    const holdings = await this.holdings(tx, input.sellerId);
    let remaining = input.amount;

    for (const h of holdings.filter((x) => x.currency === currency)) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const take = h.amount.lessThan(remaining) ? h.amount : remaining;
      await this.pair(tx, {
        accountId: h.accountId,
        currency,
        sellerId: input.sellerId,
        fromSeller: take,
        walletEntryId: input.reference,
        note: input.note,
      });
      remaining = remaining.sub(take);
    }

    // Other currencies are valued in rupees; a non-rupee amount has no
    // such anchor, so it stays within its own currency.
    if (currency === Currency.INR) {
      for (const h of holdings.filter((x) => x.currency !== Currency.INR)) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const r = await this.inrPerUnit(tx, input.sellerId, h.accountId, h.currency);
        if (r === null || r.rate.lessThanOrEqualTo(0)) continue;
        const value = h.amount.mul(r.rate);
        let units: Prisma.Decimal;
        let moved: Prisma.Decimal;
        if (value.lessThanOrEqualTo(remaining)) {
          units = h.amount;
          moved = value;
        } else {
          units = remaining.div(r.rate).toDecimalPlaces(2);
          if (units.greaterThan(h.amount)) units = h.amount;
          moved = remaining;
        }
        if (units.lessThanOrEqualTo(0)) continue;
        await this.pair(tx, {
          accountId: h.accountId,
          currency: h.currency,
          sellerId: input.sellerId,
          fromSeller: units,
          walletEntryId: input.reference,
          note:
            `${input.note} — ${units.toFixed(2)} ${h.currency} at ₹${r.rate.toDecimalPlaces(6).toString()} ` +
            (r.source === 'TOPUP'
              ? '(the rate of their last top-up into this account)'
              : '(today’s rate — no top-up has landed in this account)'),
        });
        remaining = remaining.sub(moved);
      }
    }
    return input.amount.sub(remaining.lessThan(0) ? ZERO : remaining);
  }

  /**
   * What one unit of this seller's money in `accountId` is worth in rupees.
   *
   * The rate of the latest ACCEPTED top-up into that account (rupees
   * credited ÷ what arrived), because that is the rate their wallet
   * recorded the money at. Only when none has ever landed there, today's
   * rate. Null when there is neither — the holding cannot be valued, and
   * is left alone rather than guessed at.
   */
  async inrPerUnit(
    tx: TxClient,
    sellerId: string,
    accountId: string,
    currency: Currency,
  ): Promise<InrRate | null> {
    if (currency === Currency.INR) return { rate: ONE, source: 'INR' };
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
    if (topup && credited !== null && topup.amount.greaterThan(0) && credited.greaterThan(0)) {
      return { rate: credited.div(topup.amount), source: 'TOPUP' };
    }
    const fx = await tx.fxRate.findFirst({
      where: {
        OR: [
          { fromCurrency: currency, toCurrency: Currency.INR },
          { fromCurrency: Currency.INR, toCurrency: currency },
        ],
      },
      select: { fromCurrency: true, rate: true },
    });
    if (!fx || fx.rate.lessThanOrEqualTo(0)) return null;
    // "1 fromCurrency = rate toCurrency".
    return { rate: fx.fromCurrency === currency ? fx.rate : ONE.div(fx.rate), source: 'CURRENT' };
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
   * How much of cash arriving for a seller REPAYS what they owe us.
   *
   * A charge taken while a seller held nothing wrote no bank entry — the
   * debt was a receivable (TRE-8). When their cash later arrives (a COD
   * payout, a top-up), the part of it that settles that debt is ours: it
   * repays the receivable. Posting all of it as theirs held them money
   * their wallet does not show. Read against the balance BEFORE the
   * credit this cash backs, under the wallet lock (re-entrant within the
   * transaction) so no concurrent write can move it underneath.
   */
  async debtSplit(
    tx: TxClient,
    sellerId: string,
    amount: Prisma.Decimal,
  ): Promise<{ toCapital: Prisma.Decimal; toSeller: Prisma.Decimal }> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);
    const last = await tx.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    const balance = last?.runningBalanceAfter ?? ZERO;
    const debt = balance.lessThan(0) ? balance.neg() : ZERO;
    const toCapital = debt.lessThan(amount) ? debt : amount;
    return { toCapital, toSeller: amount.sub(toCapital) };
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

  /** Every positive holding the seller has, in any currency, largest first. */
  private async holdings(
    tx: TxClient,
    sellerId: string,
  ): Promise<Array<{ accountId: string; currency: Currency; amount: Prisma.Decimal }>> {
    const grouped = await tx.bankEntry.groupBy({
      by: ['accountId', 'currency'],
      where: {
        sellerId,
        ownerKind: BankOwnerKind.SELLER,
        // Never a retired account — see heldBySeller.
        account: { deletedAt: null },
      },
      _sum: { signedAmount: true },
    });
    return grouped
      .map((g) => ({
        accountId: g.accountId,
        currency: g.currency,
        amount: g._sum.signedAmount ?? ZERO,
      }))
      .filter((h) => h.amount.greaterThan(0))
      .sort((a, b) => b.amount.comparedTo(a.amount));
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

function positive(v: Prisma.Decimal): Prisma.Decimal {
  return v.lessThan(0) ? ZERO : v;
}
