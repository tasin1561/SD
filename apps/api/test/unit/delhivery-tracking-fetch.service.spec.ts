import { DelhiveryTrackingFetchService } from '../../src/modules/courier-delhivery/services/delhivery-tracking-fetch.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';

function makeSvc(opts: { stub?: boolean; response?: unknown } = {}) {
  const request = jest.fn(async () => opts.response ?? { ShipmentData: [] });
  const http = {
    isStubMode: jest.fn(async () => opts.stub ?? false),
    request,
  };
  const svc = new DelhiveryTrackingFetchService(
    http as unknown as DelhiveryHttpService,
  );
  return { svc, request, http };
}

describe('DelhiveryTrackingFetchService.fetchTracking', () => {
  it('STUB MODE → returns [] and makes NO network call (poller inert)', async () => {
    const { svc, request } = makeSvc({ stub: true });
    const out = await svc.fetchTracking(['38061110478225']);
    expect(out).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('empty / blank waybills → [] with no call', async () => {
    const { svc, request } = makeSvc();
    expect(await svc.fetchTracking([])).toEqual([]);
    expect(await svc.fetchTracking(['', '  '])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('>50 waybills → throws (the poll service must batch)', async () => {
    const { svc } = makeSvc();
    const many = Array.from({ length: 51 }, (_, i) => `AWB${i}`);
    await expect(svc.fetchTracking(many)).rejects.toThrow(/max is 50/);
  });

  it('REAL MODE → parses ShipmentData into oldest-first scans; rawStatus=Scan; IST offset appended to zone-less timestamps', async () => {
    const response = {
      ShipmentData: [
        {
          Shipment: {
            AWB: '38061110478225',
            Scans: [
              {
                ScanDetail: {
                  Scan: 'In Transit',
                  ScanDateTime: '2026-07-26T05:00:00',
                  ScannedLocation: 'Delhi_Hub',
                  StatusCode: 'X-INT',
                  Instructions: 'Bag received at facility',
                },
              },
              {
                ScanDetail: {
                  Scan: 'Manifested',
                  ScanDateTime: '2026-07-25T19:32:50.228',
                  ScannedLocation: 'Kolkata_Hub',
                  StatusCode: 'X-UCI',
                  Instructions: 'Shipment picked up',
                },
              },
            ],
          },
        },
      ],
    };
    const { svc } = makeSvc({ response });
    const out = await svc.fetchTracking(['38061110478225']);

    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r?.awbNumber).toBe('38061110478225');
    expect(r?.scans).toHaveLength(2);
    // Sorted oldest-first — Manifested (19:32 on the 25th) precedes In Transit.
    expect(r?.scans[0]?.rawStatus).toBe('Manifested');
    expect(r?.scans[1]?.rawStatus).toBe('In Transit');
    // IST offset appended (no zone in source).
    expect(r?.scans[0]?.eventAtIso).toBe('2026-07-25T19:32:50.228+05:30');
    expect(r?.scans[0]?.locationName).toBe('Kolkata_Hub');
    expect(r?.scans[0]?.description).toBe('Shipment picked up');
    expect(r?.scans[0]?.failureReason).toBe('Shipment picked up');
  });

  it('REAL MODE → already-zoned timestamps pass through unchanged; skips scans missing Scan or time', async () => {
    const response = {
      ShipmentData: [
        {
          Shipment: {
            AWB: 999,
            Scans: [
              { ScanDetail: { Scan: 'Delivered', ScanDateTime: '2026-07-27T09:00:00Z' } },
              { ScanDetail: { Scan: '', ScanDateTime: '2026-07-27T10:00:00Z' } }, // no status → skip
              { ScanDetail: { Scan: 'Lost', ScanDateTime: '' } }, // no time → skip
            ],
          },
        },
      ],
    };
    const { svc } = makeSvc({ response });
    const out = await svc.fetchTracking(['999']);
    expect(out[0]?.awbNumber).toBe('999');
    expect(out[0]?.scans).toHaveLength(1);
    expect(out[0]?.scans[0]?.rawStatus).toBe('Delivered');
    expect(out[0]?.scans[0]?.eventAtIso).toBe('2026-07-27T09:00:00Z');
  });
});
