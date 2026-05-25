import { OrderStatus, ShipmentStatus, TrackingEventType } from '@skydrop/db';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';

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

  it('OUT_FOR_DELIVERY scan → TRANSITION from IN_TRANSIT', () => {
    expect(svc.mapScan(ShipmentStatus.OUT_FOR_DELIVERY)).toMatchObject({
      kind: 'TRANSITION',
      targetOrderStatus: OrderStatus.OUT_FOR_DELIVERY,
      allowedFromOrderStatuses: [OrderStatus.IN_TRANSIT],
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
      [
        'allowedFromOrderStatuses',
        'kind',
        'targetOrderStatus',
        'trackingEventType',
      ].sort(),
    );
  });

  // ── DELIVERY_ATTEMPT (NDR) ───────────────────────────────────────
  it('DELIVERY_ATTEMPTED scan → DELIVERY_ATTEMPT decision, target DELIVERY_FAILED, self-edge allowed for repeat NDRs', () => {
    expect(svc.mapScan(ShipmentStatus.DELIVERY_ATTEMPTED)).toEqual({
      kind: 'DELIVERY_ATTEMPT',
      targetOrderStatus: OrderStatus.DELIVERY_FAILED,
      allowedFromOrderStatuses: [
        OrderStatus.IN_TRANSIT,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERY_FAILED,
      ],
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
    expect((m as unknown as { allowedFromOrderStatuses: OrderStatus[] }).allowedFromOrderStatuses)
      .toEqual([
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
    expect((m as unknown as { allowedFromOrderStatuses: OrderStatus[] }).allowedFromOrderStatuses)
      .toEqual([
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
      expect(['TRANSITION', 'DELIVERY_ATTEMPT', 'INFORMATIONAL', 'REJECT'])
        .toContain(decision.kind);
    }
  });
});
