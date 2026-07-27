import { DelhiveryNdrService } from '../../src/modules/courier-delhivery/services/delhivery-ndr.service';
import { DelhiveryPickupService } from '../../src/modules/courier-delhivery/services/delhivery-pickup.service';
import { DelhiveryDocumentService } from '../../src/modules/courier-delhivery/services/delhivery-document.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryWriteGuardService } from '../../src/modules/courier-delhivery/services/delhivery-write-guard.service';

type AnyArgs = Record<string, unknown>;

function makeHttp(response: AnyArgs = {}, stub = false) {
  const request = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => response);
  return {
    http: {
      isStubMode: jest.fn(async () => stub),
      request,
    } as unknown as DelhiveryHttpService,
    request,
  };
}

function makeGuard(blocked = false) {
  const assertWritable = jest.fn(async () => {
    if (blocked) throw new Error('DELHIVERY_LIVE_WRITES_DISABLED');
  });
  return {
    guard: { assertWritable } as unknown as DelhiveryWriteGuardService,
    assertWritable,
  };
}

describe('DelhiveryNdrService — eligibility is checked BEFORE calling', () => {
  const svc = () => {
    const { http, request } = makeHttp({ upl: 'UPL123' });
    const { guard, assertWritable } = makeGuard();
    return { s: new DelhiveryNdrService(http, guard), request, assertWritable };
  };

  it('allows RE-ATTEMPT on a permitted NSL with attempt 1', () => {
    const { s } = svc();
    expect(
      s.checkEligibility({
        awbNumber: '1',
        action: 'RE-ATTEMPT',
        currentNslCode: 'EOD-74',
        attemptCount: 1,
      }),
    ).toEqual({ eligible: true, reason: null });
  });

  it('refuses RE-ATTEMPT on an NSL Delhivery does not permit', () => {
    // Sending it anyway would burn rate budget and earn a rejection, and
    // "we asked" would be indistinguishable from "we were refused".
    const { s } = svc();
    const r = s.checkEligibility({
      awbNumber: '1',
      action: 'RE-ATTEMPT',
      currentNslCode: 'EOD-999',
      attemptCount: 1,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain('EOD-999');
  });

  it('refuses past the second attempt', () => {
    const { s } = svc();
    expect(
      s.checkEligibility({
        awbNumber: '1',
        action: 'RE-ATTEMPT',
        currentNslCode: 'EOD-74',
        attemptCount: 3,
      }).eligible,
    ).toBe(false);
  });

  it('refuses when the current NSL is unknown — eligibility depends on it', () => {
    const { s } = svc();
    const r = s.checkEligibility({
      awbNumber: '1',
      action: 'RE-ATTEMPT',
      currentNslCode: null,
      attemptCount: 1,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain('No current NSL');
  });

  it('PICKUP_RESCHEDULE has its OWN allow-list, not the re-attempt one', () => {
    const { s } = svc();
    // EOD-777 (RVP QC fail) is valid for reschedule but not re-attempt…
    expect(
      s.checkEligibility({
        awbNumber: '1',
        action: 'PICKUP_RESCHEDULE',
        currentNslCode: 'EOD-777',
        attemptCount: 1,
      }).eligible,
    ).toBe(true);
    // …and EOD-74 is the reverse.
    expect(
      s.checkEligibility({
        awbNumber: '1',
        action: 'PICKUP_RESCHEDULE',
        currentNslCode: 'EOD-74',
        attemptCount: 1,
      }).eligible,
    ).toBe(false);
  });

  it('an ineligible action never reaches the network or the write guard', async () => {
    const { s, request, assertWritable } = svc();
    const r = await s.takeAction({
      awbNumber: '1',
      action: 'RE-ATTEMPT',
      currentNslCode: 'EOD-999',
      attemptCount: 1,
    });
    expect(r.success).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(assertWritable).not.toHaveBeenCalled();
  });

  it('an eligible action posts one waybill and returns the UPL id', async () => {
    const { s, request } = svc();
    const r = await s.takeAction({
      awbNumber: '13163116',
      action: 'RE-ATTEMPT',
      currentNslCode: 'EOD-74',
      attemptCount: 1,
    });
    expect(r).toMatchObject({ success: true, uplId: 'UPL123' });
    expect(request.mock.calls[0]![0]).toMatchObject({
      path: '/api/p/update',
      body: { data: [{ waybill: '13163116', act: 'RE-ATTEMPT' }] },
    });
  });

  it('treats a missing UPL id as failure — the id IS the acceptance', async () => {
    const { http } = makeHttp({ error: 'Package in incorrect status' });
    const { guard } = makeGuard();
    const r = await new DelhiveryNdrService(http, guard).takeAction({
      awbNumber: '1',
      action: 'RE-ATTEMPT',
      currentNslCode: 'EOD-74',
      attemptCount: 1,
    });
    expect(r.success).toBe(false);
    expect(r.message).toBe('Package in incorrect status');
  });

  it('checkStatus reports IN PROGRESS as not-yet-complete, not as failure', async () => {
    // Delhivery's "Package action is being performed" means "ask again",
    // and reading it as failure would make us retry a live action.
    const { http } = makeHttp({ status: 'Package action is being performed' });
    const { guard } = makeGuard();
    const r = await new DelhiveryNdrService(http, guard).checkStatus('UPL123');
    expect(r).toMatchObject({ complete: false, success: null });
  });

  it('is gated by the write guard — it changes a real delivery', async () => {
    const { http } = makeHttp({ upl: 'UPL123' });
    const { guard } = makeGuard(true);
    await expect(
      new DelhiveryNdrService(http, guard).takeAction({
        awbNumber: '1',
        action: 'RE-ATTEMPT',
        currentNslCode: 'EOD-74',
        attemptCount: 1,
      }),
    ).rejects.toThrow('DELHIVERY_LIVE_WRITES_DISABLED');
  });
});

describe('DelhiveryPickupService', () => {
  const build = (response: AnyArgs = { pickup_id: 987 }, blocked = false) => {
    const { http, request } = makeHttp(response);
    const { guard, assertWritable } = makeGuard(blocked);
    return { s: new DelhiveryPickupService(http, guard), request, assertWritable };
  };

  const VALID = {
    pickupLocation: 'Skydrop',
    pickupDate: '2026-07-28',
    pickupTime: '11:00:00',
    expectedPackageCount: 12,
  };

  it('requests ONE pickup for a whole warehouse, not one per parcel', async () => {
    // Twelve parcels, one van.
    const { s, request } = build();
    const r = await s.requestPickup(VALID);
    expect(r).toMatchObject({ success: true, pickupId: '987' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toMatchObject({
      path: '/fm/request/new/',
      body: {
        pickup_location: 'Skydrop',
        expected_package_count: 12,
      },
    });
  });

  it.each([
    ['28-07-2026', '11:00:00'],
    ['2026-07-28', '11:00'],
  ])('rejects a malformed date/time (%s %s) before calling out', async (d, t) => {
    const { s, request } = build();
    await expect(
      s.requestPickup({ ...VALID, pickupDate: d, pickupTime: t }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a pickup location with stray whitespace', async () => {
    const { s } = build();
    await expect(
      s.requestPickup({ ...VALID, pickupLocation: 'Skydrop ' }),
    ).rejects.toThrow(/whitespace/);
  });

  it('reads an in-body failure as failure despite HTTP 200', async () => {
    const { s } = build({ error: 'Pickup already exists for this date' });
    const r = await s.requestPickup(VALID);
    expect(r.success).toBe(false);
    expect(r.message).toContain('already exists');
  });

  it('is gated — it dispatches a real van to a real building', async () => {
    const { s } = build({ pickup_id: 1 }, true);
    await expect(s.requestPickup(VALID)).rejects.toThrow(
      'DELHIVERY_LIVE_WRITES_DISABLED',
    );
  });
});

describe('DelhiveryDocumentService', () => {
  it('fetches an EPOD — read-only, so no write guard needed', async () => {
    const { http, request } = makeHttp({ url: 'https://dlv/epod/123.pdf' });
    const r = await new DelhiveryDocumentService(http).fetch('123', 'EPOD');
    expect(r.url).toBe('https://dlv/epod/123.pdf');
    expect(String(request.mock.calls[0]![0]['path'])).toContain('doc_type=EPOD');
  });

  it('returns null rather than throwing when no document exists yet', async () => {
    // Delhivery archives documents; a missing EPOD is an ordinary state,
    // not an error — the caller decides whether to chase it.
    const { http } = makeHttp({ error: 'No document found' });
    const r = await new DelhiveryDocumentService(http).fetch('123', 'SIGNATURE_URL');
    expect(r.url).toBeNull();
    expect(r.message).toBe('No document found');
  });
});
