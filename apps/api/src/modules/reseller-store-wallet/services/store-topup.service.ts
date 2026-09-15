import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  ResellerStoreStatus,
  ResellerWalletManager,
  StoreWalletEntryDirection,
  TopupRequestStatus,
} from '@skydrop/db';
import { lockAccountsForPosting } from '../../../common/db/advisory-lock';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
  isUniqueViolation,
} from '../../treasury/services/bank-ledger.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { parseAmount, StoreWalletService, STORE_WALLET_TX_OPTIONS } from './store-wallet.service';

const PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const PROOF_PUT_TTL_SECONDS = 15 * 60;
const PROOF_READ_TTL_SECONDS = 15 * 60;

export interface StoreBankAccountView {
  readonly id: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  /** IFSC for an Indian account. */
  readonly branchCode: string | null;
  readonly branchName: string | null;
  readonly instructions: string | null;
}

export interface StoreTopupPresign {
  readonly uploadUrl: string;
  readonly spacesKey: string;
  readonly expiresInSeconds: number;
}

export interface StoreTopupView {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly bankAccountId: string;
  readonly bankLabel: string;
  readonly bankName: string;
  readonly bankAccountNumber: string;
  readonly amountInr: string;
  readonly transactionRef: string | null;
  readonly hasProof: boolean;
  readonly status: TopupRequestStatus;
  readonly reviewNote: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

const VIEW_INCLUDE = {
  store: { select: { name: true, displayName: true, seller: { select: { companyName: true } } } },
  bankAccount: { select: { label: true, bankName: true, accountNumber: true } },
} as const;

type TopupRow = Prisma.StoreTopupRequestGetPayload<{ include: typeof VIEW_INCLUDE }>;

/** What makes two claims "the same claim" for an IDEM-1 replay. */
interface TopupMaterial {
  readonly storeId: string;
  readonly bankAccountId: string;
  readonly amount: Prisma.Decimal;
  readonly transactionRef: string | null;
  readonly proofSpacesKey: string | null;
}

/**
 * RS-6 — a SKYDROP-managed store putting money into its wallet.
 *
 * WAL-2, for stores: a claim writes NOTHING. A person checks the bank and
 * accepts — a guarded `updateMany` on PENDING, in the SAME transaction as
 * the store credit and the bank entry (TRE-3). The UNIQUE `store_entry_id`
 * is the second gate. A transaction reference or a proof upload is
 * mandatory; proof is a Spaces KEY namespaced per store and read through a
 * presigned URL.
 *
 * Decision 7: the cash is posted as the SELLER's. The store's money is a
 * ledger between the store and its seller; our bank book holds it for the
 * seller. Cash arriving while the seller's GROUP (their wallet plus every
 * store's) is below zero repays that debt first and is ours (TRE-8's
 * `debtSplit`, read against the group).
 *
 * Rupees only, into one of our rupee accounts: a store sells in India and
 * its wallet is in rupees, and a conversion here would be a second place
 * an exchange rate is decided.
 */
@Injectable()
export class StoreTopupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
    private readonly storeWallet: StoreWalletService,
    private readonly bank: BankLedgerService,
    private readonly attribution: SellerCashAttributionService,
  ) {}

  /** The rupee accounts a store may send money to. */
  async bankAccounts(): Promise<readonly StoreBankAccountView[]> {
    return this.prisma.client.platformBankAccount.findMany({
      where: { isActive: true, deletedAt: null, currency: Currency.INR },
      orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        label: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        branchCode: true,
        branchName: true,
        instructions: true,
      },
    });
  }

  /** A presigned PUT for the proof, under the store's own prefix. */
  async presignProof(storeId: string, mimeType: string): Promise<StoreTopupPresign> {
    if (!PROOF_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'Proof must be a JPEG, PNG, WEBP or PDF',
      });
    }
    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
    const key = `${proofPrefix(storeId)}${randomUUID()}.${ext}`;
    const uploadUrl = await this.spaces.presignPutUrl(key, mimeType, PROOF_PUT_TTL_SECONDS);
    return { uploadUrl, spacesKey: key, expiresInSeconds: PROOF_PUT_TTL_SECONDS };
  }

  async submit(
    user: AuthenticatedStoreUser,
    input: {
      bankAccountId: string;
      amountInr: string;
      transactionRef?: string | null;
      proofSpacesKey?: string | null;
      proofMimeType?: string | null;
      /** IDEM-1: minted when the form opens, reused on a retry. */
      idempotencyKey?: string | null;
    },
  ): Promise<StoreTopupView> {
    const amount = parseAmount(input.amountInr);
    const ref = input.transactionRef?.trim() ?? '';
    const proofKey = input.proofSpacesKey?.trim() ?? '';
    const key = input.idempotencyKey ?? null;
    const material: TopupMaterial = {
      storeId: user.storeId,
      bankAccountId: input.bankAccountId,
      amount,
      transactionRef: ref === '' ? null : ref,
      proofSpacesKey: proofKey === '' ? null : proofKey,
    };
    if (ref === '' && proofKey === '') {
      throw new BadRequestException({
        code: 'PROOF_REQUIRED',
        message:
          'Give a transaction reference or upload proof of the transfer — one of the two. Without it there is nothing to match against our bank statement.',
      });
    }
    // A key from another store's prefix would attach evidence this store
    // cannot see — and let it read that evidence back through its own
    // presigned download.
    if (proofKey !== '' && !proofKey.startsWith(proofPrefix(user.storeId))) {
      throw new BadRequestException({
        code: 'INVALID_PROOF_KEY',
        message: 'That proof key does not belong to this store',
      });
    }

    // IDEM-1: the same form sent twice (a double click, a retry after a
    // dropped response) answers with the claim it already made.
    const replayed = await this.replayClaim(key, material);
    if (replayed !== null) return replayed;

    let row: TopupRow;
    try {
      row = await this.createClaim(user, input, key, material);
    } catch (err) {
      // Two copies of the same form racing: the loser answers with the winner.
      if (key !== null && isUniqueViolation(err)) {
        const winner = await this.replayClaim(key, material);
        if (winner !== null) return winner;
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'reseller_store.topup_submitted',
      entityType: 'store_topup_request',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: user.storeId,
        amountInr: amount.toFixed(2),
        bankAccountId: input.bankAccountId,
        hasRef: ref !== '',
        hasProof: proofKey !== '',
      },
    });
    return toView(row);
  }

  /**
   * IDEM-1 replay: the row this key already wrote, IF it is the same claim
   * (store, account, amount, reference, proof); the same key on a different
   * claim is refused, never answered with somebody else's row.
   */
  private async replayClaim(key: string | null, m: TopupMaterial): Promise<StoreTopupView | null> {
    if (key === null) return null;
    const prior = await this.prisma.client.storeTopupRequest.findUnique({
      where: { idempotencyKey: key },
      include: VIEW_INCLUDE,
    });
    if (prior === null) return null;
    if (
      prior.storeId !== m.storeId ||
      prior.bankAccountId !== m.bankAccountId ||
      !prior.amountInr.equals(m.amount) ||
      prior.transactionRef !== m.transactionRef ||
      prior.proofSpacesKey !== m.proofSpacesKey
    ) {
      throw idempotencyKeyReused('store top-up claim');
    }
    return toView(prior);
  }

  private async createClaim(
    user: AuthenticatedStoreUser,
    input: { bankAccountId: string; proofMimeType?: string | null },
    key: string | null,
    m: TopupMaterial,
  ): Promise<TopupRow> {
    return this.prisma.client.$transaction(async (tx) => {
      // The seller's WALLET lock: a change of who manages the wallet takes
      // it too, so a claim cannot be filed against a wallet that is at this
      // moment being handed to the seller.
      await this.storeWallet.lockSeller(tx, user.sellerId);
      const store = await this.storeWallet.loadStore(tx, { storeId: user.storeId });
      if (store.walletManagedBy !== ResellerWalletManager.SKYDROP) {
        throw new ConflictException({
          code: 'STORE_WALLET_SELLER_MANAGED',
          message: `${store.sellerCompanyName} manages this store’s wallet — they top it up for you.`,
        });
      }
      const account = await tx.platformBankAccount.findFirst({
        where: { id: input.bankAccountId, isActive: true, deletedAt: null },
        select: { id: true, currency: true },
      });
      if (account === null) {
        throw new NotFoundException({
          code: 'BANK_ACCOUNT_NOT_FOUND',
          message: 'That account is not one we currently accept transfers to',
        });
      }
      if (account.currency !== Currency.INR) {
        throw new BadRequestException({
          code: 'STORE_TOPUP_ACCOUNT_NOT_INR',
          message: 'A store’s wallet is in rupees — send the money to one of our rupee accounts.',
        });
      }
      return tx.storeTopupRequest.create({
        data: {
          storeId: store.id,
          sellerId: store.sellerId,
          bankAccountId: account.id,
          amountInr: m.amount,
          transactionRef: m.transactionRef,
          proofSpacesKey: m.proofSpacesKey,
          proofMimeType: m.proofSpacesKey === null ? null : (input.proofMimeType ?? null),
          submittedByStoreUserId: user.id,
          idempotencyKey: key,
        },
        include: VIEW_INCLUDE,
      });
    }, STORE_WALLET_TX_OPTIONS);
  }

  async listForStore(storeId: string): Promise<readonly StoreTopupView[]> {
    const rows = await this.prisma.client.storeTopupRequest.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: VIEW_INCLUDE,
    });
    return rows.map(toView);
  }

  async listForAdmin(filter: {
    status?: TopupRequestStatus;
    storeId?: string;
  }): Promise<readonly StoreTopupView[]> {
    const rows = await this.prisma.client.storeTopupRequest.findMany({
      where: {
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.storeId === undefined ? {} : { storeId: filter.storeId }),
      },
      // Oldest pending first — a review queue is worked front to back.
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: VIEW_INCLUDE,
    });
    return rows.map(toView);
  }

  /** A short-lived link to the proof. `storeId` scopes the store's own read; null is staff. */
  async proofUrl(topupId: string, storeId: string | null): Promise<{ url: string }> {
    const row = await this.prisma.client.storeTopupRequest.findFirst({
      where: { id: topupId, ...(storeId === null ? {} : { storeId }) },
      select: { proofSpacesKey: true },
    });
    if (row?.proofSpacesKey == null) {
      throw new NotFoundException({
        code: 'PROOF_NOT_FOUND',
        message: 'This request has no uploaded proof',
      });
    }
    return { url: await this.spaces.presignGetUrl(row.proofSpacesKey, PROOF_READ_TTL_SECONDS) };
  }

  /**
   * Accept: a person found the money on the statement. The claim, the
   * store credit, the bank entry (as the SELLER's) and the debt split are
   * ONE transaction. Locks in the one order every money writer uses:
   * the seller's WALLET → the receiving account's reconcile key → (inside
   * the attribution pair) ATTRIBUTION_RECONCILE_KEY.
   */
  async accept(topupId: string, staffId: string, note: string | null): Promise<StoreTopupView> {
    const existing = await this.prisma.client.storeTopupRequest.findUnique({
      where: { id: topupId },
      select: {
        id: true,
        storeId: true,
        sellerId: true,
        status: true,
        amountInr: true,
        bankAccountId: true,
        transactionRef: true,
      },
    });
    if (existing === null) {
      throw new NotFoundException({ code: 'TOPUP_NOT_FOUND', message: 'Top-up request not found' });
    }
    if (existing.status !== TopupRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'TOPUP_ALREADY_REVIEWED',
        message: `This request is already ${existing.status.toLowerCase()}`,
      });
    }
    const amount = existing.amountInr;

    const result = await this.prisma.client.$transaction(async (tx) => {
      await this.storeWallet.lockSeller(tx, existing.sellerId);
      await lockAccountsForPosting(tx, [existing.bankAccountId]);
      const claimed = await tx.storeTopupRequest.updateMany({
        where: { id: topupId, status: TopupRequestStatus.PENDING },
        data: {
          status: TopupRequestStatus.ACCEPTED,
          reviewedByStaffId: staffId,
          reviewedAt: new Date(),
          reviewNote: note?.trim() || null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'TOPUP_ALREADY_REVIEWED',
          message: 'Someone else reviewed this request first',
        });
      }
      const store = await this.storeWallet.loadStore(tx, { storeId: existing.storeId });
      // Unreachable while the manager switch refuses with a claim open;
      // refused here too, so a credit can never land on a wallet the seller
      // manages without anyone noticing.
      if (store.walletManagedBy !== ResellerWalletManager.SKYDROP) {
        throw new ConflictException({
          code: 'STORE_WALLET_SELLER_MANAGED',
          message: 'The seller manages this store’s wallet now — reject the claim instead.',
        });
      }
      if (
        store.status === ResellerStoreStatus.CLOSED ||
        store.status === ResellerStoreStatus.REJECTED
      ) {
        throw new ConflictException({
          code: 'STORE_IS_FINAL',
          message: 'This store is closed. Reject the claim and return the money to the store.',
        });
      }
      // Read against the group BEFORE the credit: the part repaying what
      // the seller's group owes is ours (TRE-8).
      const split = await this.attribution.debtSplit(tx, existing.sellerId, amount);
      const entry = await this.storeWallet.applyEntry(tx, {
        storeId: existing.storeId,
        sellerId: existing.sellerId,
        direction: StoreWalletEntryDirection.TOPUP,
        amount,
        note: `Top-up received — ${existing.transactionRef ?? 'proof on file'}`,
        reasonCode: 'STORE_TOPUP',
        actorType: ActorType.STAFF,
        actorId: staffId,
      });
      await this.bank.post(
        {
          accountId: existing.bankAccountId,
          type: BankEntryType.SELLER_TOPUP,
          signedAmount: amount,
          amountCurrency: Currency.INR,
          // Decision 7: the store's money is the SELLER's cash here.
          owner: { kind: BankOwnerKind.SELLER, sellerId: existing.sellerId },
          actorType: ActorType.STAFF,
          staffId,
          occurredAt: new Date(),
          reference: existing.transactionRef ?? existing.id,
          note: `Reseller store top-up verified — ${store.displayName ?? store.name}`,
        },
        tx,
      );
      if (split.toCapital.greaterThan(0)) {
        await this.attribution.repayDebt(tx, {
          sellerId: existing.sellerId,
          accountId: existing.bankAccountId,
          currency: Currency.INR,
          amount: split.toCapital,
          reference: entry.id,
        });
      }
      await tx.storeTopupRequest.update({
        where: { id: topupId },
        data: { storeEntryId: entry.id },
      });
      return { entryId: entry.id, repaid: split.toCapital };
    }, STORE_WALLET_TX_OPTIONS);

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: existing.sellerId,
      action: 'reseller_store.topup_accepted',
      entityType: 'store_topup_request',
      entityId: topupId,
      severity: 'HIGH',
      metadata: {
        storeId: existing.storeId,
        amountInr: amount.toFixed(2),
        storeEntryId: result.entryId,
        repaidGroupDebtInr: result.repaid.toFixed(2),
      },
    });
    return this.view(topupId);
  }

  async reject(topupId: string, staffId: string, reason: string): Promise<StoreTopupView> {
    const why = reason.trim();
    if (why.length < 5) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Say why — the store reads this, and "rejected" on its own is not actionable',
      });
    }
    const existing = await this.prisma.client.storeTopupRequest.findUnique({
      where: { id: topupId },
      select: { id: true, sellerId: true, storeId: true, amountInr: true },
    });
    if (existing === null) {
      throw new NotFoundException({ code: 'TOPUP_NOT_FOUND', message: 'Top-up request not found' });
    }
    const claimed = await this.prisma.client.storeTopupRequest.updateMany({
      where: { id: topupId, status: TopupRequestStatus.PENDING },
      data: {
        status: TopupRequestStatus.REJECTED,
        reviewedByStaffId: staffId,
        reviewedAt: new Date(),
        reviewNote: why,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'TOPUP_ALREADY_REVIEWED',
        message: 'This request has already been reviewed',
      });
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: existing.sellerId,
      action: 'reseller_store.topup_rejected',
      entityType: 'store_topup_request',
      entityId: topupId,
      severity: 'MEDIUM',
      metadata: {
        storeId: existing.storeId,
        amountInr: existing.amountInr.toFixed(2),
        reason: why,
      },
    });
    return this.view(topupId);
  }

  private async view(topupId: string): Promise<StoreTopupView> {
    const row = await this.prisma.client.storeTopupRequest.findUniqueOrThrow({
      where: { id: topupId },
      include: VIEW_INCLUDE,
    });
    return toView(row);
  }
}

/** Where a store's proofs live — one prefix per store, so a key names its owner. */
function proofPrefix(storeId: string): string {
  return `stores/${storeId}/topup-proofs/`;
}

function toView(r: TopupRow): StoreTopupView {
  return {
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.displayName ?? r.store.name,
    sellerId: r.sellerId,
    sellerCompanyName: r.store.seller.companyName,
    bankAccountId: r.bankAccountId,
    bankLabel: r.bankAccount.label,
    bankName: r.bankAccount.bankName,
    bankAccountNumber: r.bankAccount.accountNumber,
    amountInr: r.amountInr.toFixed(2),
    transactionRef: r.transactionRef,
    // The KEY never leaves the server.
    hasProof: r.proofSpacesKey !== null,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
