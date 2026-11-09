import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SolustationHttpService, type FeedbackInput } from './solustation-http.service';

/**
 * Courier status → the six values `/v1/feedback` accepts.
 *
 * Agreed with the owner on 2026-10-26 and written up in
 * `docs/integrations/solustation-feedback-mapping.md`. It is a table in
 * code rather than a condition tree because it is a TRAINING SIGNAL: a
 * wrong label here teaches their phase-5 model something false about an
 * address, and nothing downstream would ever show that it had.
 *
 * `null` means SEND NOTHING. A label printed is not a journey — an
 * order that has an AWB and no scan has had nothing happen to it, and
 * reporting one would teach the model that an address "went in transit"
 * when no van ever moved.
 *
 * Exhaustive by type: a new ShipmentStatus fails to compile until
 * somebody decides how it reads to Solustation, which is the only way
 * this stays true as the lifecycle grows.
 */
const FEEDBACK_STATUS: Record<ShipmentStatus, FeedbackInput['status'] | null> = {
  CREATED: null,
  AWB_PENDING: null,
  AWB_GENERATED: null,
  FAILED_AT_CREATION: null,

  HANDED_TO_COURIER: 'in_transit',
  IN_TRANSIT: 'in_transit',
  // A hub is not an outcome, and their vocabulary has no
  // out-for-delivery — both are still "on its way".
  AT_HUB: 'in_transit',
  OUT_FOR_DELIVERY: 'in_transit',

  DELIVERY_ATTEMPTED: 'ndr',
  DELIVERED: 'delivered',

  // Three events, same status, different event_time. That is correct
  // and wanted: the journey back is part of what the model learns.
  RTO_INITIATED: 'rto',
  RTO_IN_TRANSIT: 'rto',
  RTO_DELIVERED: 'rto',

  LOST: 'lost',
  // Their nearest value. The parcel did not arrive and will not.
  DAMAGED: 'lost',
  CANCELLED: 'cancelled',
};

/** One sweep's worth. Small on purpose — it runs every 12 minutes. */
const MAX_CHECKS_PER_SWEEP = 100;
const MAX_EVENTS_PER_CHECK = 50;

/**
 * Tell Solustation what the courier did with an address.
 *
 * ── WHY A SWEEP AND NOT A HOOK ───────────────────────────────────────
 * The sanctioned post-commit seam, `OrderLifecycleEventBus`, carries
 * ORDER status. A courier scan that does not move the order emits
 * nothing at all — the webhook processor has an `ALREADY_AT_TARGET`
 * branch where the shipment advances and the order does not — so
 * subscribing would silently drop exactly the NDR and in-transit events
 * this table most wants. A hook inside tracking ingestion would catch
 * them and would mean editing shared code the OLD order page depends
 * on, which this project is not allowed to do.
 *
 * So: read `tracking_events` after the fact, per check, past a
 * watermark. No change to the ingestion path, every scan caught, and a
 * lag of one sweep — which for model training is nothing.
 *
 * ── IT NEVER BLOCKS ANYTHING ─────────────────────────────────────────
 * A courier scan is recorded and the order transitions whatever happens
 * here. A failure costs this sweep and is retried by the next one,
 * because their endpoint ignores duplicates — which is also why the
 * watermark is a single timestamp rather than a per-event ledger: the
 * cost of re-sending one event is nothing and the cost of a second
 * table is permanent.
 */
@Injectable()
export class AddressFeedbackService {
  private readonly logger = new Logger(AddressFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SolustationHttpService,
  ) {}

  async sweep(): Promise<{ checks: number; sent: number }> {
    if (!(await this.http.isLive())) return { checks: 0, sent: 0 };

    const checks = await this.prisma.client.addressCheck.findMany({
      where: { orderId: { not: null }, validationId: { not: null } },
      select: { id: true, orderId: true, validationId: true, feedbackWatermarkAt: true },
      // Oldest watermark first, so a backlog drains in order rather
      // than the same rows being re-read every sweep.
      orderBy: { feedbackWatermarkAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_CHECKS_PER_SWEEP,
    });

    let sent = 0;
    for (const check of checks) {
      try {
        sent += await this.sendFor(check);
      } catch (e) {
        // One address's feedback failing must not stop the others.
        this.logger.warn(
          { checkId: check.id, err: e instanceof Error ? e.message : String(e) },
          'feedback for one address failed — the sweep continues',
        );
      }
    }
    return { checks: checks.length, sent };
  }

  private async sendFor(check: {
    id: string;
    orderId: string | null;
    validationId: string | null;
    feedbackWatermarkAt: Date | null;
  }): Promise<number> {
    if (check.orderId === null || check.validationId === null) return 0;

    const events = await this.prisma.client.trackingEvent.findMany({
      where: {
        shipment: { orderShipments: { some: { orderId: check.orderId } } },
        ...(check.feedbackWatermarkAt === null
          ? {}
          : { eventAt: { gt: check.feedbackWatermarkAt } }),
      },
      select: {
        eventAt: true,
        status: true,
        courierCode: true,
        // The two halves of the join to the courier's REMARK — see
        // `ndrRemarks`. The remark does not live on the scan.
        shipmentId: true,
        webhookId: true,
        shipment: { select: { awbNumber: true, courierCode: true } },
      },
      // TRK-3: `eventAt` is the SCAN time, not our intake. It is what
      // the model is being told happened, and when.
      orderBy: { eventAt: 'asc' },
      take: MAX_EVENTS_PER_CHECK,
    });
    if (events.length === 0) return 0;

    const remarks = await this.ndrRemarks(events);

    let sent = 0;
    let watermark = check.feedbackWatermarkAt;
    for (const e of events) {
      const status = FEEDBACK_STATUS[e.status];
      // Nothing to say about this scan — but it is still PAST, so the
      // watermark moves and the next sweep does not re-read it.
      if (status !== null && e.shipment?.awbNumber != null) {
        await this.http.feedback({
          validationId: check.validationId,
          courier: e.courierCode ?? e.shipment.courierCode,
          awb: e.shipment.awbNumber,
          status,
          /*
            The courier's OWN words, and only for a failed attempt.

            This is `delivery_attempts.failure_notes` — the remark text
            as the courier wrote it ("Address incomplete", "Customer not
            available"). It is NOT `rawCourierStatus`, which an earlier
            version sent: that is the STATUS string ("UD", "Undelivered")
            and it already travels in `status`. Sending it twice told
            their model nothing and cost it the one free-text signal the
            NDR carries — the whole reason the field exists.

            An NDR with no remark sends `[]`, not nothing: see
            `buildFeedbackBody`.
          */
          ...(status === 'ndr' ? { ndrReasons: remarks.for(e) } : {}),
          eventTime: e.eventAt.toISOString(),
        });
        sent += 1;
      }
      watermark = e.eventAt;
    }

    if (watermark !== null) {
      await this.prisma.client.addressCheck.update({
        where: { id: check.id },
        data: { feedbackWatermarkAt: watermark },
      });
    }
    return sent;
  }

  /**
   * The courier's remark for each failed-attempt scan in this batch.
   *
   * ── WHY IT IS A SEPARATE LOOKUP ──────────────────────────────────────
   * A scan and its remark are written by the same saga but to DIFFERENT
   * tables: `tracking_events` carries what happened, `delivery_attempts`
   * carries why it failed, and `failure_notes` on the latter is the only
   * place the courier's free text survives (TRK's visible-vs-silent
   * ordering writes the attempt FIRST, precisely so the reason is durable
   * even if the scan write fails). There is no column on the scan to read.
   *
   * ── MATCHED BY WEBHOOK FIRST, THEN BY TIME ───────────────────────────
   * A webhook-sourced pair shares a `webhookId`, which is exact. A
   * POLL-sourced pair has no webhook at all, so it falls back to
   * `(shipmentId, attemptedAt)` — the processor passes the scan's own
   * `eventAt` as `attemptedAt`, so the two are equal by construction.
   * A miss returns `[]` rather than guessing: an adjacent attempt's
   * remark attached to the wrong scan would be worse than silence.
   *
   * One query per sweep batch, not one per scan.
   */
  private async ndrRemarks(
    events: ReadonlyArray<{
      readonly status: ShipmentStatus;
      readonly shipmentId: string;
      readonly webhookId: string | null;
      readonly eventAt: Date;
    }>,
  ): Promise<{
    for: (e: { webhookId: string | null; shipmentId: string; eventAt: Date }) => string[];
  }> {
    const failed = events.filter((e) => FEEDBACK_STATUS[e.status] === 'ndr');
    const byWebhook = new Map<string, string>();
    const byScan = new Map<string, string>();
    const scanKey = (shipmentId: string, at: Date): string => `${shipmentId}|${at.toISOString()}`;

    if (failed.length > 0) {
      const attempts = await this.prisma.client.deliveryAttempt.findMany({
        where: {
          shipmentId: { in: [...new Set(failed.map((e) => e.shipmentId))] },
          attemptedAt: { in: failed.map((e) => e.eventAt) },
          failureNotes: { not: null },
        },
        select: { shipmentId: true, webhookId: true, attemptedAt: true, failureNotes: true },
      });
      for (const a of attempts) {
        const note = (a.failureNotes ?? '').trim();
        if (note === '') continue;
        if (a.webhookId !== null) byWebhook.set(a.webhookId, note);
        byScan.set(scanKey(a.shipmentId, a.attemptedAt), note);
      }
    }

    return {
      for: (e): string[] => {
        const byId = e.webhookId === null ? undefined : byWebhook.get(e.webhookId);
        const note = byId ?? byScan.get(scanKey(e.shipmentId, e.eventAt));
        return note === undefined ? [] : [note];
      },
    };
  }
}
