import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationSubscriptionMode,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EmailQueue } from '../../email/queue/email.queue';
import {
  NotificationAudienceService,
  type ResolvedRecipient,
} from './notification-audience.service';
import { NotificationPolicyService } from './notification-policy.service';
import type { AudienceSelector } from './notification-audience.service';

export interface DispatchInput {
  readonly topic: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  /** Channels the caller WANTS. The category may permit fewer. */
  readonly channels: readonly NotificationChannel[];
  readonly audience: readonly AudienceSelector[];
  /** Deterministic per-event key; the partial unique makes a re-send a
   *  no-op rather than a duplicate (NOTIF-2). */
  readonly eventId?: string;
  readonly templateCode?: string;
  readonly triggerEvent: string;
  readonly orderId?: string | null;
  readonly broadcastId?: string | null;
}

export interface DispatchResult {
  readonly groupId: string;
  readonly recipients: number;
  readonly delivered: number;
  readonly skipped: number;
  readonly failures: number;
}

/**
 * One notification, an audience, and every channel it is allowed to use.
 *
 * ── ORDER OF OPERATIONS, AND WHY ─────────────────────────────────────
 *   1. AUDIENCE decides who is eligible.
 *   2. POLICY decides which channels that KIND of message may use.
 *   3. PREFERENCE removes the channels that person silenced.
 *
 * Policy sits ABOVE preference deliberately. It is what makes the
 * credential rule real: a caller cannot ask for in-app, and a recipient
 * cannot opt INTO it, because the category never permitted it.
 *
 * ── IN-APP IS A WRITE, NOT A SEND ────────────────────────────────────
 * The notification_logs row IS the in-app delivery — there is no
 * provider to hand it to, so it is written SENT. Email keeps the M11
 * store-then-send shape: the row exists first, then a job.
 *
 * Per-recipient isolation (NOTIF-3): one person's failure never stops
 * the others. On a broadcast that is the difference between one bad
 * address and four thousand people hearing nothing.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  /** Written in chunks so a large audience cannot hold one transaction
   *  open across thousands of rows. */
  private static readonly CHUNK = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: NotificationAudienceService,
    private readonly policy: NotificationPolicyService,
    private readonly emailQueue: EmailQueue,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const groupId = randomUUID();
    const people = await this.audience.resolveMany(input.audience);
    if (people.length === 0) {
      return { groupId, recipients: 0, delivered: 0, skipped: 0, failures: 0 };
    }

    const mutes = await this.mutesFor(input.topic, people, input.category);

    let delivered = 0;
    let skipped = 0;
    let failures = 0;

    for (let i = 0; i < people.length; i += NotificationDispatchService.CHUNK) {
      const chunk = people.slice(i, i + NotificationDispatchService.CHUNK);
      for (const person of chunk) {
        const channels = this.policy.resolveChannels({
          category: input.category,
          requested: input.channels,
          mutedChannels: mutes.get(`${person.subjectType}:${person.recipientId}`) ?? [],
        });
        if (channels.length === 0) {
          skipped += 1;
          continue;
        }
        for (const channel of channels) {
          try {
            const wrote = await this.deliver(input, person, channel, groupId);
            if (wrote) delivered += 1;
            else skipped += 1;
          } catch (err) {
            failures += 1;
            this.logger.warn(
              {
                topic: input.topic,
                recipientId: person.recipientId,
                channel,
                err: err instanceof Error ? err.message : String(err),
              },
              'Notification delivery failed for one recipient — the rest continue',
            );
          }
        }
      }
    }

    return { groupId, recipients: people.length, delivered, skipped, failures };
  }

  /**
   * Everyone's standing mutes for this topic, in one query.
   *
   * A per-recipient lookup would be one query per person, which on a
   * broadcast is four thousand round trips to decide something a single
   * IN clause answers. An immutable category skips the lookup entirely
   * — the answer cannot change the outcome.
   */
  private async mutesFor(
    topic: string,
    people: readonly ResolvedRecipient[],
    category: NotificationCategory,
  ): Promise<Map<string, NotificationChannel[]>> {
    const out = new Map<string, NotificationChannel[]>();
    if (!this.policy.isMutable(category)) return out;

    const rows = await this.prisma.client.notificationSubscription.findMany({
      where: {
        topic,
        mode: NotificationSubscriptionMode.MUTED,
        subjectId: { in: people.map((p) => p.recipientId) },
      },
      select: { subjectType: true, subjectId: true, mutedChannels: true },
    });
    for (const r of rows) {
      // No channels named means the whole topic is silenced.
      const channels =
        r.mutedChannels.length > 0
          ? r.mutedChannels
          : [NotificationChannel.IN_APP, NotificationChannel.EMAIL];
      out.set(`${r.subjectType}:${r.subjectId}`, channels);
    }
    return out;
  }

  /** @returns true when a delivery row was written, false when deduped. */
  private async deliver(
    input: DispatchInput,
    person: ResolvedRecipient,
    channel: NotificationChannel,
    groupId: string,
  ): Promise<boolean> {
    const isEmail = channel === NotificationChannel.EMAIL;
    if (isEmail && person.email.trim() === '') return false;

    const data: Prisma.NotificationLogUncheckedCreateInput = {
      templateCode: input.templateCode ?? input.topic,
      templateVersion: 1,
      channel,
      recipientType: person.recipientType,
      recipientId: person.recipientId,
      toEmail: isEmail ? person.email : null,
      toInAppUserId: isEmail ? null : person.recipientId,
      subject: input.title,
      body: input.body,
      variables: { title: input.title, body: input.body, name: person.name ?? '' },
      triggerEvent: input.triggerEvent,
      groupId,
      // The in-app row IS the delivery; email waits for its worker.
      status: isEmail ? NotificationStatus.QUEUED : NotificationStatus.SENT,
      ...(isEmail ? {} : { sentAt: new Date() }),
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.orderId == null ? {} : { orderId: input.orderId }),
      ...(input.broadcastId == null ? {} : { broadcastId: input.broadcastId }),
    };

    let logId: string;
    try {
      const row = await this.prisma.client.notificationLog.create({ data, select: { id: true } });
      logId = row.id;
    } catch (err) {
      // NOTIF-2: the partial unique on (event_id, recipient_type,
      // recipient_id, channel, template_code) is the dedup gate. A
      // re-send of the same event is a no-op, not a second message.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }

    if (isEmail) {
      await this.emailQueue.enqueue({
        templateCode: input.templateCode ?? input.topic,
        recipient: {
          type: person.recipientType,
          id: person.recipientId,
          email: person.email,
        },
        variables: { title: input.title, body: input.body, name: person.name ?? '' },
        triggerEvent: input.triggerEvent,
        existingNotificationLogId: logId,
      });
    }
    return true;
  }
}
