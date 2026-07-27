import { OrderStatus, ShipmentStatus, TrackingEventType } from '@skydrop/db';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';

describe('TrackingStatusMappingService.mapScan (TRK-5)', () => {
  const svc = new TrackingStatusMappingService();

  // ── TRANSITION cases ─────────────────────────────────────────────
  it('IN_TRANSIT scan → TRANSITION to IN_TRANSIT from DISPATCHED', () => {
    expect(svc.mapScan(ShipmentStatus.IN_TRANSIT)).toEqual({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.IN_TRANSIT,
      allowedFromOrderStatuses: [OrderStatus.DISPATCHED],
      trackingEventType: TrackingEventType.IN_TRANSIT_UPDATE,
    });
  });

  it('OUT_FOR_DELIVERY scan → TRANSITION from IN_TRANSIT OR DELIVERY_FAILED (NDR retry cycle — M10 commit 9 / F6)', () => {
    expect(svc.mapScan(ShipmentStatus.OUT_FOR_DELIVERY)).toMatchObject({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.OUT_FOR_DELIVERY,
      // DELIVERY_FAILED is the second leg of the COD retry cycle —
      // omitting it would make the processor skip the legitimate
      // redelivery transition as a "stale-backward" scan.
      allowedFromOrderStatuses: [OrderStatus.IN_TRANSIT, OrderStatus.DELIVERY_FAILED],
    });
  });

  it('TRK-7 DELIVERED scan: TRANSITION carries NO stock side-effect mention — mapping service is matrix-only (sideEffects live on the matrix)', () => {
    // The mapping service does not encode sideEffects — those belong to
    // OrderStateMachineService. This test pins the contract: DELIVERED
    // is a plain TRANSITION here; M9 commit 12 already set the matrix
    // edge to sideEffects:[]. Stock neutrality is preserved by NEVER
    // adding a side-effect attribute to this service.
    const d = svc.mapScan(ShipmentStatus.DELIVERED);
    expect(d).toEqual({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.DELIVERED,
      allowedFromOrderStatuses: [OrderStatus.OUT_FOR_DELIVERY],
      trackingEventType: TrackingEventType.DELIVERED,
    });
    // Defensive: no surprise sideEffects field crept in.
    expect(Object.keys(d).sort()).toEqual(
      ['allowedFromOrderStatuses', 'kind', 'targetOrderStatus', 'trackingEventType'].sort(),
    );
  });

  // ── DELIVERY_ATTEMPT (NDR) ───────────────────────────────────────
  it('DELIVERY_ATTEMPTED scan → DELIVERY_ATTEMPT, target DELIVERY_FAILED, allowedFrom mirrors matrix inbound exactly (M10 commit 9 — no defensive self-edge; repeats handled by the processor current===target guard)', () => {
    expect(svc.mapScan(ShipmentStatus.DELIVERY_ATTEMPTED)).toEqual({
      kind: 'DELIVERY_ATTEMPT',
      targetOrderStatus: OrderStatus.DELIVERY_FAILED,
      allowedFromOrderStatuses: [OrderStatus.IN_TRANSIT, OrderStatus.OUT_FOR_DELIVERY],
      trackingEventType: TrackingEventType.DELIVERY_ATTEMPTED,
    });
  });

  // ── RTO chain — TRK-6 boundary ──────────────────────────────────
  it('RTO_INITIATED scan → TRANSITION from many in-flight states', () => {
    const m = svc.mapScan(ShipmentStatus.RTO_INITIATED);
    expect(m).toMatchObject({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.RTO_INITIATED,
    });
    expect(
      (m as unknown as { allowedFromOrderStatuses: OrderStatus[] }).allowedFromOrderStatuses,
    ).toEqual([
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERY_FAILED,
    ]);
  });

  it('RTO_IN_TRANSIT scan → TRANSITION from RTO_INITIATED only', () => {
    expect(svc.mapScan(ShipmentStatus.RTO_IN_TRANSIT)).toMatchObject({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.RTO_IN_TRANSIT,
      allowedFromOrderStatuses: [OrderStatus.RTO_INITIATED],
    });
  });

  it('TRK-6 RTO_DELIVERED scan → INFORMATIONAL only (warehouse boundary owns RTO_RECEIVED)', () => {
    expect(svc.mapScan(ShipmentStatus.RTO_DELIVERED)).toEqual({
      kind: 'INFORMATIONAL',
      reason: 'RTO_DELIVERED_IS_INFORMATIONAL_TRK6',
      trackingEventType: TrackingEventType.RTO_DELIVERED,
    });
  });

  // ── Loss / damage ──────────────────────────────────────────────
  it('LOST scan → TRANSITION to LOST_IN_TRANSIT from broad in-flight set', () => {
    const m = svc.mapScan(ShipmentStatus.LOST);
    expect(m).toMatchObject({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.LOST_IN_TRANSIT,
    });
    expect(
      (m as unknown as { allowedFromOrderStatuses: OrderStatus[] }).allowedFromOrderStatuses,
    ).toEqual([
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DELIVERY_FAILED,
      OrderStatus.RTO_INITIATED,
      OrderStatus.RTO_IN_TRANSIT,
    ]);
  });

  it('DAMAGED scan → INFORMATIONAL (RTO_DAMAGED is a warehouse-finalize disposition)', () => {
    expect(svc.mapScan(ShipmentStatus.DAMAGED)).toEqual({
      kind: 'INFORMATIONAL',
      reason: 'DAMAGED_IS_INFORMATIONAL_TRK6',
      trackingEventType: TrackingEventType.DAMAGED,
    });
  });

  // ── REJECT — pre-dispatch internal lifecycle states ────────────
  it.each([
    ShipmentStatus.CREATED,
    ShipmentStatus.AWB_PENDING,
    ShipmentStatus.AWB_GENERATED,
    ShipmentStatus.FAILED_AT_CREATION,
    ShipmentStatus.HANDED_TO_COURIER,
    ShipmentStatus.AT_HUB,
    ShipmentStatus.CANCELLED,
  ])('%s → REJECT (NOT_A_COURIER_SCAN_OUTCOME)', (status) => {
    expect(svc.mapScan(status)).toEqual({
      kind: 'REJECT',
      reason: 'NOT_A_COURIER_SCAN_OUTCOME',
    });
  });

  // ── EXHAUSTIVENESS — every ShipmentStatus value MUST be handled.
  //    If this assertion is added/changed by a future ShipmentStatus
  //    addition, the switch in mapScan will fail to compile first
  //    (the compile error is the primary discipline; this test is
  //    the runtime smoke that complements it). ─────────────────────
  it('EXHAUSTIVE: every ShipmentStatus value has a mapping decision', () => {
    const allValues = Object.values(ShipmentStatus);
    for (const v of allValues) {
      const decision = svc.mapScan(v);
      expect(['TRANSITION', 'DELIVERY_ATTEMPT', 'INFORMATIONAL', 'REJECT']).toContain(
        decision.kind,
      );
    }
  });
});

// ── Matrix consistency (M10 commit 9 / F6 reconciliation) ──────────────────
//
// The mapping service's `allowedFromOrderStatuses` for each TRANSITION /
// DELIVERY_ATTEMPT decision MUST mirror the M9 OrderStateMachineService
// matrix's actual inbound edges to `targetOrderStatus`. Drift in either
// direction is a bug:
//
//   - mapping lists a `from` that the matrix doesn't allow → the processor
//     would call transitionStatus and get an INVALID_TRANSITION 409 the
//     guard didn't catch (works, but noisy + indicates a docs gap);
//   - matrix has an inbound edge the mapping omits → the processor's
//     monotonic-forward guard skips a legitimate forward transition (the
//     real bug — silent regression).
//
// This regression test pins the bidirectional equivalence.
describe('TrackingStatusMappingService ↔ OrderStateMachineService matrix consistency (F6)', () => {
  const svc = new TrackingStatusMappingService();
  const matrix = new OrderStateMachineService();

  const orderStatuses = Object.values(OrderStatus);
  const inboundEdges = (target: OrderStatus): OrderStatus[] =>
    orderStatuses.filter((from) => matrix.isValidTransition(from, target));

  // Scan-driven TRANSITION + DELIVERY_ATTEMPT decisions whose
  // allowedFromOrderStatuses we expect to match the matrix exactly.
  // (INFORMATIONAL / REJECT don't drive transitions; excluded by design.)
  const expectations: ReadonlyArray<{
    scan: ShipmentStatus;
    target: OrderStatus;
  }> = [
    { scan: ShipmentStatus.IN_TRANSIT, target: OrderStatus.IN_TRANSIT },
    {
      scan: ShipmentStatus.OUT_FOR_DELIVERY,
      target: OrderStatus.OUT_FOR_DELIVERY,
    },
    { scan: ShipmentStatus.DELIVERED, target: OrderStatus.DELIVERED },
    {
      scan: ShipmentStatus.DELIVERY_ATTEMPTED,
      target: OrderStatus.DELIVERY_FAILED,
    },
    { scan: ShipmentStatus.RTO_INITIATED, target: OrderStatus.RTO_INITIATED },
    { scan: ShipmentStatus.RTO_IN_TRANSIT, target: OrderStatus.RTO_IN_TRANSIT },
    { scan: ShipmentStatus.LOST, target: OrderStatus.LOST_IN_TRANSIT },
  ];

  it.each(expectations)(
    '$scan: mapping.allowedFromOrderStatuses == matrix inbound to $target',
    ({ scan, target }) => {
      const decision = svc.mapScan(scan);
      expect(decision.kind === 'TRANSITION' || decision.kind === 'DELIVERY_ATTEMPT').toBe(true);
      if (decision.kind !== 'TRANSITION' && decision.kind !== 'DELIVERY_ATTEMPT') return;
      expect(decision.targetOrderStatus).toBe(target);
      // Both sides as sorted lists so order differences don't false-fail.
      const mappingFroms = [...decision.allowedFromOrderStatuses].sort();
      const matrixFroms = inboundEdges(target).sort();
      expect(mappingFroms).toEqual(matrixFroms);
    },
  );

  // TRK-7 spot-check: DELIVERED edge carries NO side-effects (stock-neutral,
  // Model A — CUR-3 / M9 commit 12). Mapping must NEVER add a stock-bearing
  // facet — guarded by the type itself (no sideEffects field on
  // ScanMappingDecision), but pin the matrix invariant here so an accidental
  // matrix change is caught at the M10 layer too.
  it('TRK-7: OUT_FOR_DELIVERY → DELIVERED matrix edge has empty side-effects (stock-neutral)', () => {
    const effects = matrix.requiredSideEffects(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED);
    expect(effects).toEqual([]);
  });

  // The NDR retry cycle's second leg — without this matrix edge the
  // mapping for OUT_FOR_DELIVERY (DELIVERY_FAILED in allowedFrom) would
  // lie about what's actually reachable.
  it('NDR retry cycle: DELIVERY_FAILED → OUT_FOR_DELIVERY is a matrix-valid edge', () => {
    expect(
      matrix.isValidTransition(OrderStatus.DELIVERY_FAILED, OrderStatus.OUT_FOR_DELIVERY),
    ).toBe(true);
  });
});
