import { Injectable, Logger } from '@nestjs/common';
import { CourierOutboxStatus, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierSupportDeskService } from './courier-support-desk.service';

export const OUTBOX_STALLED_KEY_PREFIX = 'courier-outbox-stalled:';
const STALL_HOURS_KEY = 'ops.courier_outbox_stall_alert_hours';
const DEFAULT_STALL_HOURS = 24;

/**
 * A message to a courier that nobody has sent.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * No courier has a write channel, so every message queued for a courier
 * — a seller's words, an operator's question — waits for a PERSON to
 * send it by hand on the courier's own panel. Nothing chased that wait:
 * a message could sit PENDING for a week with the seller believing it
 * had been raised. This names each one that has waited longer than
 * `ops.courier_outbox_stall_alert_hours` (24) and clears itself once it
 * leaves the send queue.
 *
 * ── THE SAME FOR EVERY COURIER ───────────────────────────────────────
 * It reads the outbox, which holds Delhivery's and Shiprocket's messages
 * alike, and names the desk from the escalation's own courier. There is
 * no courier filter here on purpose: a watchdog that covered one courier
 * would make the other's wait invisible, which is the failure it exists
 * to prevent.
 *
 * Aged from `createdAt` — written once, when the message was queued —
 * never `updatedAt`, which a claim or a release rewrites (rule 4b). It
 * never sends anything: it names the message and stops.
 */
@Injectable()
export class CourierEscalationWatchService {
  private readonly logger = new Logger(CourierEscalationWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: SystemIssueService,
    private readonly desks: CourierSupportDeskService,
  ) {}

  async checkStalledOutbox(now: Date = new Date()): Promise<{ raised: number; cleared: number }> {
    const hours = await this.stallHours();
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const waiting = await this.prisma.client.courierOutboxItem.findMany({
      where: {
        status: { in: [CourierOutboxStatus.PENDING, CourierOutboxStatus.SENDING] },
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        body: true,
        createdAt: true,
        escalation: {
          select: {
            id: true,
            ticketId: true,
            awbNumber: true,
            courierCode: true,
            externalTicketId: true,
          },
        },
      },
    });
    const stalledIds = new Set(waiting.map((w) => w.id));

    let cleared = 0;
    const openKeys = await this.issues.openDedupeKeys(OUTBOX_STALLED_KEY_PREFIX);
    for (const key of openKeys) {
      if (stalledIds.has(key.slice(OUTBOX_STALLED_KEY_PREFIX.length))) continue;
      cleared += await this.issues.resolveByKey(
        key,
        'The message left the send queue — sent by hand, or withdrawn.',
      );
    }

    const desks = await this.desks.describeMany(
      waiting.map((w) => ({
        courierCode: w.escalation.courierCode,
        externalTicketId: w.escalation.externalTicketId,
      })),
    );

    let raised = 0;
    for (const [i, item] of waiting.entries()) {
      const desk = desks[i];
      if (desk === undefined) continue;
      const waitedHours = Math.floor((now.getTime() - item.createdAt.getTime()) / 3_600_000);
      const parcel = item.escalation.awbNumber ?? 'a parcel with no waybill';
      const contact =
        desk.supportEmail !== null
          ? `Their support email is ${desk.supportEmail}.`
          : `No support email is on file — set ${desk.supportEmailSettingKey} in Settings.`;
      raised += 1;
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: `${desk.courierName} escalation for ${parcel}: a message has waited ${waitedHours}h to be sent`,
        detail:
          `A message for ${desk.courierName} about ${parcel} was queued on ` +
          `${item.createdAt.toISOString().slice(0, 16)} and has not been sent. No courier accepts ` +
          'support messages from software, so a person has to raise it by hand — until then the ' +
          'seller believes it has been reported and nothing is carrying it.\n\n' +
          `${desk.howTo} ${contact}\n\n` +
          'Open Courier escalation → Send queue, send it, and mark it sent with their ticket ' +
          'number. This clears itself once the message leaves the queue.',
        source: 'CourierEscalationWatchService',
        dedupeKey: `${OUTBOX_STALLED_KEY_PREFIX}${item.id}`,
        metadata: {
          outboxItemId: item.id,
          escalationId: item.escalation.id,
          ticketId: item.escalation.ticketId,
          awbNumber: item.escalation.awbNumber,
          courierCode: desk.courierCode,
          queuedAt: item.createdAt.toISOString(),
        },
      });
    }

    if (raised > 0 || cleared > 0) {
      this.logger.log({ raised, cleared, hours }, 'Courier send-queue stall check');
    }
    return { raised, cleared };
  }

  /** Absent, unreadable or non-positive ⇒ the default. */
  private async stallHours(): Promise<number> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: STALL_HOURS_KEY },
        select: { valueInt: true },
      });
      const v = row?.valueInt ?? null;
      return v !== null && v > 0 ? v : DEFAULT_STALL_HOURS;
    } catch {
      return DEFAULT_STALL_HOURS;
    }
  }
}
