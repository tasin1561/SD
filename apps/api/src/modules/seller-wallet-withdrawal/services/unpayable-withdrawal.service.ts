import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  Currency,
  NotificationCategory,
  NotificationChannel,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { WithdrawalRequestService } from './withdrawal-request.service';

/** Seeded ON (owner request, 2026-09-12); seller-overridable (SET-1). */
export const AUTO_REJECT_UNPAYABLE_KEY = 'wallet.auto_reject_unpayable_withdrawals';
/**
 * The in-app topic the seller is told on. Listed in the seller topic
 * catalogue so it can be silenced like any other, and pinned there by
 * `notification-topic-catalog.service.spec.ts`.
 */
export const WITHDRAWAL_AUTO_REJECTED_TOPIC = 'wallet.withdrawal_auto_rejected';
/** Who at the seller hears about it: the people who can see the wallet. */
const AUDIENCE_PERMISSION = 'wallet.view';
const APPROVED_UNCOVERED_PREFIX = 'withdrawal-approved-uncovered:';

export interface UnpayableSweepResult {
  readonly considered: number;
  readonly rejected: number;
  readonly flaggedApproved: number;
  readonly failures: number;
}

export interface AutoRejection {
  readonly requestId: string;
  readonly sellerId: string;
  readonly currency: Currency;
  readonly amountRequested: string;
  readonly withdrawableNow: string;
  readonly reason: string;
}

function money(currency: Currency, amount: Prisma.Decimal): string {
  return currency === Currency.INR ? `₹${amount.toFixed(2)}` : `${currency} ${amount.toFixed(2)}`;
}

/**
 * Withdrawal requests the wallet can no longer pay.
 *
 * A request holds its amount out of what the seller may withdraw until a
 * person decides it (`withdrawableBalance` subtracts every PENDING one).
 * Charges keep landing meanwhile, and when the balance falls below the
 * request nobody can pay it — `approve` and the remittance both re-check
 * and refuse — yet it sits there blocking every new request and the
 * automatic sweep, and the liabilities page counts it as money asked for.
 * Menev Store's automatic request of 2 Sep for ₹2,946.40 was exactly
 * that, against a wallet holding ₹111.40.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────
 * A PENDING request is unpayable when the seller's withdrawable balance —
 * the ONE number (WAL-3), with this request's own amount left out so it
 * cannot block itself, every other pending request still counted — is
 * below its amount. It is rejected with the numbers in the reason and the
 * seller is told they can ask again.
 *
 * ── APPROVED IS NEVER AUTO-REJECTED ──────────────────────────────────
 * Somebody decided to pay it and the transfer may already be on its way;
 * rejecting it underneath them would leave a bank transfer with no
 * request to account it to. It is raised on /system-issues instead, and
 * the issue clears itself once the wallet covers it again or the request
 * stops waiting.
 *
 * ── GUARDED, UNDER THE WALLET LOCK ───────────────────────────────────
 * The decision reads a balance and then writes, so it holds the seller's
 * wallet lock inside the transaction (WAL-7), and the rejection is a
 * guarded claim on `status = PENDING`: a request approved (or rejected by
 * a person) between our read and our write is left alone.
 *
 * ── TWO PASSES: ALONE, THEN NEWEST FIRST ─────────────────────────────
 * First, every request the balance cannot cover ON ITS OWN — every other
 * pending request left out, approved ones still held — is rejected: no
 * ordering of the others can make it payable. Only then are the rest
 * judged newest-first with the other pending ones counted. Newest-first
 * alone got it wrong: ₹500 in the wallet, an older ₹1,000 request and a
 * newer ₹100 one — the ₹100 was judged first with the ₹1,000 still held,
 * rejected, and then the ₹1,000 was rejected too; the ₹100 alone was
 * payable all along. With two pending requests that are each payable
 * alone but not together, newest-first still rejects the newer and keeps
 * the older — the person who has waited longest.
 */
@Injectable()
export class UnpayableWithdrawalService {
  private readonly logger = new Logger(UnpayableWithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly wallet: WalletService,
    private readonly withdrawals: WithdrawalRequestService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async sweep(now: Date = new Date()): Promise<UnpayableSweepResult> {
    const pending = await this.prisma.client.withdrawalRequest.findMany({
      where: { status: WithdrawalRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sellerId: true },
    });

    const enabledBySeller = new Map<string, boolean>();
    const failed = new Set<string>();
    let rejected = 0;
    // Pass 1 judges each request ALONE; pass 2 the survivors newest-first
    // with the other pending ones counted. A request rejected in pass 1 is
    // no longer PENDING, so pass 2 skips it by construction.
    for (const alone of [true, false]) {
      for (const r of pending) {
        if (failed.has(r.id)) continue;
        try {
          let enabled = enabledBySeller.get(r.sellerId);
          if (enabled === undefined) {
            enabled = await this.isEnabled(r.sellerId);
            enabledBySeller.set(r.sellerId, enabled);
          }
          if (!enabled) continue;
          const outcome = await this.rejectIfUnpayable(r.id, now, alone);
          if (outcome === null) continue;
          rejected += 1;
          await this.tellSeller(outcome);
        } catch (err) {
          // One request's failure must not stop the rest. A setting that
          // cannot be read lands here too, and the request is LEFT PENDING:
          // not rejecting on doubt is the safe direction. Not retried in
          // the second pass — one failure, counted once.
          failed.add(r.id);
          this.logger.warn(
            { requestId: r.id, err: err instanceof Error ? err.message : String(err) },
            'Unpayable-withdrawal check failed for this request',
          );
        }
      }
    }
    const failures = failed.size;

    const flaggedApproved = await this.flagApprovedUncovered();

    if (rejected > 0 || failures > 0 || flaggedApproved > 0) {
      this.logger.log(
        { considered: pending.length, rejected, flaggedApproved, failures },
        'Unpayable-withdrawal sweep complete',
      );
    }
    return { considered: pending.length, rejected, flaggedApproved, failures };
  }

  /** Per seller, through the resolver (SET-1). A read failure throws. */
  private async isEnabled(sellerId: string): Promise<boolean> {
    const v = (await this.settings.resolve(sellerId, AUTO_REJECT_UNPAYABLE_KEY)).value;
    return v === true || v === 'true';
  }

  /**
   * Rejects ONE request if, right now and under the wallet lock, the
   * balance no longer covers it. Returns what it did, or null when the
   * request is payable, no longer PENDING, or somebody else moved it first.
   * `alone`: judge it with every OTHER pending request left out (approved
   * ones still held) — "could it be paid at all?".
   */
  async rejectIfUnpayable(
    requestId: string,
    now: Date = new Date(),
    alone = false,
  ): Promise<AutoRejection | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.withdrawalRequest.findUnique({
        where: { id: requestId },
        select: { id: true, sellerId: true, currency: true, amountRequested: true, status: true },
      });
      if (row === null || row.status !== WithdrawalRequestStatus.PENDING) return null;

      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${row.sellerId}|${row.currency}`);
      const balance = await this.wallet.balanceLive(row.sellerId, row.currency, tx);
      const withdrawable = await this.withdrawals.withdrawableBalance(
        row.sellerId,
        row.currency,
        balance,
        tx,
        row.id,
        { countOtherPending: !alone },
      );
      if (withdrawable.gte(row.amountRequested)) return null;

      const reason =
        `Asked for ${money(row.currency, row.amountRequested)}, only ` +
        `${money(row.currency, withdrawable)} is withdrawable now (wallet balance ` +
        `${money(row.currency, balance)}, less the minimum balance and ` +
        (alone ? 'any approved withdrawals' : 'any other withdrawals still waiting') +
        `) — rejected automatically because charges since the request left the ` +
        `wallet unable to pay it. A new request can be made for what is available.`;

      // Guarded on PENDING: approved or decided by a person since the read
      // above ⇒ count 0 ⇒ theirs stands.
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id: row.id, status: WithdrawalRequestStatus.PENDING },
        data: {
          status: WithdrawalRequestStatus.REJECTED,
          rejectionReason: reason,
          resolvedByStaffId: null,
          resolvedAt: now,
        },
      });
      if (claimed.count === 0) return null;

      await this.audit.log(
        {
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: row.sellerId,
          action: 'system.withdrawal_request.auto_rejected',
          entityType: 'withdrawal_request',
          entityId: row.id,
          metadata: {
            currency: row.currency,
            amountRequested: row.amountRequested.toFixed(2),
            withdrawableNow: withdrawable.toFixed(2),
            balance: balance.toFixed(2),
            setting: AUTO_REJECT_UNPAYABLE_KEY,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      return {
        requestId: row.id,
        sellerId: row.sellerId,
        currency: row.currency,
        amountRequested: row.amountRequested.toFixed(2),
        withdrawableNow: withdrawable.toFixed(2),
        reason,
      };
    });
  }

  /**
   * In-app, to the people at the seller who can see the wallet. After the
   * rejection has committed and awaited here (not fire-and-forget), and
   * best-effort: the rejection is the durable fact and is on their
   * withdrawals list with its reason whether or not this lands.
   */
  private async tellSeller(r: AutoRejection): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: WITHDRAWAL_AUTO_REJECTED_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Withdrawal of ${money(r.currency, new Prisma.Decimal(r.amountRequested))} rejected — your balance no longer covers it`,
        body: r.reason,
        channels: [NotificationChannel.IN_APP],
        audience: [
          { kind: 'SELLER_PERMISSION', sellerId: r.sellerId, permission: AUDIENCE_PERMISSION },
        ],
        triggerEvent: WITHDRAWAL_AUTO_REJECTED_TOPIC,
        // One per request, so a retry cannot tell them twice (NOTIF-2).
        eventId: `withdrawal_auto_rejected:${r.requestId}`,
      });
    } catch (err) {
      this.logger.warn(
        { requestId: r.requestId, err: err instanceof Error ? err.message : String(err) },
        'Could not notify the seller of an automatic withdrawal rejection',
      );
    }
  }

  /**
   * APPROVED requests the wallet no longer covers: raised, never rejected.
   * Same bar `approve` used — the withdrawable balance — so the issue says
   * "what was approved is no longer there" in the terms it was approved on.
   */
  private async flagApprovedUncovered(): Promise<number> {
    let flagged = 0;
    try {
      const approved = await this.prisma.client.withdrawalRequest.findMany({
        where: { status: WithdrawalRequestStatus.APPROVED },
        select: { id: true, sellerId: true, currency: true, amountRequested: true },
      });
      const stillApproved = new Set(approved.map((a) => a.id));
      for (const a of approved) {
        const key = `${APPROVED_UNCOVERED_PREFIX}${a.id}`;
        // Its own amount left out (approved requests are held now, so it
        // would otherwise count against itself) and pending claims too: a
        // newer pending request does not make an approved one uncovered —
        // it is the pending one that is unpayable, and pass 1 rejects it.
        const available = await this.withdrawals.withdrawableBalance(
          a.sellerId,
          a.currency,
          undefined,
          undefined,
          a.id,
          { countOtherPending: false },
        );
        if (available.lt(a.amountRequested)) {
          flagged += 1;
          await this.issues.raise({
            kind: SystemIssueKind.MONEY,
            severity: SystemIssueSeverity.HIGH,
            title: `Approved withdrawal of ${money(a.currency, a.amountRequested)} is no longer covered`,
            detail:
              `Withdrawal request ${a.id} was approved, but the seller's withdrawable balance is ` +
              `now ${money(a.currency, available)}. The payout will be refused. It is not rejected ` +
              `automatically because a transfer may already be under way: check whether it was ` +
              `sent, then record the payment or reject the request on /withdrawals.`,
            source: UnpayableWithdrawalService.name,
            dedupeKey: key,
            metadata: {
              requestId: a.id,
              sellerId: a.sellerId,
              amountRequested: a.amountRequested.toFixed(2),
              withdrawableNow: available.toFixed(2),
            },
          });
        } else {
          await this.issues.resolveByKey(key, 'The wallet covers the approved amount again.');
        }
      }
      // A flag whose request has since been paid or rejected has nothing
      // left to ask anybody.
      const open = await this.prisma.client.systemIssue.findMany({
        where: { dedupeKey: { startsWith: APPROVED_UNCOVERED_PREFIX }, resolvedAt: null },
        select: { dedupeKey: true },
      });
      for (const o of open) {
        if (!stillApproved.has(o.dedupeKey.slice(APPROVED_UNCOVERED_PREFIX.length))) {
          await this.issues.resolveByKey(
            o.dedupeKey,
            'The request is no longer waiting to be paid.',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not check approved withdrawals against the wallet',
      );
    }
    return flagged;
  }
}
