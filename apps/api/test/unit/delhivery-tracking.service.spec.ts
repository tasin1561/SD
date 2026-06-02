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

  it('real Delhivery code in the documented table → NORMALIZED', () => {
    // 'UD' is one of Delhivery's published StatusType codes; the
    // adapter now recognises it even in mixed stub+real operation.
    expect(svc.normalizeScan(raw({ rawStatus: 'UD' }))).toEqual({
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
