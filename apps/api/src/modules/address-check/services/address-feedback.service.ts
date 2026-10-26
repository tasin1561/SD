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
        // The courier's own words for this scan, used only for an NDR.
        rawCourierStatus: true,
        courierCode: true,
        shipment: { select: { awbNumber: true, courierCode: true } },
      },
      // TRK-3: `eventAt` is the SCAN time, not our intake. It is what
      // the model is being told happened, and when.
      orderBy: { eventAt: 'asc' },
      take: MAX_EVENTS_PER_CHECK,
    });
    if (events.length === 0) return 0;

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
          // The courier's OWN words, and only for a failed attempt.
          // Nothing of ours goes in here — it is the field their model
          // reads as the courier speaking.
          ...(status === 'ndr' && e.rawCourierStatus != null
            ? { ndrReasons: [e.rawCourierStatus] }
            : {}),
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
}
