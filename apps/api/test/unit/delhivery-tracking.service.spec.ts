import { ShipmentStatus } from '@skydrop/db';
import { DelhiveryTrackingService } from '../../src/modules/courier-delhivery/services/delhivery-tracking.service';
import type { DelhiveryRawScan } from '../../src/modules/courier-delhivery/types/delhivery.types';

function raw(over: Partial<DelhiveryRawScan> = {}): DelhiveryRawScan {
  return {
    awbNumber: 'DLVSTUB1',
    rawStatus: 'DLV-DELIVERED',
    eventAtIso: '2026-05-25T10:00:00Z',
    ...over,
  };
}

describe('DelhiveryTrackingService.normalizeScan (stub mode)', () => {
  const svc = new DelhiveryTrackingService();

  it.each([
    ['DLV-IN-TRANSIT', ShipmentStatus.IN_TRANSIT],
    ['DLV-OFD', ShipmentStatus.OUT_FOR_DELIVERY],
    ['DLV-DELIVERED', ShipmentStatus.DELIVERED],
    ['DLV-NDR', ShipmentStatus.DELIVERY_ATTEMPTED],
    ['DLV-RTO-INIT', ShipmentStatus.RTO_INITIATED],
    ['DLV-RTO-IT', ShipmentStatus.RTO_IN_TRANSIT],
    ['DLV-RTO-DEL', ShipmentStatus.RTO_DELIVERED],
    ['DLV-LOST', ShipmentStatus.LOST],
    ['DLV-DAMAGED', ShipmentStatus.DAMAGED],
  ])('maps "%s" → ShipmentStatus.%s', (rawStatus, expected) => {
    const r = svc.normalizeScan(raw({ rawStatus }));
    expect(r).toEqual({ kind: 'NORMALIZED', shipmentStatus: expected });
  });

  it('lowercase / mixed-case raw codes are normalized', () => {
    expect(svc.normalizeScan(raw({ rawStatus: 'dlv-delivered' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERED,
    });
    expect(svc.normalizeScan(raw({ rawStatus: 'Dlv-Ofd' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
    });
  });

  it('whitespace around the raw code is trimmed', () => {
    expect(svc.normalizeScan(raw({ rawStatus: '   DLV-LOST   ' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.LOST,
    });
  });

  it('unknown DLV- prefixed code → UNMAPPABLE with STUB_UNKNOWN_CODE reason', () => {
    expect(svc.normalizeScan(raw({ rawStatus: 'DLV-UNKNOWN' }))).toEqual({
      kind: 'UNMAPPABLE',
      reason: 'STUB_UNKNOWN_CODE',
    });
  });

  it('a bare StatusType is NOT a status — "UD" alone maps to nothing', () => {
    // This test previously asserted UD → IN_TRANSIT, which encoded a
    // misreading of the API: UD is the journey LEG, not the stage. The
    // real payload always carries both, and a leg on its own says only
    // "this parcel is going forwards" — not where it has got to.
    expect(svc.normalizeScan(raw({ rawStatus: 'UD' }))).toEqual({
      kind: 'UNMAPPABLE',
      reason: 'UNKNOWN_COURIER_CODE',
    });
  });

  it('maps the (StatusType, Status) PAIR the real API sends', () => {
    expect(svc.normalizeScan(raw({ statusType: 'UD', rawStatus: 'In Transit' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.IN_TRANSIT,
    });
    // Delhivery's "Dispatched" on a forward leg is our OUT_FOR_DELIVERY.
    expect(svc.normalizeScan(raw({ statusType: 'UD', rawStatus: 'Dispatched' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
    });
  });

  it('THE DIRECTION BUG: the same status under RT is a RETURN, not forward progress', () => {
    // The failure this guards against is an order marching towards
    // DELIVERED while the parcel is physically coming back to us.
    expect(svc.normalizeScan(raw({ statusType: 'RT', rawStatus: 'In Transit' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.RTO_IN_TRANSIT,
    });
    expect(svc.normalizeScan(raw({ statusType: 'RT', rawStatus: 'Dispatched' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.RTO_IN_TRANSIT,
    });
  });

  it('an ambiguous status with NO leg is refused rather than guessed', () => {
    // Recording it as unmappable (still audited) beats a coin flip on
    // whether the parcel is coming or going.
    expect(svc.normalizeScan(raw({ rawStatus: 'In Transit' }))).toEqual({
      kind: 'UNMAPPABLE',
      reason: 'UNKNOWN_COURIER_CODE',
    });
  });

  it('an UNambiguous status still maps without a leg', () => {
    // A terminal says where the parcel ended up; no leg can change that.
    expect(svc.normalizeScan(raw({ rawStatus: 'Delivered' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERED,
    });
  });

  it('an EOD-* NSL on a forward leg is a failed delivery ATTEMPT', () => {
    // The status itself is an unremarkable "Pending" — the NSL is the
    // only thing that says a delivery was tried and failed.
    expect(
      svc.normalizeScan(raw({ statusType: 'UD', rawStatus: 'Pending', nslCode: 'EOD-74' })),
    ).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
    });
    // Without the NSL the same scan is ordinary transit.
    expect(svc.normalizeScan(raw({ statusType: 'UD', rawStatus: 'Pending' }))).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.IN_TRANSIT,
    });
  });

  it('empty or unknown non-prefixed code → UNMAPPABLE with UNKNOWN_COURIER_CODE reason', () => {
    expect(svc.normalizeScan(raw({ rawStatus: '' }))).toEqual({
      kind: 'UNMAPPABLE',
      reason: 'UNKNOWN_COURIER_CODE',
    });
    expect(svc.normalizeScan(raw({ rawStatus: 'NOPE' }))).toEqual({
      kind: 'UNMAPPABLE',
      reason: 'UNKNOWN_COURIER_CODE',
    });
  });
});

describe('DelhiveryTrackingService — an NDR the track API cannot spell with an NSL', () => {
  /**
   * The production bug, reproduced from the real payload.
   *
   * Delhivery's TRACK API does not carry NSLCode inside the scan (their
   * docs put it at the Shipment level, and the live API returned null on
   * every scan for a real AWB on 2026-09-01). The NSL check is therefore
   * unreachable in production, and a genuine failed delivery arrived
   * looking exactly like ordinary transit.
   */
  const svc = new DelhiveryTrackingService();

  it('reads a failed delivery off the remark when no NSL is supplied', () => {
    const out = svc.normalizeScan({
      awbNumber: '38061110518534',
      rawStatus: 'Pending',
      statusType: 'UD',
      nslCode: null,
      eventAtIso: '2026-08-31T13:23:00.000Z',
      description: 'Consignee Unavailable',
    });
    expect(out).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
    });
  });

  it('still prefers the NSL when the courier does send one', () => {
    const out = svc.normalizeScan({
      awbNumber: 'A1',
      rawStatus: 'Pending',
      statusType: 'UD',
      nslCode: 'EOD-74',
      eventAtIso: '2026-08-31T13:23:00.000Z',
      description: 'anything at all',
    });
    expect(out).toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
    });
  });

  it('does NOT invent an NDR from an ordinary transit remark', () => {
    // The expensive direction: a false NDR moves the order to
    // DELIVERY_FAILED, calls a customer whose parcel is fine, and counts
    // toward the cap that eventually rejects the order.
    for (const remark of [
      'Shipment Received at Facility',
      'Bag Added To Trip',
      'Vehicle Departed',
      'Agent remark verified',
      'NTD Updated',
    ]) {
      const out = svc.normalizeScan({
        awbNumber: 'A1',
        rawStatus: 'Pending',
        statusType: 'UD',
        nslCode: null,
        eventAtIso: '2026-08-31T13:23:00.000Z',
        description: remark,
      });
      expect(out).not.toEqual({
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      });
    }
  });

  it('does not read an NDR remark on the RETURN leg as a forward attempt', () => {
    const out = svc.normalizeScan({
      awbNumber: 'A1',
      rawStatus: 'Pending',
      statusType: 'RT',
      nslCode: null,
      eventAtIso: '2026-08-31T13:23:00.000Z',
      description: 'Consignee Unavailable',
    });
    expect(out).not.toEqual({
      kind: 'NORMALIZED',
      shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
    });
  });
});
