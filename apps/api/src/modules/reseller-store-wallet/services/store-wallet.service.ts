import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  Prisma,
  ResellerStoreStatus,
  ResellerWalletManager,
  SellerStoreKind,
  StoreWalletEntryDirection,
  TopupRequestStatus,
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import {
  storeWalletBalance,
  storeWalletBalances,
  storeWithdrawalsHeld,
} from '../../treasury/services/store-wallet-balances';

type TxClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/** Skydrop's cap on how far below zero a seller may let one store go (SET-1). */
export const NEGATIVE_LIMIT_CAP_KEY = 'reseller.store_negative_limit_cap_inr';

/**
 * Directions that ADD to a store wallet. Anything not listed here is a
 * DEBIT, so forgetting a new credit would silently take money FROM the
 * store — add it here in the same change that adds the enum value, AND to
 * `isStoreWalletCredit` in @skydrop/ui/status. `store-wallet-directions.spec`
 * compares the two as whole sets in both directions (WAL-1, for stores).
 */
export const STORE_CREDIT_DIRECTIONS: ReadonlySet<StoreWalletEntryDirection> = new Set([
  // The seller moving their own money in (seller-managed).
  StoreWalletEntryDirection.SELLER_TOPUP,
  // The store's own money, seen arriving in our bank (Skydrop-managed).
  StoreWalletEntryDirection.TOPUP,
  // Phase 3b — a COD order's store margin.
  StoreWalletEntryDirection.ORDER_CREDIT,
  // Phase 3b — a fee or tax share given back.
  StoreWalletEntryDirection.SHARE_REFUND,
  // Phase 3b — a prepaid order's debit given back on a cancel.
  StoreWalletEntryDirection.PREPAID_REFUND,
]);

export interface ApplyStoreEntryInput {
  readonly storeId: string;
  /** The store's seller — checked against the store, never trusted. */
  readonly sellerId: string;
  readonly direction: StoreWalletEntryDirection;
  /** Always positive — `direction` carries the sign. */
  readonly amount: Prisma.Decimal;
  /** FEE_SHARE / SHARE_REFUND: which Skydrop fee this is a share of. */
  readonly shareOf?: WalletEntryDirection | null;
  readonly linkedOrderId?: string | null;
  readonly linkedEntryId?: string | null;
  readonly linkedSellerEntryId?: string | null;
  readonly reasonCode?: string | null;
  readonly note?: string | null;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly idempotencyKey?: string | null;
}

export interface AppliedStoreEntry {
  readonly id: string;
  readonly runningBalanceAfter: Prisma.Decimal;
}

export interface StoreNegativeLimit {
  /** What the seller set (0 when they have not). */
  readonly ownInr: string;
  /** Skydrop's cap for this seller. */
  readonly capInr: string;
  /** The lower of the two — what order create enforces. */
  readonly effectiveInr: string;
}

export interface StoreWalletSummary {
  readonly storeId: string;
  readonly storeName: string;
  readonly displayName: string | null;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly status: ResellerStoreStatus | null;
  readonly walletManagedBy: ResellerWalletManager | null;
  readonly balanceInr: string;
  /** What the store may withdraw now; null when the SELLER manages the wallet. */
  readonly withdrawableInr: string | null;
  readonly negativeLimit: StoreNegativeLimit;
  readonly pendingTopups: { readonly count: number; readonly amountInr: string };
  readonly pendingWithdrawals: { readonly count: number; readonly amountInr: string };
}

export interface StoreWalletEntryView {
  readonly id: string;
  readonly direction: StoreWalletEntryDirection;
  readonly amountInr: string;
  readonly runningBalanceAfterInr: string;
  readonly shareOf: WalletEntryDirection | null;
  readonly linkedOrderId: string | null;
  readonly note: string | null;
  readonly actorType: ActorType;
  readonly createdAt: string;
}

export interface StoreWalletLedger {
  readonly items: readonly StoreWalletEntryView[];
  /** Pass back as `before` for the next (older) page; null at the start. */
  readonly nextCursor: string | null;
}

export interface StoreCanSpend {
  readonly allowed: boolean;
  readonly balanceInr: string;
  readonly afterInr: string;
  /** How far below zero this store may go — the effective limit. */
  readonly limitInr: string;
}

export interface StoreWithdrawable {
  readonly withdrawable: Prisma.Decimal;
  /** The store's balance less what it has already asked for. */
  readonly ownFree: Prisma.Decimal;
  /** The seller's group — wallet + every store — less every open request. */
  readonly groupFree: Prisma.Decimal;
}

/** The store as the wallet needs it. */
export interface WalletStore {
  readonly id: string;
  readonly sellerId: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus | null;
  readonly walletManagedBy: ResellerWalletManager | null;
  readonly sellerCompanyName: string;
}

const STORE_SELECT = {
  id: true,
  sellerId: true,
  name: true,
  displayName: true,
  status: true,
  walletManagedBy: true,
  seller: { select: { companyName: true } },
} as const;

/**
 * RS-6 — a reseller store's wallet: the ledger between a seller and one of
 * their stores.
 *
 * ── THE ONE WRITER ───────────────────────────────────────────────────
 * `applyEntry` is the sole writer of `store_wallet_entries` (WAL-1 / W-2,
 * for stores). It takes the SELLER's WALLET advisory lock — the same
 * `<sellerId>|INR` key the seller's own wallet takes — so the seller and
 * every one of their stores are serialised together. That is what makes
 * the combined balance the bank invariant reads consistent: nothing can
 * move a store while a seller-side write is deciding from the group.
 *
 * The balance is the LAST entry's running balance, read under that lock —
 * never a re-sum (WAL-7).
 *
 * ── THE CASH IS THE SELLER'S (decision 7) ────────────────────────────
 * After writing, it hands the entry to `SellerCashAttributionService.
 * applyStore`, in the same transaction: a store's fee share makes the
 * seller's held cash ours, a store's refund makes it theirs again, both
 * judged against the combined balance. The invariant it keeps:
 *   held for a seller = max(0, seller wallet + Σ that seller's store wallets).
 */
@Injectable()
export class StoreWalletService {
  private readonly logger = new Logger(StoreWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: SellerCashAttributionService,
    private readonly settings: SettingsResolverService,
    private readonly audit: AuditLogService,
  ) {}

  // ── The writer ─────────────────────────────────────────────────────

  async applyEntry(tx: TxClient, input: ApplyStoreEntryInput): Promise<AppliedStoreEntry> {
    if (input.amount.lessThanOrEqualTo(0)) {
      throw new Error('STORE_WALLET_INVALID_AMOUNT: amount must be > 0');
    }
    if (!input.amount.equals(input.amount.toDecimalPlaces(2))) {
      throw new Error('STORE_WALLET_INVALID_AMOUNT: at most two decimals');
    }
    if (
      (input.direction === StoreWalletEntryDirection.FEE_SHARE ||
        input.direction === StoreWalletEntryDirection.SHARE_REFUND) &&
      (input.shareOf ?? null) === null &&
      (input.direction === StoreWalletEntryDirection.FEE_SHARE ||
        (input.linkedEntryId ?? null) === null)
    ) {
      // A fee share names its fee; a refund of one names it or the entry
      // it returns. Without it "what did this store pay us for delivery"
      // stops being answerable from the ledger.
      throw new Error('STORE_WALLET_SHARE_OF_REQUIRED: a fee share names the fee it is a share of');
    }

    // ── Serialise with the seller and all of their stores ────────────
    await this.lockSeller(tx, input.sellerId);

    // The store must be this seller's reseller store. Read AFTER the lock,
    // from the row, never from the caller: a mismatched pair would put one
    // seller's cash behind another's store.
    const store = await tx.sellerStore.findFirst({
      where: { id: input.storeId, sellerId: input.sellerId, kind: SellerStoreKind.RESELLER },
      select: { id: true },
    });
    if (store === null) {
      throw new Error(
        `STORE_WALLET_STORE_MISMATCH: store ${input.storeId} is not a reseller store of seller ${input.sellerId}`,
      );
    }

    const current = await storeWalletBalance(tx, input.storeId);
    const signed = STORE_CREDIT_DIRECTIONS.has(input.direction) ? input.amount : input.amount.neg();
    const created = await tx.storeWalletEntry.create({
      data: {
        storeId: input.storeId,
        sellerId: input.sellerId,
        direction: input.direction,
        amount: input.amount,
        runningBalanceAfter: current.add(signed),
        shareOf: input.shareOf ?? null,
        linkedOrderId: input.linkedOrderId ?? null,
        linkedEntryId: input.linkedEntryId ?? null,
        linkedSellerEntryId: input.linkedSellerEntryId ?? null,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true, runningBalanceAfter: true },
    });

    // The seller's cash behind it, in THIS transaction (TRE-3).
    await this.attribution.applyStore(tx, {
      sellerId: input.sellerId,
      direction: input.direction,
      amount: input.amount,
      storeEntryId: created.id,
    });
    return created;
  }

  /** The seller's WALLET lock — the one every store wallet write takes. Re-entrant. */
  async lockSeller(tx: TxClient, sellerId: string): Promise<void> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);
  }

  // ── Decisions (callers hold the seller's WALLET lock) ──────────────

  /**
   * May this store spend `amount` now — would its balance stay at or above
   * minus its negative limit?
   *
   * CONTRACT (phase 3b's order create): call it INSIDE the transaction that
   * will write the debit, and write the debit in that same transaction. It
   * takes the seller's WALLET lock itself (re-entrant), so from this read to
   * the commit no other writer can move this store, the seller or any of
   * the seller's stores — the check and the write cannot be separated. Read
   * outside such a transaction its answer is already stale.
   */
  async storeCanSpend(
    tx: TxClient,
    input: { storeId: string; sellerId: string; amount: Prisma.Decimal },
  ): Promise<StoreCanSpend> {
    await this.lockSeller(tx, input.sellerId);
    const balance = await storeWalletBalance(tx, input.storeId);
    const limit = await this.negativeLimit(tx, input.storeId, input.sellerId);
    const effective = new Prisma.Decimal(limit.effectiveInr);
    const after = balance.sub(input.amount);
    return {
      allowed: after.greaterThanOrEqualTo(effective.neg()),
      balanceInr: balance.toFixed(2),
      afterInr: after.toFixed(2),
      limitInr: effective.toFixed(2),
    };
  }

  /**
   * What a SKYDROP-managed store may withdraw: the lower of
   *   - its balance less what it has already asked for (PENDING and
   *     APPROVED, WAL-3's amended rule), and
   *   - the seller's GROUP less every open request in it — the seller's
   *     wallet plus every store's, less the seller's and the stores'
   *     requests.
   * The second is the part that keeps us from funding a payout: a store
   * owed money while its seller (or a sibling store) is in debt holds a
   * claim on the seller, not on cash we hold for them. No minimum balance
   * (there is no reason for one on a store: nothing charges it unasked).
   * Takes the seller's WALLET lock (re-entrant).
   */
  async storeWithdrawable(
    tx: TxClient,
    input: { storeId: string; sellerId: string; excludeRequestId?: string },
  ): Promise<StoreWithdrawable> {
    await this.lockSeller(tx, input.sellerId);
    const sellerBalance = await this.attribution.walletBalance(tx, input.sellerId);
    const stores = await storeWalletBalances(tx, input.sellerId);
    const held = await storeWithdrawalsHeld(tx, input.sellerId, input.excludeRequestId);
    const sellerHeld = await tx.withdrawalRequest.aggregate({
      where: {
        sellerId: input.sellerId,
        currency: Currency.INR,
        status: { in: [WithdrawalRequestStatus.PENDING, WithdrawalRequestStatus.APPROVED] },
      },
      _sum: { amountRequested: true },
    });
    const storesTotal = stores.reduce((t, s) => t.add(s.balance), ZERO);
    const heldTotal = [...held.values()].reduce((t, v) => t.add(v), ZERO);
    const mine = stores.find((s) => s.storeId === input.storeId)?.balance ?? ZERO;
    const ownFree = mine.sub(held.get(input.storeId) ?? ZERO);
    const groupFree = sellerBalance
      .add(storesTotal)
      .sub(sellerHeld._sum.amountRequested ?? ZERO)
      .sub(heldTotal);
    const lower = ownFree.lessThan(groupFree) ? ownFree : groupFree;
    return { withdrawable: lower.lessThan(0) ? ZERO : lower, ownFree, groupFree };
  }

  /**
   * How far below zero a store may go: what the seller set, capped by
   * Skydrop's `reseller.store_negative_limit_cap_inr` for that seller.
   * A cap that cannot be read counts as 0 — FAILS CLOSED: a store not
   * going negative is the safe side of a settings outage on a money path.
   */
  async negativeLimit(
    db: TxClient,
    storeId: string,
    sellerId: string,
  ): Promise<StoreNegativeLimit> {
    const row = await db.storeWalletSettings.findUnique({
      where: { storeId },
      select: { negativeLimitInr: true },
    });
    const own = row?.negativeLimitInr ?? ZERO;
    const cap = await this.cap(sellerId);
    return {
      ownInr: own.toFixed(2),
      capInr: cap.toFixed(2),
      effectiveInr: (own.lessThan(cap) ? own : cap).toFixed(2),
    };
  }

  private async cap(sellerId: string): Promise<Prisma.Decimal> {
    try {
      const resolved = await this.settings.resolve(sellerId, NEGATIVE_LIMIT_CAP_KEY);
      const v = new Prisma.Decimal(String(resolved.value ?? 0));
      return v.lessThan(0) ? ZERO : v;
    } catch (err) {
      this.logger.warn(
        { sellerId, err: (err as Error).message },
        'Reseller store negative-limit cap unreadable — treated as 0 (no store may go negative)',
      );
      return ZERO;
    }
  }

  /**
   * The seller sets how far below zero one of their stores may go (their
   * risk). Refused above Skydrop's cap for the seller rather than silently
   * lowered, so the seller knows the number they typed is not the one in
   * force.
   */
  async setNegativeLimit(
    sellerId: string,
    storeId: string,
    amountInr: string,
    actor: { sellerUserId: string },
  ): Promise<StoreNegativeLimit> {
    const amount = parseAmount(amountInr, { allowZero: true });
    const store = await this.requireStore({ sellerId, storeId });
    if (
      store.status === ResellerStoreStatus.CLOSED ||
      store.status === ResellerStoreStatus.REJECTED
    ) {
      throw new ConflictException({
        code: 'STORE_IS_FINAL',
        message: 'A closed or rejected store’s wallet settings cannot change.',
      });
    }
    const cap = await this.cap(sellerId);
    if (amount.greaterThan(cap)) {
      throw new BadRequestException({
        code: 'STORE_NEGATIVE_LIMIT_ABOVE_CAP',
        message: `Skydrop lets a store go at most ₹${cap.toFixed(2)} below zero for your account. Set ₹${cap.toFixed(2)} or less.`,
      });
    }
    const before = await this.prisma.client.storeWalletSettings.findUnique({
      where: { storeId },
      select: { negativeLimitInr: true },
    });
    await this.prisma.client.storeWalletSettings.upsert({
      where: { storeId },
      create: { storeId, negativeLimitInr: amount, updatedBySellerUserId: actor.sellerUserId },
      update: { negativeLimitInr: amount, updatedBySellerUserId: actor.sellerUserId },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId,
      action: 'reseller_store.wallet_negative_limit_set',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      changes: {
        from: (before?.negativeLimitInr ?? ZERO).toFixed(2),
        to: amount.toFixed(2),
      },
      metadata: { capInr: cap.toFixed(2) },
    });
    return this.negativeLimit(this.prisma.client, storeId, sellerId);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  /**
   * A reseller store, scoped as the caller is entitled to see it: by its
   * seller (the seller surface), or by id alone (the store's own token and
   * staff). Never a CHANNEL store.
   */
  async requireStore(scope: { storeId: string; sellerId?: string }): Promise<WalletStore> {
    return this.loadStore(this.prisma.client, scope);
  }

  async loadStore(
    db: TxClient,
    scope: { storeId: string; sellerId?: string },
  ): Promise<WalletStore> {
    const row = await db.sellerStore.findFirst({
      where: {
        id: scope.storeId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        ...(scope.sellerId === undefined ? {} : { sellerId: scope.sellerId }),
      },
      select: STORE_SELECT,
    });
    if (row === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return {
      id: row.id,
      sellerId: row.sellerId,
      name: row.name,
      displayName: row.displayName,
      status: row.status,
      walletManagedBy: row.walletManagedBy,
      sellerCompanyName: row.seller.companyName,
    };
  }

  async summary(scope: { storeId: string; sellerId?: string }): Promise<StoreWalletSummary> {
    const store = await this.requireStore(scope);
    return this.prisma.client.$transaction(async (tx) => {
      // Under the seller's lock, so the balance, what is withdrawable and
      // what is pending are one consistent moment rather than three.
      await this.lockSeller(tx, store.sellerId);
      const balance = await storeWalletBalance(tx, store.id);
      const withdrawable =
        store.walletManagedBy === ResellerWalletManager.SKYDROP
          ? (await this.storeWithdrawable(tx, { storeId: store.id, sellerId: store.sellerId }))
              .withdrawable
          : null;
      const topups = await tx.storeTopupRequest.aggregate({
        where: { storeId: store.id, status: TopupRequestStatus.PENDING },
        _sum: { amountInr: true },
        _count: { _all: true },
      });
      const withdrawals = await tx.storeWithdrawalRequest.aggregate({
        where: {
          storeId: store.id,
          status: { in: [WithdrawalRequestStatus.PENDING, WithdrawalRequestStatus.APPROVED] },
        },
        _sum: { amountInr: true },
        _count: { _all: true },
      });
      return {
        storeId: store.id,
        storeName: store.name,
        displayName: store.displayName,
        sellerId: store.sellerId,
        sellerCompanyName: store.sellerCompanyName,
        status: store.status,
        walletManagedBy: store.walletManagedBy,
        balanceInr: balance.toFixed(2),
        withdrawableInr: withdrawable === null ? null : withdrawable.toFixed(2),
        negativeLimit: await this.negativeLimit(tx, store.id, store.sellerId),
        pendingTopups: {
          count: topups._count._all,
          amountInr: (topups._sum.amountInr ?? ZERO).toFixed(2),
        },
        pendingWithdrawals: {
          count: withdrawals._count._all,
          amountInr: (withdrawals._sum.amountInr ?? ZERO).toFixed(2),
        },
      };
    });
  }

  /**
   * The ledger, newest first, paged by entry id (uuidv7, so ids order the
   * way the entries were written — stable within one transaction, where
   * `createdAt` is not).
   */
  async ledger(
    scope: { storeId: string; sellerId?: string },
    page: { before?: string; limit?: number },
  ): Promise<StoreWalletLedger> {
    const store = await this.requireStore(scope);
    const limit = Math.min(200, Math.max(1, page.limit ?? 50));
    const rows = await this.prisma.client.storeWalletEntry.findMany({
      where: {
        storeId: store.id,
        ...(page.before === undefined || page.before === '' ? {} : { id: { lt: page.before } }),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
        shareOf: true,
        linkedOrderId: true,
        note: true,
        actorType: true,
        createdAt: true,
      },
    });
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      direction: r.direction,
      amountInr: r.amount.toFixed(2),
      runningBalanceAfterInr: r.runningBalanceAfter.toFixed(2),
      shareOf: r.shareOf,
      linkedOrderId: r.linkedOrderId,
      note: r.note,
      actorType: r.actorType,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      items,
      nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
    };
  }
}

/**
 * A rupee amount from a form: positive (or zero, where allowed), at most
 * two decimals. Refused before anything is read.
 */
export function parseAmount(raw: string, opts: { allowZero?: boolean } = {}): Prisma.Decimal {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(raw);
  } catch {
    throw new BadRequestException({
      code: 'STORE_WALLET_AMOUNT_INVALID',
      message: 'Give the amount in rupees, as a figure.',
    });
  }
  const tooSmall = opts.allowZero === true ? amount.lessThan(0) : amount.lessThanOrEqualTo(0);
  if (!amount.isFinite() || tooSmall || !amount.equals(amount.toDecimalPlaces(2))) {
    throw new BadRequestException({
      code: 'STORE_WALLET_AMOUNT_INVALID',
      message:
        opts.allowZero === true
          ? 'Give the amount in rupees — zero or more, with at most two decimals.'
          : 'Give the amount in rupees — more than zero, with at most two decimals.',
    });
  }
  return amount;
}
