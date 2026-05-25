import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  PublicShipmentDisplayStatus,
  PublicTrackingResponse,
  PublicTrackingTimelineEvent,
} from '../dto/public-tracking.response.dto';

/**
 * Module 10 (TRK-8) — open public AWB-keyed tracking read.
 *
 * The endpoint that backs this service has NO authentication: the AWB
 * is the access token. The rate limit on the controller is the only
 * defense against enumeration; the projection here is the defense
 * against PII / cross-order leakage — the two together implement
 * TRK-8.
 *
 * Concretely the service:
 *
 *   1. Looks up the shipment by AWB (unique). NOT FOUND → 404 with
 *      the SAME generic message regardless of why (unknown AWB,
 *      deleted shipment, malformed AWB). No information leakage on
 *      404.
 *
 *   2. Loads the courier display name (NOT the courier code, which
 *      is an internal identifier).
 *
 *   3. Loads tracking_events WHERE isVisibleToCustomer = true, scoped
 *      to the shipment, ordered by eventAt DESC (TRK-3). The
 *      processor (M10 commit 8) sets isVisibleToCustomer=false on
 *      UNMAPPABLE/REJECT scans — those NEVER surface to the public
 *      timeline.
 *
 *   4. Projects through `safeProject` — coarse status bucket, no IDs,
 *      no internal codes, locationCity only (no precise location).
 *
 * The current-status derivation: if at least one customer-visible
 * scan exists, use the latest scan's status; otherwise fall back to
 * the shipment's `status` field projection. Either way, the value is
 * collapsed to the PublicShipmentDisplayStatus enum (12 buckets) —
 * pre-dispatch internals all bucket to `processing`.
 */
@Injectable()
export class PublicTrackingReadService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAwb(awbNumber: string): Promise<PublicTrackingResponse> {
    // Phase-1A: trim + uppercase normalization is conservative —
    // shipment.awbNumber is unique so any case difference would
    // already 404. Leave as-is to keep the lookup byte-exact.
    const trimmed = awbNumber.trim();
    if (trimmed.length === 0) {
      // Same not-found shape — don't reveal "you sent an empty AWB"
      // separately from "unknown AWB."
      throw this.notFound();
    }

    const ship = await this.prisma.client.shipment.findUnique({
      where: { awbNumber: trimmed },
      select: {
        id: true,
        awbNumber: true,
        status: true,
        deletedAt: true,
        destCity: true,
        expectedDeliveryAt: true,
        createdAt: true,
        courier: {
          select: {
            displayName: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !ship ||
      ship.deletedAt !== null ||
      ship.courier.deletedAt !== null ||
      ship.awbNumber === null
    ) {
      throw this.notFound();
    }

    const events = await this.prisma.client.trackingEvent.findMany({
      where: {
        shipmentId: ship.id,
        isVisibleToCustomer: true,
      },
      orderBy: { eventAt: 'desc' },
      select: {
        eventAt: true,
        status: true,
        description: true,
        locationCity: true,
      },
    });

    const timeline: PublicTrackingTimelineEvent[] = events.map((e) => ({
      status: this.projectStatus(e.status),
      eventAt: e.eventAt.toISOString(),
      description: e.description,
      locationCity: e.locationCity,
    }));

    const latest = events[0];
    const currentStatus = latest
      ? this.projectStatus(latest.status)
      : this.projectStatus(ship.status);
    const currentStatusAt = (latest?.eventAt ?? ship.createdAt).toISOString();

    return {
      awbNumber: ship.awbNumber,
      courierDisplayName: ship.courier.displayName,
      currentStatus,
      currentStatusAt,
      destinationCity: ship.destCity,
      estimatedDeliveryAt: ship.expectedDeliveryAt?.toISOString() ?? null,
      timeline,
    };
  }

  /**
   * Internal-to-public ShipmentStatus projection. Exhaustive over
   * ShipmentStatus — a future enum addition fails to compile here
   * (TS narrowing), forcing a conscious bucket choice.
   */
  private projectStatus(s: ShipmentStatus): PublicShipmentDisplayStatus {
    switch (s) {
      // Pre-dispatch internals — the customer sees a single coarse
      // "processing" bucket. No leakage of internal lifecycle states
      // (AWB_PENDING / FAILED_AT_CREATION / etc).
      case ShipmentStatus.CREATED:
      case ShipmentStatus.AWB_PENDING:
      case ShipmentStatus.AWB_GENERATED:
      case ShipmentStatus.FAILED_AT_CREATION:
      case ShipmentStatus.HANDED_TO_COURIER:
      case ShipmentStatus.AT_HUB:
        return 'processing';

      case ShipmentStatus.IN_TRANSIT:
        return 'in_transit';
      case ShipmentStatus.OUT_FOR_DELIVERY:
        return 'out_for_delivery';
      case ShipmentStatus.DELIVERY_ATTEMPTED:
        return 'delivery_attempted';
      case ShipmentStatus.DELIVERED:
        return 'delivered';
      case ShipmentStatus.RTO_INITIATED:
        return 'return_initiated';
      case ShipmentStatus.RTO_IN_TRANSIT:
        return 'returning';
      case ShipmentStatus.RTO_DELIVERED:
        return 'returned';
      case ShipmentStatus.LOST:
        return 'lost';
      case ShipmentStatus.DAMAGED:
        return 'damaged';
      case ShipmentStatus.CANCELLED:
        return 'cancelled';

      default:
        return assertNever(s);
    }
  }

  private notFound(): NotFoundException {
    // Single generic message — never reveals whether the AWB exists,
    // is deleted, belongs to a soft-deleted courier, etc.
    return new NotFoundException({
      code: 'TRACKING_NOT_FOUND',
      message: 'No tracking information found for the provided number.',
    });
  }
}

function assertNever(value: never): never {
  throw new Error(
    `PublicTrackingReadService.projectStatus: unhandled ShipmentStatus ${String(value)}`,
  );
}
