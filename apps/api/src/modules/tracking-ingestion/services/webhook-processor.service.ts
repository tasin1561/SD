import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  OrderStatus,
  Prisma,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
  WebhookStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { DelhiveryTrackingService } from '../../courier-delhivery/services/delhivery-tracking.service';
import { TrackingStatusMappingService } from '../../tracking-events/services/tracking-status-mapping.service';
import {
  TrackingEventAppendService,
  type TrackingEventRow,
} from '../../tracking-events/services/tracking-event-append.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { mapFailureReason, parseScanPayload } from './raw-scan-parser';

/**
 * Outcome of a single processor run. Returned to the BullMQ worker
 * (it does not branch on this; we throw on retryable failures).
 * Useful for unit tests + the manual ops trigger.
 */
export type ProcessOutcome =
  | { kind: 'ALREADY_PROCESSED'; webhookId: string }
  | { kind: 'IGNORED'; webhookId: string; reason: string }
  | { kind: 'PARSE_FAILED'; webhookId: string }
  | { kind: 'NO_MATCHING_SHIPMENT'; webhookId: string; awbNumber: string }
  | { kind: 'UNMAPPABLE'; webhookId: string; reason: string; trackingEventId: string }
  | { kind: 'REJECT'; webhookId: string; reason: string; trackingEventId: string }
  | { kind: 'INFORMATIONAL'; webhookId: string; reason: string; trackingEventId: string }
  | {
      kind: 'TRANSITIONED' | 'DELIVERY_ATTEMPT_TRANSITIONED';
      webhookId: string;
      trackingEventId: string;
      fromStatus: OrderStatus;
      toStatus: OrderStatus;
    }
  | {
      kind: 'TRANSITION_SKIPPED' | 'DELIVERY_ATTEMPT_SKIPPED';
      webhookId: string;
      trackingEventId: string;
      reason: 'CURRENT_NOT_IN_ALLOWED_FROM' | 'ALREADY_AT_TARGET';
      currentOrderStatus: OrderStatus;
    };

/**
 * The advisory-lock namespace for delivery_attempts numbering. A
 * tx-scoped `pg_advisory_xact_lock(namespace, key)` serializes
 * concurrent attempt inserts for the same shipment so the
 * count-then-insert sequence assigns sequential attemptNumber values
 * without P2002 races. Mirrors WMS-7's manifest find-or-create
 * (namespace 0x04d47, FNV-1a on the pair key).
 *
 * Distinct from M8's namespaces (0x04d46 / 0x04d47) by design — picked
 * sequentially so a tx that ever needs to take TWO locks (different
 * namespaces) can do so in deterministic numeric order.
 */
const DELIVERY_ATTEMPTS_LOCK_NAMESPACE = 0x04d48;

/**
 * Module 10 (TRK-1/2/3/4/5/7/8) — the webhook PROCESSOR. The BullMQ
 * worker (commit 8 sibling file) delegates to `process(webhookId)`.
 *
 * The processing saga (visible-vs-silent failure ordering):
 *
 *   1. Master idempotency gate. Re-read courier_webhooks; if status ≠
 *      RECEIVED (PROCESSED, IGNORED, ABANDONED, FAILED) → no-op.
 *      A BullMQ retry that arrives after a previous run already
 *      finished sees PROCESSED + returns success without re-doing any
 *      side-effect (TRK-2 webhook-reprocess discipline).
 *
 *   2. Parse the raw body. Failure → mark IGNORED with reason
 *      PARSE_FAILED (terminal — re-attempting won't help; the raw
 *      bytes are preserved on courier_webhooks for ops).
 *
 *   3. Normalize via DelhiveryClient.normalizeScan. UNMAPPABLE → audit
 *      append a tracking_event so the timeline records the raw scan
 *      (with metadata.unmappable=true) then mark PROCESSED — no
 *      transition.
 *
 *   4. Resolve the shipment by AWB. No match → IGNORED reason
 *      NO_MATCHING_SHIPMENT (terminal — likely an early webhook
 *      arriving before the shipment row landed, or a non-Skydrop AWB).
 *
 *   5. Bind courier_webhooks.shipmentId for cross-reference (best-
 *      effort; doesn't gate processing).
 *
 *   6. Mapping decision via TrackingStatusMappingService (commit 6 /
 *      F2 exhaustive).
 *      - REJECT → audit HIGH (the normalized status is not a legitimate
 *        courier scan outcome; an attacker-spoofed or upstream-broken
 *        payload), still record the tracking_event, mark IGNORED.
 *      - INFORMATIONAL → record the tracking_event, no transition,
 *        mark PROCESSED.
 *      - TRANSITION / DELIVERY_ATTEMPT → §7.
 *
 *   7. The DELIVERY-ATTEMPT FAN-OUT (saga ordering, visible-vs-silent):
 *      a. delivery_attempts row written FIRST (the durable, source-of-
 *         truth fact — an NDR happened). Dedup-keyed on webhookId so
 *         a retry never double-writes. attemptNumber assigned under
 *         a per-shipment advisory lock to serialize concurrent
 *         inserts.
 *      b. tracking_events appended (the timeline record). Dedup-keyed
 *         on (webhookId, eventType).
 *      c. Monotonic-forward guard, then OrderWriteService.
 *         transitionStatus LAST (the reflection). The guard skips
 *         the transition gracefully when the current order status is
 *         not in the mapping's allowedFromOrderStatuses (stale
 *         backward scan, an already-past order, OR a repeat NDR with
 *         the order already in DELIVERY_FAILED — the
 *         current===target self-no-op path). Skipped transitions are
 *         NORMAL, NOT errors: the tracking_event + delivery_attempts
 *         row are recorded; the order is just past or at the target
 *         already. Logged at debug.
 *
 *   8. For pure TRANSITION decisions the same shape (without §7.a)
 *      applies: append tracking_event FIRST, transition LAST.
 *
 *   9. Mark courier_webhooks PROCESSED at the very END (post-
 *      transition), with the trackingEventId for cross-reference. The
 *      mark is a guarded `updateMany` on (id, status=RECEIVED) so a
 *      concurrent retry that races us is a safe no-op.
 *
 * A crash anywhere between §7.a and §9 leaves courier_webhooks in
 * RECEIVED; the retry re-enters at §1, re-runs each step idempotently
 * (delivery_attempts dedup on webhookId; tracking_events dedup on
 * webhookId+eventType; transitionStatus is matrix-driven idempotent;
 * the guard naturally handles "current is already at or past target"
 * after a partial success). The state converges.
 *
 * Throws only when an unexpected error surfaces (DB transient,
 * upstream programming bug) — BullMQ's per-attempt retry is then the
 * recovery. After max-attempts the job lands in FAILED; ops manually
 * re-trigger via `process(webhookId)` (the method is public for that).
 */
@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly courierDelhivery: DelhiveryTrackingService,
    private readonly mapping: TrackingStatusMappingService,
    private readonly append: TrackingEventAppendService,
    private readonly orderWrite: OrderWriteService,
    private readonly audit: AuditLogService,
  ) {}

  async process(webhookId: string): Promise<ProcessOutcome> {
    // §1 — master idempotency gate.
    const wh = await this.prisma.client.courierWebhook.findUnique({
      where: { id: webhookId },
      select: {
        id: true,
        courierCode: true,
        rawBody: true,
        parsedBody: true,
        status: true,
        shipmentId: true,
        awbNumber: true,
      },
    });
    if (!wh) {
      // The webhook row vanished between enqueue and processing —
      // shouldn't happen at Phase 1A volume, but a 404 here is not a
      // retryable error.
      throw new NotFoundException(`Webhook ${webhookId} not found`);
    }
    if (wh.status !== WebhookStatus.RECEIVED) {
      this.logger.debug(
        { webhookId, status: wh.status },
        'Webhook already in terminal status — no-op',
      );
      return { kind: 'ALREADY_PROCESSED', webhookId };
    }

    // §2 — parse the raw body. We prefer the already-parsed JSON (the
    // ingester stored it) but fall back to re-parsing the raw bytes
    // when parsedBody is null (the raw body wasn't valid JSON at
    // ingest, or the ingester chose not to store the parse).
    const parsedRoot = wh.parsedBody ?? safeJsonParse(wh.rawBody);
    const parsed = parseScanPayload(parsedRoot);
    if (parsed === null) {
      await this.markIgnored(webhookId, 'PARSE_FAILED');
      return { kind: 'PARSE_FAILED', webhookId };
    }

    // §3 — normalize via the Delhivery adapter (stub mode in Phase 1A).
    const normalized = this.courierDelhivery.normalizeScan({
      awbNumber: parsed.awbNumber,
      rawStatus: parsed.rawStatus,
      // The leg + NSL travel with the scan: without them "In Transit"
      // cannot be told from a return leg, and an NDR looks like ordinary
      // transit (D5).
      statusType: parsed.statusType,
      nslCode: parsed.nslCode,
      eventAtIso: parsed.eventAtIso,
      locationName: parsed.locationName,
      locationCity: parsed.locationCity,
      locationPincode: parsed.locationPincode,
      description: parsed.description,
      failureReason: parsed.failureReason,
    });

    // §4 — resolve shipment by AWB.
    const ship = await this.prisma.client.shipment.findUnique({
      where: { awbNumber: parsed.awbNumber },
      select: {
        id: true,
        status: true,
        orderShipments: {
          select: { order: { select: { id: true, status: true } } },
        },
      },
    });
    if (!ship || ship.orderShipments.length === 0) {
      await this.markIgnored(webhookId, 'NO_MATCHING_SHIPMENT');
      return { kind: 'NO_MATCHING_SHIPMENT', webhookId, awbNumber: parsed.awbNumber };
    }
    const orderLink = ship.orderShipments[0];
    if (!orderLink) {
      await this.markIgnored(webhookId, 'NO_MATCHING_SHIPMENT');
      return { kind: 'NO_MATCHING_SHIPMENT', webhookId, awbNumber: parsed.awbNumber };
    }
    const order = orderLink.order;

    // §5 — bind webhook.shipmentId + awbNumber for cross-reference.
    //      Best-effort; failure does not gate downstream side-effects.
    if (wh.shipmentId === null || wh.awbNumber === null) {
      try {
        await this.prisma.client.courierWebhook.update({
          where: { id: webhookId },
          data: { shipmentId: ship.id, awbNumber: parsed.awbNumber },
        });
      } catch (err) {
        this.logger.warn(
          { webhookId, err: errMsg(err) },
          'Failed to bind webhook.shipmentId; continuing',
        );
      }
    }

    const eventAt = new Date(parsed.eventAtIso);

    // §6 — branch on normalization.
    if (normalized.kind === 'UNMAPPABLE') {
      const te = await this.appendIfNew(wh.id, ship.id, {
        eventAt,
        eventType: TrackingEventType.STATUS_SYNC,
        status: ship.status,
        courierCode: wh.courierCode,
        rawCourierStatus: parsed.rawStatus,
        nslCode: parsed.nslCode,
        description: parsed.description,
        locationName: parsed.locationName,
        locationCity: parsed.locationCity,
        locationPincode: parsed.locationPincode,
        metadata: {
          unmappable: true,
          reason: normalized.reason,
          rawStatus: parsed.rawStatus,
        },
        // Ops-only — the customer timeline shouldn't show an
        // unrecognized internal code.
        isVisibleToCustomer: false,
      });
      await this.markProcessed(webhookId, te.id);
      return {
        kind: 'UNMAPPABLE',
        webhookId,
        reason: normalized.reason,
        trackingEventId: te.id,
      };
    }

    const decision = this.mapping.mapScan(normalized.shipmentStatus);

    if (decision.kind === 'REJECT') {
      const te = await this.appendIfNew(wh.id, ship.id, {
        eventAt,
        eventType: TrackingEventType.STATUS_SYNC,
        status: ship.status,
        courierCode: wh.courierCode,
        rawCourierStatus: parsed.rawStatus,
        nslCode: parsed.nslCode,
        description: parsed.description,
        locationName: parsed.locationName,
        locationCity: parsed.locationCity,
        locationPincode: parsed.locationPincode,
        metadata: {
          reject: true,
          reason: decision.reason,
          normalizedStatus: normalized.shipmentStatus,
        },
        isVisibleToCustomer: false,
      });
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'tracking.webhook_scan_rejected',
        entityType: 'courier_webhook',
        entityId: webhookId,
        severity: 'HIGH',
        metadata: {
          reason: decision.reason,
          normalizedStatus: normalized.shipmentStatus,
          rawStatus: parsed.rawStatus,
          shipmentId: ship.id,
        },
      });
      await this.markIgnored(webhookId, `REJECT:${decision.reason}`);
      return {
        kind: 'REJECT',
        webhookId,
        reason: decision.reason,
        trackingEventId: te.id,
      };
    }

    if (decision.kind === 'INFORMATIONAL') {
      const te = await this.appendIfNew(wh.id, ship.id, {
        eventAt,
        eventType: decision.trackingEventType,
        status: normalized.shipmentStatus,
        courierCode: wh.courierCode,
        rawCourierStatus: parsed.rawStatus,
        nslCode: parsed.nslCode,
        description: parsed.description,
        locationName: parsed.locationName,
        locationCity: parsed.locationCity,
        locationPincode: parsed.locationPincode,
        metadata: {
          informational: true,
          reason: decision.reason,
        },
      });
      await this.markProcessed(webhookId, te.id);
      return {
        kind: 'INFORMATIONAL',
        webhookId,
        reason: decision.reason,
        trackingEventId: te.id,
      };
    }

    // §7.a — DELIVERY_ATTEMPT: write delivery_attempts FIRST (durable).
    if (decision.kind === 'DELIVERY_ATTEMPT') {
      await this.writeAttemptIfNew(wh.id, ship.id, parsed.failureReason, eventAt, parsed.nslCode);
    }

    // §7.b / §8 — append tracking_event (idempotent).
    const trackingEvent = await this.appendIfNew(wh.id, ship.id, {
      eventAt,
      eventType: decision.trackingEventType,
      status: normalized.shipmentStatus,
      courierCode: wh.courierCode,
      rawCourierStatus: parsed.rawStatus,
      nslCode: parsed.nslCode,
      description: parsed.description,
      locationName: parsed.locationName,
      locationCity: parsed.locationCity,
      locationPincode: parsed.locationPincode,
    });

    // §7.c / §8 — monotonic-forward guard + transition.
    const skipReason = this.shouldSkipTransition(order.status, decision);
    if (skipReason !== null) {
      this.logger.debug(
        {
          webhookId,
          orderId: order.id,
          current: order.status,
          target: decision.targetOrderStatus,
          skipReason,
        },
        'Monotonic-forward guard: skipping transition (event recorded)',
      );
      await this.markProcessed(webhookId, trackingEvent.id);
      return {
        kind:
          decision.kind === 'DELIVERY_ATTEMPT' ? 'DELIVERY_ATTEMPT_SKIPPED' : 'TRANSITION_SKIPPED',
        webhookId,
        trackingEventId: trackingEvent.id,
        reason: skipReason,
        currentOrderStatus: order.status,
      };
    }

    try {
      const result = await this.orderWrite.transitionStatus({
        orderId: order.id,
        to: decision.targetOrderStatus,
        // Optimistic guard. A concurrent transition raced us → 409
        // STALE_ORDER_STATUS, caught below.
        expectedFrom: order.status,
        actor: { type: ActorType.SYSTEM },
        reason: `Courier scan ${normalized.shipmentStatus} via ${wh.courierCode}`,
      });
      // The shipment row follows the parcel, not just the order.
      //
      // Nothing advanced it from a scan — nine writers, all of them
      // warehouse or courier ACTIONS — so it froze at HANDED_TO_COURIER
      // while the order moved. The public tracking page projects from
      // this field, and that value maps to "processing": a customer
      // whose parcel was out for delivery was told we were still
      // preparing it.
      //
      // After the transition, so the order's monotonic-forward guard
      // (TRK-4) governs this too — one ordering, not two. Best-effort:
      // the event and the order are the durable record.
      try {
        await this.prisma.client.shipment.update({
          where: { id: ship.id },
          data: { status: normalized.shipmentStatus },
        });
      } catch (e) {
        this.logger.warn(
          { shipmentId: ship.id, status: normalized.shipmentStatus, err: String(e) },
          'Could not advance the shipment status; the order and the scan are recorded',
        );
      }
      await this.markProcessed(webhookId, trackingEvent.id);
      return {
        kind:
          decision.kind === 'DELIVERY_ATTEMPT' ? 'DELIVERY_ATTEMPT_TRANSITIONED' : 'TRANSITIONED',
        webhookId,
        trackingEventId: trackingEvent.id,
        fromStatus: result.fromStatus,
        toStatus: result.status,
      };
    } catch (err) {
      if (err instanceof ConflictException) {
        const code = extractConflictCode(err);
        // Stale guard fired (concurrent transition) / no-op (race) /
        // invalid (the guard should have caught — but a moved-on order
        // is still NOT a worker failure). All three: event is recorded,
        // mark PROCESSED, return SKIPPED.
        this.logger.warn(
          {
            webhookId,
            orderId: order.id,
            current: order.status,
            target: decision.targetOrderStatus,
            conflictCode: code,
          },
          'transitionStatus 409 after monotonic guard — concurrent change; event recorded, marking PROCESSED',
        );
        await this.markProcessed(webhookId, trackingEvent.id);
        return {
          kind:
            decision.kind === 'DELIVERY_ATTEMPT'
              ? 'DELIVERY_ATTEMPT_SKIPPED'
              : 'TRANSITION_SKIPPED',
          webhookId,
          trackingEventId: trackingEvent.id,
          reason: 'CURRENT_NOT_IN_ALLOWED_FROM',
          currentOrderStatus: order.status,
        };
      }
      // Unknown failure — let BullMQ retry (webhook stays RECEIVED).
      throw err;
    }
  }

  /**
   * Monotonic-forward guard. Returns the skip reason, or null when the
   * transition should proceed.
   *
   *  - ALREADY_AT_TARGET — current === target. Repeat DELIVERY_FAILED
   *    scan when order is already DELIVERY_FAILED, OR a duplicate
   *    forward scan replayed after we already transitioned. The
   *    DELIVERY_ATTEMPTS row is already written (§7.a) regardless.
   *  - CURRENT_NOT_IN_ALLOWED_FROM — the mapping's allowedFrom does
   *    not list the current status. This catches stale backward
   *    scans (current=DELIVERED, scan=IN_TRANSIT), out-of-order
   *    arrivals (current=OUT_FOR_DELIVERY, scan=IN_TRANSIT), and
   *    orders past the natural lifecycle (current=CANCELLED).
   *  - null — current ∈ allowedFrom AND current ≠ target → transition.
   */
  private shouldSkipTransition(
    current: OrderStatus,
    decision: { targetOrderStatus: OrderStatus; allowedFromOrderStatuses: readonly OrderStatus[] },
  ): 'ALREADY_AT_TARGET' | 'CURRENT_NOT_IN_ALLOWED_FROM' | null {
    if (current === decision.targetOrderStatus) return 'ALREADY_AT_TARGET';
    if (!decision.allowedFromOrderStatuses.includes(current)) {
      return 'CURRENT_NOT_IN_ALLOWED_FROM';
    }
    return null;
  }

  /**
   * Append a tracking_event with retry-safe dedup. The dedup key is
   * `(webhookId, eventType)` — a re-processed webhook with the SAME
   * decision will hit the dedup branch; if the mapping ever decided
   * differently (it can't in practice — the inputs are byte-stable),
   * a second TE under the same webhook with a different eventType
   * would not be considered a duplicate. Phase 1A volume + the
   * normalize/map being pure functions makes this the right trade.
   */
  private async appendIfNew(
    webhookId: string,
    shipmentId: string,
    opts: {
      eventAt: Date;
      eventType: TrackingEventType;
      status: ShipmentStatus;
      courierCode: string;
      rawCourierStatus: string;
      nslCode: string | null;
      description: string | null;
      locationName: string | null;
      locationCity: string | null;
      locationPincode: string | null;
      metadata?: Prisma.InputJsonValue;
      isVisibleToCustomer?: boolean;
    },
  ): Promise<TrackingEventRow> {
    const existing = await this.prisma.client.trackingEvent.findFirst({
      where: { webhookId, eventType: opts.eventType },
      orderBy: { eventAt: 'desc' },
      select: ROW_SELECT,
    });
    if (existing) return existing as TrackingEventRow;
    return this.append.append({
      shipmentId,
      eventAt: opts.eventAt,
      eventType: opts.eventType,
      status: opts.status,
      source: TrackingEventSource.COURIER_WEBHOOK,
      courierCode: opts.courierCode,
      rawCourierStatus: opts.rawCourierStatus,
      nslCode: opts.nslCode,
      description: opts.description,
      locationName: opts.locationName,
      locationCity: opts.locationCity,
      locationPincode: opts.locationPincode,
      webhookId,
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
      ...(opts.isVisibleToCustomer !== undefined
        ? { isVisibleToCustomer: opts.isVisibleToCustomer }
        : {}),
    });
  }

  /**
   * Write the delivery_attempts row idempotently. The advisory lock
   * serializes concurrent attempts on the same shipment so the
   * count-then-insert race that would otherwise hit P2002 on the
   * (shipmentId, attemptNumber) unique becomes a clean sequential
   * assignment.
   */
  private async writeAttemptIfNew(
    webhookId: string,
    shipmentId: string,
    rawFailureReason: string | null,
    attemptedAt: Date,
    // The courier's own reason code. Kept because Delhivery decides
    // re-attempt eligibility from it and nothing else — see the NDR
    // service. Historically parsed and discarded.
    nslCode: string | null,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const dedupExisting = await tx.deliveryAttempt.findFirst({
        where: { webhookId },
        select: { id: true },
      });
      if (dedupExisting) return;

      // FNV-1a 32-bit on the shipmentId UUID string. Two distinct
      // shipments share the lock-key space sparsely; collisions just
      // serialize unrelated inserts (rare + harmless).
      const key = fnv1a32(shipmentId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELIVERY_ATTEMPTS_LOCK_NAMESPACE}::int, ${key}::int)`;

      const prior = await tx.deliveryAttempt.count({ where: { shipmentId } });

      const mappedReason = mapFailureReason(rawFailureReason);
      await tx.deliveryAttempt.create({
        data: {
          shipmentId,
          attemptNumber: prior + 1,
          attemptedAt,
          outcome: DeliveryAttemptOutcome.FAILED,
          ...(mappedReason !== null ? { failureReason: mappedReason } : {}),
          ...(rawFailureReason !== null ? { failureNotes: rawFailureReason } : {}),
          ...(nslCode !== null ? { courierNslCode: nslCode } : {}),
          source: TrackingEventSource.COURIER_WEBHOOK,
          webhookId,
        },
      });
    });
  }

  private async markProcessed(webhookId: string, trackingEventId: string | null): Promise<void> {
    // Guarded — already-processed retries are no-ops.
    await this.prisma.client.courierWebhook.updateMany({
      where: { id: webhookId, status: WebhookStatus.RECEIVED },
      data: {
        status: WebhookStatus.PROCESSED,
        processedAt: new Date(),
        ...(trackingEventId !== null ? { trackingEventId } : {}),
      },
    });
  }

  private async markIgnored(webhookId: string, reason: string): Promise<void> {
    await this.prisma.client.courierWebhook.updateMany({
      where: { id: webhookId, status: WebhookStatus.RECEIVED },
      data: {
        status: WebhookStatus.IGNORED,
        processedAt: new Date(),
        errorMessage: reason,
      },
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

function safeJsonParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractConflictCode(err: ConflictException): string {
  const r = err.getResponse();
  if (typeof r === 'object' && r !== null) {
    const code = (r as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'CONFLICT';
}

/** FNV-1a 32-bit hash. Mirrors M8 WMS-7 advisory-lock pair-key derivation. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Cast to signed 32-bit so the int passes to pg_advisory_xact_lock cleanly.
  return h | 0;
}
