import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  OrderStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryHttpService } from '../../courier-delhivery/services/delhivery-http.service';
import { DelhiveryTrackingFetchService } from '../../courier-delhivery/services/delhivery-tracking-fetch.service';
import { DelhiveryTrackingService } from '../../courier-delhivery/services/delhivery-tracking.service';
import type { DelhiveryRawScan } from '../../courier-delhivery/types/delhivery.types';
import { TrackingStatusMappingService } from '../../tracking-events/services/tracking-status-mapping.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

const COURIER_CODE = 'delhivery';

/**
 * Order statuses for which polling is worthwhile — the shipment is
 * dispatched and moving, but not yet at a terminal / warehouse-owned
 * state. Mirrors TRK-6: webhook/poll drives up to RTO_IN_TRANSIT only;
 * RTO_RECEIVED onward is the warehouse's authority. DELIVERED and the
 * cancel/lost/restock terminals are excluded — nothing left to track.
 */
const IN_FLIGHT_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
];

/** Max shipments pulled into one poll cycle (bounds the work; the cron
 *  re-fires so a backlog drains across cycles). */
const MAX_SHIPMENTS_PER_CYCLE = 1000;

export interface PollCycleSummary {
  stubMode: boolean;
  shipmentsExamined: number;
  scansApplied: number;
  transitions: number;
}

interface InFlightShipment {
  id: string;
  awbNumber: string;
  orderId: string;
  shipmentStatus: ShipmentStatus;
}

/**
 * Module 10 (poll) — the Delhivery tracking POLLER.
 *
 * Delhivery B2C accounts push NO webhooks (validated live 2026-07), so
 * tracking is poll-based. This service is the polling counterpart to
 * the webhook processor: a repeatable BullMQ job (TrackingPollWorker)
 * calls `pollAll()` on a cron; it fetches scan history for in-flight
 * AWBs and drives the SAME order lifecycle the webhook flow does —
 * same mapping (TrackingStatusMappingService, TRK-5), same
 * monotonic-forward guard (TRK-4), same NDR saga ordering
 * (delivery_attempts FIRST). Source on every row = COURIER_POLL.
 *
 * ── Idempotency: the eventAt WATERMARK ────────────────────────────
 * Unlike webhooks (one scan, deduped on the courier_webhooks row), a
 * poll returns the FULL scan history every cycle. The dedup key is the
 * shipment's latest tracking_event `eventAt` (TRK-3 scan time): only
 * scans strictly newer than the watermark are applied. Appending the
 * scan's tracking_event advances the watermark, so the next cycle skips
 * it. delivery_attempts get a second guard (dedup on
 * (shipmentId, attemptedAt)) to stay idempotent across the rare
 * crash-between-attempt-and-event window (the poll has no webhookId to
 * dedup on).
 *
 * ── STUB MODE ─────────────────────────────────────────────────────
 * `pollAll()` short-circuits when the Delhivery adapter is in stub mode
 * (empty `courier.delhivery_api_base_url`) — the poller is inert in
 * Phase-1A / e2e / CI. It activates automatically the moment real mode
 * is switched on (the go-live setting). No separate enable flag.
 */
@Injectable()
export class TrackingPollService {
  private readonly logger = new Logger(TrackingPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: DelhiveryHttpService,
    private readonly fetch: DelhiveryTrackingFetchService,
    private readonly normalizer: DelhiveryTrackingService,
    private readonly mapping: TrackingStatusMappingService,
    private readonly append: TrackingEventAppendService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async pollAll(): Promise<PollCycleSummary> {
    const summary: PollCycleSummary = {
      stubMode: false,
      shipmentsExamined: 0,
      scansApplied: 0,
      transitions: 0,
    };

    if (await this.http.isStubMode()) {
      summary.stubMode = true;
      return summary;
    }

    const shipments = await this.loadInFlightShipments();
    summary.shipmentsExamined = shipments.length;
    if (shipments.length === 0) return summary;

    const byAwb = new Map<string, InFlightShipment>();
    for (const s of shipments) byAwb.set(s.awbNumber, s);

    // Batch the tracking fetch (Delhivery caps at 50 waybills/call).
    const batchSize = DelhiveryTrackingFetchService.MAX_WAYBILLS_PER_CALL;
    for (let i = 0; i < shipments.length; i += batchSize) {
      const batch = shipments.slice(i, i + batchSize);
      let results;
      try {
        results = await this.fetch.fetchTracking(
          batch.map((s) => s.awbNumber),
          courierActor.runner('tracking-poll'),
        );
      } catch (err) {
        // A transient fetch failure for one batch never aborts the
        // cycle — the next cron run retries. Log and continue.
        this.logger.warn(
          { err: errMsg(err), batchStart: i, batchSize: batch.length },
          'Delhivery fetchTracking batch failed; skipping this batch',
        );
        continue;
      }

      for (const result of results) {
        const shipment = byAwb.get(result.awbNumber);
        if (!shipment) continue;
        try {
          const applied = await this.applyNewScans(shipment, result.scans);
          summary.scansApplied += applied.scansApplied;
          summary.transitions += applied.transitions;
        } catch (err) {
          // Per-shipment isolation — one shipment's failure never
          // blocks the others (same fan-out discipline as the M9/M8
          // manifest sagas).
          this.logger.warn(
            { err: errMsg(err), shipmentId: shipment.id, awb: result.awbNumber },
            'Poll: applying scans for shipment failed; continuing',
          );
        }
      }
    }

    this.logger.log(
      {
        examined: summary.shipmentsExamined,
        scansApplied: summary.scansApplied,
        transitions: summary.transitions,
      },
      'Delhivery tracking poll cycle complete',
    );
    return summary;
  }

  private async loadInFlightShipments(): Promise<InFlightShipment[]> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        courierCode: COURIER_CODE,
        awbNumber: { not: null },
        deletedAt: null,
        orderShipments: {
          some: { order: { status: { in: [...IN_FLIGHT_ORDER_STATUSES] } } },
        },
      },
      select: {
        id: true,
        awbNumber: true,
        status: true,
        orderShipments: { select: { orderId: true }, take: 1 },
      },
      take: MAX_SHIPMENTS_PER_CYCLE,
    });

    const out: InFlightShipment[] = [];
    for (const r of rows) {
      const awbNumber = r.awbNumber;
      const link = r.orderShipments[0];
      if (awbNumber === null || !link) continue;
      out.push({
        id: r.id,
        awbNumber,
        orderId: link.orderId,
        shipmentStatus: r.status,
      });
    }
    return out;
  }

  /**
   * Apply every scan newer than the shipment's tracking-event
   * watermark, oldest-first. Each scan re-reads the order's current
   * status (transitions applied earlier in the loop move it forward).
   */
  private async applyNewScans(
    shipment: InFlightShipment,
    scans: readonly DelhiveryRawScan[],
  ): Promise<{ scansApplied: number; transitions: number }> {
    const latest = await this.append.latestForShipment(shipment.id);
    const watermarkMs = latest ? latest.eventAt.getTime() : -Infinity;

    let scansApplied = 0;
    let transitions = 0;
    for (const scan of scans) {
      const eventAt = new Date(scan.eventAtIso);
      if (Number.isNaN(eventAt.getTime())) continue;
      if (eventAt.getTime() <= watermarkMs) continue; // watermark dedup

      const didTransition = await this.applyScan(shipment, scan, eventAt);
      scansApplied += 1;
      if (didTransition) transitions += 1;
    }
    return { scansApplied, transitions };
  }

  /** Returns true when an order transition actually fired. */
  private async applyScan(
    shipment: InFlightShipment,
    scan: DelhiveryRawScan,
    eventAt: Date,
  ): Promise<boolean> {
    const normalized = this.normalizer.normalizeScan(scan);

    // UNMAPPABLE — record an ops-only audit event so the watermark
    // advances (we won't re-examine this scan) but emit no transition.
    if (normalized.kind === 'UNMAPPABLE') {
      await this.append.append({
        shipmentId: shipment.id,
        eventAt,
        eventType: TrackingEventType.STATUS_SYNC,
        status: shipment.shipmentStatus,
        source: TrackingEventSource.COURIER_POLL,
        courierCode: COURIER_CODE,
        rawCourierStatus: scan.rawStatus,
        description: scan.description ?? null,
        locationName: scan.locationName ?? null,
        locationCity: scan.locationCity ?? null,
        metadata: { unmappable: true, reason: normalized.reason, rawStatus: scan.rawStatus },
        isVisibleToCustomer: false,
      });
      return false;
    }

    const decision = this.mapping.mapScan(normalized.shipmentStatus);

    if (decision.kind === 'REJECT') {
      // A real courier scan should never map to REJECT; record an
      // ops-only event + log. No transition.
      this.logger.warn(
        { shipmentId: shipment.id, rawStatus: scan.rawStatus, reason: decision.reason },
        'Poll: scan mapped to REJECT (unexpected from courier); recording audit only',
      );
      await this.append.append({
        shipmentId: shipment.id,
        eventAt,
        eventType: TrackingEventType.STATUS_SYNC,
        status: normalized.shipmentStatus,
        source: TrackingEventSource.COURIER_POLL,
        courierCode: COURIER_CODE,
        rawCourierStatus: scan.rawStatus,
        metadata: { reject: true, reason: decision.reason },
        isVisibleToCustomer: false,
      });
      return false;
    }

    // DELIVERY_ATTEMPT — write the durable delivery_attempts row FIRST
    // (visible-vs-silent), deduped on (shipmentId, attemptedAt).
    if (decision.kind === 'DELIVERY_ATTEMPT') {
      await this.writeAttemptIfNew(shipment.id, eventAt, scan.failureReason ?? null);
    }

    // Append the tracking_event (advances the watermark).
    await this.append.append({
      shipmentId: shipment.id,
      eventAt,
      eventType: decision.trackingEventType,
      status: normalized.shipmentStatus,
      source: TrackingEventSource.COURIER_POLL,
      courierCode: COURIER_CODE,
      rawCourierStatus: scan.rawStatus,
      description: scan.description ?? null,
      locationName: scan.locationName ?? null,
      locationCity: scan.locationCity ?? null,
    });

    if (decision.kind === 'INFORMATIONAL') return false;

    // Re-read the order's CURRENT status (earlier scans in this loop
    // may have moved it) before the monotonic-forward guard.
    const order = await this.prisma.client.order.findUnique({
      where: { id: shipment.orderId },
      select: { status: true },
    });
    if (!order) return false;

    if (this.shouldSkipTransition(order.status, decision) !== null) {
      return false;
    }

    try {
      await this.orderWrite.transitionStatus({
        orderId: shipment.orderId,
        to: decision.targetOrderStatus,
        expectedFrom: order.status,
        actor: { type: ActorType.SYSTEM },
        reason: `Courier poll scan ${normalized.shipmentStatus} via ${COURIER_CODE}`,
      });
      return true;
    } catch (err) {
      if (err instanceof ConflictException) {
        // Concurrent change / already past target — the event is
        // recorded; not a failure (same as webhook/manual).
        this.logger.debug(
          {
            shipmentId: shipment.id,
            orderId: shipment.orderId,
            target: decision.targetOrderStatus,
          },
          'Poll: transitionStatus 409 after guard — concurrent change; event recorded',
        );
        return false;
      }
      throw err;
    }
  }

  private shouldSkipTransition(
    current: OrderStatus,
    decision: {
      targetOrderStatus: OrderStatus;
      allowedFromOrderStatuses: readonly OrderStatus[];
    },
  ): 'ALREADY_AT_TARGET' | 'CURRENT_NOT_IN_ALLOWED_FROM' | null {
    if (current === decision.targetOrderStatus) return 'ALREADY_AT_TARGET';
    if (!decision.allowedFromOrderStatuses.includes(current)) {
      return 'CURRENT_NOT_IN_ALLOWED_FROM';
    }
    return null;
  }

  /** Idempotent delivery_attempts write for polling — dedup on
   *  (shipmentId, attemptedAt) since a poll has no webhookId. */
  private async writeAttemptIfNew(
    shipmentId: string,
    attemptedAt: Date,
    rawFailureReason: string | null,
  ): Promise<void> {
    const existing = await this.prisma.client.deliveryAttempt.findFirst({
      where: { shipmentId, attemptedAt },
      select: { id: true },
    });
    if (existing) return;

    const prior = await this.prisma.client.deliveryAttempt.count({
      where: { shipmentId },
    });
    try {
      await this.prisma.client.deliveryAttempt.create({
        data: {
          shipmentId,
          attemptNumber: prior + 1,
          attemptedAt,
          outcome: DeliveryAttemptOutcome.FAILED,
          ...(rawFailureReason !== null && rawFailureReason !== ''
            ? { failureNotes: rawFailureReason }
            : {}),
          source: TrackingEventSource.COURIER_POLL,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return; // lost the race — fine
      throw err;
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2002';
}
