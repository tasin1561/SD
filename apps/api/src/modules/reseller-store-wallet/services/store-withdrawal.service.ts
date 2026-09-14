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
  ResellerWalletManager,
  StoreWalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { lockAccountsForPosting } from '../../../common/db/advisory-lock';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
  isUniqueViolation,
} from '../../treasury/services/bank-ledger.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { parseAmount, StoreWalletService, STORE_WALLET_TX_OPTIONS } from './store-wallet.service';

const ZERO = new Prisma.Decimal(0);
const OPEN: readonly WithdrawalRequestStatus[] = [
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
];

export interface StoreWithdrawalView {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly amountInr: string;
  readonly status: WithdrawalRequestStatus;
  readonly payeeName: string;
  readonly payeeAccountNumber: string;
  readonly payeeIfsc: string;
  readonly payeeBankName: string;
  readonly note: string | null;
  readonly rejectionReason: string | null;
  readonly resolvedAt: string | null;
  readonly paidFromLabel: string | null;
  readonly bankReference: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

const VIEW_INCLUDE = {
  store: { select: { name: true, displayName: true, seller: { select: { companyName: true } } } },
  paidFromAccount: { select: { label: true } },
} as const;

type WithdrawalRow = Prisma.StoreWithdrawalRequestGetPayload<{ include: typeof VIEW_INCLUDE }>;

export interface StoreWithdrawalRequestInput {
  readonly amountInr: string;
  readonly payeeName: string;
  readonly payeeAccountNumber: string;
  readonly payeeIfsc: string;
  readonly payeeBankName: string;
  readonly note?: string | null;
}

export interface StoreWithdrawalPayInput {
  readonly paidFromAccountId: string;
  readonly bankReference: string;
  /** ISO date-time the bank confirmed it. */
  readonly paidAt: string;
  readonly idempotencyKey?: string | null;
}

/**
 * RS-6 — a SKYDROP-managed store taking its money out, through us.
 *
 * A REQUEST first (it moves nothing), then a person approves and records
 * the payout. PENDING and APPROVED requests are held out of what the store
 * may withdraw (WAL-3's amended rule), and "what it may withdraw" is the
 * ONE method `StoreWalletService.storeWithdrawable` — the lower of the
 * store's own free balance and its seller's GROUP free balance.
 *
 * ── WHY A DEDICATED SERVICE, NOT THE REMITTANCE MACHINERY ────────────
 * `RemittanceService` pays a SELLER: it snapshots the seller's bank
 * details, debits the seller's wallet (REMITTANCE_OUT) and closes a
 * seller's withdrawal request — none of which is true of a store. What IS
 * the same is the cash rule, and it is mirrored here exactly: decision 7
 * makes the cash leaving the SELLER's, as far as they hold it in the
 * paying account; the rest leaves as ours and an equal value of their
 * money elsewhere becomes ours (`takeToCapital`, clamped). Rupees only.
 * The book then falls by exactly what the group's balance did, so
 * held = max(0, group) holds after the payout as it did before.
 */
@Injectable()
export class StoreWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly storeWallet: StoreWalletService,
    private readonly bank: BankLedgerService,
    private readonly attribution: SellerCashAttributionService,
  ) {}

  async request(
    user: AuthenticatedStoreUser,
    input: StoreWithdrawalRequestInput,
  ): Promise<StoreWithdrawalView> {
    const amount = parseAmount(input.amountInr);
    const payee = {
      payeeName: required(input.payeeName, 'the name on the account', 2, 160),
      payeeAccountNumber: required(input.payeeAccountNumber, 'the account number', 4, 40),
      payeeIfsc: ifsc(input.payeeIfsc),
      payeeBankName: required(input.payeeBankName, 'the bank', 2, 120),
    };
    const note = input.note?.trim() || null;

    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.storeWallet.lockSeller(tx, user.sellerId);
      const store = await this.storeWallet.loadStore(tx, { storeId: user.storeId });
      if (store.walletManagedBy !== ResellerWalletManager.SKYDROP) {
        throw new ConflictException({
          code: 'STORE_WALLET_SELLER_MANAGED',
          message: `${store.sellerCompanyName} manages this store’s wallet and pays you directly.`,
        });
      }
      const { withdrawable } = await this.storeWallet.storeWithdrawable(tx, {
        storeId: store.id,
        sellerId: store.sellerId,
      });
      if (withdrawable.lessThan(amount)) {
        throw new BadRequestException({
          code: 'STORE_WITHDRAWAL_EXCEEDS_WITHDRAWABLE',
          message:
            `You can withdraw at most ₹${withdrawable.toFixed(2)} now — your balance, less ` +
            'withdrawals already asked for, and never more than your seller’s account holds for you.',
        });
      }
      return tx.storeWithdrawalRequest.create({
        data: {
          storeId: store.id,
          sellerId: store.sellerId,
          amountInr: amount,
          ...payee,
          note,
          requestedByStoreUserId: user.id,
        },
        include: VIEW_INCLUDE,
      });
    }, STORE_WALLET_TX_OPTIONS);

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'reseller_store.withdrawal_requested',
      entityType: 'store_withdrawal_request',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: { storeId: user.storeId, amountInr: amount.toFixed(2) },
    });
    return toView(row);
  }

  async listForStore(storeId: string): Promise<readonly StoreWithdrawalView[]> {
    const rows = await this.prisma.client.storeWithdrawalRequest.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: VIEW_INCLUDE,
    });
    return rows.map(toView);
  }

  async listForAdmin(filter: {
    status?: WithdrawalRequestStatus;
    storeId?: string;
  }): Promise<readonly StoreWithdrawalView[]> {
    const rows = await this.prisma.client.storeWithdrawalRequest.findMany({
      where: {
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.storeId === undefined ? {} : { storeId: filter.storeId }),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: VIEW_INCLUDE,
    });
    return rows.map(toView);
  }

  /**
   * Approve: a person has said yes, re-checked against what the store may
   * withdraw NOT counting this request (it must not block itself) — under
   * the seller's WALLET lock, guarded on PENDING.
   */
  async approve(id: string, staffId: string): Promise<StoreWithdrawalView> {
    const req = await this.load(id);
    await this.prisma.client.$transaction(async (tx) => {
      await this.storeWallet.lockSeller(tx, req.sellerId);
      const { withdrawable } = await this.storeWallet.storeWithdrawable(tx, {
        storeId: req.storeId,
        sellerId: req.sellerId,
        excludeRequestId: id,
      });
      if (withdrawable.lessThan(req.amountInr)) {
        throw new ConflictException({
          code: 'STORE_WITHDRAWAL_UNPAYABLE',
          message: `The store may withdraw ₹${withdrawable.toFixed(2)} now — less than this request. Reject it; the store can ask again.`,
        });
      }
      const moved = await tx.storeWithdrawalRequest.updateMany({
        where: { id, status: WithdrawalRequestStatus.PENDING },
        data: {
          status: WithdrawalRequestStatus.APPROVED,
          resolvedByStaffId: staffId,
          resolvedAt: new Date(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: 'STORE_WITHDRAWAL_ALREADY_MOVED',
          message: 'Someone else resolved this request first',
        });
      }
    }, STORE_WALLET_TX_OPTIONS);
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: req.sellerId,
      action: 'reseller_store.withdrawal_approved',
      entityType: 'store_withdrawal_request',
      entityId: id,
      severity: 'MEDIUM',
      metadata: { storeId: req.storeId, amountInr: req.amountInr.toFixed(2) },
    });
    return this.view(id);
  }

  async reject(id: string, staffId: string, reason: string): Promise<StoreWithdrawalView> {
    const why = reason.trim();
    if (why.length < 5) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Say why — the store reads this.',
      });
    }
    const req = await this.load(id);
    const moved = await this.prisma.client.storeWithdrawalRequest.updateMany({
      where: { id, status: { in: [...OPEN] } },
      data: {
        status: WithdrawalRequestStatus.REJECTED,
        rejectionReason: why,
        resolvedByStaffId: staffId,
        resolvedAt: new Date(),
      },
    });
    if (moved.count === 0) {
      throw new ConflictException({
        code: 'STORE_WITHDRAWAL_ALREADY_MOVED',
        message: 'This request is already paid or rejected',
      });
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: req.sellerId,
      action: 'reseller_store.withdrawal_rejected',
      entityType: 'store_withdrawal_request',
      entityId: id,
      severity: 'MEDIUM',
      metadata: { storeId: req.storeId, amountInr: req.amountInr.toFixed(2), reason: why },
    });
    return this.view(id);
  }

  /**
   * Record the payout. The claim (guarded on the status READ), the store
   * debit and the cash leaving are ONE transaction; locks in the one order:
   * the seller's WALLET → the paying account's reconcile key → (inside a
   * `takeToCapital` pair) ATTRIBUTION_RECONCILE_KEY.
   */
  async pay(
    id: string,
    staffId: string,
    input: StoreWithdrawalPayInput,
  ): Promise<StoreWithdrawalView> {
    const reference = input.bankReference.trim();
    if (reference.length < 3) {
      throw new BadRequestException({
        code: 'BANK_REFERENCE_REQUIRED',
        message: 'Give the bank’s reference for the transfer — it is what the store matches.',
      });
    }
    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: 'paidAt must be a date' });
    }
    const key = input.idempotencyKey ?? null;
    const replayed = await this.replay(key, id, input.paidFromAccountId, reference);
    if (replayed !== null) return replayed;

    const req = await this.load(id);
    let entryId: string;
    try {
      entryId = await this.prisma.client.$transaction(async (tx) => {
        await this.storeWallet.lockSeller(tx, req.sellerId);
        await lockAccountsForPosting(tx, [input.paidFromAccountId]);
        const current = await tx.storeWithdrawalRequest.findUnique({
          where: { id },
          select: { status: true },
        });
        if (current === null || !OPEN.includes(current.status)) {
          throw new ConflictException({
            code: 'STORE_WITHDRAWAL_ALREADY_MOVED',
            message: 'This request is already paid or rejected',
          });
        }
        const account = await tx.platformBankAccount.findFirst({
          where: { id: input.paidFromAccountId, deletedAt: null },
          select: { currency: true },
        });
        if (account === null) {
          throw new NotFoundException({
            code: 'BANK_ACCOUNT_NOT_FOUND',
            message: 'No such bank account, or it has been retired.',
          });
        }
        if (account.currency !== Currency.INR) {
          throw new BadRequestException({
            code: 'STORE_WITHDRAWAL_ACCOUNT_NOT_INR',
            message: 'A store is paid in rupees — pay it from one of our rupee accounts.',
          });
        }
        const store = await this.storeWallet.loadStore(tx, { storeId: req.storeId });
        if (store.walletManagedBy !== ResellerWalletManager.SKYDROP) {
          throw new ConflictException({
            code: 'STORE_WALLET_SELLER_MANAGED',
            message: 'The seller manages this store’s wallet now — reject the request.',
          });
        }
        const { withdrawable } = await this.storeWallet.storeWithdrawable(tx, {
          storeId: req.storeId,
          sellerId: req.sellerId,
          excludeRequestId: id,
        });
        if (withdrawable.lessThan(req.amountInr)) {
          throw new ConflictException({
            code: 'STORE_WITHDRAWAL_UNPAYABLE',
            message: `The store may withdraw ₹${withdrawable.toFixed(2)} now — less than this request. Reject it; the store can ask again.`,
          });
        }
        const claimed = await tx.storeWithdrawalRequest.updateMany({
          where: { id, status: current.status },
          data: {
            status: WithdrawalRequestStatus.PAID,
            resolvedByStaffId: staffId,
            resolvedAt: new Date(),
            paidFromAccountId: input.paidFromAccountId,
            bankReference: reference,
            paidAt,
            payoutIdempotencyKey: key,
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'STORE_WITHDRAWAL_ALREADY_MOVED',
            message: 'Someone else resolved this request first',
          });
        }

        const amount = req.amountInr;
        const entry = await this.storeWallet.applyEntry(tx, {
          storeId: req.storeId,
          sellerId: req.sellerId,
          direction: StoreWalletEntryDirection.WITHDRAWAL,
          amount,
          note: `Paid to ${req.payeeName} — ${reference}`,
          reasonCode: 'STORE_WITHDRAWAL',
          actorType: ActorType.STAFF,
          actorId: staffId,
        });

        // ── The cash (decision 7: the SELLER's) ─────────────────────────
        // The seller's money in the paying account goes first, up to the
        // payout; whatever that does not cover leaves as OURS, and an equal
        // value of their money elsewhere becomes ours (clamped to what they
        // hold — beyond it their group owes us, a receivable).
        const here = await this.bank.sellerBook(
          req.sellerId,
          input.paidFromAccountId,
          Currency.INR,
          tx,
        );
        const fromSeller = here.units.greaterThan(0)
          ? here.units.lessThan(amount)
            ? here.units
            : amount
          : ZERO;
        const rest = amount.sub(fromSeller);
        const base = {
          accountId: input.paidFromAccountId,
          type: BankEntryType.SELLER_WITHDRAWAL,
          amountCurrency: Currency.INR,
          actorType: ActorType.STAFF,
          staffId,
          occurredAt: paidAt,
          reference,
        } as const;
        if (fromSeller.greaterThan(0)) {
          await this.bank.post(
            {
              ...base,
              signedAmount: fromSeller.neg(),
              owner: { kind: BankOwnerKind.SELLER, sellerId: req.sellerId },
              note: `Reseller store ${store.displayName ?? store.name} paid out`,
            },
            tx,
          );
        }
        if (rest.greaterThan(0)) {
          await this.bank.post(
            {
              ...base,
              signedAmount: rest.neg(),
              owner: { kind: BankOwnerKind.CAPITAL },
              note: `Reseller store ${store.displayName ?? store.name} paid out from our money here — the seller’s money elsewhere becomes ours`,
            },
            tx,
          );
          await this.attribution.takeToCapital(tx, {
            sellerId: req.sellerId,
            amount: rest,
            reference: entry.id,
            note: `Store payout ${reference} paid from our money — this was the seller’s`,
          });
        }
        await tx.storeWithdrawalRequest.update({
          where: { id },
          data: { storeEntryId: entry.id },
        });
        return entry.id;
      }, STORE_WALLET_TX_OPTIONS);
    } catch (err) {
      const raced = isUniqueViolation(err)
        ? await this.replay(key, id, input.paidFromAccountId, reference)
        : null;
      if (raced !== null) return raced;
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: req.sellerId,
      action: 'reseller_store.withdrawal_paid',
      entityType: 'store_withdrawal_request',
      entityId: id,
      severity: 'HIGH',
      metadata: {
        storeId: req.storeId,
        amountInr: req.amountInr.toFixed(2),
        paidFromAccountId: input.paidFromAccountId,
        bankReference: reference,
        storeEntryId: entryId,
      },
    });
    return this.view(id);
  }

  /**
   * IDEM-1: a retried pay form. Answered only when the stored payout
   * matches — the same request, account and reference.
   */
  private async replay(
    key: string | null,
    id: string,
    accountId: string,
    reference: string,
  ): Promise<StoreWithdrawalView | null> {
    if (key === null) return null;
    const prior = await this.prisma.client.storeWithdrawalRequest.findUnique({
      where: { payoutIdempotencyKey: key },
      select: { id: true, paidFromAccountId: true, bankReference: true },
    });
    if (prior === null) return null;
    if (
      prior.id !== id ||
      prior.paidFromAccountId !== accountId ||
      prior.bankReference !== reference
    ) {
      throw idempotencyKeyReused('store payout');
    }
    return this.view(id);
  }

  private async load(id: string): Promise<{
    storeId: string;
    sellerId: string;
    amountInr: Prisma.Decimal;
    payeeName: string;
  }> {
    const req = await this.prisma.client.storeWithdrawalRequest.findUnique({
      where: { id },
      select: { storeId: true, sellerId: true, amountInr: true, payeeName: true },
    });
    if (req === null) {
      throw new NotFoundException({
        code: 'STORE_WITHDRAWAL_NOT_FOUND',
        message: 'No such withdrawal request',
      });
    }
    return req;
  }

  private async view(id: string): Promise<StoreWithdrawalView> {
    const row = await this.prisma.client.storeWithdrawalRequest.findUniqueOrThrow({
      where: { id },
      include: VIEW_INCLUDE,
    });
    return toView(row);
  }
}

function required(raw: string, what: string, min: number, max: number): string {
  const t = raw.trim();
  if (t.length < min || t.length > max) {
    throw new BadRequestException({
      code: 'PAYEE_DETAILS_INVALID',
      message: `Give ${what} (${min}–${max} characters).`,
    });
  }
  return t;
}

/** An Indian IFSC: four letters, a zero, six letters or digits. */
function ifsc(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(t)) {
    throw new BadRequestException({
      code: 'PAYEE_IFSC_INVALID',
      message: 'That IFSC does not look right — four letters, a zero, then six letters or digits.',
    });
  }
  return t;
}

function toView(r: WithdrawalRow): StoreWithdrawalView {
  return {
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.displayName ?? r.store.name,
    sellerId: r.sellerId,
    sellerCompanyName: r.store.seller.companyName,
    amountInr: r.amountInr.toFixed(2),
    status: r.status,
    payeeName: r.payeeName,
    payeeAccountNumber: r.payeeAccountNumber,
    payeeIfsc: r.payeeIfsc,
    payeeBankName: r.payeeBankName,
    note: r.note,
    rejectionReason: r.rejectionReason,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    paidFromLabel: r.paidFromAccount?.label ?? null,
    bankReference: r.bankReference,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
