import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

/**
 * Phase 1B M21 — the wallet primitive.
 *
 * **W-2: WalletService.applyEntry IS the sole writer of
 * seller_wallet_entries** (mirrors INV-1 for stock). Every credit /
 * debit goes through here. The signature takes a transaction client
 * so callers can compose into their own tx (e.g. M22's COD-accrual
 * listener writes BOTH a CREDIT and a DEBIT in one Prisma.$transaction).
 *
 * **W-3: Balance is COMPUTED from the ledger, never stored
 * authoritatively.** The seller_wallet_balances row is a CACHE
 * (recomputed post-commit via `recomputeCacheAfterCommit`); the
 * authoritative balance is `SUM(direction-signed amount)` over the
 * append-only ledger. The cache lets `/seller/wallet` render in O(1)
 * instead of O(ledger).
 *
 * **W-4: Per-currency wallets.** Each (sellerId, currency) is its
 * own running balance. Cross-border remittance writes TWO paired
 * entries — a REMITTANCE_OUT on the source currency and a
 * REMITTANCE_FX on the destination — so both ledgers conserve under
 * the FX rate snapshot.
 *
 * **No negative-balance enforcement at the writer level.** A
 * remittance that would push the wallet negative is caught at the
 * REMITTANCE_OUT caller (RemittanceService) BEFORE the entry is
 * written. The wallet primitive itself allows ADJUSTMENT_DEBIT into
 * negative territory deliberately — that's the operator's emergency
 * tool when reconciliation finds a missing credit; the negative
 * surface is what makes the corruption visible.
 */

type TxClient = Prisma.TransactionClient;

export interface ApplyEntryInput {
  readonly sellerId: string;
  readonly currency: Currency;
  readonly direction: WalletEntryDirection;
  /** Always positive — `direction` encodes the sign. */
  readonly amount: Prisma.Decimal;
  readonly linkedOrderId?: string | null;
  readonly linkedRemittanceId?: string | null;
  /** Required when direction is ADJUSTMENT_* (pointing at the
   *  original entry being corrected). */
  readonly linkedEntryId?: string | null;
  readonly reasonCode?: string | null;
  readonly note?: string | null;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly fxRateSnapshot?: Prisma.Decimal | null;
}

export interface AppliedEntry {
  readonly id: string;
  readonly runningBalanceAfter: Prisma.Decimal;
}

/** Directions that ADD to the wallet. Anything not listed here is
 *  treated as a DEBIT, so forgetting to register a new credit direction
 *  would silently take money FROM the seller — add new credits here in
 *  the same change that adds the enum value. */
const CREDIT_DIRECTIONS: ReadonlySet<WalletEntryDirection> = new Set([
  WalletEntryDirection.COD_COLLECTION,
  WalletEntryDirection.REMITTANCE_FX,
  WalletEntryDirection.ADJUSTMENT_CREDIT,
  WalletEntryDirection.OPENING_BALANCE,
  // R7 — damage/loss ticket settled in the seller's favour.
  WalletEntryDirection.SCRAP_REFUND,
  // A seller wiring money in, verified against the bank by an operator.
  // Omitting it here would take the top-up back OUT of the wallet it was
  // meant to fill.
  WalletEntryDirection.TOPUP,
  // Giving the delivery fee back on an order cancelled before it
  // shipped. Omitting it here would charge the seller a SECOND time for
  // a parcel that never moved.
  WalletEntryDirection.ORDER_CHARGES_REFUND,
]);

function isCredit(d: WalletEntryDirection): boolean {
  return CREDIT_DIRECTIONS.has(d);
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * W-2: sole writer. Computes the post-entry running balance + writes
   * one row. Caller composes into their own tx; this method takes
   * `tx` as the first arg so it CANNOT be called outside a Prisma
   * transaction (the type system enforces it).
   */
  async applyEntry(tx: TxClient, input: ApplyEntryInput): Promise<AppliedEntry> {
    if (input.amount.lte(0)) {
      throw new Error(`WALLET_INVALID_AMOUNT: amount must be > 0`);
    }
    if (
      (input.direction === WalletEntryDirection.ADJUSTMENT_CREDIT ||
        input.direction === WalletEntryDirection.ADJUSTMENT_DEBIT) &&
      !input.reasonCode
    ) {
      throw new Error(`WALLET_REASON_REQUIRED: reasonCode required on ADJUSTMENT_*`);
    }

    // ── Serialize every write to THIS wallet ──────────────────────────
    // Read-then-write under READ COMMITTED is not a guard. Two
    // concurrent credits — two parcels for one seller delivering at the
    // same moment, a top-up landing while an accrual sweeps — both read
    // the same balance and both stamp the SAME runningBalanceAfter. The
    // statement then stops adding up, and because the ledger is
    // append-only the error is permanent: there is no row to correct,
    // only an adjusting entry that makes the history stranger.
    //
    // A transaction-scoped advisory lock is the same instrument the
    // manifest find-or-create (WMS-7) and order numbering (ORD-8) use.
    // It is released on commit or rollback, so a failure cannot wedge a
    // seller's wallet.
    await this.lockWallet(tx, input.sellerId, input.currency);

    // With the lock held, the LAST ENTRY's running balance is the
    // current balance — that column is what the ledger exists to carry.
    // Reading it is one indexed row instead of the whole history: the
    // previous implementation fetched EVERY entry for the seller into
    // Node and summed them in JS, on every single money write, inside
    // the transaction. At a few hundred entries that is invisible; at
    // six figures it is a self-inflicted outage on the money path.
    const current = await this.latestRunningBalance(tx, input.sellerId, input.currency);

    const signedDelta = isCredit(input.direction) ? input.amount : input.amount.neg();
    const next = current.add(signedDelta);

    const created = await tx.sellerWalletEntry.create({
      data: {
        sellerId: input.sellerId,
        currency: input.currency,
        direction: input.direction,
        amount: input.amount,
        runningBalanceAfter: next,
        linkedOrderId: input.linkedOrderId ?? null,
        linkedRemittanceId: input.linkedRemittanceId ?? null,
        linkedEntryId: input.linkedEntryId ?? null,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        fxRateSnapshot: input.fxRateSnapshot ?? null,
      },
      select: { id: true, runningBalanceAfter: true },
    });

    return { id: created.id, runningBalanceAfter: created.runningBalanceAfter };
  }

  /**
   * Serialize writes to one (seller, currency) wallet.
   *
   * `pg_advisory_xact_lock` takes two 32-bit keys: a namespace so
   * wallet locks cannot collide with the manifest (0x04d47) or order
   * numbering (0x04d46) locks, and an FNV-1a hash of the wallet's
   * identity. Held to commit-or-rollback, so a crash mid-write releases
   * it rather than freezing a seller's money.
   *
   * A hash collision between two DIFFERENT wallets costs one of them a
   * brief wait — it can never produce a wrong balance, because the lock
   * is a mutex and not an identity.
   */
  private async lockWallet(tx: TxClient, sellerId: string, currency: Currency): Promise<void> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${currency}`);
  }

  /**
   * The balance as of the last entry — O(1), and the ledger's own
   * account of itself rather than a cache to be trusted.
   *
   * Ordered by `id` DESC: ids are uuidv7, so they are monotonic, and
   * unlike `createdAt` they break ties. Postgres fixes
   * `CURRENT_TIMESTAMP` for the whole transaction, so two entries
   * written together — the COD credit and the charges debit that pair
   * on delivery — carry the SAME createdAt, and ordering on it alone
   * would pick between them arbitrarily.
   */
  private async latestRunningBalance(
    tx: TxClient,
    sellerId: string,
    currency: Currency,
  ): Promise<Prisma.Decimal> {
    const last = await tx.sellerWalletEntry.findFirst({
      where: { sellerId, currency },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? new Prisma.Decimal(0);
  }

  /**
   * W-3: authoritative balance, summed across the whole ledger.
   *
   * This is the VERIFICATION path, not the hot path — `applyEntry`
   * reads the last entry's running balance instead. Kept because
   * re-deriving the total from the entries themselves is the only way
   * to catch a running balance that has gone wrong; a system that only
   * ever reads its own last answer cannot notice it was mistaken.
   *
   * Summed in SQL. It used to pull every row for the seller into Node
   * and add them up in a loop, which made the cost of asking "what is
   * my balance" grow with how long the seller had been trading.
   */
  async balanceLive(sellerId: string, currency: Currency, tx?: TxClient): Promise<Prisma.Decimal> {
    const client = tx ?? this.prisma.client;
    const credits = [...CREDIT_DIRECTIONS];
    // Sequential rather than Promise.all: an interactive Prisma
    // transaction runs one statement at a time, and issuing two
    // concurrently against the same tx client is undefined behaviour.
    const credited = await client.sellerWalletEntry.aggregate({
      _sum: { amount: true },
      where: { sellerId, currency, direction: { in: credits } },
    });
    const debited = await client.sellerWalletEntry.aggregate({
      _sum: { amount: true },
      where: { sellerId, currency, direction: { notIn: credits } },
    });
    return (credited._sum.amount ?? new Prisma.Decimal(0)).sub(
      debited._sum.amount ?? new Prisma.Decimal(0),
    );
  }

  /**
   * Cached balance for display paths. Falls back to live if the cache
   * row doesn't exist yet (new wallet).
   */
  async balanceCached(sellerId: string, currency: Currency): Promise<Prisma.Decimal> {
    const cached = await this.prisma.client.sellerWalletBalance.findUnique({
      where: { sellerId_currency: { sellerId, currency } },
      select: { balance: true },
    });
    if (cached) return cached.balance;
    return this.balanceLive(sellerId, currency);
  }

  /**
   * Cache recompute — call POST-COMMIT (mirrors INV-5 for stock).
   * Reads the freshly-committed ledger and upserts the cache row.
   * Best-effort: a failure here is logged but never throws — the
   * cache will catch up on the next applyEntry's post-commit hook
   * or a manual reconciler.
   */
  async recomputeCacheAfterCommit(
    sellerId: string,
    currency: Currency,
    lastEntryId: string,
  ): Promise<void> {
    try {
      const balance = await this.balanceLive(sellerId, currency);
      await this.prisma.client.sellerWalletBalance.upsert({
        where: { sellerId_currency: { sellerId, currency } },
        create: {
          sellerId,
          currency,
          balance,
          lastEntryId,
        },
        update: { balance, lastEntryId },
      });
    } catch (e) {
      this.logger.error(
        { sellerId, currency, err: (e as Error).message },
        'Wallet balance cache recompute failed; cache lag possible',
      );
    }
  }
}
