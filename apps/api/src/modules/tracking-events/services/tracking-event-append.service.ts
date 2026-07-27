import { Injectable } from '@nestjs/common';
import {
  ActorType,
  type Prisma,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Input for a single tracking_event append. Per TRK-3, `eventAt` is the
 * SCAN timestamp the courier (or the manual operator for
 * source=MANUAL_ENTRY) reports — NEVER the receive time. The receive
 * time is `createdAt`, auto-stamped by Postgres; the hypertable
 * partitions on createdAt (insertion-time partitioning is the canonical
 * Timescale pattern), while every read + the monotonic-forward
 * transition guard order by eventAt.
 */
export interface AppendTrackingEventInput {
  shipmentId: string;
  /** Scan-time timestamp. Webhook entries supply the parsed
   *  `DelhiveryRawScan.eventAtIso`; manual entries supply explicitly. */
  eventAt: Date;
  eventType: TrackingEventType;
  status: ShipmentStatus;
  source: TrackingEventSource;
  courierCode?: string | null;
  rawCourierStatus?: string | null;
  /** The courier's fine-grained reason code under the status (Delhivery
   *  NSL, e.g. `EOD-74`). The status alone does not say WHY, and for a
   *  failed delivery the why is what decides whether a re-attempt is
   *  even permitted. */
  nslCode?: string | null;
  description?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  locationPincode?: string | null;
  /** courier_webhooks.id when source=COURIER_WEBHOOK. Soft scalar:
   *  tracking_events has a composite PK so an inbound FK from
   *  CourierWebhook is fine, but the reverse is by ID-only convention. */
  webhookId?: string | null;
  actorType?: ActorType | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  /** Defaults to true. Set false for ops-only diagnostic scans the
   *  public tracking page should hide. */
  isVisibleToCustomer?: boolean;
}

/** Subset of TrackingEvent columns returned by reads — keeps the
 *  cross-module surface narrow without bringing the full hypertable row
 *  shape into consumers' types. */
export interface TrackingEventRow {
  id: string;
  createdAt: Date;
  eventAt: Date;
  shipmentId: string;
  eventType: TrackingEventType;
  status: ShipmentStatus;
  source: TrackingEventSource;
  courierCode: string | null;
  rawCourierStatus: string | null;
  nslCode: string | null;
  description: string | null;
  locationName: string | null;
  locationCity: string | null;
  locationPincode: string | null;
  webhookId: string | null;
  actorType: ActorType | null;
  actorId: string | null;
  metadata: Prisma.JsonValue | null;
  isVisibleToCustomer: boolean;
}

/**
 * Module 10 (TRK-3) — APPEND-ONLY writer for `tracking_events` + the
 * eventAt-ordered read primitives every downstream consumer goes
 * through. tracking_events is the M10 hypertable; like
 * `stock_movements` / `call_attempts` / `order_events`, it is
 * MUST-NOT-modify-after-insert (CLAUDE.md MUST NOT #3) and the schema
 * enforces this by construction (no update/delete path is exposed).
 *
 * Two primitives:
 *
 *   1. `append` — inserts a new row. The caller supplies `eventAt`
 *      (scan time) explicitly. The row's `createdAt` is auto-stamped
 *      by Postgres (the partition key) — the service NEVER overrides
 *      it. webhook entries pass through `webhookId`; manual entries
 *      pass `actorType=STAFF` + `actorId`.
 *
 *   2. `latestForShipment` — the eventAt-DESC ordered "most recent
 *      scan we've seen". Two consumers:
 *        - the M10 processor (commit 8) reads this to drive the
 *          monotonic-forward transition guard (TRK-4): if a new
 *          scan's eventAt is older than the latest stored, the scan
 *          is still appended (audit) but emits NO order transition.
 *        - the M10 public tracking read service (commit 10) reads
 *          this to derive the customer-visible "current status."
 *
 * Why eventAt and not createdAt: receive time ≠ scan time. A courier
 * may batch + replay scans; a webhook may arrive out-of-order. The
 * tracking timeline shows the courier's reality (eventAt), not our
 * intake (createdAt). MANUAL_ENTRY explicitly preserves the operator's
 * stated scan time too — backfilling a missed manual-courier scan
 * places it correctly in the timeline.
 */
@Injectable()
export class TrackingEventAppendService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendTrackingEventInput): Promise<TrackingEventRow> {
    const row = await this.prisma.client.trackingEvent.create({
      data: {
        shipmentId: input.shipmentId,
        eventAt: input.eventAt,
        eventType: input.eventType,
        status: input.status,
        source: input.source,
        isVisibleToCustomer: input.isVisibleToCustomer ?? true,
        courierCode: input.courierCode ?? null,
        rawCourierStatus: input.rawCourierStatus ?? null,
        nslCode: input.nslCode ?? null,
        description: input.description ?? null,
        locationName: input.locationName ?? null,
        locationCity: input.locationCity ?? null,
        locationPincode: input.locationPincode ?? null,
        webhookId: input.webhookId ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        ...(input.metadata !== undefined && input.metadata !== null
          ? { metadata: input.metadata }
          : {}),
      },
      select: ROW_SELECT,
    });
    return row;
  }

  /**
   * Most-recent tracking_event for the shipment by SCAN time. Returns
   * null when no scan has been recorded yet. The orderBy is the
   * (shipmentId, eventAt DESC) index declared on the schema (TRK-3).
   */
  async latestForShipment(shipmentId: string): Promise<TrackingEventRow | null> {
    return this.prisma.client.trackingEvent.findFirst({
      where: { shipmentId },
      orderBy: { eventAt: 'desc' },
      select: ROW_SELECT,
    });
  }
}

const ROW_SELECT = {
  id: true,
  createdAt: true,
  eventAt: true,
  shipmentId: true,
  eventType: true,
  status: true,
  source: true,
  courierCode: true,
  rawCourierStatus: true,
  nslCode: true,
  description: true,
  locationName: true,
  locationCity: true,
  locationPincode: true,
  webhookId: true,
  actorType: true,
  actorId: true,
  metadata: true,
  isVisibleToCustomer: true,
} as const satisfies Prisma.TrackingEventSelect;
