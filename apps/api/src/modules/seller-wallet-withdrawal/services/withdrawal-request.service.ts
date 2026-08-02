import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  Prisma,
  WithdrawalRequestedBy,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

const MIN_THRESHOLD_KEY = 'wallet.withdrawal_min_threshold_inr';
const MAX_PER_DAY_KEY = 'wallet.withdrawal_max_per_day';
const MAX_PER_MONTH_KEY = 'wallet.withdrawal_max_per_month';
const MIN_BALANCE_KEY = 'wallet.minimum_balance_inr';

export interface WithdrawalRequestView {
  readonly id: string;
  readonly sellerId: string;
  readonly currency: Currency;
  readonly amountRequested: string;
  readonly status: WithdrawalRequestStatus;
  readonly requestedBy: WithdrawalRequestedBy;
  readonly linkedRemittanceId: string | null;
  readonly rejectionReason: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

export interface CreateWithdrawalRequestInput {
  readonly currency: Currency;
  readonly amount: string;
  readonly note?: string | null;
}

/**
 * R2 (revised-plan roadmap) — seller-initiated withdrawal requests.
 * NEVER moves money itself: `RemittanceService.create()` (W-6, admin-
 * manual-payout) is the sole executor; `markPaid` only LINKS an
 * already-created Remittance to a request. This preserves "no
 * seller-initiated direct debit" — the ledger is only ever touched by
 * `WalletService.applyEntry`.
 */
/** A request in either of these has already been decided; the guarded
 *  claims below refuse to move it again. */
const RESOLVED_STATUSES: WithdrawalRequestStatus[] = [
  WithdrawalRequestStatus.PAID,
  WithdrawalRequestStatus.REJECTED,
];

@Injectable()
export class WithdrawalRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * Balance minus the floor, clamped at zero.
   *
   * Public because three callers need the SAME number: the request
   * guard, whatever the seller is shown as available, and the
   * auto-withdrawal sweep — which withdraws exactly this. Three
   * independent subtractions would eventually disagree, and the symptom
   * would be a sweep asking for money the guard then refuses.
   *
   * INR only: the floor setting is INR-denominated, matching the
   * documented scope of the minimum-threshold check below.
   */
  async withdrawableBalance(
    sellerId: string,
    currency: Currency,
    knownBalance?: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const balance = knownBalance ?? (await this.wallet.balanceLive(sellerId, currency));
    if (currency !== Currency.INR) return balance;
    const floor = await this.settings.resolve(sellerId, MIN_BALANCE_KEY);
    const min = new Prisma.Decimal(String(floor.value ?? 0));
    const available = balance.minus(min);
    return available.isNegative() ? new Prisma.Decimal(0) : available;
  }

  async create(
    sellerId: string,
    requestedByUserId: string,
    input: CreateWithdrawalRequestInput,
  ): Promise<WithdrawalRequestView> {
    return this.createInternal(sellerId, requestedByUserId, input, WithdrawalRequestedBy.SELLER);
  }

  /**
   * The same request, raised by the nightly sweep instead of a person.
   *
   * Deliberately routed through the identical guard chain: an automatic
   * request that skipped the balance floor or the rate limits would be a
   * way to get money out that a manual one could not, which is the
   * opposite of what automation should mean here.
   */
  async createAuto(
    sellerId: string,
    input: CreateWithdrawalRequestInput,
  ): Promise<WithdrawalRequestView> {
    return this.createInternal(sellerId, null, input, WithdrawalRequestedBy.SYSTEM);
  }

  private async createInternal(
    sellerId: string,
    requestedByUserId: string | null,
    input: CreateWithdrawalRequestInput,
    requestedBy: WithdrawalRequestedBy,
  ): Promise<WithdrawalRequestView> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'amount must be > 0',
      });
    }

    // Min-threshold is INR-denominated (the setting's own name/unit);
    // BDT requests skip this specific check by design — a BDT
    // threshold is a documented future extension, not built here.
    if (input.currency === Currency.INR) {
      const threshold = await this.settings.resolve(sellerId, MIN_THRESHOLD_KEY);
      const min = new Prisma.Decimal(String(threshold.value));
      if (amount.lt(min)) {
        throw new BadRequestException({
          code: 'BELOW_MIN_THRESHOLD',
          message: `amount (${amount}) is below the minimum withdrawal threshold (${min})`,
        });
      }
    }

    // Both limits are COUNTS of requests, not totals — the amount is
    // governed by the balance floor below.
    const maxPerDay = await this.settings.resolve(sellerId, MAX_PER_DAY_KEY);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await this.prisma.client.withdrawalRequest.count({
      where: { sellerId, createdAt: { gte: since } },
    });
    if (todayCount >= Number(maxPerDay.value)) {
      throw new ConflictException({
        code: 'WITHDRAWAL_DAILY_LIMIT_REACHED',
        message: `Already submitted ${todayCount} withdrawal request(s) in the last 24h (limit ${maxPerDay.value})`,
      });
    }

    const maxPerMonth = await this.settings.resolve(sellerId, MAX_PER_MONTH_KEY);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthCount = await this.prisma.client.withdrawalRequest.count({
      where: { sellerId, createdAt: { gte: monthAgo } },
    });
    if (monthCount >= Number(maxPerMonth.value)) {
      throw new ConflictException({
        code: 'WITHDRAWAL_MONTHLY_LIMIT_REACHED',
        message: `Already submitted ${monthCount} withdrawal request(s) in the last 30 days (limit ${maxPerMonth.value})`,
      });
    }

    // The balance floor. What the seller may take is the balance MINUS
    // the minimum they must leave behind — not the whole balance.
    //
    // This is what stands between us and an unpaid delivery fee on a
    // prepaid seller, whose wallet is the only security we hold. Raising
    // their floor is how a credit limit is expressed here.
    const balance = await this.wallet.balanceLive(sellerId, input.currency);
    const withdrawable = await this.withdrawableBalance(sellerId, input.currency, balance);
    if (withdrawable.lt(amount)) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_WITHDRAWABLE_BALANCE',
        message:
          `Wallet balance is ${balance}, of which ${withdrawable} is withdrawable ` +
          `(the rest is held by this account's minimum balance). Requested ${amount}.`,
      });
    }

    const row = await this.prisma.client.withdrawalRequest.create({
      data: {
        sellerId,
        currency: input.currency,
        amountRequested: amount,
        requestedBy,
        requestedByUserId,
        note: input.note ?? null,
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: requestedByUserId,
      sellerId,
      action: 'seller.withdrawal_request.created',
      entityType: 'withdrawal_request',
      entityId: row.id,
      metadata: { currency: input.currency, amount: amount.toString() },
      severity: 'MEDIUM',
    });

    return this.toView(row);
  }

  async listForSeller(sellerId: string): Promise<readonly WithdrawalRequestView[]> {
    const rows = await this.prisma.client.withdrawalRequest.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async listForAdmin(filters: {
    sellerId?: string;
    status?: WithdrawalRequestStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: readonly WithdrawalRequestView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const where = {
      ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.withdrawalRequest.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  /** Links an already-created Remittance (the actual money movement)
   *  to a request and marks it PAID. Does NOT create the Remittance —
   *  that's the existing `POST /admin/remittances` flow. */
  async markPaid(
    requestId: string,
    staffId: string,
    linkedRemittanceId: string,
  ): Promise<WithdrawalRequestView> {
    const existing = await this.prisma.client.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'WITHDRAWAL_REQUEST_NOT_FOUND',
        message: `Withdrawal request ${requestId} not found`,
      });
    }
    if (
      existing.status === WithdrawalRequestStatus.PAID ||
      existing.status === WithdrawalRequestStatus.REJECTED
    ) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED',
        message: `Withdrawal request ${requestId} is already ${existing.status}`,
      });
    }
    const remittance = await this.prisma.client.remittance.findUnique({
      where: { id: linkedRemittanceId },
      select: { id: true, sellerId: true },
    });
    if (!remittance) {
      throw new NotFoundException({
        code: 'REMITTANCE_NOT_FOUND',
        message: `Remittance ${linkedRemittanceId} not found`,
      });
    }
    if (remittance.sellerId !== existing.sellerId) {
      throw new BadRequestException({
        code: 'REMITTANCE_SELLER_MISMATCH',
        message: 'The linked remittance belongs to a different seller',
      });
    }

    // Guarded on "still unresolved", not just `id`. The check above is a
    // read outside any transaction; without this, two admins resolving the
    // same request would both write and the last would win — silently
    // detaching one of the two remittances from the request it paid, so a
    // real bank transfer ends up accounted to nothing. No money is
    // duplicated (the remittance moves it, not this row), but a payout
    // that cannot be traced back to its request is its own problem.
    const claimed = await this.prisma.client.withdrawalRequest.updateMany({
      where: { id: requestId, status: { notIn: RESOLVED_STATUSES } },
      data: {
        status: WithdrawalRequestStatus.PAID,
        linkedRemittanceId,
        resolvedByStaffId: staffId,
        resolvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED',
        message: `Withdrawal request ${requestId} was resolved by someone else first`,
      });
    }
    const updated = await this.prisma.client.withdrawalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: existing.sellerId,
      action: 'staff.withdrawal_request.paid',
      entityType: 'withdrawal_request',
      entityId: requestId,
      metadata: { linkedRemittanceId },
      severity: 'MEDIUM',
    });

    return this.toView(updated);
  }

  async reject(requestId: string, staffId: string, reason: string): Promise<WithdrawalRequestView> {
    const existing = await this.prisma.client.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'WITHDRAWAL_REQUEST_NOT_FOUND',
        message: `Withdrawal request ${requestId} not found`,
      });
    }
    if (
      existing.status === WithdrawalRequestStatus.PAID ||
      existing.status === WithdrawalRequestStatus.REJECTED
    ) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED',
        message: `Withdrawal request ${requestId} is already ${existing.status}`,
      });
    }

    const claimed = await this.prisma.client.withdrawalRequest.updateMany({
      where: { id: requestId, status: { notIn: RESOLVED_STATUSES } },
      data: {
        status: WithdrawalRequestStatus.REJECTED,
        rejectionReason: reason,
        resolvedByStaffId: staffId,
        resolvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED',
        message: `Withdrawal request ${requestId} was resolved by someone else first`,
      });
    }
    const updated = await this.prisma.client.withdrawalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: existing.sellerId,
      action: 'staff.withdrawal_request.rejected',
      entityType: 'withdrawal_request',
      entityId: requestId,
      metadata: { reason },
      severity: 'MEDIUM',
    });

    return this.toView(updated);
  }

  private toView(row: {
    id: string;
    sellerId: string;
    currency: Currency;
    amountRequested: Prisma.Decimal;
    status: WithdrawalRequestStatus;
    requestedBy: WithdrawalRequestedBy;
    linkedRemittanceId: string | null;
    rejectionReason: string | null;
    note: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }): WithdrawalRequestView {
    return {
      id: row.id,
      sellerId: row.sellerId,
      currency: row.currency,
      amountRequested: row.amountRequested.toFixed(2),
      status: row.status,
      requestedBy: row.requestedBy,
      linkedRemittanceId: row.linkedRemittanceId,
      rejectionReason: row.rejectionReason,
      note: row.note,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }
}
