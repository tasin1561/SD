import { Injectable } from '@nestjs/common';
import { BankEntryType, BankOwnerKind, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { BankLedgerService } from './bank-ledger.service';

const ZERO = new Prisma.Decimal(0);

type TxClient = Prisma.TransactionClient;

/** Which way the CASH behind a wallet movement changes hands. */
type Reclassification = 'TO_CAPITAL' | 'TO_SELLER' | 'NONE';

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
      case WalletEntryDirection.ORDER_CHARGES:
      case WalletEntryDirection.RTO_FEE:
      case WalletEntryDirection.CUSTOMER_RETURN_FEE:
      case WalletEntryDirection.INBOUND_FREIGHT:
      case WalletEntryDirection.INSTANT_PAY_FEE:
      case WalletEntryDirection.COD_COLLECTION_FEE:
        return 'TO_CAPITAL';

      // Giving it back. The cash was ours; now it is theirs again.
      case WalletEntryDirection.ORDER_CHARGES_REFUND:
      case WalletEntryDirection.SCRAP_REFUND:
        return 'TO_SELLER';

      // Real cash crossing the bank, posted by the flow that moved it.
      // Reclassifying here as well would double-count the movement.
      case WalletEntryDirection.TOPUP:
      case WalletEntryDirection.COD_COLLECTION:
      case WalletEntryDirection.REMITTANCE_OUT:
      case WalletEntryDirection.REMITTANCE_FX:
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
      const held = await this.heldBySeller(tx, input.sellerId, input.currency);
      // Clamped. Charging ₹200 to a seller holding ₹50 makes ₹50 ours
      // and leaves ₹150 as a receivable — there is no third ₹150 in any
      // account to move, and writing one would be inventing cash.
      const movable = held.total.lessThan(input.amount) ? held.total : input.amount;
      if (movable.lessThanOrEqualTo(0) || held.accountId === null) return;
      await this.pair(tx, {
        accountId: held.accountId,
        currency: input.currency,
        sellerId: input.sellerId,
        fromSeller: movable,
        walletEntryId: input.walletEntryId,
        note: 'Charged — cash now ours',
      });
      return;
    }

    // TO_SELLER: a refund. Land it where their money already is; failing
    // that, the account we most recently used for them. If neither
    // exists there is no bank book for this seller yet and the wallet
    // credit stands alone until one is reconciled.
    const held = await this.heldBySeller(tx, input.sellerId, input.currency);
    const accountId = held.accountId ?? (await this.anyAccount(tx, input.currency));
    if (accountId === null) return;
    await this.pair(tx, {
      accountId,
      currency: input.currency,
      sellerId: input.sellerId,
      fromSeller: input.amount.neg(),
      walletEntryId: input.walletEntryId,
      note: 'Refunded — cash theirs again',
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

  private async anyAccount(tx: TxClient, currency: Currency): Promise<string | null> {
    const a = await tx.platformBankAccount.findFirst({
      where: { currency, deletedAt: null, isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true },
    });
    return a?.id ?? null;
  }
}
