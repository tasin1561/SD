import { Injectable, Logger } from '@nestjs/common';
import { CourierMessageChannel, CourierMessageDirection, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierMessageClassifierService } from './courier-message-classifier.service';

export interface InboundCourierMessage {
  /** Delhivery's ticket id, parsed from the message. */
  readonly externalTicketId: string;
  /** VERBATIM body. Never rewritten before it gets here. */
  readonly body: string;
  /** The courier's timestamp when we have one; else receipt time. */
  readonly occurredAt: Date;
  readonly channel: CourierMessageChannel;
  /** Message-id or equivalent, for tracing back to the source. */
  readonly sourceRef?: string | null;
  readonly awbNumber?: string | null;
}

export type IngestResult =
  | { readonly kind: 'STORED'; readonly messageId: string; readonly escalationId: string }
  | { readonly kind: 'DEDUPED'; readonly escalationId: string }
  | { readonly kind: 'NO_ESCALATION'; readonly externalTicketId: string };

/** Epoch minute — the second half of the dedup key. */
export function minuteBucketOf(when: Date): bigint {
  return BigInt(Math.floor(when.getTime() / 60_000));
}

/**
 * Store an inbound courier message exactly once, and label it.
 *
 * ── THE DEDUP KEY, AND WHY THE MINUTE MATTERS ────────────────────────
 * `(escalationId, bodyHash, minuteBucket)`, enforced by a UNIQUE INDEX
 * rather than by looking first — a read-then-write under READ COMMITTED
 * lets a re-delivered webhook and a poll land the same message twice,
 * and this codebase has found that shape in enough places to stop
 * writing it.
 *
 * The minute bucket is NOT defensive padding. Delhivery's canned replies
 * repeat BYTE-IDENTICALLY across days — "trying our best to deliver
 * within 24 to 48 hours" arrives again tomorrow, unchanged — so a
 * `(escalation, hash)` key would treat tomorrow's genuine reply as a
 * duplicate of today's and silently drop it. That failure is invisible:
 * the thread simply stops updating, and the parcel looks quiet rather
 * than stuck. The bucket narrows the claim to "this exact text, in this
 * conversation, in this minute", which still collapses the duplicates
 * that actually occur (a retried delivery, a re-read of the same page)
 * without collapsing the ones that are real.
 *
 * ── VERBATIM ─────────────────────────────────────────────────────────
 * The stored body is what the courier wrote. The classifier's label
 * drives badges, notifications and prompts; it NEVER edits the text the
 * seller reads.
 */
@Injectable()
export class CourierEscalationIngestService {
  private readonly logger = new Logger(CourierEscalationIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: CourierMessageClassifierService,
  ) {}

  async ingest(input: InboundCourierMessage): Promise<IngestResult> {
    const escalation = await this.prisma.client.courierEscalation.findFirst({
      where: { externalTicketId: input.externalTicketId },
      select: { id: true },
    });

    if (escalation === null) {
      // We received courier mail about a ticket we have no record of.
      // NOT an error and NOT something to invent an escalation for: a
      // ticket raised in the panel by a human is a real case, and
      // fabricating a Ticket + seller linkage from an email would attach
      // a conversation to the wrong seller. It is logged so the gap is
      // visible, and Phase 3's reconciler is what will bind it.
      this.logger.warn(
        { externalTicketId: input.externalTicketId, channel: input.channel },
        'Courier message for an unknown ticket — stored nowhere, needs binding',
      );
      return { kind: 'NO_ESCALATION', externalTicketId: input.externalTicketId };
    }

    const bodyHash = this.classifier.hashBody(input.body);
    const minuteBucket = minuteBucketOf(input.occurredAt);
    const classification = await this.classifier.classify(input.body);

    try {
      const row = await this.prisma.client.courierEscalationMessage.create({
        data: {
          escalationId: escalation.id,
          direction: CourierMessageDirection.INBOUND,
          channel: input.channel,
          body: input.body,
          bodyHash,
          minuteBucket,
          occurredAt: input.occurredAt,
          templateCode: classification.templateCode,
          state: classification.state,
          confidence: new Prisma.Decimal(classification.confidence.toFixed(3)),
          needsReview: classification.needsReview,
          sourceRef: input.sourceRef ?? null,
        },
        select: { id: true },
      });

      // The escalation's own state follows its latest CLASSIFIED message.
      // An unmatched message advances `lastMessageAt` and raises the
      // review flag but does NOT overwrite a known state with null — the
      // thread has not become less understood just because one reply was
      // unrecognised.
      await this.prisma.client.courierEscalation.update({
        where: { id: escalation.id },
        data: {
          lastMessageAt: input.occurredAt,
          ...(classification.state === null ? {} : { state: classification.state }),
          ...(classification.needsReview ? { needsReviewAt: new Date() } : {}),
          ...(input.awbNumber == null ? {} : { awbNumber: input.awbNumber }),
        },
      });

      return { kind: 'STORED', messageId: row.id, escalationId: escalation.id };
    } catch (err) {
      // P2002 on the dedup index is the SUCCESS path for a duplicate:
      // the message is already stored, so there is nothing to do and
      // nothing to report as a failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { kind: 'DEDUPED', escalationId: escalation.id };
      }
      throw err;
    }
  }
}
