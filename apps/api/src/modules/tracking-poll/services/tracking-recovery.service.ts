import { Injectable, Logger } from '@nestjs/common';
import { ActorType, NotificationRecipientType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { TrackingPollService, TRACKING_STALE_AFTER_MINUTES } from './tracking-poll.service';
import { TrackingPollQueue } from '../queue/tracking-poll.queue';

const AUTO_RECOVER_KEY = 'courier.tracking_poll_auto_recover_enabled';
const ALERT_EMAIL_KEY = 'ops.alert_email';

export interface WatchdogOutcome {
  healthy: boolean;
  minutesSinceLastRun: number | null;
  autoRecoverEnabled: boolean;
  /** Whether a recovery cycle was run, and whether it worked. */
  recovery: 'NOT_NEEDED' | 'DISABLED' | 'RECOVERED' | 'STILL_STALLED';
  alerted: boolean;
}

/**
 * The watchdog, and the automatic half of recovering from a stall.
 *
 * Delhivery pushes us no webhooks, so the tracking poll is the only
 * thing moving an order to delivered. Waiting for a person to notice is
 * not a plan — the symptom is silence, and silence is what a working
 * system looks like from the outside.
 *
 * So this runs on its OWN schedule, independent of the poll cron. That
 * separation is the point: the most common stall is the poll job itself
 * erroring or losing its repeat entry, and a watchdog living inside that
 * same job would die with it.
 *
 * It cannot cover everything, and pretending otherwise would be worse
 * than the gap. It shares Redis and this process with the poller, so if
 * the whole app is down it is down too — which is exactly why the
 * GitHub-Actions watchdog exists outside the droplet as well.
 */
@Injectable()
export class TrackingRecoveryService {
  private readonly logger = new Logger(TrackingRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poll: TrackingPollService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly queue: TrackingPollQueue,
  ) {}

  async check(): Promise<WatchdogOutcome> {
    const health = await this.poll.health();
    if (!health.stale) {
      return {
        healthy: true,
        minutesSinceLastRun: health.minutesSinceLastRun,
        autoRecoverEnabled: await this.autoRecoverEnabled(),
        recovery: 'NOT_NEEDED',
        alerted: false,
      };
    }

    const autoRecoverEnabled = await this.autoRecoverEnabled();
    let recovery: WatchdogOutcome['recovery'] = 'DISABLED';

    if (autoRecoverEnabled) {
      // Run a cycle rather than merely reporting one is missing. Safe by
      // construction: a cycle applies only scans strictly newer than
      // each parcel's watermark, so a recovery run can duplicate
      // nothing. The worst case is that it fails the same way the
      // scheduled one did — which the outcome below records honestly
      // instead of claiming a fix.
      try {
        // Re-arm the schedule FIRST. If the repeatable entry was lost —
        // a flushed Redis, an evicted key — then running one cycle here
        // fixes today and leaves the cron still gone, so the watchdog
        // would be carrying tracking on its back indefinitely. This is
        // a no-op when the entry is already there.
        await this.queue.ensureScheduled();
        await this.poll.pollAll();
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Tracking recovery cycle threw',
        );
      }
      const after = await this.poll.health();
      recovery = after.stale ? 'STILL_STALLED' : 'RECOVERED';
    }

    // The alert fires whether or not recovery worked. A stall that
    // self-healed is still worth knowing about: it is the difference
    // between a blip and a pattern, and nobody can see a pattern in
    // events that were never reported.
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: 'tracking.poll_stalled',
      entityType: 'tracking_poll',
      entityId: null,
      severity: 'CRITICAL',
      metadata: {
        minutesSinceLastRun: health.minutesSinceLastRun,
        thresholdMinutes: TRACKING_STALE_AFTER_MINUTES,
        autoRecoverEnabled,
        recovery,
      },
    });

    const alerted = await this.emailOps(health.minutesSinceLastRun, recovery);
    return {
      healthy: false,
      minutesSinceLastRun: health.minutesSinceLastRun,
      autoRecoverEnabled,
      recovery,
      alerted,
    };
  }

  /** Default TRUE — a missing row must not silently disable recovery. */
  private async autoRecoverEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: AUTO_RECOVER_KEY },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? true;
  }

  private async emailOps(
    minutes: number | null,
    recovery: WatchdogOutcome['recovery'],
  ): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: ALERT_EMAIL_KEY },
      select: { valueString: true },
    });
    const to = (row?.valueString ?? '').trim();
    if (to === '') {
      // Deliberately not defaulted to a guessed address. An alert sent
      // nowhere is worse than one with no destination, because the first
      // looks exactly like everything being fine.
      this.logger.warn(`${ALERT_EMAIL_KEY} is unset — tracking stall recorded in audit_logs only`);
      return false;
    }

    try {
      await this.email.enqueue({
        templateCode: 'ops.tracking_stalled.email',
        recipient: { type: NotificationRecipientType.STAFF, email: to },
        triggerEvent: 'tracking.poll_stalled',
        variables: {
          minutes: minutes === null ? 'an unknown number of' : String(minutes),
          threshold: String(TRACKING_STALE_AFTER_MINUTES),
          recovery: DESCRIBE_RECOVERY[recovery],
          health_url: 'https://api.skydrop.online/health/tracking',
        },
      });
      return true;
    } catch (err) {
      // Never let a mail problem fail the watchdog: the audit row is the
      // durable finding and the job must stay re-runnable.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not enqueue the tracking-stall alert email',
      );
      return false;
    }
  }
}

const DESCRIBE_RECOVERY: Record<WatchdogOutcome['recovery'], string> = {
  NOT_NEEDED: 'not needed',
  DISABLED: 'turned OFF for this system, so nothing was attempted — a person must run a cycle',
  RECOVERED: 'ran a cycle automatically and tracking is moving again',
  STILL_STALLED: 'ran a cycle automatically and it did NOT recover — this needs a person',
};
