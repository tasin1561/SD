import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  CourierDispatchErrorClass,
  CourierOutboxKind,
  CourierOutboxStatus,
  CourierWriteMode,
} from '@skydrop/db';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierChannelSettingsService } from './courier-channel-settings.service';

/** How long a claim holds before anyone else may take the item. */
export const CLAIM_LEASE_MS = 10 * 60_000;

export interface EnqueueOutboxInput {
  readonly escalationId: string;
  readonly kind: CourierOutboxKind;
  /** VERBATIM outbound text. */
  readonly body: string;
  readonly categoryId?: string | null;
}

export interface ClaimedItem {
  readonly id: string;
  readonly escalationId: string;
  readonly kind: CourierOutboxKind;
  readonly body: string;
  readonly categoryId: string | null;
  readonly routedMode: CourierWriteMode;
  readonly claimExpiresAt: Date;
  /** Which courier's support desk this belongs to. Carried so the
   *  dispatcher picks THAT courier's adapter rather than a default —
   *  a message filed with the wrong company is not recoverable. */
  readonly courierCode: string;
}

/**
 * Classify a dispatch failure by what it lets us DO, not by what it was.
 *
 * The only question that matters is whether the request could have been
 * processed on their side:
 *
 *  - **PRE_DISPATCH** — it provably never arrived. DNS failure, connection
 *    refused, TLS failure, 401/403 (they rejected us before reading the
 *    body). Nothing happened, so failing over immediately is safe.
 *  - **AMBIGUOUS** — a timeout, an aborted socket, a 5xx. The request MAY
 *    have been processed. This is the class that must never be retried
 *    blind: retrying a timed-out comment is how one message becomes two
 *    in a thread the customer reads.
 *  - **REJECTED** — they answered, and the answer was no (4xx that is not
 *    an auth failure). Not retryable as-is; a human decides.
 *
 * Anything unrecognised is AMBIGUOUS. That is the expensive-to-be-wrong
 * direction and therefore the right default: treating an unknown as
 * pre-dispatch would authorise an immediate retry of something that may
 * already have landed.
 */
export function classifyDispatchError(err: unknown): CourierDispatchErrorClass {
  const e = err as { code?: string; status?: number; name?: string; message?: string };
  const code = (e?.code ?? '').toUpperCase();
  const message = (e?.message ?? '').toLowerCase();

  if (['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPROTO', 'CERT_HAS_EXPIRED'].includes(code)) {
    // ECONNRESET is DELIBERATELY ABSENT from this list — see below.
    return CourierDispatchErrorClass.PRE_DISPATCH;
  }
  if (e?.status === 401 || e?.status === 403) return CourierDispatchErrorClass.PRE_DISPATCH;

  // ECONNRESET is AMBIGUOUS as of 2026-08-06, moved from PRE_DISPATCH on
  // exactly the condition its TODO named: the portal channel makes
  // `capabilities().getThread` true, so a read-back now exists.
  //
  // A reset can occur mid-response, so the request MAY have been
  // processed. While there was no read-back, calling it pre-dispatch was
  // the lesser evil: an AMBIGUOUS item would have been stranded forever
  // because neither the reconciler nor a human could decide it. With a
  // read-back the trade REVERSES and not marginally — stranding costs one
  // reconciler cycle, while a duplicate lands permanently in a thread the
  // customer reads and is invisible to us.
  if (code === 'ECONNRESET') return CourierDispatchErrorClass.AMBIGUOUS;
  if (typeof e?.status === 'number' && e.status >= 500) return CourierDispatchErrorClass.AMBIGUOUS;
  if (code === 'ETIMEDOUT' || e?.name === 'AbortError' || message.includes('timeout')) {
    return CourierDispatchErrorClass.AMBIGUOUS;
  }
  if (typeof e?.status === 'number' && e.status >= 400) return CourierDispatchErrorClass.REJECTED;
  return CourierDispatchErrorClass.AMBIGUOUS;
}

/**
 * The outbox: a durable row whose STATE decides what may happen next.
 *
 * ── WHY NOT JUST A QUEUE JOB ─────────────────────────────────────────
 * BullMQ retries on failure. That is right for idempotent work and
 * catastrophic here: posting a comment is not idempotent, and a retried
 * timeout puts the same message twice into a thread the customer reads.
 * So the queue only ever wakes something up to LOOK at the outbox; the
 * row decides.
 *
 * ── ROUTING HAPPENS AT CLAIM, NOT AT ENQUEUE ─────────────────────────
 * `claimForWorker` reads the mode at pickup. An item queued under AUTO
 * and picked up after someone switched to MANUAL obeys MANUAL. Stamping
 * the route at enqueue would leave a backlog executing yesterday's
 * intent — and flipping the switch would appear not to have worked,
 * which is the worst possible property for a control someone reaches for
 * in an incident.
 *
 * ── SWITCHING MID-FLIGHT ─────────────────────────────────────────────
 * On MANUAL the worker stops CLAIMING immediately, and an already-claimed
 * item runs to completion. Aborting mid-post is precisely how you produce
 * a SENT_UNCONFIRMED with no read-back — the one state that causes
 * duplicates — so "stop now" means "claim nothing new", never "drop what
 * you are holding".
 */
@Injectable()
export class CourierOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CourierChannelSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  /** sha256 of what identifies this write. Logged instead of the payload. */
  fingerprint(input: EnqueueOutboxInput): string {
    return createHash('sha256')
      .update(`${input.escalationId}|${input.kind}|${input.body}`)
      .digest('hex');
  }

  async enqueue(input: EnqueueOutboxInput): Promise<{ id: string }> {
    const row = await this.prisma.client.courierOutboxItem.create({
      data: {
        escalationId: input.escalationId,
        kind: input.kind,
        body: input.body,
        categoryId: input.categoryId ?? null,
        requestFingerprint: this.fingerprint(input),
        // NOT routed here. See the class doc.
        status: CourierOutboxStatus.PENDING,
      },
      select: { id: true },
    });
    return row;
  }

  /**
   * Claim the next item the WORKER may act on, or null.
   *
   * Returns null when the mode is MANUAL, the channel is paused, or the
   * item's category is not on the auto list — the item stays PENDING and
   * the ops console picks it up. A claim is a guarded `updateMany`, not
   * a read-then-write: two workers reading "PENDING" and both proceeding
   * is exactly the double-post this table exists to prevent.
   */
  async claimForWorker(courierCode = 'delhivery'): Promise<ClaimedItem | null> {
    const settings = await this.settings.get(courierCode);
    if (settings.effectivelyPaused) return null;
    if (settings.writeMode === CourierWriteMode.MANUAL) return null;

    const now = new Date();
    const candidates = await this.prisma.client.courierOutboxItem.findMany({
      where: {
        status: CourierOutboxStatus.PENDING,
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, categoryId: true },
    });

    for (const c of candidates) {
      if (!(await this.settings.mayAutoAct(c.categoryId, courierCode))) continue;

      const expires = new Date(Date.now() + CLAIM_LEASE_MS);
      const { count } = await this.prisma.client.courierOutboxItem.updateMany({
        // The guard IS the WHERE clause.
        where: { id: c.id, status: CourierOutboxStatus.PENDING },
        data: {
          status: CourierOutboxStatus.SENDING,
          claimedByKind: 'worker',
          claimedByStaffId: null,
          claimedAt: now,
          claimExpiresAt: expires,
          // Stamped NOW, at pickup — this is the routing decision.
          routedMode: settings.writeMode,
          attempts: { increment: 1 },
        },
      });
      if (count === 0) continue; // someone else got it

      const row = await this.prisma.client.courierOutboxItem.findUniqueOrThrow({
        where: { id: c.id },
        include: { escalation: { select: { courierCode: true } } },
      });
      return {
        id: row.id,
        escalationId: row.escalationId,
        courierCode: row.escalation.courierCode,
        kind: row.kind,
        body: row.body,
        categoryId: row.categoryId,
        routedMode: settings.writeMode,
        claimExpiresAt: expires,
      };
    }
    return null;
  }

  /** Claim for a HUMAN in the ops console. Same lease, same guard. */
  async claimForStaff(itemId: string, staffId: string): Promise<ClaimedItem> {
    const now = new Date();
    const expires = new Date(now.getTime() + CLAIM_LEASE_MS);
    const { count } = await this.prisma.client.courierOutboxItem.updateMany({
      where: {
        id: itemId,
        status: CourierOutboxStatus.PENDING,
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }],
      },
      data: {
        status: CourierOutboxStatus.SENDING,
        claimedByKind: 'staff',
        claimedByStaffId: staffId,
        claimedAt: now,
        claimExpiresAt: expires,
        routedMode: CourierWriteMode.MANUAL,
        attempts: { increment: 1 },
      },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'OUTBOX_ITEM_NOT_CLAIMABLE',
        message: 'Someone else is already working this item, or it has moved on.',
      });
    }
    const row = await this.prisma.client.courierOutboxItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { escalation: { select: { courierCode: true } } },
    });
    return {
      id: row.id,
      escalationId: row.escalationId,
      courierCode: row.escalation.courierCode,
      kind: row.kind,
      body: row.body,
      categoryId: row.categoryId,
      routedMode: CourierWriteMode.MANUAL,
      claimExpiresAt: expires,
    };
  }

  /**
   * We dispatched it and do NOT know the outcome.
   *
   * Set by the worker the instant it hands bytes over, and by a human
   * clicking "Mark sent". Both mean the same thing and neither means
   * success: only a read-back may produce CONFIRMED. If a human clicks
   * this and pastes nothing, the reconciler finds an item with no
   * external ref and returns it to the queue.
   */
  async markSentUnconfirmed(input: {
    itemId: string;
    actorType: ActorType;
    staffId?: string | null;
    externalRef?: string | null;
  }): Promise<void> {
    const { count } = await this.prisma.client.courierOutboxItem.updateMany({
      where: { id: input.itemId, status: CourierOutboxStatus.SENDING },
      data: {
        status: CourierOutboxStatus.SENT_UNCONFIRMED,
        dispatchedAt: new Date(),
        ...(input.externalRef == null ? {} : { externalRef: input.externalRef }),
      },
    });
    if (count === 0) return;
    await this.logAction(
      input.itemId,
      'courier.outbox.sent_unconfirmed',
      input.actorType,
      input.staffId,
    );
  }

  /**
   * The ONLY path to CONFIRMED, and it takes evidence.
   *
   * `readBack` is the caller's proof that the message is present in the
   * courier's thread. There is deliberately no method that lets a worker
   * or a human simply declare success: asserting it is exactly how a
   * duplicate becomes invisible.
   */
  async confirmFromReadBack(input: {
    itemId: string;
    externalRef?: string | null;
    actorType: ActorType;
    staffId?: string | null;
  }): Promise<void> {
    const { count } = await this.prisma.client.courierOutboxItem.updateMany({
      where: {
        id: input.itemId,
        status: { in: [CourierOutboxStatus.SENT_UNCONFIRMED, CourierOutboxStatus.SENDING] },
      },
      data: {
        status: CourierOutboxStatus.CONFIRMED,
        confirmedAt: new Date(),
        ...(input.externalRef == null ? {} : { externalRef: input.externalRef }),
      },
    });
    if (count === 0) return;
    await this.logAction(input.itemId, 'courier.outbox.confirmed', input.actorType, input.staffId);
  }

  /**
   * Definitively not sent.
   *
   * PRE_DISPATCH and REJECTED end here and are safe to re-enqueue as a
   * NEW item. AMBIGUOUS must NOT come here — it goes to
   * SENT_UNCONFIRMED and the reconciler, because "we do not know" is not
   * "it did not happen".
   */
  async fail(input: {
    itemId: string;
    error: string;
    errorClass: CourierDispatchErrorClass;
    actorType: ActorType;
    staffId?: string | null;
  }): Promise<void> {
    const nextStatus =
      input.errorClass === CourierDispatchErrorClass.AMBIGUOUS
        ? CourierOutboxStatus.SENT_UNCONFIRMED
        : CourierOutboxStatus.FAILED;

    await this.prisma.client.courierOutboxItem.updateMany({
      where: { id: input.itemId, status: CourierOutboxStatus.SENDING },
      data: {
        status: nextStatus,
        lastError: input.error.slice(0, 2000),
        lastErrorClass: input.errorClass,
        ...(nextStatus === CourierOutboxStatus.SENT_UNCONFIRMED
          ? { dispatchedAt: new Date() }
          : {}),
      },
    });
    await this.logAction(
      input.itemId,
      nextStatus === CourierOutboxStatus.SENT_UNCONFIRMED
        ? 'courier.outbox.ambiguous_pending_reconcile'
        : 'courier.outbox.failed',
      input.actorType,
      input.staffId,
      { errorClass: input.errorClass },
    );
  }

  /** Return an item to the queue — an expired lease, or a human giving up. */
  async release(itemId: string, why: string): Promise<void> {
    await this.prisma.client.courierOutboxItem.updateMany({
      where: { id: itemId, status: CourierOutboxStatus.SENDING },
      data: {
        status: CourierOutboxStatus.PENDING,
        claimedByKind: null,
        claimedByStaffId: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError: why.slice(0, 2000),
      },
    });
  }

  /**
   * One audit shape for BOTH consumers.
   *
   * The worker and the ops console write IDENTICAL rows differing only in
   * `actor_type` (SYSTEM vs STAFF). That is the point: "who did this"
   * should be one field to read, not two log formats to reconcile — and
   * it is what makes the amended CUR-10's operator-vs-runner distinction
   * answerable from the audit log for outbound writes too.
   *
   * The FINGERPRINT is logged, never the payload. The body already lives
   * in `courier_outbox_items`; copying customer-visible text into the
   * audit trail would put it in two places with two retention stories.
   */
  private async logAction(
    itemId: string,
    action: string,
    actorType: ActorType,
    staffId?: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const item = await this.prisma.client.courierOutboxItem.findUnique({
      where: { id: itemId },
      select: {
        requestFingerprint: true,
        kind: true,
        status: true,
        externalRef: true,
        routedMode: true,
        escalation: { select: { awbNumber: true, externalTicketId: true, courierCode: true } },
      },
    });
    if (item === null) return;

    await this.audit.log({
      actorType,
      staffUserId: staffId ?? null,
      actorId: staffId ?? null,
      action,
      entityType: 'courier_outbox_item',
      entityId: itemId,
      severity: 'MEDIUM',
      metadata: {
        channel: item.escalation.courierCode,
        op: item.kind,
        awb: item.escalation.awbNumber,
        externalId: item.externalRef ?? item.escalation.externalTicketId,
        outcome: item.status,
        routedMode: item.routedMode,
        requestFingerprint: item.requestFingerprint,
        ...extra,
      },
    });
  }
}
