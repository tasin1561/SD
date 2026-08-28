import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  DeliveryAttemptOutcome,
  DeliveryFailureReason,
  OrderStatus,
  ShipmentStatus,
  TrackingEventSource,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TrackingStatusMappingService } from '../../tracking-events/services/tracking-status-mapping.service';
import { TrackingEventAppendService } from '../../tracking-events/services/tracking-event-append.service';
import { OrderWriteService } from '../../order/services/order-write.service';

export interface RecordManualScanInput {
  status: ShipmentStatus;
  eventAtIso: string;
  description?: string;
  locationName?: string;
  locationCity?: string;
  locationPincode?: string;
  failureReason?: DeliveryFailureReason;
  isVisibleToCustomer?: boolean;
}

export type ManualScanOutcome =
  | {
      kind: 'TRANSITIONED' | 'DELIVERY_ATTEMPT_TRANSITIONED';
      trackingEventId: string;
      fromStatus: OrderStatus;
      toStatus: OrderStatus;
    }
  | {
      kind: 'TRANSITION_SKIPPED' | 'DELIVERY_ATTEMPT_SKIPPED';
      trackingEventId: string;
      reason: 'CURRENT_NOT_IN_ALLOWED_FROM' | 'ALREADY_AT_TARGET';
      currentOrderStatus: OrderStatus;
    }
  | { kind: 'INFORMATIONAL'; trackingEventId: string; reason: string }
  /**
   * This exact scan is already on the timeline.
   *
   * Its own variant rather than folded into INFORMATIONAL, because the
   * caller genuinely wants to tell them apart: one means "recorded, no
   * transition warranted", the other means "you already did this". The
   * id returned is the ORIGINAL event's, so a client that stored it
   * still resolves.
   */
  | { kind: 'DUPLICATE'; trackingEventId: string; reason: string };

/**
 * Module 10 (TRK-9) — manual tracking-event recording.
 *
 * The complement to the webhook processor: when a shipment is being
 * carried by a manual courier (non-Delhivery, no webhook integration),
 * ops record scan events directly via this service. Source =
 * MANUAL_ENTRY; actorType = STAFF; actorId = the operator's staff
 * user id. Manual scans drive the SAME order-lifecycle transitions
 * the webhook flow does — same mapping (TrackingStatusMappingService),
 * same monotonic-forward guard, same saga ordering for NDR.
 *
 * Differences from the webhook processor (commit 8):
 *
 *   - No raw-body parse or DelhiveryClient.normalizeScan step — the
 *     operator submits a typed ShipmentStatus directly (the DTO
 *     enforces the allowlist).
 *   - No master idempotency gate: there is no courier_webhooks row
 *     to dedup against. Two accidental submissions WILL produce two
 *     tracking_events and two delivery_attempts rows. The actorId +
 *     eventAt on the rows makes corrections discoverable via the
 *     ops timeline; per-request idempotency keys are deferred to a
 *     future need.
 *   - No webhook-shipmentId binding step.
 *   - For DELIVERY_ATTEMPTED: writes a delivery_attempts row with
 *     source=MANUAL_ENTRY, webhookId=null. NO advisory lock —
 *     concurrent manual submissions on the same shipment are
 *     vanishingly rare; on a P2002 collision the caller retries with
 *     the next attemptNumber.
 *
 * Saga ordering matches the webhook processor (visible-vs-silent):
 *
 *   1. For DELIVERY_ATTEMPTED: write delivery_attempts FIRST (the
 *      durable, source-of-truth fact).
 *   2. Append the tracking_event (the timeline record).
 *   3. Monotonic-forward guard, then OrderWriteService.transitionStatus
 *      LAST (the reflection). Same skip semantics as the webhook
 *      processor — a stale-backward or already-at-target scan
 *      records the event without transitioning the order.
 */
@Injectable()
export class ManualTrackingService {
  private readonly logger = new Logger(ManualTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: TrackingStatusMappingService,
    private readonly append: TrackingEventAppendService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async recordScan(
    shipmentId: string,
    input: RecordManualScanInput,
    staffId: string,
  ): Promise<ManualScanOutcome> {
    const eventAt = new Date(input.eventAtIso);
    if (Number.isNaN(eventAt.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_AT',
        message: 'eventAtIso must be a valid ISO 8601 timestamp',
      });
    }

    const ship = await this.prisma.client.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        courierCode: true,
        deletedAt: true,
        orderShipments: {
          select: { order: { select: { id: true, status: true } } },
        },
      },
    });
    if (!ship || ship.deletedAt !== null) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }
    const orderLink = ship.orderShipments[0];
    if (!orderLink) {
      throw new NotFoundException(`Shipment ${shipmentId} not linked to an order`);
    }
    const order = orderLink.order;

    const decision = this.mapping.mapScan(input.status);
    // DTO validation already keeps REJECT values out, but guard
    // defensively (a future ShipmentStatus addition that drops into
    // REJECT mid-DTO update would otherwise silently no-op).
    if (decision.kind === 'REJECT') {
      throw new BadRequestException({
        code: 'STATUS_NOT_MANUAL_LOGGABLE',
        message: `Status ${input.status} cannot be recorded manually (mapping REJECT: ${decision.reason})`,
      });
    }

    // §1 — for DELIVERY_ATTEMPT, write the durable delivery_attempts
    //      row FIRST. No webhookId dedup here (manual entries have
    //      none); a count-based attemptNumber assignment with a
    //      retry on P2002 collision (vanishingly rare).
    // ── The same scan, submitted twice ───────────────────────────────
    //
    // An operator double-clicks, or a slow response gets retried. There
    // is no courier_webhooks row to dedup against here (TRK-2's master
    // gate is for the ingest path), so the natural key does the work:
    // the same shipment, the same event type, at the same instant, from
    // the manual path. A genuine second scan matching all three is
    // indistinguishable from a duplicate anyway — and the timeline
    // showing one delivery attempt twice makes an operator doubt the
    // whole record.
    //
    // Checked BEFORE the delivery_attempts write, or a repeat NDR
    // submit would inflate the attempt count that the courier's own
    // eligibility rules read.
    const duplicate = await this.prisma.client.trackingEvent.findFirst({
      where: {
        shipmentId: ship.id,
        eventType: decision.trackingEventType,
        eventAt,
        source: TrackingEventSource.MANUAL_ENTRY,
      },
      select: { id: true },
    });
    if (duplicate !== null) {
      this.logger.log(
        { shipmentId: ship.id, eventType: decision.trackingEventType },
        'Manual scan already recorded at this timestamp; returning the original',
      );
      return {
        kind: 'DUPLICATE',
        trackingEventId: duplicate.id,
        reason: 'This scan was already recorded at that timestamp',
      };
    }

    if (decision.kind === 'DELIVERY_ATTEMPT') {
      await this.writeManualAttempt(ship.id, eventAt, input.failureReason);
    }

    // §2 — append the tracking_event.
    const trackingEvent = await this.append.append({
      shipmentId: ship.id,
      eventAt,
      eventType: decision.trackingEventType,
      status: input.status,
      source: TrackingEventSource.MANUAL_ENTRY,
      courierCode: ship.courierCode,
      actorType: ActorType.STAFF,
      actorId: staffId,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.locationName !== undefined ? { locationName: input.locationName } : {}),
      ...(input.locationCity !== undefined ? { locationCity: input.locationCity } : {}),
      ...(input.locationPincode !== undefined ? { locationPincode: input.locationPincode } : {}),
      ...(input.isVisibleToCustomer !== undefined
        ? { isVisibleToCustomer: input.isVisibleToCustomer }
        : {}),
    });

    // §3 — INFORMATIONAL: no transition. The event is the value.
    if (decision.kind === 'INFORMATIONAL') {
      return {
        kind: 'INFORMATIONAL',
        trackingEventId: trackingEvent.id,
        reason: decision.reason,
      };
    }

    // §4 — monotonic-forward guard + transition LAST.
    const skipReason = this.shouldSkipTransition(order.status, decision);
    if (skipReason !== null) {
      this.logger.debug(
        {
          shipmentId,
          orderId: order.id,
          current: order.status,
          target: decision.targetOrderStatus,
          skipReason,
        },
        'Manual scan: monotonic-forward guard skipped transition (event recorded)',
      );
      return {
        kind:
          decision.kind === 'DELIVERY_ATTEMPT' ? 'DELIVERY_ATTEMPT_SKIPPED' : 'TRANSITION_SKIPPED',
        trackingEventId: trackingEvent.id,
        reason: skipReason,
        currentOrderStatus: order.status,
      };
    }

    try {
      const result = await this.orderWrite.transitionStatus({
        orderId: order.id,
        to: decision.targetOrderStatus,
        expectedFrom: order.status,
        actor: { type: ActorType.STAFF, id: staffId },
        reason: `Manual scan ${input.status} via ${ship.courierCode}`,
      });
      return {
        kind:
          decision.kind === 'DELIVERY_ATTEMPT' ? 'DELIVERY_ATTEMPT_TRANSITIONED' : 'TRANSITIONED',
        trackingEventId: trackingEvent.id,
        fromStatus: result.fromStatus,
        toStatus: result.status,
      };
    } catch (err) {
      if (err instanceof ConflictException) {
        // Same shape as the webhook processor — the event is
        // recorded; the order moved concurrently or is already past
        // the target. Not a worker failure.
        this.logger.warn(
          {
            shipmentId,
            orderId: order.id,
            current: order.status,
            target: decision.targetOrderStatus,
          },
          'Manual-scan transitionStatus 409 after guard — concurrent change; event recorded',
        );
        return {
          kind:
            decision.kind === 'DELIVERY_ATTEMPT'
              ? 'DELIVERY_ATTEMPT_SKIPPED'
              : 'TRANSITION_SKIPPED',
          trackingEventId: trackingEvent.id,
          reason: 'CURRENT_NOT_IN_ALLOWED_FROM',
          currentOrderStatus: order.status,
        };
      }
      throw err;
    }
  }

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

  private async writeManualAttempt(
    shipmentId: string,
    attemptedAt: Date,
    failureReason: DeliveryFailureReason | undefined,
  ): Promise<void> {
    // P2002 retry: if a concurrent manual entry won the
    // attemptNumber, recount and retry once. Phase-1A volume makes
    // a second collision after that effectively impossible.
    for (let attempt = 0; attempt < 2; attempt++) {
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
            ...(failureReason !== undefined ? { failureReason } : {}),
            source: TrackingEventSource.MANUAL_ENTRY,
          },
        });
        return;
      } catch (err) {
        if (attempt === 0 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002';
}
