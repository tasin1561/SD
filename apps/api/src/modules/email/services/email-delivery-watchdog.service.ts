import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { EmailQueue } from '../queue/email.queue';
import type { EmailDispatchInput, EmailVariables } from '../email.types';

/**
 * How long a QUEUED email row may sit, with no job behind it, before it
 * counts as stuck. Comfortably past BullMQ's whole retry ladder (30s,
 * 1m, 2m, 4m — about 7.5 minutes) so a row mid-retry is never touched;
 * and a row held for quiet hours has a DELAYED job, which is excluded
 * whatever its age.
 */
export const EMAIL_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Older than this, a never-sent email is NOT sent late — it is closed
 * and reported. A password-reset link expires in thirty minutes, and a
 * "Critical" alert arriving five days after the issue was resolved
 * would send somebody chasing a problem that no longer exists.
 */
export const EMAIL_RESEND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows looked at per sweep. Stuck mail is a handful by definition. */
export const EMAIL_WATCHDOG_BATCH = 200;

export const EMAIL_UNDELIVERED_ISSUE_KEY = 'email-undelivered';

/** Why the watchdog stopped trying — written to `failure_code`. */
export type EmailGiveUpReason = 'NO_ADDRESS' | 'EXPIRED_UNSENT' | 'UNSENT_AFTER_RETRY';

const REASON_TEXT: Record<EmailGiveUpReason, string> = {
  NO_ADDRESS: 'Never sent: the row carries no email address.',
  EXPIRED_UNSENT: 'Never sent, and now too old to send late.',
  UNSENT_AFTER_RETRY: 'Never sent, including after the watchdog re-queued it once.',
};

const STALE_SELECT = {
  id: true,
  templateCode: true,
  recipientType: true,
  recipientId: true,
  toEmail: true,
  variables: true,
  orderId: true,
  shipmentId: true,
  callAttemptId: true,
  triggerEvent: true,
  attemptNumber: true,
  createdAt: true,
  failureCode: true,
  failureMessage: true,
} as const satisfies Prisma.NotificationLogSelect;

type StaleRow = Prisma.NotificationLogGetPayload<{ select: typeof STALE_SELECT }>;

export interface EmailWatchdogResult {
  /** Stale QUEUED rows found. */
  readonly examined: number;
  /** Of those, rows a live job will still send (quiet hours, backoff). */
  readonly stillLive: number;
  /** Re-queued for their one second chance. */
  readonly reenqueued: number;
  /** Closed as FAILED and reported. */
  readonly givenUp: number;
}

/**
 * Finds email that was meant to go out and did not, and either gives it
 * one more chance or says so.
 *
 * ── THE HOLE ─────────────────────────────────────────────────────────
 * Store-then-send (NOTIF-2) writes the notification_logs row QUEUED and
 * then queues a job; only the job moves it to SENT or FAILED. When the
 * job dies without getting that far — a template that did not exist, a
 * job lost from Redis, an enqueue that threw after the row committed —
 * the row stays QUEUED with nothing anywhere to say so. The three
 * CRITICAL system-issue emails of 7 Sep did exactly that for five days,
 * while their in-app twins arrived and made everything look fine.
 *
 * ── WHAT IT DOES, PER ROW ────────────────────────────────────────────
 *   - a live job still holds it        → leave it (it is waiting on purpose)
 *   - no address / older than 24h      → FAILED, reported, not sent
 *   - never re-queued before           → re-queued ONCE from the row
 *   - already re-queued, still QUEUED  → FAILED, reported
 *
 * ── ONCE, BY CONSTRUCTION ────────────────────────────────────────────
 * The second chance is claimed by a guarded `updateMany` that moves
 * `attempt_number` 1 → 2 before anything is enqueued, so two sweeps
 * cannot both re-send, and a re-queue that itself fails leaves a row
 * that the next sweep closes and reports rather than retrying for ever.
 * The re-send goes through the ordinary `existingNotificationLogId`
 * UPDATE path, so it lands on the same row and keeps the NOTIF-2 key.
 * The one double-send it cannot rule out is the one it cannot see: the
 * provider accepted a message and the row write after it failed (the
 * dispatcher reports SENT and leaves the row QUEUED on purpose) — then
 * this re-sends it once.
 *
 * ── LOUD, ONCE ───────────────────────────────────────────────────────
 * A row is reported in the sweep that closes it, as one HIGH issue
 * (`email-undelivered`), which tells people IN-APP — deliberately not by
 * email, the channel that is failing. It is never cleared automatically:
 * the mail did not go and nobody will send it now, so a person decides
 * what, if anything, to re-send.
 */
@Injectable()
export class EmailDeliveryWatchdogService {
  private readonly logger = new Logger(EmailDeliveryWatchdogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueue: EmailQueue,
    private readonly issues: SystemIssueService,
  ) {}

  async sweep(now: Date = new Date()): Promise<EmailWatchdogResult> {
    const staleBefore = new Date(now.getTime() - EMAIL_STALE_AFTER_MS);
    const rows = await this.prisma.client.notificationLog.findMany({
      where: {
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.QUEUED,
        createdAt: { lt: staleBefore },
        // The row's own last write — which, for a QUEUED email row, is
        // the ledger insert, a recorded render failure, or this
        // watchdog's own claim. Waiting on it gives a re-queued row the
        // same grace as a fresh one before it is judged again.
        updatedAt: { lt: staleBefore },
      },
      orderBy: { createdAt: 'asc' },
      take: EMAIL_WATCHDOG_BATCH,
      select: STALE_SELECT,
    });
    if (rows.length === 0) return { examined: 0, stillLive: 0, reenqueued: 0, givenUp: 0 };

    const live = await this.emailQueue.liveNotificationLogIds();
    const closed: Array<{ row: StaleRow; reason: EmailGiveUpReason }> = [];
    let stillLive = 0;
    let reenqueued = 0;

    for (const row of rows) {
      if (live.has(row.id)) {
        stillLive += 1;
        continue;
      }
      // Per-row isolation: one bad row must not cost the rest their check.
      try {
        const reason = giveUpReason(row, now);
        if (reason !== null) {
          if (await this.close(row, reason, now)) closed.push({ row, reason });
        } else if (await this.reenqueue(row)) {
          reenqueued += 1;
        }
      } catch (err) {
        this.logger.warn(
          { notificationLogId: row.id, err: err instanceof Error ? err.message : String(err) },
          'Email watchdog could not handle one row — the rest continue',
        );
      }
    }

    if (closed.length > 0) await this.report(closed);
    return { examined: rows.length, stillLive, reenqueued, givenUp: closed.length };
  }

  private async close(row: StaleRow, reason: EmailGiveUpReason, now: Date): Promise<boolean> {
    const lastError =
      row.failureCode === null
        ? ''
        : ` Last error: ${row.failureCode}${row.failureMessage ? `: ${row.failureMessage}` : ''}`;
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { id: row.id, status: NotificationStatus.QUEUED },
      data: {
        status: NotificationStatus.FAILED,
        failedAt: now,
        failureCode: reason,
        failureMessage: `${REASON_TEXT[reason]}${lastError}`,
      },
    });
    return res.count === 1;
  }

  private async reenqueue(row: StaleRow): Promise<boolean> {
    // Claim FIRST: the attempt number moves before any job exists, so a
    // concurrent sweep loses the claim instead of queuing a second send.
    const claim = await this.prisma.client.notificationLog.updateMany({
      where: { id: row.id, status: NotificationStatus.QUEUED, attemptNumber: row.attemptNumber },
      data: { attemptNumber: { increment: 1 } },
    });
    if (claim.count !== 1) return false;

    const variables = toVariables(row.variables);
    const input: EmailDispatchInput = {
      templateCode: row.templateCode,
      recipient: { type: row.recipientType, id: row.recipientId, email: row.toEmail ?? '' },
      ...(variables === undefined ? {} : { variables }),
      orderId: row.orderId,
      shipmentId: row.shipmentId,
      callAttemptId: row.callAttemptId,
      triggerEvent: row.triggerEvent,
      existingNotificationLogId: row.id,
    };
    // Colon-free (Redis key separator) and per row, so the same row can
    // never be queued twice while that job is still held.
    await this.emailQueue.enqueue(input, { jobId: `email-watchdog-${row.id}` });
    this.logger.log(
      { notificationLogId: row.id, templateCode: row.templateCode },
      'Re-queued an email that was never sent',
    );
    return true;
  }

  private async report(closed: ReadonlyArray<{ row: StaleRow; reason: EmailGiveUpReason }>) {
    const lines = closed
      .slice(0, 10)
      .map(
        ({ row, reason }) =>
          `• ${row.templateCode} to a ${row.recipientType.toLowerCase()} (row ${row.id}) — ` +
          `${REASON_TEXT[reason]}${row.failureCode ? ` Last error: ${row.failureCode}.` : ''}`,
      );
    if (closed.length > lines.length) lines.push(`…and ${closed.length - lines.length} more.`);
    const byReason: Record<string, number> = {};
    for (const { reason } of closed) byReason[reason] = (byReason[reason] ?? 0) + 1;

    await this.issues.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.HIGH,
      title:
        closed.length === 1 ? 'An email was never sent' : `${closed.length} emails were never sent`,
      detail:
        `${lines.join('\n')}\n\n` +
        'These are marked FAILED and nothing will send them now. Check that the template ' +
        'exists and that the email provider is reachable, re-send by hand anything that still ' +
        'matters, then resolve this with a note.',
      source: EmailDeliveryWatchdogService.name,
      dedupeKey: EMAIL_UNDELIVERED_ISSUE_KEY,
      metadata: {
        notificationLogIds: closed.slice(0, 50).map(({ row }) => row.id),
        byReason,
      },
    });
  }
}

function giveUpReason(row: StaleRow, now: Date): EmailGiveUpReason | null {
  if (row.toEmail === null || row.toEmail.trim() === '') return 'NO_ADDRESS';
  if (now.getTime() - row.createdAt.getTime() > EMAIL_RESEND_MAX_AGE_MS) return 'EXPIRED_UNSENT';
  if (row.attemptNumber >= 2) return 'UNSENT_AFTER_RETRY';
  return null;
}

/**
 * The row keeps the variables it was queued with; the language does not
 * survive (the ledger never stored it), so a re-send renders in the
 * default. A late email in English beats no email.
 */
function toVariables(value: Prisma.JsonValue | null): EmailVariables | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: EmailVariables = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v;
    }
  }
  return out;
}
