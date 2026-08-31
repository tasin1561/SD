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
  SellerCapability,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
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
  /**
   * How long this has been waiting, for a request still PENDING. Null
   * once decided — the age of a settled request is not a queue.
   */
  readonly waitingHours: number | null;
  /** Past the SLA we told the seller to expect. */
  readonly slaBreached: boolean;
}

export interface AdminWithdrawalListResult {
  readonly items: readonly WithdrawalRequestView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** What we told the seller to expect, so the page can name the promise. */
  readonly slaHours: number;
  /** Pending requests past it. Counted across ALL pages, not this one. */
  readonly breachedCount: number;
  readonly breachedInr: string;
  /** The longest anything has been waiting, in hours. Null when nothing is. */
  readonly oldestPendingHours: number | null;
}

export interface CreateWithdrawalRequestInput {
  readonly currency: Currency;
  readonly amount: string;
  readonly note?: string | null;
}

/**
 * R2 (revised-plan roadmap) — seller-initiated withdrawal requests.
 * NEVER moves money itself: `RemittanceService.create()` (W-6, admin-
 * manual-withdrawal) is the sole executor; `markPaid` only LINKS an
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

/** Someone is still waiting for money in either of these. */
const UNPAID_STATUSES: WithdrawalRequestStatus[] = [
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
];

@Injectable()
export class WithdrawalRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
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
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const balance = knownBalance ?? (await this.wallet.balanceLive(sellerId, currency));
    if (currency !== Currency.INR) return balance;
    const floor = await this.settings.resolve(sellerId, MIN_BALANCE_KEY);
    const min = new Prisma.Decimal(String(floor.value ?? 0));

    // Money already asked for is NOT available again.
    //
    // A request writes no wallet entry — the balance only moves when the
    // remittance is actually paid (WAL-6) — so without this subtraction
    // the same rupees can be requested twice. A seller with ₹10,000
    // could raise two ₹10,000 requests on consecutive days, both pass
    // this guard, and both be payable: ₹20,000 out of a ₹10,000 wallet.
    // The daily and monthly caps limit how OFTEN, never how much.
    //
    // Held rather than debited on purpose. A request is not a payment,
    // and debiting one would take money from a seller for a transfer
    // nobody has made — the same reasoning that keeps a top-up out of
    // the balance until an operator has seen it.
    const db = tx ?? this.prisma.client;
    const pending = await db.withdrawalRequest.aggregate({
      where: { sellerId, currency, status: WithdrawalRequestStatus.PENDING },
      _sum: { amountRequested: true },
    });
    const held = pending._sum.amountRequested ?? new Prisma.Decimal(0);

    const available = balance.minus(min).minus(held);
    return available.isNegative() ? new Prisma.Decimal(0) : available;
  }

  /**
   * What the seller needs to know BEFORE filling in the form: how much
   * they can actually take, and whether we have anywhere to send it.
   *
   * Both facts come from the same places the guards read, so the form
   * cannot promise something the server then refuses. It is still only a
   * courtesy — `createInternal` re-checks each one inside the write
   * transaction, because a balance read outside it is already stale
   * (WAL-7).
   */
  async eligibility(sellerId: string): Promise<{
    withdrawableInr: string;
    balanceInr: string;
    minimumBalanceInr: string;
    /** Already asked for and not yet paid — held out of what is available. */
    pendingWithdrawalInr: string;
    hasBankAccount: boolean;
  }> {
    const balance = await this.wallet.balanceLive(sellerId, Currency.INR);
    const withdrawable = await this.withdrawableBalance(sellerId, Currency.INR, balance);
    const floor = await this.settings.resolve(sellerId, MIN_BALANCE_KEY);
    const seller = await this.prisma.client.seller.findUnique({
      where: { id: sellerId },
      select: { bankAccountNumber: true },
    });
    const pending = await this.prisma.client.withdrawalRequest.aggregate({
      where: { sellerId, currency: Currency.INR, status: WithdrawalRequestStatus.PENDING },
      _sum: { amountRequested: true },
    });

    return {
      withdrawableInr: withdrawable.toFixed(2),
      balanceInr: balance.toFixed(2),
      minimumBalanceInr: new Prisma.Decimal(String(floor.value ?? 0)).toFixed(2),
      pendingWithdrawalInr: (pending._sum.amountRequested ?? new Prisma.Decimal(0)).toFixed(2),
      hasBankAccount: seller?.bankAccountNumber != null && seller.bankAccountNumber.trim() !== '',
    };
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

    // ── Everything below is ONE locked transaction ────────────────────
    // Every check here is a read-then-write: count the day's requests,
    // count the month's, read the balance, then insert. Run
    // concurrently, two submissions each see the state before the other
    // and both pass — the seller ends up with two requests for the
    // whole withdrawable balance and both count limits bypassed. It is
    // the same shape as the wallet writer, the ticket double-refund and
    // the pickup-request duplicate, so it takes the same instrument: the
    // seller's own wallet lock, which also serialises this against a
    // credit landing mid-check.
    //
    // The money itself was never at risk — a remittance is what actually
    // pays, and that refuses to push the wallet negative. What was at
    // risk is the limits meaning anything, and an operator being shown a
    // queue that asks for more than exists.
    return this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${input.currency}`);

      // Both limits are COUNTS of requests, not totals — the amount is
      // governed by the balance floor below.
      const maxPerDay = await this.settings.resolve(sellerId, MAX_PER_DAY_KEY);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const todayCount = await tx.withdrawalRequest.count({
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
      const monthCount = await tx.withdrawalRequest.count({
        where: { sellerId, createdAt: { gte: monthAgo } },
      });
      if (monthCount >= Number(maxPerMonth.value)) {
        throw new ConflictException({
          code: 'WITHDRAWAL_MONTHLY_LIMIT_REACHED',
          message: `Already submitted ${monthCount} withdrawal request(s) in the last 30 days (limit ${maxPerMonth.value})`,
        });
      }

      // A seller on hold cannot take money out.
      //
      // Inside the transaction with the other guards, and reached by
      // BOTH the manual request and the nightly sweep — an automatic
      // path that could move money a manual one could not is backwards
      // (WAL-3).
      await this.restrictions.assertAllowed(sellerId, SellerCapability.WITHDRAWAL_REQUEST);

      // Somewhere to pay it TO.
      //
      // A withdrawal request with no bank details on file is a promise
      // nobody can keep: an operator picks it up, has no account to wire
      // to, and it sits in the queue while the seller waits. Refused
      // here rather than only hidden in the UI — the server is the
      // boundary (FE-2), and the nightly auto-sweep raises requests
      // through this same path with no screen in front of it.
      //
      // The profile enforces bank details all-or-nothing, so the account
      // number standing in for "has details" is exact rather than a
      // sample: a seller cannot have saved it without the rest.
      const seller = await tx.seller.findUnique({
        where: { id: sellerId },
        select: { bankAccountNumber: true },
      });
      if (seller?.bankAccountNumber == null || seller.bankAccountNumber.trim() === '') {
        throw new BadRequestException({
          code: 'NO_BANK_ACCOUNT_ON_FILE',
          message:
            'Add your bank details on your profile before requesting a withdrawal — without them ' +
            'there is nowhere for us to send the money.',
        });
      }

      // The balance floor. What the seller may take is the balance MINUS
      // the minimum they must leave behind — not the whole balance.
      //
      // This is what stands between us and an unpaid delivery fee on a
      // prepaid seller, whose wallet is the only security we hold. Raising
      // their floor is how a credit limit is expressed here.
      const balance = await this.wallet.balanceLive(sellerId, input.currency, tx);
      const withdrawable = await this.withdrawableBalance(sellerId, input.currency, balance, tx);
      if (withdrawable.lt(amount)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_WITHDRAWABLE_BALANCE',
          message:
            `Wallet balance is ${balance}, of which ${withdrawable} is withdrawable ` +
            `(the rest is held by this account's minimum balance). Requested ${amount}.`,
        });
      }

      const row = await tx.withdrawalRequest.create({
        data: {
          sellerId,
          currency: input.currency,
          amountRequested: amount,
          requestedBy,
          requestedByUserId,
          note: input.note ?? null,
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          actorId: requestedByUserId,
          sellerId,
          action: 'seller.withdrawal_request.created',
          entityType: 'withdrawal_request',
          entityId: row.id,
          metadata: { currency: input.currency, amount: amount.toString() },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toView(row);
    });
  }

  async listForSeller(sellerId: string): Promise<readonly WithdrawalRequestView[]> {
    const rows = await this.prisma.client.withdrawalRequest.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * The admin queue, with the promise we made attached to it.
   *
   * `wallet.withdrawal_sla_hours` has existed since the wallet shipped
   * and is documented as DISPLAY ONLY — a seller is told "processed
   * within 48 hours" and NOTHING anywhere measured whether that
   * happened. A request could sit past its own SLA indefinitely and no
   * screen said so, which is the silent half of "approved and never
   * paid": nobody is chasing it because nobody can see it.
   *
   * The breach counts are computed across EVERY matching row, not the
   * page — a queue that is two pages long hides its oldest entries
   * exactly when it matters most.
   */
  async listForAdmin(filters: {
    sellerId?: string;
    status?: WithdrawalRequestStatus;
    page?: number;
    pageSize?: number;
  }): Promise<AdminWithdrawalListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const where = {
      ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
    };

    // Read straight from system_settings rather than through the
    // resolver: this key carries no `sellerOverridable`, so there is no
    // per-seller answer to resolve and asking for one across a
    // cross-seller queue would be N reads for one number. SET-1 governs
    // overrides, and this key has none.
    const slaRow = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'wallet.withdrawal_sla_hours' },
      select: { valueInt: true },
    });
    const slaHours = slaRow?.valueInt ?? 48;
    const now = new Date();
    const breachCutoff = new Date(now.getTime() - slaHours * 3_600_000);

    // Oldest FIRST on either unpaid view. Newest-first is right for
    // history and wrong for work: it buries the request that has waited
    // longest at the bottom of the list.
    const pendingView = filters.status !== undefined && UNPAID_STATUSES.includes(filters.status);

    const [rows, total, breached, oldest] = await Promise.all([
      this.prisma.client.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: pendingView ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.withdrawalRequest.count({ where }),
      this.prisma.client.withdrawalRequest.aggregate({
        where: {
          ...where,
          status: { in: UNPAID_STATUSES },
          createdAt: { lte: breachCutoff },
        },
        _count: { _all: true },
        _sum: { amountRequested: true },
      }),
      this.prisma.client.withdrawalRequest.findFirst({
        where: { ...where, status: { in: UNPAID_STATUSES } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      items: rows.map((r) => this.toView(r, slaHours, now)),
      total,
      page,
      pageSize,
      slaHours,
      breachedCount: breached._count._all,
      breachedInr: (breached._sum.amountRequested ?? new Prisma.Decimal(0)).toFixed(2),
      oldestPendingHours:
        oldest === null
          ? null
          : Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000),
    };
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
    // duplicated (the remittance moves it, not this row), but a withdrawal
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

  /**
   * Say yes, before the money moves.
   *
   * APPROVED existed in the enum from the start and NOTHING ever wrote
   * it — the only reference was a liabilities report reading it — so
   * the page's own copy described a step that did not exist, and a
   * seller's request had exactly two answers: paid, or refused.
   *
   * The decision and the payment are genuinely different acts, often by
   * different people and often a day apart. Separating them lets the
   * seller be told "yes, it is coming" the moment somebody decides,
   * instead of hearing nothing until the transfer clears.
   *
   * Approving moves NO money and is not the last word: the request is
   * still unpaid, still counts against the SLA, and can still be
   * rejected if the transfer turns out to be impossible.
   *
   * It is OPTIONAL. `markPaid` accepts a PENDING request as well, so an
   * operator who does both jobs in one sitting is not made to click
   * twice. A step that can be skipped when it adds nothing is what
   * keeps it meaningful when it is used.
   */
  async approve(requestId: string, staffId: string, note?: string): Promise<WithdrawalRequestView> {
    const existing = await this.prisma.client.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'WITHDRAWAL_REQUEST_NOT_FOUND',
        message: `Withdrawal request ${requestId} not found`,
      });
    }
    if (existing.status !== WithdrawalRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_NOT_PENDING',
        message: `Withdrawal request ${requestId} is ${existing.status}, not pending`,
      });
    }

    // Re-check the money NOW, not as it was at request time.
    //
    // The balance was validated when the seller asked, and everything
    // that happens between then and here can lower it — order charges,
    // a return fee, freight. Approving on the old number is promising
    // money that is no longer there, and the seller has by then been
    // told yes. Same subtraction the request guard and the auto-sweep
    // use (WAL-3), so the three cannot disagree.
    const available = await this.withdrawableBalance(existing.sellerId, existing.currency);
    if (available.lt(existing.amountRequested)) {
      throw new ConflictException({
        code: 'WITHDRAWAL_BALANCE_NO_LONGER_COVERS',
        message:
          `This asked for ${existing.amountRequested.toFixed(2)} and only ` +
          `${available.toFixed(2)} is withdrawable now. Reject it, or wait for the balance.`,
      });
    }

    // Guarded on PENDING rather than on id: the read above is outside
    // any transaction, so two admins approving at once would both write
    // and the second would overwrite the first's decision. `count === 0`
    // is Postgres saying somebody got there first.
    const claimed = await this.prisma.client.withdrawalRequest.updateMany({
      where: { id: requestId, status: WithdrawalRequestStatus.PENDING },
      data: {
        status: WithdrawalRequestStatus.APPROVED,
        ...(note === undefined || note.trim() === '' ? {} : { note: note.trim() }),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'WITHDRAWAL_REQUEST_ALREADY_MOVED',
        message: `Withdrawal request ${requestId} was decided by someone else first`,
      });
    }

    const updated = await this.prisma.client.withdrawalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId: existing.sellerId,
      action: 'staff.withdrawal_request.approved',
      entityType: 'withdrawal_request',
      entityId: requestId,
      metadata: {
        amountRequested: existing.amountRequested.toFixed(2),
        withdrawableAtApproval: available.toFixed(2),
      },
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

  private toView(
    row: {
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
    },
    slaHours?: number,
    now: Date = new Date(),
  ): WithdrawalRequestView {
    // Waiting means UNPAID, which is PENDING or APPROVED. The seller
    // was promised money, not a decision — an approved request whose
    // transfer has not happened is still someone waiting, and counting
    // only PENDING would let the queue clear itself by approving
    // everything. The age of a settled request is history, and
    // reporting it as a wait would make every paid one look overdue
    // forever.
    const waitingHours = UNPAID_STATUSES.includes(row.status)
      ? Math.floor((now.getTime() - row.createdAt.getTime()) / 3_600_000)
      : null;
    return {
      waitingHours,
      slaBreached: waitingHours !== null && slaHours !== undefined && waitingHours >= slaHours,
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
