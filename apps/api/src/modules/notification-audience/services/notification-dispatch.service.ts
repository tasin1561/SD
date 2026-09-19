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
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';
import type { EmailVariables } from '../../email/email.types';
import {
  NotificationAudienceService,
  type ResolvedRecipient,
} from './notification-audience.service';
import { NotificationPolicyService } from './notification-policy.service';
import { StoreNotificationPreferenceService } from './store-notification-preference.service';
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
  /**
   * Send the EMAIL leg through a real TEMPLATE instead of the generic
   * title/body (2026-09-19).
   *
   * ── WHY THIS IS HERE AND NOT A SECOND CALL ───────────────────────────
   * A reseller store's messages have had proper templates and proper
   * variables since RS-4, written by each notifier through the ledger,
   * and the owner's instruction was to keep every email exactly as it is
   * while adding an inbox line beside it. Sending the two legs as two
   * calls would have meant resolving the audience twice, applying the
   * store's own preference twice and the person's mute twice — three
   * chances for the halves to disagree about who gets what, in a design
   * whose whole claim is that the two decisions compose.
   *
   * So the ONE call carries both, and the policy / store / person layers
   * run once over the pair. `variables` is a function because the email
   * templates address the reader by name; the in-app leg has no such
   * need and keeps the title/body it was given.
   */
  readonly email?: {
    readonly templateCode: string;
    readonly variables: (person: ResolvedRecipient) => EmailVariables;
    /**
     * The EMAIL leg's OWN dedup key, distinct from the in-app leg's
     * (`DispatchInput.eventId`) — NOTIF-14's rule that the two legs of
     * one notification never share a key.
     *
     * Required in practice rather than by the type, because the callers
     * that use this path are migrating emails that ALREADY have keys:
     * inheriting the in-app leg's would silently re-key every stored
     * row's successor and re-send something already sent. Omitting it
     * falls back to the in-app key, which is only ever right for a
     * brand-new pair.
     */
    readonly eventId?: string;
    readonly locale?: string;
    readonly shipmentId?: string | null;
  };
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
 *   3. The STORE's own say removes what a reseller store switched off
 *      for everybody there (2026-09-19; seller and staff recipients skip
 *      this step entirely — they have no store).
 *   4. PREFERENCE removes the channels that person silenced.
 *
 * Policy sits ABOVE preference deliberately. It is what makes the
 * credential rule real: a caller cannot ask for in-app, and a recipient
 * cannot opt INTO it, because the category never permitted it.
 *
 * Steps 3 and 4 are the two layers the owner asked for, and each can
 * only ever REMOVE a channel — so they compose by intersection, the
 * order between them cannot change the answer, and neither can turn on
 * something the other turned off. A topic on `IMMUTABLE_TOPICS` is
 * exempt from both.
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
    private readonly ledger: NotificationLedgerService,
    private readonly storePrefs: StoreNotificationPreferenceService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const groupId = randomUUID();
    const people = await this.audience.resolveMany(input.audience);
    if (people.length === 0) {
      return { groupId, recipients: 0, delivered: 0, skipped: 0, failures: 0 };
    }

    const mutes = await this.mutesFor(input.topic, people, input.category);
    const storeDecisions = await this.storeDecisionsFor(input, people);

    let delivered = 0;
    let skipped = 0;
    let failures = 0;

    for (let i = 0; i < people.length; i += NotificationDispatchService.CHUNK) {
      const chunk = people.slice(i, i + NotificationDispatchService.CHUNK);
      for (const person of chunk) {
        // ORDER: policy (what this KIND of message may use) → the STORE's
        // own say → the PERSON's own mute. Each step only ever removes,
        // so the order cannot change the answer; it is written this way
        // because that is the order the rules are argued in.
        const permitted = this.policy.resolveChannels({
          category: input.category,
          topic: input.topic,
          requested: input.channels,
          mutedChannels: mutes.get(`${person.subjectType}:${person.recipientId}`) ?? [],
        });
        const channels =
          person.storeId === null
            ? permitted
            : permitted.filter((c) => allowedByStore(storeDecisions.get(person.storeId ?? ''), c));
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
    // A named-unmutable topic skips the lookup for the same reason an
    // immutable category does: the answer cannot change the outcome, and
    // a mute recorded before the topic became unmutable must not survive
    // as a back door (see `IMMUTABLE_TOPICS`).
    if (!this.policy.isTopicMutable(topic)) return out;

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

  /**
   * What each STORE in the audience has said about this topic, in one
   * lookup per store rather than one per person.
   *
   * A store's team is small, so this is usually one query for the whole
   * dispatch; it is written as a map anyway because a `SUBSCRIBERS`
   * audience can legitimately span stores, and a per-person lookup there
   * would be the same defect `mutesFor` already avoids.
   *
   * No store users in the audience ⇒ no query at all: the seller and
   * staff paths must not pay for a layer that cannot apply to them.
   */
  private async storeDecisionsFor(
    input: DispatchInput,
    people: readonly ResolvedRecipient[],
  ): Promise<Map<string, { email: boolean; inApp: boolean }>> {
    const out = new Map<string, { email: boolean; inApp: boolean }>();
    const storeIds = [
      ...new Set(people.map((p) => p.storeId).filter((id): id is string => id !== null)),
    ];
    for (const storeId of storeIds) {
      out.set(
        storeId,
        await this.storePrefs.decide({
          storeId,
          topic: input.topic,
          notificationCategory: input.category,
        }),
      );
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

    // A TEMPLATED email leg goes through the ledger exactly as its own
    // notifier used to, so the message the recipient reads is unchanged:
    // same template code, same variables, same store-then-send row, same
    // NOTIF-2 dedup. What has changed is only that the decision about
    // WHETHER to send it was made once, beside the in-app leg's.
    if (isEmail && input.email !== undefined) {
      const result = await this.ledger.enqueue({
        eventId:
          input.email.eventId ?? input.eventId ?? `${input.triggerEvent}:${person.recipientId}`,
        recipientType: person.recipientType,
        recipientId: person.recipientId,
        channel,
        templateCode: input.email.templateCode,
        locale: input.email.locale ?? 'en',
        toEmail: person.email,
        variables: input.email.variables(person),
        orderId: input.orderId ?? null,
        shipmentId: input.email.shipmentId ?? null,
        triggerEvent: input.triggerEvent,
        toStoreId: person.storeId,
      });
      return result.kind === 'ENQUEUED';
    }

    const data: Prisma.NotificationLogUncheckedCreateInput = {
      templateCode: input.templateCode ?? input.topic,
      templateVersion: 1,
      channel,
      recipientType: person.recipientType,
      recipientId: person.recipientId,
      toEmail: isEmail ? person.email : null,
      toInAppUserId: isEmail ? null : person.recipientId,
      // NULL for a seller or staff row; the store inbox scopes on it
      // together with the person's own id, both taken from the token.
      toStoreId: person.storeId,
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

/**
 * Whether a store's own per-category choice permits one channel.
 *
 * An UNKNOWN store (no decision resolved — which cannot happen through
 * `dispatch`, but could if a caller ever shapes its own map) is treated
 * as permitting everything, for the same reason the resolver fails open:
 * the failure of silently dropping a message is worse than the failure
 * of sending one somebody switched off.
 */
function allowedByStore(
  decision: { email: boolean; inApp: boolean } | undefined,
  channel: NotificationChannel,
): boolean {
  if (decision === undefined) return true;
  if (channel === NotificationChannel.EMAIL) return decision.email;
  if (channel === NotificationChannel.IN_APP) return decision.inApp;
  // SMS and WhatsApp have no sender in Phase-1A and no switch here; a
  // caller asking for one is not silently refused by a layer that was
  // never asked about it.
  return true;
}
