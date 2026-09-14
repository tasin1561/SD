import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  ActorType,
  Currency,
  Prisma,
  ResellerStoreStatus,
  ResellerWalletManager,
  StoreWalletEntryDirection,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { WithdrawalRequestService } from '../../seller-wallet-withdrawal/services/withdrawal-request.service';
import {
  idempotencyKeyReused,
  isUniqueViolation,
} from '../../treasury/services/bank-ledger.service';
import { storeWalletBalance } from '../../treasury/services/store-wallet-balances';
import {
  parseAmount,
  StoreWalletService,
  type WalletStore,
  STORE_WALLET_TX_OPTIONS,
} from './store-wallet.service';

const MIN_PAYOUT_NOTE = 5;
const MAX_NOTE = 500;

export interface SellerStoreMoveResult {
  readonly storeEntryId: string;
  readonly replayed: boolean;
  readonly storeBalanceAfterInr: string;
}

/**
 * RS-6 — a SELLER-managed store's wallet, moved by the seller.
 *
 * Decision 9: the seller pays such a store OFF-platform, so we only RECORD
 * it. Neither flow touches the bank book — the seller's money and their
 * stores' money are one pot there (decision 7), and each flow moves money
 * between two wallets of that one pot in ONE transaction:
 *
 *   - top-up:  seller −X (STORE_TOPUP_OUT), store +X (SELLER_TOPUP)
 *   - payout:  store −X (SELLER_PAYOUT),    seller +X (STORE_PAYOUT_IN)
 *
 * so `seller wallet + Σ store wallets` does not move and neither does the
 * cash held against it.
 *
 * ── THE TOP-UP GUARD ─────────────────────────────────────────────────
 * A top-up takes money out of the seller's reach exactly as a withdrawal
 * does, so it is refused beyond what the seller could WITHDRAW — the one
 * WAL-3 method (`withdrawableBalance`): their balance, less their minimum
 * balance, less requests already made, less any store's shortfall. Read
 * inside the transaction, under the seller's WALLET lock, which every
 * writer of the seller's and their stores' wallets takes.
 */
@Injectable()
export class SellerManagedStoreWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeWallet: StoreWalletService,
    private readonly wallet: WalletService,
    private readonly withdrawals: WithdrawalRequestService,
    private readonly audit: AuditLogService,
  ) {}

  async topUp(
    sellerId: string,
    storeId: string,
    input: { amountInr: string; note?: string | null; idempotencyKey?: string | null },
    actor: { sellerUserId: string },
  ): Promise<SellerStoreMoveResult> {
    const amount = parseAmount(input.amountInr);
    const note = cleanNote(input.note);
    const key = input.idempotencyKey ?? null;
    const prior = await this.replay(key, storeId, StoreWalletEntryDirection.SELLER_TOPUP, amount);
    if (prior !== null) return prior;

    let done: {
      storeEntryId: string;
      sellerEntryId: string;
      after: Prisma.Decimal;
      store: WalletStore;
    };
    try {
      done = await this.prisma.client.$transaction(async (tx) => {
        await this.storeWallet.lockSeller(tx, sellerId);
        const store = await this.storeWallet.loadStore(tx, { storeId, sellerId });
        assertSellerManagedAndOpen(store);
        const balance = await this.wallet.balanceLive(sellerId, Currency.INR, tx);
        const withdrawable = await this.withdrawals.withdrawableBalance(
          sellerId,
          Currency.INR,
          balance,
          tx,
        );
        if (withdrawable.lessThan(amount)) {
          throw new BadRequestException({
            code: 'STORE_TOPUP_EXCEEDS_WITHDRAWABLE',
            message:
              `You can move at most ₹${withdrawable.toFixed(2)} out of your wallet now — ` +
              'the same amount you could withdraw (your balance, less the minimum balance, ' +
              'withdrawals already asked for, and any store that is below zero).',
          });
        }
        const label = store.displayName ?? store.name;
        const sellerEntry = await this.wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.STORE_TOPUP_OUT,
          amount,
          note: note === null ? `Moved to ${label}` : `Moved to ${label} — ${note}`,
          reasonCode: 'RESELLER_STORE_TOPUP',
          actorType: ActorType.SELLER,
          actorId: actor.sellerUserId,
        });
        const storeEntry = await this.storeWallet.applyEntry(tx, {
          storeId,
          sellerId,
          direction: StoreWalletEntryDirection.SELLER_TOPUP,
          amount,
          linkedSellerEntryId: sellerEntry.id,
          note,
          reasonCode: 'SELLER_TOPUP',
          actorType: ActorType.SELLER,
          actorId: actor.sellerUserId,
          idempotencyKey: key,
        });
        return {
          storeEntryId: storeEntry.id,
          sellerEntryId: sellerEntry.id,
          after: storeEntry.runningBalanceAfter,
          store,
        };
      }, STORE_WALLET_TX_OPTIONS);
    } catch (err) {
      const raced = isUniqueViolation(err)
        ? await this.replay(key, storeId, StoreWalletEntryDirection.SELLER_TOPUP, amount)
        : null;
      if (raced !== null) return raced;
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId,
      action: 'reseller_store.wallet_topped_up',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      metadata: {
        amountInr: amount.toFixed(2),
        storeEntryId: done.storeEntryId,
        sellerEntryId: done.sellerEntryId,
        storeBalanceAfterInr: done.after.toFixed(2),
        note,
      },
    });
    return {
      storeEntryId: done.storeEntryId,
      replayed: false,
      storeBalanceAfterInr: done.after.toFixed(2),
    };
  }

  /**
   * The seller says they paid the store `X` off-platform (decision 9). The
   * store's wallet falls by X and the seller's rises by X. Refused beyond
   * the store's balance: a store cannot be recorded as paid money it was
   * never owed. The note is what the store reads, so it is required.
   */
  async recordPayout(
    sellerId: string,
    storeId: string,
    input: { amountInr: string; note: string; idempotencyKey?: string | null },
    actor: { sellerUserId: string },
  ): Promise<SellerStoreMoveResult> {
    const amount = parseAmount(input.amountInr);
    const note = cleanNote(input.note);
    if (note === null || note.length < MIN_PAYOUT_NOTE) {
      throw new BadRequestException({
        code: 'STORE_PAYOUT_NOTE_REQUIRED',
        message: `Say how you paid the store (at least ${MIN_PAYOUT_NOTE} characters) — the store reads this.`,
      });
    }
    const key = input.idempotencyKey ?? null;
    const prior = await this.replay(key, storeId, StoreWalletEntryDirection.SELLER_PAYOUT, amount);
    if (prior !== null) return prior;

    let done: { storeEntryId: string; sellerEntryId: string; after: Prisma.Decimal };
    try {
      done = await this.prisma.client.$transaction(async (tx) => {
        await this.storeWallet.lockSeller(tx, sellerId);
        const store = await this.storeWallet.loadStore(tx, { storeId, sellerId });
        assertSellerManagedAndOpen(store);
        const balance = await storeWalletBalance(tx, storeId);
        if (balance.lessThan(amount)) {
          throw new BadRequestException({
            code: 'STORE_PAYOUT_EXCEEDS_BALANCE',
            message: `The store’s wallet holds ₹${balance.toFixed(2)}. You cannot record paying it more than that.`,
          });
        }
        const label = store.displayName ?? store.name;
        const sellerEntry = await this.wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.STORE_PAYOUT_IN,
          amount,
          note: `Paid ${label} — ${note}`,
          reasonCode: 'RESELLER_STORE_PAYOUT',
          actorType: ActorType.SELLER,
          actorId: actor.sellerUserId,
        });
        const storeEntry = await this.storeWallet.applyEntry(tx, {
          storeId,
          sellerId,
          direction: StoreWalletEntryDirection.SELLER_PAYOUT,
          amount,
          linkedSellerEntryId: sellerEntry.id,
          note,
          reasonCode: 'SELLER_PAYOUT',
          actorType: ActorType.SELLER,
          actorId: actor.sellerUserId,
          idempotencyKey: key,
        });
        return {
          storeEntryId: storeEntry.id,
          sellerEntryId: sellerEntry.id,
          after: storeEntry.runningBalanceAfter,
        };
      }, STORE_WALLET_TX_OPTIONS);
    } catch (err) {
      const raced = isUniqueViolation(err)
        ? await this.replay(key, storeId, StoreWalletEntryDirection.SELLER_PAYOUT, amount)
        : null;
      if (raced !== null) return raced;
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: actor.sellerUserId,
      sellerId,
      action: 'reseller_store.wallet_payout_recorded',
      entityType: 'seller_store',
      entityId: storeId,
      // A claim that money moved outside every system we can check.
      severity: 'HIGH',
      metadata: {
        amountInr: amount.toFixed(2),
        storeEntryId: done.storeEntryId,
        sellerEntryId: done.sellerEntryId,
        storeBalanceAfterInr: done.after.toFixed(2),
        note,
      },
    });
    return {
      storeEntryId: done.storeEntryId,
      replayed: false,
      storeBalanceAfterInr: done.after.toFixed(2),
    };
  }

  /**
   * IDEM-1: the same key already wrote this move. Answered only when the
   * material fields match — the store, which way, and the amount; anything
   * else is refused rather than answered with somebody else's move.
   */
  private async replay(
    key: string | null,
    storeId: string,
    direction: StoreWalletEntryDirection,
    amount: Prisma.Decimal,
  ): Promise<SellerStoreMoveResult | null> {
    if (key === null) return null;
    const prior = await this.prisma.client.storeWalletEntry.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, storeId: true, direction: true, amount: true, runningBalanceAfter: true },
    });
    if (prior === null) return null;
    if (
      prior.storeId !== storeId ||
      prior.direction !== direction ||
      !prior.amount.equals(amount)
    ) {
      throw idempotencyKeyReused('store wallet movement');
    }
    return {
      storeEntryId: prior.id,
      replayed: true,
      storeBalanceAfterInr: prior.runningBalanceAfter.toFixed(2),
    };
  }
}

function cleanNote(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? '';
  if (t.length > MAX_NOTE) {
    throw new BadRequestException({
      code: 'STORE_WALLET_NOTE_TOO_LONG',
      message: `Keep the note to ${MAX_NOTE} characters.`,
    });
  }
  return t === '' ? null : t;
}

/** Only a SELLER-managed store, and only one that is open, is moved this way. */
function assertSellerManagedAndOpen(store: WalletStore): void {
  if (store.walletManagedBy !== ResellerWalletManager.SELLER) {
    throw new ConflictException({
      code: 'STORE_WALLET_SKYDROP_MANAGED',
      message:
        'Skydrop manages this store’s wallet: the store tops up to Skydrop’s bank and withdraws through Skydrop.',
    });
  }
  if (store.status !== ResellerStoreStatus.ACTIVE && store.status !== ResellerStoreStatus.PAUSED) {
    throw new ConflictException({
      code: 'STORE_NOT_OPEN',
      message: 'Only an open (or paused) store’s wallet can be moved.',
    });
  }
}
