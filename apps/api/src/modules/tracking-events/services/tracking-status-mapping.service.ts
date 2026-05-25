import { Injectable } from '@nestjs/common';
import { OrderStatus, ShipmentStatus, TrackingEventType } from '@skydrop/db';

/**
 * What the tracking processor should do with a scan that asserts a
 * given ShipmentStatus, in terms of the OUR order lifecycle:
 *
 *  - TRANSITION: the matrix permits at least one inbound edge to
 *    targetOrderStatus from a delivery/RTO state. The processor
 *    attempts the transition via OrderWriteService.transitionStatus
 *    with `expectedFrom` widened to the allowed prior states (TRK-4
 *    monotonic-forward — if the order is already at or past
 *    targetOrderStatus, the transition guard returns the equivalent
 *    409 NOOP/STALE and the processor silently records the scan).
 *  - DELIVERY_ATTEMPT: a delivery NDR. The processor writes a
 *    delivery_attempts row AND transitions the order toward
 *    DELIVERY_FAILED (re-enterable from OUT_FOR_DELIVERY → DELIVERY_
 *    FAILED → OUT_FOR_DELIVERY retry cycle — the common COD path).
 *  - INFORMATIONAL: the scan is recorded on tracking_events for the
 *    customer-visible timeline but emits NO order transition.
 *    Two reasons something is informational:
 *    (a) the boundary belongs to a different authority (TRK-6
 *        RTO_DELIVERED — warehouse physical receipt owns
 *        RTO_RECEIVED), or
 *    (b) the lifecycle event does not exist as a scan-driven order
 *        transition (DAMAGED — the corresponding RTO_DAMAGED is a
 *        warehouse-finalize disposition, not a scan terminal).
 *  - REJECT: the ShipmentStatus value cannot be the output of
 *    normalizeScan in real life (CREATED / AWB_PENDING / etc — those
 *    are pre-dispatch internal lifecycle states, never carried by a
 *    courier scan). An exhaustive switch over ShipmentStatus is the
 *    enforcement — a future ShipmentStatus addition will surface as
 *    a compile error here (REJECT vs the other variants must be a
 *    conscious choice), not as a silent passthrough.
 */
export type ScanMappingDecision =
  | {
      kind: 'TRANSITION';
      targetOrderStatus: OrderStatus;
      /** Order statuses from which this transition is valid. Used by
       *  the processor to widen expectedFrom across the matrix's
       *  permitted inbound edges (and for monotonic-forward — if the
       *  current status is NOT in this list, no transition is made). */
      allowedFromOrderStatuses: readonly OrderStatus[];
      /** Persisted on tracking_events.eventType. */
      trackingEventType: TrackingEventType;
    }
  | {
      kind: 'DELIVERY_ATTEMPT';
      targetOrderStatus: OrderStatus; // DELIVERY_FAILED
      allowedFromOrderStatuses: readonly OrderStatus[];
      trackingEventType: TrackingEventType; // DELIVERY_ATTEMPTED
    }
  | {
      kind: 'INFORMATIONAL';
      /** Why this scan does not drive a transition. Audited on
       *  tracking_events.metadata for ops visibility. */
      reason:
        | 'RTO_DELIVERED_IS_INFORMATIONAL_TRK6'
        | 'DAMAGED_IS_INFORMATIONAL_TRK6';
      trackingEventType: TrackingEventType;
    }
  | {
      kind: 'REJECT';
      /** This ShipmentStatus cannot be a legitimate output of
       *  normalizeScan. The processor logs HIGH + still stores the raw
       *  scan as a tracking_event (audit) but emits no transition. */
      reason:
        | 'NOT_A_COURIER_SCAN_OUTCOME' // CREATED / AWB_* / FAILED_AT_CREATION / HANDED_TO_COURIER / AT_HUB / CANCELLED
        ;
    };

/**
 * Module 10 (TRK-5) — the SINGLE SOURCE OF TRUTH for
 * "courier scan ShipmentStatus → our OrderStatus transition".
 * Pure logic, no Prisma, no Order dependency — mirrors
 * CallOutcomeMappingService (the Module 7 pattern this borrows the
 * shape from) and OrderStateMachineService.
 *
 * F2 (M10 pre-flight, locked): we REUSE ShipmentStatus as the
 * normalized intermediate (no parallel `CourierTrackingStatus` enum).
 * The discipline is in this service's EXHAUSTIVE allowlist —
 * `mapScan(status)` does a TypeScript exhaustive switch over every
 * ShipmentStatus, and a missing case is a compile error. A future
 * ShipmentStatus addition fails LOUDLY here rather than slipping
 * through as a silent passthrough.
 *
 * The processor (M10 commit 8) consults this map for every
 * normalized scan; the choice between TRANSITION/DELIVERY_ATTEMPT/
 * INFORMATIONAL/REJECT IS the entire behavioral contract.
 */
@Injectable()
export class TrackingStatusMappingService {
  /**
   * Reference: order-state-machine.service.ts (M9). The
   * `allowedFromOrderStatuses` for each transition derive from the
   * matrix's inbound edges. Sourcing them HERE (a thin parallel
   * declaration) keeps the mapping service Order-dep-free and
   * pure-logic — if the matrix changes, the unit test
   * `tracking-status-mapping.service.spec.ts` will surface the drift
   * (commit 12).
   */
  mapScan(status: ShipmentStatus): ScanMappingDecision {
    switch (status) {
      // ── Forward lifecycle transitions (post-DISPATCH only — the
      //    matrix has no scan-driven edges before DISPATCHED) ───────
      case ShipmentStatus.IN_TRANSIT:
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.IN_TRANSIT,
          allowedFromOrderStatuses: [OrderStatus.DISPATCHED],
          trackingEventType: TrackingEventType.IN_TRANSIT_UPDATE,
        };
      case ShipmentStatus.OUT_FOR_DELIVERY:
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.OUT_FOR_DELIVERY,
          allowedFromOrderStatuses: [OrderStatus.IN_TRANSIT],
          trackingEventType: TrackingEventType.OUT_FOR_DELIVERY,
        };
      case ShipmentStatus.DELIVERED:
        // TRK-7: DELIVERED is stock-neutral. The OUT_FOR_DELIVERY →
        // DELIVERED matrix edge carries sideEffects: [] (M9 commit 12).
        // M10 webhooks NEVER touch inventory — confirmed by the
        // existing matrix; this commit adds NO stock side-effect.
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.DELIVERED,
          allowedFromOrderStatuses: [OrderStatus.OUT_FOR_DELIVERY],
          trackingEventType: TrackingEventType.DELIVERED,
        };

      // ── NDR — delivery attempted, failed ─────────────────────────
      case ShipmentStatus.DELIVERY_ATTEMPTED:
        // Re-enterable: DELIVERY_FAILED → OUT_FOR_DELIVERY → … →
        // DELIVERY_FAILED is the common COD retry cycle. Each NDR
        // records its own delivery_attempts row (processor stamps
        // attemptNumber from a count); duplicate DELIVERY_FAILED
        // scans on an already-DELIVERY_FAILED order land as
        // "no-op transition, attempt row written" (TRK-2 + the
        // app-level dedup on delivery_attempts).
        return {
          kind: 'DELIVERY_ATTEMPT',
          targetOrderStatus: OrderStatus.DELIVERY_FAILED,
          allowedFromOrderStatuses: [
            OrderStatus.IN_TRANSIT,
            OrderStatus.OUT_FOR_DELIVERY,
            OrderStatus.DELIVERY_FAILED, // self-edge for repeat NDRs
          ],
          trackingEventType: TrackingEventType.DELIVERY_ATTEMPTED,
        };

      // ── RTO chain — webhook-driven UP TO RTO_IN_TRANSIT only
      //    (TRK-6 — RTO_RECEIVED is the warehouse boundary) ─────────
      case ShipmentStatus.RTO_INITIATED:
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.RTO_INITIATED,
          allowedFromOrderStatuses: [
            OrderStatus.DISPATCHED,
            OrderStatus.IN_TRANSIT,
            OrderStatus.OUT_FOR_DELIVERY,
            OrderStatus.DELIVERY_FAILED,
          ],
          trackingEventType: TrackingEventType.RTO_INITIATED,
        };
      case ShipmentStatus.RTO_IN_TRANSIT:
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.RTO_IN_TRANSIT,
          allowedFromOrderStatuses: [OrderStatus.RTO_INITIATED],
          trackingEventType: TrackingEventType.RTO_IN_TRANSIT,
        };
      case ShipmentStatus.RTO_DELIVERED:
        // TRK-6 (locked): a RTO_DELIVERED scan is INFORMATIONAL.
        // Physical receipt at the warehouse is RtoReceiptService.
        // receive() — the only authority for RTO_RECEIVED. Driving
        // RTO_RECEIVED from a webhook would let a malformed /
        // spoofed scan trigger the conservation-critical RTO
        // finalize chain (Model A — see WMS-8 / CUR-3) without
        // physical confirmation.
        return {
          kind: 'INFORMATIONAL',
          reason: 'RTO_DELIVERED_IS_INFORMATIONAL_TRK6',
          trackingEventType: TrackingEventType.RTO_DELIVERED,
        };

      // ── Loss / damage ───────────────────────────────────────────
      case ShipmentStatus.LOST:
        return {
          kind: 'TRANSITION',
          targetOrderStatus: OrderStatus.LOST_IN_TRANSIT,
          allowedFromOrderStatuses: [
            OrderStatus.DISPATCHED,
            OrderStatus.IN_TRANSIT,
            OrderStatus.DELIVERY_FAILED,
            OrderStatus.RTO_INITIATED,
            OrderStatus.RTO_IN_TRANSIT,
          ],
          trackingEventType: TrackingEventType.LOST,
        };
      case ShipmentStatus.DAMAGED:
        // Informational at the order level — RTO_DAMAGED is a
        // warehouse-finalize disposition (RtoDispositionService),
        // never a scan terminal. A damaged parcel in transit
        // typically routes to RTO_INITIATED → warehouse intake
        // anyway; the DAMAGED scan is operational telemetry.
        return {
          kind: 'INFORMATIONAL',
          reason: 'DAMAGED_IS_INFORMATIONAL_TRK6',
          trackingEventType: TrackingEventType.DAMAGED,
        };

      // ── Pre-dispatch internal lifecycle — REJECT (cannot be a
      //    legitimate output of normalizeScan) ───────────────────────
      case ShipmentStatus.CREATED:
      case ShipmentStatus.AWB_PENDING:
      case ShipmentStatus.AWB_GENERATED:
      case ShipmentStatus.FAILED_AT_CREATION:
      case ShipmentStatus.HANDED_TO_COURIER:
      case ShipmentStatus.AT_HUB:
      case ShipmentStatus.CANCELLED:
        return { kind: 'REJECT', reason: 'NOT_A_COURIER_SCAN_OUTCOME' };

      // ── EXHAUSTIVENESS — F2 discipline. A future ShipmentStatus
      //    addition will fail to compile here (TS narrowing: `status`
      //    has type `never` only when every variant is handled). The
      //    author MUST consciously route the new value. ──────────────
      default:
        return assertNeverShipmentStatus(status);
    }
  }
}

/** Compile-time exhaustiveness witness. */
function assertNeverShipmentStatus(value: never): never {
  throw new Error(
    `TrackingStatusMappingService.mapScan: unhandled ShipmentStatus value ${String(value)} — add a case (or REJECT) when the enum gains a member`,
  );
}
