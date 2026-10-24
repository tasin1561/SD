import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, WebhookStatus } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { TrackingWebhookQueue } from '../queue/tracking-webhook.queue';

/** One stuck row, as the admin listing shows it. */
export interface UnprocessedWebhook {
  readonly id: string;
  readonly courierCode: string;
  readonly awbNumber: string | null;
  readonly receivedAt: Date;
  readonly retryCount: number;
  readonly errorMessage: string | null;
}

export interface ReplayResult {
  readonly webhookId: string;
  readonly jobId: string;
  /** True when a job was already queued or running and this changed nothing. */
  readonly alreadyQueued: boolean;
}

/** Matches the watchdog's own listing cap, so the screen and the alert agree. */
const LIST_LIMIT = 50;

/**
 * The ops lever TRK-11 assumed existed.
 *
 * TRK-11 closed half of the dropped-scan problem: a webhook stuck at
 * RECEIVED is now NAMED, once, for the estate. It deliberately stops
 * there — "re-queueing on a timer is how one bad body becomes a job
 * that fails for ever". But the other half was never built. The
 * worker's own comment says "ops manually re-trigger via
 * `process(webhookId)` (the method is intentionally public)", and no
 * surface was ever put in front of it, so the only actual recovery was
 * an SSH session and a hand-written script — the exact shape TRK-10's
 * sibling `AdminTrackingPollController` was written to get rid of.
 *
 * Production proved the gap: seven Shiprocket rows from 12-13 September
 * whose parser bug was fixed within the same week sat unreplayed for six
 * weeks, raising the same issue 604 times, because nothing could press
 * the button.
 *
 * WHY THIS IS NOT THE RE-QUEUEING TRK-11 FORBIDS. The rule is about the
 * WATCHDOG: a detector that retries on a schedule turns one unparseable
 * body into an infinite job. Here a person reads the row, decides the
 * cause is fixed, and says so with a reason that lands in `audit_logs`.
 * Nothing here runs on a timer, and nothing retries by itself.
 *
 * Replaying is SAFE by construction, not by care:
 *   - TRK-2's master gate means a row that has since been PROCESSED is
 *     refused here and would be a no-op in the processor anyway;
 *   - TRK-3 keeps `event_at` at the scan's own time, so a six-week-late
 *     replay lands in September where it belongs, never at replay time;
 *   - TRK-4's monotonic-forward guard skips the transition for any order
 *     that has moved on since, so a stale scan is recorded without
 *     dragging an order backwards.
 */
@Injectable()
export class WebhookReplayService {
  private readonly logger = new Logger(WebhookReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TrackingWebhookQueue,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Every webhook that arrived and never left RECEIVED — the rows the
   * watchdog counts, with the `errorMessage` that is finally populated
   * now the worker records its failures.
   */
  async listUnprocessed(): Promise<readonly UnprocessedWebhook[]> {
    return this.prisma.client.courierWebhook.findMany({
      where: { status: WebhookStatus.RECEIVED },
      select: {
        id: true,
        courierCode: true,
        awbNumber: true,
        receivedAt: true,
        retryCount: true,
        errorMessage: true,
      },
      orderBy: { receivedAt: 'asc' },
      take: LIST_LIMIT,
    });
  }

  /**
   * Hand one stored webhook back to the processor.
   *
   * `reason` is required by the DTO and recorded, because this drives
   * real order transitions and the next person needs to know why
   * somebody decided a six-week-old scan should be applied now.
   */
  async replay(webhookId: string, staffId: string, reason: string): Promise<ReplayResult> {
    const row = await this.prisma.client.courierWebhook.findUnique({
      where: { id: webhookId },
      select: { id: true, status: true, courierCode: true, awbNumber: true },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'No stored webhook has that id.',
      });
    }
    if (row.status !== WebhookStatus.RECEIVED) {
      // Not an error worth hiding behind a silent no-op: somebody is
      // looking at a stale screen, and saying so is more useful than
      // pretending to requeue something the processor would refuse.
      throw new ConflictException({
        code: 'WEBHOOK_ALREADY_HANDLED',
        message: `That webhook is already ${row.status.toLowerCase()}; only a webhook still at RECEIVED can be replayed.`,
      });
    }

    const { jobId, alreadyQueued } = await this.queue.replayWebhook(webhookId);

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'tracking.webhook_replayed',
      entityType: 'courier_webhook',
      entityId: webhookId,
      severity: 'HIGH',
      metadata: {
        courierCode: row.courierCode,
        awbNumber: row.awbNumber,
        jobId,
        alreadyQueued,
        reason,
      },
    });

    this.logger.log(
      { webhookId, jobId, alreadyQueued, staffId },
      'Webhook handed back to the processor by hand',
    );
    return { webhookId, jobId, alreadyQueued };
  }
}
