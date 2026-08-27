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
import { AuditLogService } from '../../auth-common/services/audit-log.service';
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

/**
 * Max shipments pulled into one poll cycle.
 *
 * Sized against Delhivery's actual tracking limit — 750 requests per 5
 * minutes per IP, 50 waybills per request, so 37 500 waybills per 5
 * minutes. At the default 20-minute cron, 10 000 shipments is 200 calls
 * a cycle, or roughly 50 per 5 minutes: about 7% of the budget. The old
 * value of 1 000 was ~13x more conservative than the constraint it was
 * protecting against.
 *
 * That mattered more than it looks, because the cap is not just work-
 * shedding when webhooks are absent — see the ordering note below.
 */
const MAX_SHIPMENTS_PER_CYCLE = 10_000;

export interface TrackingLookupScan {
  readonly rawStatus: string;
  readonly statusType: string | null;
  readonly nslCode: string | null;
  /** As Delhivery sent it — no offset, IST. */
  readonly courierTimestamp: string;
  /** What we would store on tracking_events.eventAt (TRK-3), zoned. */
  readonly eventAtIso: string;
  readonly location: string | null;
  readonly description: string | null;
  /** What our mapper makes of it, or why it makes nothing. */
  readonly normalisedTo: string;
}

export interface TrackingLookupResult {
  readonly awbNumber: string;
  /** Delhivery returned nothing for this waybill. */
  readonly known: boolean;
  /** Whether WE hold a shipment for it — a lookup works either way. */
  readonly ourShipmentId: string | null;
  readonly latest: TrackingLookupScan | null;
  readonly scans: readonly TrackingLookupScan[];
}

export interface PollHealth {
  /** null when no cycle has ever completed. */
  lastRunAtIso: string | null;
  minutesSinceLastRun: number | null;
  cronPattern: string;
  stale: boolean;
}

/**
 * Two missed cycles at the 20-minute default. One late cycle is
 * ordinary; two in a row is worth a person looking.
 */
export const TRACKING_STALE_AFTER_MINUTES = 45;

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
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Where the last completed cycle is recorded, so "has tracking stopped"
   * is answerable without reading logs. A system_setting rather than a
   * new table: one row, written once a cycle, read by the ops page.
   */
  private static readonly HEARTBEAT_KEY = 'courier.tracking_poll_last_run_at';

  async pollAll(): Promise<PollCycleSummary> {
    const summary: PollCycleSummary = {
      stubMode: false,
      shipmentsExamined: 0,
      scansApplied: 0,
      transitions: 0,
    };

    if (await this.http.isStubMode()) {
      summary.stubMode = true;
      // Stub mode is correct in dev and CI. In production it means
      // somebody cleared `courier.delhivery_api_base_url`, and because
      // this poller IS tracking, that turns tracking OFF — with no
      // error, no failed request and nothing in the logs but a quiet
      // early return. The first symptom would be a seller asking why a
      // parcel has not moved in three days.
      //
      // So it announces itself, but only when there is something it
      // should have been polling: in dev there never is, so this stays
      // silent where stub mode is the intended state.
      const inFlight = await this.countInFlight();
      if (inFlight > 0) {
        await this.alarm('tracking.poll_stub_mode_with_inflight', {
          inFlightShipments: inFlight,
          remedy: 'Set courier.delhivery_api_base_url — tracking is not running.',
        });
      }
      await this.stampHeartbeat();
      return summary;
    }

    const shipments = await this.loadInFlightShipments();
    summary.shipmentsExamined = shipments.length;
    if (shipments.length === 0) {
      await this.stampHeartbeat();
      return summary;
    }

    const byAwb = new Map<string, InFlightShipment>();
    for (const s of shipments) byAwb.set(s.awbNumber, s);

    // Batch the tracking fetch (Delhivery caps at 50 waybills/call).
    const batchSize = DelhiveryTrackingFetchService.MAX_WAYBILLS_PER_CALL;
    let batchesAttempted = 0;
    let batchesFailed = 0;
    for (let i = 0; i < shipments.length; i += batchSize) {
      batchesAttempted += 1;
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
        batchesFailed += 1;
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

    // EVERY batch failing is a different animal from one failing. One is
    // a blip the next cycle fixes; all of them means the credential
    // expired, the account was suspended, or their API is down — and
    // because each failure is caught and logged at warn, that state
    // repeats every 20 minutes forever without anything escalating.
    // Tracking is simply frozen and the logs look ordinary.
    const totalFailure = batchesAttempted > 0 && batchesFailed === batchesAttempted;
    if (totalFailure) {
      await this.alarm('tracking.poll_all_batches_failed', {
        batchesAttempted,
        shipmentsExamined: summary.shipmentsExamined,
        remedy:
          'Check the Delhivery credential and their API status — no parcel has updated this cycle.',
      });
    }

    // The heartbeat means "tracking is MOVING", not "the cron fired".
    //
    // Stamping it after a cycle where every batch failed would be the
    // worst of both: the watchdog reads a fresh timestamp and reports
    // healthy, while not one parcel has updated. Everyone reading this
    // number assumes it means the former, so it has to mean the former.
    //
    // The consequence is deliberate: if Delhivery's API is down, we go
    // stale and alarm. That is not our fault, but it IS parcels not
    // updating, which is the thing worth being told about.
    if (!totalFailure) await this.stampHeartbeat();

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
      // STALE FIRST, and this is load-bearing rather than a nicety.
      //
      // With no ordering, `take` hands back whatever the plan yields —
      // in practice the same rows every time. Above the cap that means
      // one arbitrary subset is polled forever and every other parcel
      // is never updated at all: not delayed, never. The comment on the
      // cap used to claim a backlog "drains across cycles", which is
      // only true if the selection rotates, and it did not.
      //
      // It is worth being blunt about the consequence: Delhivery B2C
      // pushes no webhooks, so this poller IS tracking. A silent
      // coverage hole here is a parcel whose customer is told nothing
      // while the parcel beside it updates normally.
      //
      // `updatedAt` ascending puts the shipments we have heard about
      // least recently at the front. Applying a scan touches the row,
      // which sends it to the back — so attention rotates by
      // construction, without another column to maintain.
      orderBy: { updatedAt: 'asc' },
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

  /**
   * How long since a cycle completed. Read by the admin endpoint, the
   * capacity page and the public liveness probe — one computation, so
   * they cannot disagree about whether tracking is healthy.
   */
  async health(): Promise<PollHealth> {
    const [beat, cron] = await Promise.all([
      this.prisma.client.systemSetting.findUnique({
        where: { key: TrackingPollService.HEARTBEAT_KEY },
        select: { valueDate: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: 'courier.tracking_poll_cron' },
        select: { valueString: true },
      }),
    ]);
    const last = beat?.valueDate ?? null;
    const minutes = last === null ? null : Math.floor((Date.now() - last.getTime()) / 60_000);
    return {
      lastRunAtIso: last === null ? null : last.toISOString(),
      minutesSinceLastRun: minutes,
      cronPattern: (cron?.valueString ?? '').trim() || '*/20 * * * *',
      // Never having run counts as stale: it is indistinguishable from
      // having stopped, and both need the same person to look.
      stale: minutes === null || minutes > TRACKING_STALE_AFTER_MINUTES,
    };
  }

  /**
   * What does Delhivery say about these AWBs, and what would we do with
   * it — WITHOUT doing any of it.
   *
   * A poll cycle answers the same question but only for parcels we
   * already hold, and it acts on the answer: writes tracking events,
   * moves orders, credits money downstream. That makes it the wrong
   * instrument for "is realtime status working", because to use it you
   * must first have real parcels in flight.
   *
   * This reads any waybill and writes nothing. It exercises the whole
   * chain that actually breaks — credential decrypt, their wire format,
   * the unzoned IST timestamps, and the (leg, status) mapping — against
   * real data, which is the part no stub can tell you about.
   *
   * Reads are free and side-effect-free at Delhivery's end (unlike a
   * manifest, a cancel or an NDR action), so this is safe to point at a
   * waybill that is not ours.
   */
  async lookup(awbNumbers: readonly string[]): Promise<{
    results: TrackingLookupResult[];
    stubMode: boolean;
  }> {
    const stubMode = await this.http.isStubMode();
    const awbs = awbNumbers.map((a) => a.trim()).filter((a) => a !== '');
    if (awbs.length === 0) return { results: [], stubMode };

    const [fetched, ours] = await Promise.all([
      this.fetch.fetchTracking([...awbs], courierActor.runner('tracking-lookup')),
      this.prisma.client.shipment.findMany({
        where: { awbNumber: { in: [...awbs] }, deletedAt: null },
        select: { id: true, awbNumber: true },
      }),
    ]);
    const oursByAwb = new Map(ours.map((s) => [s.awbNumber ?? '', s.id]));
    const byAwb = new Map(fetched.map((f) => [f.awbNumber, f]));

    const results: TrackingLookupResult[] = awbs.map((awb) => {
      const found = byAwb.get(awb);
      const scans = (found?.scans ?? []).map((raw) => {
        const decision = this.normalizer.normalizeScan(raw);
        return {
          rawStatus: raw.rawStatus,
          statusType: raw.statusType ?? null,
          nslCode: raw.nslCode ?? null,
          courierTimestamp: raw.eventAtIso,
          eventAtIso: new Date(raw.eventAtIso).toISOString(),
          location: raw.locationName ?? null,
          description: raw.description ?? null,
          normalisedTo:
            decision.kind === 'NORMALIZED'
              ? decision.shipmentStatus
              : // Worth surfacing rather than hiding: an unmappable scan
                // is exactly the finding this tool exists to produce.
                `UNMAPPABLE (${raw.statusType ?? '?'} | ${raw.rawStatus})`,
        };
      });
      return {
        awbNumber: awb,
        known: found !== undefined && scans.length > 0,
        ourShipmentId: oursByAwb.get(awb) ?? null,
        latest: scans.length > 0 ? (scans[scans.length - 1] ?? null) : null,
        scans,
      };
    });

    return { results, stubMode };
  }

  /** In-flight count without loading the rows — for the stub-mode alarm. */
  private async countInFlight(): Promise<number> {
    return this.prisma.client.shipment.count({
      where: {
        courierCode: COURIER_CODE,
        awbNumber: { not: null },
        deletedAt: null,
        orderShipments: {
          some: { order: { status: { in: [...IN_FLIGHT_ORDER_STATUSES] } } },
        },
      },
    });
  }

  /**
   * Record that a cycle completed. Best-effort on purpose: a heartbeat
   * that could fail the thing it measures would be worse than none.
   */
  private async stampHeartbeat(): Promise<void> {
    try {
      await this.prisma.client.systemSetting.updateMany({
        where: { key: TrackingPollService.HEARTBEAT_KEY },
        data: { valueDate: new Date() },
      });
    } catch (err) {
      this.logger.warn({ err: errMsg(err) }, 'Could not stamp the tracking-poll heartbeat');
    }
  }

  /** Audit HIGH, swallowed — an alarm must never break the cycle. */
  private async alarm(action: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action,
        entityType: 'tracking_poll',
        entityId: null,
        severity: 'HIGH',
        metadata,
      });
      this.logger.error({ action, ...metadata }, 'Tracking poll alarm');
    } catch (err) {
      this.logger.warn({ err: errMsg(err), action }, 'Could not record a tracking-poll alarm');
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
