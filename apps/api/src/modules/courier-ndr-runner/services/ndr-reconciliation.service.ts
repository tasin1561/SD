import { Injectable, Logger } from '@nestjs/common';
import { ActorType, NdrRequestStatus, NotificationRecipientType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { NdrSettingsService } from './ndr-settings.service';

export interface NdrReconciliationSummary {
  readonly checked: number;
  readonly acted: number;
  readonly notActed: number;
  readonly notActedPercent: number;
  readonly threshold: number;
  readonly alerted: boolean;
}

/**
 * Did the re-attempts we asked for actually happen?
 *
 * ── WHY THIS IS NOT OPTIONAL ─────────────────────────────────────────
 * Every other signal in the NDR flow reports success. `takeAction`
 * returns a UPL id. The UPL poll says CONFIRMED. Both mean Delhivery
 * ACCEPTED the request — neither means a van went out. If they accept
 * our calls and quietly do nothing, the entire pipeline stays green
 * while every parcel sits still, and the first person to notice is a
 * customer.
 *
 * This job asks the only question that distinguishes those worlds: after
 * we asked, did a NEW delivery attempt actually appear in tracking?
 *
 * ── WHY A PERCENTAGE, NOT AN INCIDENT ────────────────────────────────
 * Individual misses are normal and uninteresting: a parcel gets
 * delivered before the re-attempt runs, a customer collects it, an
 * address is corrected out of band. What is NOT normal is a sustained
 * share of requests producing nothing — that is the systematic failure,
 * and it is only visible in aggregate. Alerting per parcel would train
 * everyone to ignore the alert, which is the same as not having one.
 *
 * ── WHY IT RUNS AT MIDDAY ────────────────────────────────────────────
 * A night's requests need a full delivery cycle before their absence
 * means anything. Checking at 06:00 would report a courier that simply
 * has not started yet.
 */
@Injectable()
export class NdrReconciliationService {
  private readonly logger = new Logger(NdrReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: NdrSettingsService,
    private readonly email: EmailQueue,
    private readonly audit: AuditLogService,
  ) {}

  /** Public so it doubles as the manual ops trigger. */
  async reconcile(): Promise<NdrReconciliationSummary> {
    const windowHours = await this.settings.reconcileWindowHours();
    const threshold = await this.settings.reconcileAlertPercent();
    const now = Date.now();

    // Only rows old enough for an answer to be meaningful, and not yet
    // reconciled. A row younger than the window is not evidence of
    // anything — reconciling it early would count a working courier as
    // a failure.
    const due = await this.prisma.client.ndrActionRequest.findMany({
      where: {
        status: NdrRequestStatus.CONFIRMED,
        reconciledAt: null,
        submittedAt: { lt: new Date(now - windowHours * 3_600_000) },
      },
      select: {
        id: true,
        shipmentId: true,
        awbNumber: true,
        submittedAt: true,
        attemptCountAtSubmit: true,
      },
      take: 500,
    });

    let acted = 0;
    let notActed = 0;

    for (const row of due) {
      // "A new attempt appeared" = a delivery_attempts row recorded
      // AFTER we asked. Comparing counts against the snapshot taken at
      // submit time is what makes this robust to attempts we learned
      // about late: the row's own createdAt is when WE saw it, and
      // that is the honest question — did evidence of a new attempt
      // reach us within the window.
      const newer = await this.prisma.client.deliveryAttempt.count({
        where: { shipmentId: row.shipmentId, createdAt: { gt: row.submittedAt } },
      });
      const didAct = newer > 0;
      if (didAct) acted += 1;
      else notActed += 1;

      await this.prisma.client.ndrActionRequest.update({
        where: { id: row.id },
        data: { reconciledAt: new Date(), newAttemptSeen: didAct },
      });
    }

    const checked = due.length;
    const notActedPercent = checked === 0 ? 0 : Math.round((notActed / checked) * 100);
    const alerted = checked > 0 && notActedPercent > threshold;

    if (alerted) {
      await this.raiseAlert({ checked, acted, notActed, notActedPercent, threshold });
    }

    const summary: NdrReconciliationSummary = {
      checked,
      acted,
      notActed,
      notActedPercent,
      threshold,
      alerted,
    };
    this.logger.log(summary, 'NDR reconciliation complete');
    return summary;
  }

  /**
   * Tell a human, through the M11 substrate rather than beside it.
   *
   * The audit row is the durable record and is written FIRST — if the
   * email enqueue fails, the finding still exists and is queryable.
   * Sending first and recording second would let a mail outage erase the
   * only evidence that we noticed.
   */
  private async raiseAlert(s: {
    checked: number;
    acted: number;
    notActed: number;
    notActedPercent: number;
    threshold: number;
  }): Promise<void> {
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.ndr.reconciliation_alert',
      entityType: 'courier',
      entityId: 'delhivery',
      // CRITICAL: this is the signal that a courier is accepting our
      // instructions and not acting on them. Nothing else detects it.
      severity: 'CRITICAL',
      metadata: { ...s },
    });

    const to = await this.settings.alertEmail();
    if (to === '') {
      // Deliberately not defaulted to a guessed address. An alert sent
      // nowhere is worse than one with no destination, because the first
      // looks exactly like everything being fine.
      this.logger.warn('ops.alert_email is unset — NDR alert recorded in audit_logs only');
      return;
    }

    try {
      await this.email.enqueue({
        templateCode: 'ops.ndr_reconciliation_alert.email',
        recipient: { type: NotificationRecipientType.STAFF, email: to },
        triggerEvent: 'courier.ndr.reconciliation_alert',
        variables: {
          checked: String(s.checked),
          not_acted: String(s.notActed),
          not_acted_percent: String(s.notActedPercent),
          threshold: String(s.threshold),
        },
      });
    } catch (err) {
      // Never let a mail problem fail the job: the audit row above is
      // the durable finding, and the job must stay re-runnable.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'NDR reconciliation alert email could not be enqueued; the CRITICAL audit row stands',
      );
    }
  }
}
