import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { EmailDispatchInput, EmailVariables } from '../../email/email.types';

/**
 * Single fan-out target the listener resolved + wants enqueued.
 *
 * `eventId` is the deterministic per-lifecycle-event idempotency key
 * (e.g. `order_status:<orderId>:<from>:<to>`). It IS the dedup
 * anchor: identical input on a re-emit → identical eventId → identical
 * composite-key tuple → partial-unique violation caught here, no
 * second BullMQ enqueue.
 *
 * `recipientId` is REQUIRED (a non-null UUID) so the composite-key
 * gate fires reliably. The listener resolves it to a concrete value
 * (seller.id or customer.id) — when the order has no customer row,
 * the listener uses `orderId` as a stable surrogate so the dedup
 * tuple is still concrete (NULL-distinct semantics in PostgreSQL
 * would otherwise let two NULL-recipient_id rows for the same
 * eventId BOTH succeed → double-send).
 *
 * `toEmail` is nullable per NOTIF-8: when the customer order had no
 * recipientEmail snapshot, the ledger lands a SKIPPED row (not
 * FAILED) AND still consumes the dedup gate (a re-emit on the same
 * eventId/recipient won't insert a second SKIPPED).
 *
 * `variables` are the rendered-template substitutions; the seeded
 * notification_templates reference these by name (Nunjucks {{ var }}).
 */
export interface NotificationLedgerInput {
  readonly eventId: string;
  readonly recipientType: NotificationRecipientType;
  readonly recipientId: string;
  readonly channel: NotificationChannel;
  readonly templateCode: string;
  readonly locale: string;
  readonly toEmail: string | null;
  readonly variables: EmailVariables;
  readonly orderId: string | null;
  readonly shipmentId?: string | null;
  readonly triggerEvent: string;
  /** Optional sender display override (only used by tests today). */
  readonly fromOverride?: string;
}

export type NotificationLedgerResult =
  | { readonly kind: 'ENQUEUED'; readonly notificationLogId: string }
  | { readonly kind: 'SKIPPED'; readonly notificationLogId: string; readonly reason: 'NO_ADDRESS' }
  | { readonly kind: 'DEDUPED'; readonly notificationLogId: string };

/**
 * Module 11 (NOTIF-2 / NOTIF-3 / NOTIF-8) — the outbound ledger writer
 * + dedup gate + best-effort enqueue for the lifecycle-event fan-out
 * path.
 *
 * Contract:
 *   1. NOTIF-2 store-then-send. INSERT the notification_logs row in
 *      PENDING/QUEUED (or SKIPPED, see below) state FIRST, carrying
 *      the eventId. The partial-unique
 *      (event_id, recipient_type, recipient_id, channel, template_code)
 *      WHERE event_id IS NOT NULL is the dedup gate — a re-emit on
 *      the same lifecycle event lands a unique-violation that we
 *      catch and convert to `kind: 'DEDUPED'` (no second enqueue,
 *      no double-send).
 *   2. NOTIF-8 SKIPPED. If `toEmail` is null (e.g., a customer order
 *      whose recipientEmail snapshot is missing) → INSERT status
 *      SKIPPED with the same eventId so a re-emit still hits the
 *      dedup gate, and DO NOT enqueue.
 *   3. NOTIF-3 fan-out independence. The listener calls this method
 *      N times for one lifecycle event (one call per fan-out
 *      target). The composite-key gate per-row means a BullMQ retry
 *      on one target never touches the other; a re-emitted event
 *      double-sends none.
 *   4. NOTIF-1 best-effort. The caller (the post-commit listener)
 *      wraps each enqueue() in a try/catch so an enqueue failure
 *      NEVER propagates back to the triggering transition.
 *
 * Reuses the existing EmailModule substrate end-to-end:
 *   - EmailQueue → BullMQ producer (queue + retries already wired)
 *   - EmailWorker → consumes the job via EmailDispatchService.send,
 *     which the M11 commit-4 change extended to UPDATE the pre-
 *     created row (`existingNotificationLogId`) instead of CREATE.
 *   - ResendService → the underlying send (real SDK; empty-key
 *     dev mode falls back to log-to-stdout, satisfying NOTIF-6's
 *     "stub mode" semantics without a separate adapter).
 */
@Injectable()
export class NotificationLedgerService {
  private readonly logger = new Logger(NotificationLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueue: EmailQueue,
  ) {}

  async enqueue(input: NotificationLedgerInput): Promise<NotificationLedgerResult> {
    // NOTIF-8: skip the send when we have no address. The ledger row
    // is still written so reports / forensics show "we received the
    // lifecycle event, recipient had no email" — and the dedup gate
    // still consumes the eventId so a re-emit doesn't insert a 2nd
    // SKIPPED row. Currently EMAIL is the only channel — for the
    // Phase-2 SMS/WhatsApp shapes "no address" generalises to
    // "no phone/no whatsapp number".
    if (input.channel === NotificationChannel.EMAIL && !input.toEmail) {
      return this.insertSkipped(input);
    }

    const variablesPayload = (input.variables ?? Prisma.DbNull) as Prisma.InputJsonValue;
    try {
      const log = await this.prisma.client.notificationLog.create({
        data: {
          // templateCode + templateVersion are required NOT NULL on
          // notification_logs. We use placeholder values here (the
          // actual template is loaded by EmailDispatchService at send
          // time and the existing-row update path stamps the real
          // version). templateCode IS the seeded code so reports
          // can group by template even on a PENDING/SKIPPED row.
          templateCode: input.templateCode,
          templateVersion: 0, // will be stamped to the real version on send
          channel: input.channel,
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          toEmail: input.toEmail,
          // body/subject are NOT NULL on the schema for body; subject
          // is nullable. Use deterministic placeholders that the
          // EmailDispatchService UPDATE will overwrite with the
          // rendered text.
          body: '',
          subject: null,
          variables: variablesPayload,
          orderId: input.orderId ?? null,
          shipmentId: input.shipmentId ?? null,
          triggerEvent: input.triggerEvent,
          eventId: input.eventId,
          status: NotificationStatus.QUEUED,
        },
        select: { id: true },
      });

      const emailInput: EmailDispatchInput = {
        templateCode: input.templateCode,
        language: input.locale,
        recipient: {
          type: input.recipientType,
          id: input.recipientId,
          email: input.toEmail as string,
        },
        variables: input.variables,
        orderId: input.orderId ?? null,
        shipmentId: input.shipmentId ?? null,
        triggerEvent: input.triggerEvent,
        existingNotificationLogId: log.id,
        ...(input.fromOverride ? { fromOverride: input.fromOverride } : {}),
      };
      await this.emailQueue.enqueue(emailInput);

      return { kind: 'ENQUEUED', notificationLogId: log.id };
    } catch (err) {
      // Partial-unique on (event_id, recipient_type, recipient_id,
      // channel, template_code) WHERE event_id IS NOT NULL caught
      // a duplicate — the lifecycle event was already processed for
      // this target.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.findByDedupKey(input);
        if (existing) {
          this.logger.debug(
            {
              eventId: input.eventId,
              recipientType: input.recipientType,
              templateCode: input.templateCode,
              notificationLogId: existing.id,
            },
            'NotificationLedger: dedup hit — re-emit of the same lifecycle event',
          );
          return { kind: 'DEDUPED', notificationLogId: existing.id };
        }
        // The unique-violation came from a different constraint (we
        // don't have any other UNIQUE on notification_logs today, but
        // log + rethrow defensively).
      }
      throw err;
    }
  }

  /**
   * Lookup by the composite dedup tuple. Used after a P2002 catch to
   * resolve the existing row's id.
   */
  private async findByDedupKey(
    input: NotificationLedgerInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.client.notificationLog.findFirst({
      where: {
        eventId: input.eventId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: input.channel,
        templateCode: input.templateCode,
      },
      select: { id: true },
      // composite key uniqueness on (event_id, recipient_type,
      // recipient_id, channel, template_code) WHERE event_id IS NOT
      // NULL — at most one row.
      orderBy: { createdAt: 'asc' },
    });
  }

  private async insertSkipped(
    input: NotificationLedgerInput,
  ): Promise<NotificationLedgerResult> {
    const variablesPayload = (input.variables ?? Prisma.DbNull) as Prisma.InputJsonValue;
    try {
      const log = await this.prisma.client.notificationLog.create({
        data: {
          templateCode: input.templateCode,
          templateVersion: 0,
          channel: input.channel,
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          toEmail: null,
          body: '',
          subject: null,
          variables: variablesPayload,
          orderId: input.orderId ?? null,
          shipmentId: input.shipmentId ?? null,
          triggerEvent: input.triggerEvent,
          eventId: input.eventId,
          status: NotificationStatus.SKIPPED,
        },
        select: { id: true },
      });
      this.logger.debug(
        {
          eventId: input.eventId,
          recipientType: input.recipientType,
          templateCode: input.templateCode,
          notificationLogId: log.id,
        },
        'NotificationLedger: SKIPPED (no resolvable address — NOTIF-8)',
      );
      return { kind: 'SKIPPED', notificationLogId: log.id, reason: 'NO_ADDRESS' };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.findByDedupKey(input);
        if (existing) return { kind: 'DEDUPED', notificationLogId: existing.id };
      }
      throw err;
    }
  }
}
