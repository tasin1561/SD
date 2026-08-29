import type { CourierParcelFacts } from '../../courier-delhivery/types/delhivery.types';
import {
  COURIER_TRACKING_SOURCES,
  type CourierTrackingSource,
} from '../../courier-shared/services/courier-tracking-source';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  OrderStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryTrackingService } from '../../courier-delhivery/services/delhivery-tracking.service';
import type { DelhiveryRawScan } from '../../courier-delhivery/types/delhivery.types';
import { TrackingStatusMappingService } from '../../tracking-events/services/tracking-status-mapping.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';

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
  /** Which of the courier's accounts booked it. Delhivery ignores this;
   *  Shiprocket's token is per-account, and polling an AWB with the
   *  wrong account's token returns "not found" — indistinguishable
   *  from a parcel that has not moved. */
  courierAccountId: string | null;
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
    @Inject(COURIER_TRACKING_SOURCES)
    private readonly sources: readonly CourierTrackingSource[],
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

  /**
   * One cycle, across every courier that has a tracking integration.
   *
   * Per-courier failure isolation, for the same reason the batch loop
   * inside has it: Shiprocket's API being down must not stop Delhivery
   * parcels updating, and vice versa. The summary is the SUM, because
   * "did tracking run" is a question about the estate, not about one
   * vendor.
   */
  async pollAll(): Promise<PollCycleSummary> {
    const summary: PollCycleSummary = {
      stubMode: false,
      shipmentsExamined: 0,
      scansApplied: 0,
      transitions: 0,
    };

    let anySourceMoved = false;
    let allSourcesStub = true;

    for (const source of this.sources) {
      try {
        const one = await this.pollSource(source);
        summary.shipmentsExamined += one.summary.shipmentsExamined;
        summary.scansApplied += one.summary.scansApplied;
        summary.transitions += one.summary.transitions;
        if (!one.summary.stubMode) allSourcesStub = false;
        if (one.moved) anySourceMoved = true;
      } catch (err) {
        // A courier's whole cycle failing is already alarmed inside
        // pollSource; this catch exists so an unexpected throw cannot
        // take the other couriers' parcels down with it.
        this.logger.error(
          { err: errMsg(err), courierCode: source.courierCode },
          'Tracking poll cycle threw for one courier; continuing with the rest',
        );
      }
    }

    summary.stubMode = allSourcesStub;

    // The heartbeat means "tracking is MOVING", not "the cron fired".
    //
    // Stamping it after a cycle where every batch failed would be the
    // worst of both: the watchdog reads a fresh timestamp and reports
    // healthy, while not one parcel has updated. Everyone reading this
    // number assumes it means the former, so it has to mean the former.
    //
    // With two couriers the rule is ANY of them moving — one vendor
    // being down is worth an alarm (pollSource raises it) but is not
    // "tracking has stopped", and going stale on it would cry wolf
    // every time either API had a bad twenty minutes.
    if (anySourceMoved) await this.stampHeartbeat();

    this.logger.log(
      {
        examined: summary.shipmentsExamined,
        scansApplied: summary.scansApplied,
        transitions: summary.transitions,
        couriers: this.sources.map((s) => s.courierCode),
      },
      'Tracking poll cycle complete',
    );
    return summary;
  }

  /**
   * One courier's cycle.
   *
   * `moved` is separate from the summary because it answers a different
   * question: not "how much happened" but "is this source working at
   * all". A cycle with nothing to poll counts as working; a cycle where
   * every batch failed does not.
   */
  private async pollSource(
    source: CourierTrackingSource,
  ): Promise<{ summary: PollCycleSummary; moved: boolean }> {
    const summary: PollCycleSummary = {
      stubMode: false,
      shipmentsExamined: 0,
      scansApplied: 0,
      transitions: 0,
    };

    if (await source.isStubMode()) {
      summary.stubMode = true;
      // Stub mode is correct in dev and CI. In production it means
      // somebody cleared this courier's base URL, and because this
      // poller IS tracking, that turns tracking OFF for their parcels —
      // with no error, no failed request and nothing in the logs but a
      // quiet early return. The first symptom would be a seller asking
      // why a parcel has not moved in three days.
      //
      // So it announces itself, but only when there is something it
      // should have been polling: in dev there never is, so this stays
      // silent where stub mode is the intended state.
      const inFlight = await this.countInFlight(source.courierCode);
      if (inFlight > 0) {
        await this.alarm('tracking.poll_stub_mode_with_inflight', {
          courierCode: source.courierCode,
          inFlightShipments: inFlight,
          remedy: source.stubRemedy,
        });
      }
      // Stub mode is not a failure — a dev box has no reason to go
      // stale — so it counts as moved.
      return { summary, moved: true };
    }

    const shipments = await this.loadInFlightShipments(source.courierCode);
    summary.shipmentsExamined = shipments.length;
    if (shipments.length === 0) return { summary, moved: true };

    const byAwb = new Map<string, InFlightShipment>();
    for (const s of shipments) byAwb.set(s.awbNumber, s);

    // GROUPED BY ACCOUNT when the courier's credentials are per-account.
    // Shiprocket's bearer token belongs to one account: polling an AWB
    // with a different account's token returns "not found", which reads
    // exactly like a parcel that has not moved. Delhivery has one set of
    // credentials for the estate, so it is a single group.
    const groups = source.perAccount
      ? this.groupByAccount(shipments)
      : new Map<string | null, InFlightShipment[]>([[null, shipments]]);

    let batchesAttempted = 0;
    let batchesFailed = 0;

    for (const [courierAccountId, groupShipments] of groups) {
      for (let i = 0; i < groupShipments.length; i += source.maxAwbsPerCall) {
        batchesAttempted += 1;
        const batch = groupShipments.slice(i, i + source.maxAwbsPerCall);
        let results;
        try {
          results = await source.fetchTracking(
            batch.map((s) => s.awbNumber),
            courierAccountId,
          );
        } catch (err) {
          // A transient fetch failure for one batch never aborts the
          // cycle — the next cron run retries. Log and continue.
          batchesFailed += 1;
          this.logger.warn(
            {
              err: errMsg(err),
              courierCode: source.courierCode,
              courierAccountId,
              batchStart: i,
              batchSize: batch.length,
            },
            'fetchTracking batch failed; skipping this batch',
          );
          continue;
        }

        for (const result of results) {
          const shipment = byAwb.get(result.awbNumber);
          if (!shipment) continue;
          try {
            // What the courier says the parcel IS, before what happened
            // to it. Best-effort and non-fatal: these are enrichment,
            // and losing them must never stop a scan being applied,
            // because the scan is what moves the order.
            await this.applyParcelFacts(shipment.id, result.facts);
            const applied = await this.applyNewScans(shipment, result.scans, source);
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
        courierCode: source.courierCode,
        batchesAttempted,
        shipmentsExamined: summary.shipmentsExamined,
        remedy: `Check the ${source.courierCode} credential and their API status — no parcel of theirs updated this cycle.`,
      });
    }

    return { summary, moved: !totalFailure };
  }

  /**
   * Record the courier's own statement of what the parcel is.
   *
   * ── WHY THESE ARE WRITTEN ONLY WHEN STATED ───────────────────────
   * Each field is set only when the courier actually sent it. A poll
   * that omits the chargeable weight must not blank a weight an earlier
   * poll established — their responses thin out as a parcel ages, and
   * treating silence as "no longer true" would erase the number an
   * invoice is built on.
   *
   * Not a transaction and not fatal: the scans are the point of the
   * cycle, and a failure here is enrichment lost for twenty minutes
   * rather than an order that stopped moving.
   */
  private async applyParcelFacts(
    shipmentId: string,
    facts: CourierParcelFacts | undefined,
  ): Promise<void> {
    if (facts === undefined) return;
    const data: Record<string, unknown> = {};
    if (facts.chargedWeightGrams != null) data['chargeableWeightGrams'] = facts.chargedWeightGrams;
    if (facts.expectedDeliveryAt != null) data['expectedDeliveryAt'] = facts.expectedDeliveryAt;
    if (Object.keys(data).length === 0) return;

    try {
      await this.prisma.client.shipment.update({ where: { id: shipmentId }, data });
    } catch (err) {
      this.logger.warn(
        { shipmentId, err: errMsg(err) },
        'Could not record courier parcel facts; scans still applied',
      );
    }
  }

  /** Shipments keyed by the account that booked them. */
  private groupByAccount(
    shipments: readonly InFlightShipment[],
  ): Map<string | null, InFlightShipment[]> {
    const out = new Map<string | null, InFlightShipment[]>();
    for (const s of shipments) {
      // A null account is kept as its OWN group rather than dropped:
      // the source refuses it loudly, which surfaces the data problem.
      // Silently skipping would leave those parcels never polled and
      // nothing anywhere saying so.
      const existing = out.get(s.courierAccountId);
      if (existing === undefined) out.set(s.courierAccountId, [s]);
      else existing.push(s);
    }
    return out;
  }

  private async loadInFlightShipments(courierCode: string): Promise<InFlightShipment[]> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        courierCode,
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
        courierAccountId: true,
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
        courierAccountId: r.courierAccountId,
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
    source: CourierTrackingSource,
  ): Promise<{ scansApplied: number; transitions: number }> {
    const latest = await this.append.latestForShipment(shipment.id);
    const watermarkMs = latest ? latest.eventAt.getTime() : -Infinity;

    // Reconcile the shipment row against what we already know, BEFORE
    // looking at anything new.
    //
    // Doing it only when a scan is applied made the repair opportunistic:
    // of ten parcels needing it, one cycle fixed two — the two that
    // happened to have a fresh scan. The other eight would have waited
    // on the courier, and a parcel that stops scanning would have waited
    // for ever, with the public page still saying "processing".
    //
    // The watermark read already carries the status, so this is a
    // comparison rather than a query: deterministic, every cycle, every
    // in-flight parcel, at no extra cost. The latest tracking event IS
    // the record of where the parcel is; the shipment row should say the
    // same thing.
    if (latest !== null && latest.status !== shipment.shipmentStatus) {
      await this.advanceShipmentStatus(shipment.id, latest.status);
    }

    let scansApplied = 0;
    let transitions = 0;
    for (const scan of scans) {
      const eventAt = new Date(scan.eventAtIso);
      if (Number.isNaN(eventAt.getTime())) continue;
      if (eventAt.getTime() <= watermarkMs) continue; // watermark dedup

      const didTransition = await this.applyScan(shipment, scan, eventAt, source);
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
    source: CourierTrackingSource,
  ): Promise<boolean> {
    const normalized = source.normalizeScan(scan);

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

    const skip = this.shouldSkipTransition(order.status, decision);
    if (skip !== null) {
      // ALREADY_AT_TARGET means the ORDER is already where this scan
      // says — but the shipment row may not be, and until now nothing
      // ever moved it. That is not hypothetical: ten parcels sat with
      // orders at IN_TRANSIT and shipments still at HANDED_TO_COURIER,
      // and because every further scan also said IN_TRANSIT they could
      // never catch up. Advancing only on a successful transition left
      // exactly this hole.
      //
      // Safe because it copies a status the order already holds — no new
      // claim about the parcel. A stale backward scan
      // (CURRENT_NOT_IN_ALLOWED_FROM) is still refused, so this cannot
      // walk a shipment backwards.
      if (skip === 'ALREADY_AT_TARGET' && shipment.shipmentStatus !== normalized.shipmentStatus) {
        await this.advanceShipmentStatus(shipment.id, normalized.shipmentStatus);
      }
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
      await this.advanceShipmentStatus(shipment.id, normalized.shipmentStatus);
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
    // An AWB on its own does not say who issued it, so every source is
    // asked and the first that recognises it answers. Reads are free and
    // side-effect-free at both couriers, so this costs a call, not a
    // consequence. Stub mode is reported only when EVERY source is in
    // it — one configured courier means lookups genuinely work.
    const stubFlags = await Promise.all(this.sources.map((src) => src.isStubMode()));
    const stubMode = stubFlags.length > 0 && stubFlags.every((f) => f);
    const awbs = awbNumbers.map((a) => a.trim()).filter((a) => a !== '');
    if (awbs.length === 0) return { results: [], stubMode };

    const [fetchedPerSource, ours] = await Promise.all([
      Promise.all(
        this.sources.map(async (src) => {
          try {
            return await src.fetchTracking([...awbs], null);
          } catch {
            // One courier refusing a lookup must not lose the other's
            // answer — a Shiprocket AWB is expected to be unknown to
            // Delhivery and vice versa.
            return [];
          }
        }),
      ),
      this.prisma.client.shipment.findMany({
        where: { awbNumber: { in: [...awbs] }, deletedAt: null },
        select: { id: true, awbNumber: true },
      }),
    ]);
    const oursByAwb = new Map(ours.map((s) => [s.awbNumber ?? '', s.id]));
    // First source that returned scans for an AWB wins; an empty result
    // is not an answer, so it does not shadow a later source's.
    const byAwb = new Map<string, (typeof fetchedPerSource)[number][number]>();
    const normalizerByAwb = new Map<string, CourierTrackingSource>();
    fetchedPerSource.forEach((fetched, idx) => {
      const src = this.sources[idx];
      if (src === undefined) return;
      for (const f of fetched) {
        if (f.scans.length === 0 || byAwb.has(f.awbNumber)) continue;
        byAwb.set(f.awbNumber, f);
        normalizerByAwb.set(f.awbNumber, src);
      }
    });

    const results: TrackingLookupResult[] = awbs.map((awb) => {
      const found = byAwb.get(awb);
      const scans = (found?.scans ?? []).map((raw) => {
        const decision = (normalizerByAwb.get(awb) ?? this.sources[0])?.normalizeScan(raw) ?? {
          kind: 'UNMAPPABLE' as const,
          reason: 'NO_TRACKING_SOURCE_CONFIGURED',
        };
        return {
          rawStatus: raw.rawStatus,
          statusType: raw.statusType ?? null,
          nslCode: raw.nslCode ?? null,
          courierTimestamp: raw.eventAtIso,
          eventAtIso: new Date(raw.eventAtIso).toISOString(),
          location: raw.locationName ?? null,
          description: raw.description ?? null,
          normalisedTo: describeDecision(decision, raw),
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

  /**
   * Move the SHIPMENT row to where the parcel actually is.
   *
   * Nine services write shipment.status and every one of them is a
   * warehouse or courier ACTION — pick, pack, manifest, handoff. Not one
   * is a scan. So after handoff the row froze at HANDED_TO_COURIER while
   * scans moved the ORDER, and the two disagreed for the rest of the
   * parcel's life.
   *
   * That is not cosmetic. The public tracking page projects from
   * ShipmentStatus, and HANDED_TO_COURIER maps to "processing" — so a
   * customer tracking a parcel that was out for delivery, or delivered,
   * was told we were still preparing it. Found by running ten real
   * waybills through, which is the only way it could have been found:
   * every test until now dispatched and asserted on the ORDER.
   *
   * Called only AFTER the order transition succeeded, so the
   * monotonic-forward guard that protects the order (TRK-4) protects
   * this too — a stale scan that cannot move the order cannot move the
   * shipment either. No second ordering to invent, and none to drift.
   *
   * Best-effort: the tracking event and the order are the durable
   * record. A failure here must not undo them, and the next scan
   * corrects it.
   */
  private async advanceShipmentStatus(shipmentId: string, status: ShipmentStatus): Promise<void> {
    try {
      await this.prisma.client.shipment.update({
        where: { id: shipmentId },
        data: { status },
      });
    } catch (err) {
      this.logger.warn(
        { shipmentId, status, err: errMsg(err) },
        'Could not advance the shipment status; the order and the scan are recorded',
      );
    }
  }

  /** In-flight count without loading the rows — for the stub-mode alarm. */
  private async countInFlight(courierCode: string): Promise<number> {
    return this.prisma.client.shipment.count({
      where: {
        courierCode,
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

/**
 * What the mapper did, in words a person can act on.
 *
 * "Manifested" normalises to nothing on purpose — a label exists, the
 * parcel has not moved, and the order must not advance. Reporting that
 * as UNMAPPABLE alongside a genuinely unknown pair told the reader a
 * working system was broken, which is worse than saying nothing: every
 * real waybill starts with a manifest scan, so the screen was mostly
 * red by design.
 */
function describeDecision(
  decision: ReturnType<DelhiveryTrackingService['normalizeScan']>,
  raw: DelhiveryRawScan,
): string {
  if (decision.kind === 'NORMALIZED') return decision.shipmentStatus;
  const pair = `${(raw.statusType ?? '').toUpperCase()}|${raw.rawStatus.toUpperCase()}`;
  if (DelhiveryTrackingService.INFORMATIONAL_PAIRS.has(pair)) {
    return 'recorded only — parcel has not moved yet';
  }
  // The genuine finding: a pair the table has never seen.
  return `UNKNOWN PAIR (${raw.statusType ?? '?'} | ${raw.rawStatus}) — needs mapping`;
}
