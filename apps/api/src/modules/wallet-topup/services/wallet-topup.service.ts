import { randomUUID } from 'node:crypto';
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
  NotificationRecipientType,
  Prisma,
  TopupRequestStatus,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { FxRateService } from '../../fx/services/fx-rate.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Putting money INTO the wallet.
 *
 * Until this existed the wallet had a credit side only for sellers
 * shipping COD. A prepaid-only seller accrued nothing but debits —
 * delivery fees, inbound freight, returns — with no way to settle them,
 * so the balance went negative and stayed there.
 *
 * ── The wallet is NOT credited on submission ──────────────────────────
 * A seller saying "I sent you money" is a claim, not a payment. Crediting
 * first and reversing on rejection would let anyone raise their balance
 * by filling in a form, and the reversal would land after they had
 * already withdrawn against it. An operator checks the bank; the credit
 * follows the check.
 *
 * ── A reference is mandatory ──────────────────────────────────────────
 * Either a transaction reference or a proof image — the service refuses
 * without at least one. Otherwise there is nothing to match against the
 * statement, and "trust me" is not a reconciliation.
 *
 * Proof is stored as a Spaces KEY and read through a short-lived
 * presigned URL. Never a stored URL: the 2026-07-28 storage pass found
 * every object world-readable, and a bank-transfer screenshot carries an
 * account number.
 */

const PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const PROOF_PRESIGN_TTL_SECONDS = 15 * 60;
const PROOF_READ_TTL_SECONDS = 15 * 60;

export interface TopupPresignResult {
  readonly uploadUrl: string;
  readonly spacesKey: string;
  readonly expiresInSeconds: number;
}

export interface TopupRequestView {
  readonly id: string;
  readonly sellerId: string;
  readonly bankAccountId: string;
  readonly bankLabel: string;
  /**
   * The account they actually paid into, not just what we called it.
   *
   * A label is our filing name for an account; a seller checking a
   * transfer against their bank statement needs the bank and the number
   * they typed. "Tasin City" tells them nothing they can compare.
   */
  readonly bankName: string;
  readonly bankAccountNumber: string;
  readonly bankBranchName: string | null;
  /**
   * Who claimed it. A uuid identifies a row; an operator checking a
   * bank statement needs the name the money came from.
   */
  readonly sellerCompanyName: string | null;
  /**
   * Who accepted or rejected it. Staff have no display name, so this is
   * the address — enough to walk over and ask, which is the point.
   */
  readonly reviewedByEmail: string | null;
  readonly currency: Currency;
  readonly amount: string;
  readonly transactionRef: string | null;
  readonly hasProof: boolean;
  readonly status: TopupRequestStatus;
  readonly reviewNote: string | null;
  readonly reviewedAt: Date | null;
  readonly createdAt: Date;
}

@Injectable()
export class WalletTopupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
    private readonly fx: FxRateService,
    private readonly email: EmailQueue,
  ) {}

  private readonly logger = new Logger(WalletTopupService.name);

  /** The accounts a seller may send money to. */
  /**
   * The accounts a seller may send money to, each carrying the rate that
   * turns what they paid into what lands in their wallet.
   *
   * The rate comes from the SERVER rather than being worked out in the
   * browser. A seller paying in taka sees the rupee figure that will be
   * credited before they commit, and that figure has to come from the
   * same table the credit will use — two independent conversions
   * eventually disagree, and the one the seller was shown is the one
   * they will quote back.
   *
   * A rate that cannot be resolved is null, not 1. Silently treating
   * 100 taka as 100 rupees is the worst possible failure here.
   */
  async listBankAccounts(): Promise<{
    accounts: Array<{
      id: string;
      label: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
      branchCode: string | null;
      branchName: string | null;
      district: string | null;
      routingNumber: string | null;
      currency: Currency;
      instructions: string | null;
      rateToInr: string | null;
    }>;
    /** For showing the taka equivalent of a rupee amount. */
    inrToBdt: string | null;
  }> {
    const rows = await this.prisma.client.platformBankAccount.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        label: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        branchCode: true,
        branchName: true,
        district: true,
        routingNumber: true,
        currency: true,
        instructions: true,
      },
    });

    const rate = async (from: Currency, to: Currency): Promise<string | null> => {
      if (from === to) return '1';
      try {
        return (await this.fx.getRate(from, to)).toString();
      } catch {
        return null;
      }
    };
    const inrToBdt = await rate(Currency.INR, Currency.BDT);
    const accounts = await Promise.all(
      rows.map(async (r) => ({ ...r, rateToInr: await rate(r.currency, Currency.INR) })),
    );
    return { accounts, inrToBdt };
  }

  /**
   * A URL the browser PUTs the proof image to directly.
   *
   * The key is namespaced by seller so one seller's key can never be
   * guessed into another's, and carries a random segment so a re-upload
   * cannot overwrite an earlier request's evidence.
   */
  async presignProof(sellerId: string, mimeType: string): Promise<TopupPresignResult> {
    if (!PROOF_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'Proof must be a JPEG, PNG, WEBP or PDF',
      });
    }
    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
    const key = `topups/${sellerId}/${randomUUID()}.${ext}`;
    const uploadUrl = await this.spaces.presignPutUrl(key, mimeType, PROOF_PRESIGN_TTL_SECONDS);
    return { uploadUrl, spacesKey: key, expiresInSeconds: PROOF_PRESIGN_TTL_SECONDS };
  }

  async submit(
    sellerId: string,
    sellerUserId: string | null,
    input: {
      bankAccountId: string;
      amount: number;
      transactionRef?: string | null;
      proofSpacesKey?: string | null;
      proofMimeType?: string | null;
    },
    ctx?: ClientContext,
  ): Promise<TopupRequestView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Amount must be greater than zero',
      });
    }
    const ref = input.transactionRef?.trim() ?? '';
    const proofKey = input.proofSpacesKey?.trim() ?? '';
    if (ref.length === 0 && proofKey.length === 0) {
      throw new BadRequestException({
        code: 'PROOF_REQUIRED',
        message:
          'Give a transaction reference or upload proof of the transfer — one of the two. Without it there is nothing to match against our bank statement.',
      });
    }
    // A key from another seller's namespace would let someone attach
    // evidence they cannot see, and — worse — read it back through the
    // presigned download on their own request.
    if (proofKey.length > 0 && !proofKey.startsWith(`topups/${sellerId}/`)) {
      throw new BadRequestException({
        code: 'INVALID_PROOF_KEY',
        message: 'That proof key does not belong to this seller',
      });
    }

    const bank = await this.prisma.client.platformBankAccount.findFirst({
      where: { id: input.bankAccountId, isActive: true, deletedAt: null },
      select: {
        id: true,
        label: true,
        currency: true,
        bankName: true,
        accountNumber: true,
        branchName: true,
      },
    });
    if (!bank) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'That account is not one we currently accept transfers to',
      });
    }

    const row = await this.prisma.client.walletTopupRequest.create({
      data: {
        sellerId,
        bankAccountId: bank.id,
        currency: bank.currency,
        amount,
        transactionRef: ref.length > 0 ? ref : null,
        proofSpacesKey: proofKey.length > 0 ? proofKey : null,
        proofMimeType: input.proofMimeType ?? null,
        submittedByUserId: sellerUserId,
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'wallet.topup.submitted',
      entityType: 'wallet_topup_request',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: {
        amount: amount.toFixed(2),
        currency: bank.currency,
        bankAccountId: bank.id,
        hasProof: proofKey.length > 0,
        hasRef: ref.length > 0,
        ipAddress: ctx?.ipAddress,
        requestId: ctx?.requestId,
      },
    });

    await this.notifySeller(sellerId, 'seller.topup_submitted.email', {
      amount: `${bank.currency} ${amount.toFixed(2)}`,
      bank_label: bank.label,
      reference: ref.length > 0 ? ref : 'receipt uploaded',
    });

    return this.toView(row, bank);
  }

  /**
   * Tell the seller what happened to their money.
   *
   * BEST-EFFORT and deliberately so: a seller has already sent real
   * money, and an email provider being down must never undo the record
   * of it or block an operator from crediting a wallet. The audit row
   * and the request row are the durable facts; this is the courtesy.
   *
   * Legacy fire-once caller (no `eventId`) — see the two idempotency
   * regimes in CLAUDE.md. These fire on state changes that are
   * themselves guarded, so a duplicate needs a duplicate transition
   * first.
   */
  private async notifySeller(
    sellerId: string,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<void> {
    try {
      const seller = await this.prisma.client.seller.findUnique({
        where: { id: sellerId },
        select: { email: true, companyName: true },
      });
      if (seller === null) return;
      await this.email.enqueue({
        templateCode,
        recipient: { type: NotificationRecipientType.SELLER, id: sellerId, email: seller.email },
        variables: { company_name: seller.companyName, ...variables },
        triggerEvent: templateCode,
      });
    } catch (e) {
      this.logger.warn(
        { sellerId, templateCode, err: (e as Error).message },
        'Top-up notification failed to enqueue; the request itself is unaffected',
      );
    }
  }

  /**
   * A short-lived link to the proof image.
   *
   * Callers must have already established that the requester may see
   * this request — a seller their own, staff any. The URL itself carries
   * no further check once minted, which is why the TTL is minutes.
   */
  async proofUrl(topupId: string, sellerId: string | null): Promise<string> {
    const row = await this.prisma.client.walletTopupRequest.findFirst({
      where: { id: topupId, ...(sellerId === null ? {} : { sellerId }) },
      select: { proofSpacesKey: true },
    });
    if (!row?.proofSpacesKey) {
      throw new NotFoundException({
        code: 'PROOF_NOT_FOUND',
        message: 'This request has no uploaded proof',
      });
    }
    return this.spaces.presignGetUrl(row.proofSpacesKey, PROOF_READ_TTL_SECONDS);
  }

  /**
   * Accept: the operator has found the money on the statement.
   *
   * The status claim and the credit are ONE transaction, and the claim is
   * a guarded `updateMany` on `status = PENDING` — a read-then-write
   * check would let two operators reviewing the same request each pass it
   * and each credit the seller. The UNIQUE `wallet_entry_id` is the
   * second line of defence.
   */
  async accept(
    topupId: string,
    staffId: string,
    note: string | null,
    ctx?: ClientContext,
  ): Promise<TopupRequestView> {
    const existing = await this.requireRequest(topupId);
    if (existing.status !== TopupRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'TOPUP_ALREADY_REVIEWED',
        message: `This request is already ${existing.status.toLowerCase()}`,
      });
    }
    // Hoisted so the acceptance email can quote what actually
    // reached the wallet, which is not what the seller sent when they
    // paid in taka.
    let credited = new Prisma.Decimal(0);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.walletTopupRequest.updateMany({
        where: { id: topupId, status: TopupRequestStatus.PENDING },
        data: {
          status: TopupRequestStatus.ACCEPTED,
          reviewedByStaffId: staffId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'TOPUP_ALREADY_REVIEWED',
          message: 'Someone else reviewed this request first',
        });
      }

      // Credited in INR whatever was wired.
      //
      // The wallet is INR-canonical — every other entry the system
      // writes is INR, and BDT is shown as a conversion of it rather
      // than a pot of its own. A taka top-up credited to a BDT wallet
      // would land in a balance nothing displays: the seller would send
      // real money, see it accepted, and watch their balance not move.
      //
      // What they actually sent is not lost — the request keeps its own
      // currency and amount, and the entry note carries both. This is
      // the same reasoning as the remittance fix: the wallet records
      // what is OWED, in one currency; the bank movement is recorded
      // where it happened.
      credited =
        existing.currency === Currency.INR
          ? existing.amount
          : new Prisma.Decimal(
              (
                await this.fx.convert({
                  amount: existing.amount.toFixed(2),
                  from: existing.currency,
                  to: Currency.INR,
                })
              ).amount,
            );
      const entry = await this.wallet.applyEntry(tx, {
        sellerId: existing.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.TOPUP,
        amount: credited,
        actorType: ActorType.STAFF,
        actorId: staffId,
        note:
          existing.currency === Currency.INR
            ? `Top-up verified — ${existing.transactionRef ?? 'proof on file'}`
            : `Top-up verified — ${existing.currency} ${existing.amount.toFixed(2)} converted — ` +
              `${existing.transactionRef ?? 'proof on file'}`,
      });

      return tx.walletTopupRequest.update({
        where: { id: topupId },
        data: { walletEntryId: entry.id },
      });
    });

    await this.wallet.recomputeCacheAfterCommit(
      existing.sellerId,
      Currency.INR,
      'post-topup-accept',
    );
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'wallet.topup.accepted',
      entityType: 'wallet_topup_request',
      entityId: topupId,
      severity: 'HIGH',
      metadata: {
        sellerId: existing.sellerId,
        amount: existing.amount.toFixed(2),
        currency: existing.currency,
        walletEntryId: updated.walletEntryId,
        ipAddress: ctx?.ipAddress,
        requestId: ctx?.requestId,
      },
    });
    await this.notifySeller(existing.sellerId, 'seller.topup_accepted.email', {
      amount: `${existing.currency} ${existing.amount.toFixed(2)}`,
      credited: `INR ${credited.toFixed(2)}`,
      bank_label: existing.bankLabel,
      reference: existing.transactionRef ?? 'receipt on file',
    });

    return this.toView(updated, existing.bank, {
      sellerCompanyName: existing.sellerCompanyName,
      reviewedByEmail: existing.reviewedByEmail,
    });
  }

  /** Reject: the money is not on the statement, or does not match. */
  async reject(
    topupId: string,
    staffId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<TopupRequestView> {
    if (reason.trim().length < 5) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Say why — the seller sees this, and "rejected" on its own is not actionable',
      });
    }
    const existing = await this.requireRequest(topupId);
    const claimed = await this.prisma.client.walletTopupRequest.updateMany({
      where: { id: topupId, status: TopupRequestStatus.PENDING },
      data: {
        status: TopupRequestStatus.REJECTED,
        reviewedByStaffId: staffId,
        reviewedAt: new Date(),
        reviewNote: reason.trim(),
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
      action: 'wallet.topup.rejected',
      entityType: 'wallet_topup_request',
      entityId: topupId,
      severity: 'MEDIUM',
      metadata: {
        sellerId: existing.sellerId,
        amount: existing.amount.toFixed(2),
        reason: reason.trim(),
        ipAddress: ctx?.ipAddress,
        requestId: ctx?.requestId,
      },
    });
    await this.notifySeller(existing.sellerId, 'seller.topup_rejected.email', {
      amount: `${existing.currency} ${existing.amount.toFixed(2)}`,
      bank_label: existing.bankLabel,
      reference: existing.transactionRef ?? 'no reference given',
      reason: reason.trim(),
    });

    const row = await this.requireRequest(topupId);
    return this.toView(row, row.bank, {
      sellerCompanyName: row.sellerCompanyName,
      reviewedByEmail: row.reviewedByEmail,
    });
  }

  async listForSeller(sellerId: string, status?: TopupRequestStatus): Promise<TopupRequestView[]> {
    const rows = await this.prisma.client.walletTopupRequest.findMany({
      where: { sellerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        bankAccount: {
          select: { label: true, bankName: true, accountNumber: true, branchName: true },
        },
        seller: { select: { companyName: true } },
        reviewedByStaff: { select: { emailDisplay: true } },
      },
    });
    return rows.map((r) =>
      this.toView(r, r.bankAccount, {
        sellerCompanyName: r.seller.companyName,
        reviewedByEmail: r.reviewedByStaff?.emailDisplay ?? null,
      }),
    );
  }

  async listForAdmin(status?: TopupRequestStatus): Promise<TopupRequestView[]> {
    const rows = await this.prisma.client.walletTopupRequest.findMany({
      where: status ? { status } : {},
      // Oldest PENDING first — a review queue is worked front to back,
      // and a seller waiting on money should not be overtaken.
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: {
        bankAccount: {
          select: { label: true, bankName: true, accountNumber: true, branchName: true },
        },
        seller: { select: { companyName: true } },
        reviewedByStaff: { select: { emailDisplay: true } },
      },
    });
    return rows.map((r) =>
      this.toView(r, r.bankAccount, {
        sellerCompanyName: r.seller.companyName,
        reviewedByEmail: r.reviewedByStaff?.emailDisplay ?? null,
      }),
    );
  }

  // ── internal ──────────────────────────────────────────────────────

  private async requireRequest(topupId: string): Promise<
    Prisma.WalletTopupRequestGetPayload<Record<string, never>> & {
      bankLabel: string;
      bank: { label: string; bankName: string; accountNumber: string; branchName: string | null };
      sellerCompanyName: string;
      reviewedByEmail: string | null;
    }
  > {
    const row = await this.prisma.client.walletTopupRequest.findUnique({
      where: { id: topupId },
      include: {
        bankAccount: {
          select: { label: true, bankName: true, accountNumber: true, branchName: true },
        },
        seller: { select: { companyName: true } },
        reviewedByStaff: { select: { emailDisplay: true } },
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'TOPUP_NOT_FOUND',
        message: 'Top-up request not found',
      });
    }
    const { bankAccount, seller, reviewedByStaff, ...rest } = row;
    return {
      ...rest,
      bankLabel: bankAccount.label,
      bank: bankAccount,
      sellerCompanyName: seller.companyName,
      reviewedByEmail: reviewedByStaff?.emailDisplay ?? null,
    };
  }

  private toView(
    row: {
      id: string;
      sellerId: string;
      bankAccountId: string;
      currency: Currency;
      amount: Prisma.Decimal;
      transactionRef: string | null;
      proofSpacesKey: string | null;
      status: TopupRequestStatus;
      reviewNote: string | null;
      reviewedAt: Date | null;
      createdAt: Date;
    },
    bank: { label: string; bankName: string; accountNumber: string; branchName: string | null },
    extra: { sellerCompanyName?: string | null; reviewedByEmail?: string | null } = {},
  ): TopupRequestView {
    return {
      id: row.id,
      sellerId: row.sellerId,
      bankAccountId: row.bankAccountId,
      bankLabel: bank.label,
      bankName: bank.bankName,
      bankAccountNumber: bank.accountNumber,
      bankBranchName: bank.branchName,
      sellerCompanyName: extra.sellerCompanyName ?? null,
      reviewedByEmail: extra.reviewedByEmail ?? null,
      currency: row.currency,
      amount: row.amount.toFixed(2),
      transactionRef: row.transactionRef,
      // The KEY never leaves the server — a caller asks for a presigned
      // read when they actually want to look at it.
      hasProof: row.proofSpacesKey !== null,
      status: row.status,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
    };
  }
}
