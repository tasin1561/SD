import { DeliveryFailureReason } from '@skydrop/db';
import {
  mapFailureReason,
  parseScanPayload,
} from '../../src/modules/tracking-ingestion/services/raw-scan-parser';

// ── parseScanPayload ──────────────────────────────────────────────────────

describe('parseScanPayload (M10 — webhook body shape)', () => {
  describe('happy paths — required fields present', () => {
    it('snake_case top-level keys are accepted', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-AWB-1',
        raw_status: 'DLV-IN-TRANSIT',
        event_at: '2026-05-20T10:00:00.000Z',
      });
      expect(r).toEqual({
        awbNumber: 'DLV-AWB-1',
        rawStatus: 'DLV-IN-TRANSIT',
        statusType: null,
        nslCode: null,
        eventAtIso: '2026-05-20T10:00:00.000Z',
        locationName: null,
        locationCity: null,
        locationPincode: null,
        description: null,
        failureReason: null,
      });
    });

    it('camelCase top-level keys are accepted (Phase 1A tolerance)', () => {
      const r = parseScanPayload({
        awbNumber: 'DLV-AWB-2',
        rawStatus: 'DLV-OFD',
        eventAt: '2026-05-20T12:00:00.000Z',
      });
      expect(r?.awbNumber).toBe('DLV-AWB-2');
      expect(r?.rawStatus).toBe('DLV-OFD');
      expect(r?.eventAtIso).toBe('2026-05-20T12:00:00.000Z');
    });

    it('eventAtIso accepted as alternate top-level key', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-3',
        raw_status: 'DLV-DELIVERED',
        eventAtIso: '2026-05-21T08:00:00.000Z',
      });
      expect(r?.eventAtIso).toBe('2026-05-21T08:00:00.000Z');
    });

    it('"status" is accepted as an alias for "raw_status"', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-4',
        status: 'DLV-DELIVERED',
        event_at: '2026-05-22T08:00:00.000Z',
      });
      expect(r?.rawStatus).toBe('DLV-DELIVERED');
    });
  });

  describe('location resolution', () => {
    it('nested location object: name / city / pincode', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-5',
        raw_status: 'DLV-OFD',
        event_at: '2026-05-22T08:00:00.000Z',
        location: { name: 'BLR-HUB', city: 'Bengaluru', pincode: '560037' },
      });
      expect(r?.locationName).toBe('BLR-HUB');
      expect(r?.locationCity).toBe('Bengaluru');
      expect(r?.locationPincode).toBe('560037');
    });

    it('nested location.postal_code aliases pincode', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-6',
        raw_status: 'DLV-OFD',
        event_at: '2026-05-22T08:00:00.000Z',
        location: { postal_code: '110001' },
      });
      expect(r?.locationPincode).toBe('110001');
    });

    it('flat location_* fields take precedence over the nested object', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-7',
        raw_status: 'DLV-IN-TRANSIT',
        event_at: '2026-05-22T08:00:00.000Z',
        location_name: 'FLAT_NAME',
        location_city: 'FlatCity',
        location_pincode: '999999',
        location: { name: 'NESTED', city: 'NestedCity', pincode: '111111' },
      });
      expect(r?.locationName).toBe('FLAT_NAME');
      expect(r?.locationCity).toBe('FlatCity');
      expect(r?.locationPincode).toBe('999999');
    });

    it('no location at all → all three null', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-8',
        raw_status: 'DLV-DELIVERED',
        event_at: '2026-05-22T08:00:00.000Z',
      });
      expect(r?.locationName).toBeNull();
      expect(r?.locationCity).toBeNull();
      expect(r?.locationPincode).toBeNull();
    });

    it('malformed location (not object) is ignored without throwing', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-9',
        raw_status: 'DLV-DELIVERED',
        event_at: '2026-05-22T08:00:00.000Z',
        location: 'not-an-object',
      });
      expect(r).not.toBeNull();
      expect(r?.locationName).toBeNull();
    });
  });

  describe('optional fields', () => {
    it('description + failure_reason pass through (used for NDR processing)', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-10',
        raw_status: 'DLV-NDR',
        event_at: '2026-05-22T08:00:00.000Z',
        description: 'Customer unavailable at attempt',
        failure_reason: 'CUSTOMER_UNAVAILABLE',
      });
      expect(r?.description).toBe('Customer unavailable at attempt');
      expect(r?.failureReason).toBe('CUSTOMER_UNAVAILABLE');
    });

    it('narrative aliases description', () => {
      const r = parseScanPayload({
        awb_number: 'DLV-11',
        raw_status: 'DLV-IN-TRANSIT',
        event_at: '2026-05-22T08:00:00.000Z',
        narrative: 'In transit from BLR_HUB',
      });
      expect(r?.description).toBe('In transit from BLR_HUB');
    });
  });

  describe('parse-failure paths (return null — caller marks webhook IGNORED with PARSE_FAILED)', () => {
    it('non-object input → null', () => {
      expect(parseScanPayload(null)).toBeNull();
      expect(parseScanPayload('a string')).toBeNull();
      expect(parseScanPayload(42)).toBeNull();
      expect(parseScanPayload([])).toBeNull();
      expect(parseScanPayload(undefined)).toBeNull();
    });

    it('missing awb_number → null', () => {
      expect(
        parseScanPayload({
          raw_status: 'DLV-DELIVERED',
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
    });

    it('missing raw_status → null', () => {
      expect(
        parseScanPayload({
          awb_number: 'DLV-X',
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
    });

    it('missing event_at → null', () => {
      expect(
        parseScanPayload({
          awb_number: 'DLV-X',
          raw_status: 'DLV-DELIVERED',
        }),
      ).toBeNull();
    });

    it('event_at not a valid ISO timestamp → null (rejects "yesterday" / "soon" / malformed)', () => {
      expect(
        parseScanPayload({
          awb_number: 'DLV-X',
          raw_status: 'DLV-DELIVERED',
          event_at: 'yesterday',
        }),
      ).toBeNull();
    });

    it('empty-string required fields → null', () => {
      expect(
        parseScanPayload({
          awb_number: '',
          raw_status: 'DLV-DELIVERED',
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
      expect(
        parseScanPayload({
          awb_number: 'DLV-X',
          raw_status: '',
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
    });

    it('non-string required fields → null (defensive against poisoned JSON)', () => {
      expect(
        parseScanPayload({
          awb_number: 12345,
          raw_status: 'DLV-DELIVERED',
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
      expect(
        parseScanPayload({
          awb_number: 'DLV-X',
          raw_status: { nested: 'object' },
          event_at: '2026-05-22T08:00:00.000Z',
        }),
      ).toBeNull();
    });
  });
});

// ── mapFailureReason ──────────────────────────────────────────────────────

describe('mapFailureReason (M10 — courier-emitted failure-reason → enum)', () => {
  it('null input → null', () => {
    expect(mapFailureReason(null)).toBeNull();
  });

  it('exact UPPER_SNAKE_CASE enum value passes through', () => {
    expect(mapFailureReason('CUSTOMER_UNAVAILABLE')).toBe(
      DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
    );
    expect(mapFailureReason('BAD_WEATHER')).toBe(
      DeliveryFailureReason.BAD_WEATHER,
    );
  });

  it('case-insensitive matching: lowercase, mixed-case, title-case', () => {
    expect(mapFailureReason('customer_unavailable')).toBe(
      DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
    );
    expect(mapFailureReason('Customer_Unavailable')).toBe(
      DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
    );
  });

  it('punctuation normalization: spaces and dashes collapse to underscores', () => {
    expect(mapFailureReason('customer unavailable')).toBe(
      DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
    );
    expect(mapFailureReason('bad-weather')).toBe(
      DeliveryFailureReason.BAD_WEATHER,
    );
    expect(mapFailureReason('damaged-package')).toBe(
      DeliveryFailureReason.DAMAGED_PACKAGE,
    );
  });

  it('whitespace trimmed', () => {
    expect(mapFailureReason('  customer_unavailable  ')).toBe(
      DeliveryFailureReason.CUSTOMER_UNAVAILABLE,
    );
  });

  it('unknown reason falls back to OTHER (raw string preserved by the caller via failureNotes)', () => {
    expect(mapFailureReason('some_courier_specific_code_we_dont_recognize')).toBe(
      DeliveryFailureReason.OTHER,
    );
    expect(mapFailureReason('!@#$%')).toBe(DeliveryFailureReason.OTHER);
  });
});

/**
 * D5 — the REAL Delhivery webhook envelope, from their documentation
 * (docs/delhivery-integration.md §5).
 *
 * The bug these guard against: an earlier version put `StatusType` into
 * `rawStatus`, which handed the mapper "UD" (a direction) where it
 * expected "In Transit" (a stage) — and threw the direction away in the
 * process. Both axes now travel with the scan.
 */
describe('parseScanPayload — the real Delhivery Shipment envelope', () => {
  const envelope = (over: Record<string, unknown> = {}) => ({
    Shipment: {
      Status: {
        Status: 'In Transit',
        StatusDateTime: '2019-01-09T17:10:42.767',
        StatusType: 'UD',
        StatusLocation: 'Chandigarh_Raiprkln_C (Chandigarh)',
        Instructions: 'Manifest uploaded',
      },
      PickUpDate: '2019-01-09 17:10:42.543',
      NSLCode: 'X-UCI',
      Sortcode: 'IXC/MDP',
      ReferenceNo: '28',
      AWB: '38061110478262',
      ...over,
    },
  });

  it('takes Status as the stage and StatusType as the leg — not the other way round', () => {
    const p = parseScanPayload(envelope());
    expect(p).toMatchObject({
      awbNumber: '38061110478262',
      rawStatus: 'In Transit',
      statusType: 'UD',
      nslCode: 'X-UCI',
    });
  });

  it('reads NSLCode from the Shipment level, where Delhivery puts it', () => {
    const p = parseScanPayload(envelope({ NSLCode: 'EOD-74' }));
    expect(p?.nslCode).toBe('EOD-74');
  });

  it('keeps the scan timestamp and location', () => {
    const p = parseScanPayload(envelope());
    expect(p?.eventAtIso).toBe('2019-01-09T17:10:42.767');
    expect(p?.locationName).toBe('Chandigarh_Raiprkln_C (Chandigarh)');
    expect(p?.description).toBe('Manifest uploaded');
  });

  it('distinguishes a RETURN leg — the same stage, the opposite direction', () => {
    const p = parseScanPayload(
      envelope({ Status: { Status: 'In Transit', StatusType: 'RT', StatusDateTime: '2019-01-09T17:10:42.767' } }),
    );
    expect(p).toMatchObject({ rawStatus: 'In Transit', statusType: 'RT' });
  });

  it('still returns null when the envelope lacks an AWB or a timestamp', () => {
    expect(parseScanPayload({ Shipment: { Status: { Status: 'In Transit' } } })).toBeNull();
  });
});

