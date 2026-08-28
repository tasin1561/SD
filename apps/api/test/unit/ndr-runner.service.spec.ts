import { NdrRunnerService } from '../../src/modules/courier-ndr-runner/services/ndr-runner.service';

/**
 * The three gates, and the fresh-NSL rule.
 *
 * Everything here is about NOT sending a van. The runner is the only
 * scheduled thing in the system with a physical-world effect, and the
 * amended CUR-10 permits it to exist only because these gates do.
 */

type Ctx = {
  enabled?: boolean;
  liveWrites?: boolean;
  autoActions?: string[];
  candidates?: {
    id: string;
    awbNumber: string | null;
    courierCode?: string;
    courierAccountId?: string | null;
  }[];
  scans?: { nslCode?: string | null }[];
  attemptCount?: number;
  eligible?: boolean;
  trackingThrows?: boolean;
};

function make(ctx: Ctx = {}) {
  const takeAction = jest.fn().mockResolvedValue({ success: true, uplId: 'upl-1', message: 'ok' });
  const fetchTracking = jest.fn().mockImplementation(() => {
    if (ctx.trackingThrows === true) throw new Error('network');
    return Promise.resolve([{ awbNumber: 'AWB1', scans: ctx.scans ?? [{ nslCode: 'EOD-74' }] }]);
  });
  const updates: { data: Record<string, unknown> }[] = [];
  const created: unknown[] = [];

  const prisma = {
    client: {
      shipment: {
        findMany: jest.fn().mockResolvedValue(
          ctx.candidates ?? [
            {
              id: 'ship-1',
              awbNumber: 'AWB1',
              courierCode: 'delhivery',
              courierAccountId: 'dl-1',
            },
          ],
        ),
      },
      ndrActionRequest: {
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          created.push(args.data);
          return Promise.resolve({ id: 'req-1' });
        }),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          updates.push(args as { data: Record<string, unknown> });
          return Promise.resolve({});
        }),
      },
    },
  };

  const listNdr = jest.fn().mockResolvedValue([]);

  const svc = new NdrRunnerService(
    prisma as never,
    {
      runnerEnabled: jest.fn().mockResolvedValue(ctx.enabled ?? true),
      autoActions: jest.fn().mockResolvedValue(ctx.autoActions ?? ['RE-ATTEMPT']),
      batchMax: jest.fn().mockResolvedValue(50),
    } as never,
    {
      resolve: jest.fn().mockResolvedValue({
        nslCode: 'STALE-CODE',
        attemptCount: ctx.attemptCount ?? 1,
        source: 'LOCAL_DELIVERY_ATTEMPTS',
      }),
    } as never,
    { fetchTracking } as never,
    {
      checkEligibility: jest
        .fn()
        .mockReturnValue(
          ctx.eligible === false
            ? { eligible: false, reason: 'NSL_NOT_ELIGIBLE' }
            : { eligible: true },
        ),
      takeAction,
    } as never,
    // The Shiprocket NDR list. Every fixture here is Delhivery, so it
    // asserts by never being consulted.
    { listNdr: listNdr } as never,
    // The guard is per courier now; these fixtures answer the same for
    // whichever code it is asked about.
    { liveWritesEnabled: jest.fn().mockResolvedValue(ctx.liveWrites ?? true) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { svc, takeAction, fetchTracking, created, listNdr, updates };
}

describe('NdrRunnerService — the gates', () => {
  it('GATE 1: the kill switch stops everything, and says so', async () => {
    const { svc, takeAction } = make({ enabled: false });
    const out = await svc.run();
    expect(out.enabled).toBe(false);
    expect(takeAction).not.toHaveBeenCalled();
  });

  it('GATE 3: live writes off submits NOTHING', async () => {
    const { svc, takeAction } = make({ liveWrites: false });
    const out = await svc.run();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.submitted).toBe(0);
    expect(out.dryRun).toBe(true);
  });

  it('GATE 3 is a DRY RUN, not a no-op — it still reads and still plans', async () => {
    // The point of the dry run: `DELIVERY_ATTEMPTED` is a GUESS at
    // Delhivery's "must be in Pending", and a wrong guess fails silently
    // in both directions. The plan is what makes it answerable against
    // real parcels without enabling a write.
    const { svc, fetchTracking } = make({ liveWrites: false });
    const out = await svc.run();
    expect(fetchTracking).toHaveBeenCalledTimes(1);
    expect(out.plan).toHaveLength(1);
    expect(out.plan[0]).toMatchObject({
      awbNumber: 'AWB1',
      disposition: 'WOULD_SUBMIT',
      nslCode: 'EOD-74', // the FRESH code, not the cached 'STALE-CODE'
      attemptCount: 1,
    });
  });

  it('a dry-run plan records SKIPPED parcels with their reason too', async () => {
    // "Why was this parcel not picked up" is half the question the plan
    // exists to answer — a plan of only the selected ones cannot show
    // that the selection rule is too narrow.
    const { svc } = make({ liveWrites: false, eligible: false });
    const out = await svc.run();
    expect(out.plan[0]).toMatchObject({ disposition: 'SKIPPED', reason: 'NSL_NOT_ELIGIBLE' });
  });

  it('GATE 2: an empty auto list PREPARES but does not send — the shipped default', async () => {
    // The seeded default is []. If this ever sends, the first unattended
    // night sends everything.
    const { svc, takeAction } = make({ autoActions: [] });
    const out = await svc.run();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.heldForOperator).toBe(1);
    expect(out.reasons['HELD_NOT_ON_AUTO_LIST']).toBe(1);
  });

  it('submits when all three gates are open', async () => {
    const { svc, takeAction } = make();
    const out = await svc.run();
    expect(takeAction).toHaveBeenCalledTimes(1);
    expect(out.submitted).toBe(1);
  });
});

describe('NdrRunnerService — the fresh-NSL rule', () => {
  it('judges eligibility on the FRESHLY FETCHED nsl, not the cached one', async () => {
    const { svc, takeAction } = make({ scans: [{ nslCode: 'EOD-74' }] });
    await svc.run();
    // The cached row says STALE-CODE; the live read says EOD-74. If the
    // cached value reaches the courier we are submitting against a stale
    // NSL, which is the exact failure this rule exists to prevent.
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ currentNslCode: 'EOD-74' }),
      expect.anything(),
    );
  });

  it('takes the LATEST scan carrying a code, not the first', async () => {
    // Scans arrive oldest-first and informational ones carry no code.
    const { svc, takeAction } = make({
      scans: [{ nslCode: 'EOD-11' }, { nslCode: null }, { nslCode: 'EOD-74' }, { nslCode: '' }],
    });
    await svc.run();
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ currentNslCode: 'EOD-74' }),
      expect.anything(),
    );
  });

  it('SKIPS a parcel whose tracking read failed — never falls back to the cached NSL', async () => {
    // Falling back would be invisible: the submission looks identical to
    // a good one, and only the courier's rejection would hint at it.
    const { svc, takeAction } = make({ trackingThrows: true });
    const out = await svc.run();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.reasons['TRACKING_READ_FAILED']).toBe(1);
  });

  it('skips a parcel with no scans at all rather than guessing', async () => {
    const { svc, takeAction } = make({ scans: [] });
    const out = await svc.run();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.reasons['TRACKING_READ_FAILED']).toBe(1);
  });

  it('respects the courier eligibility verdict', async () => {
    const { svc, takeAction } = make({ eligible: false });
    const out = await svc.run();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.reasons['NSL_NOT_ELIGIBLE']).toBe(1);
  });

  it('records the request BEFORE calling out — visible-vs-silent ordering', async () => {
    // If the call is made and we crash, the row must already exist or
    // the poller has nothing to find and a van went out unrecorded.
    const { svc, created, takeAction } = make();
    const order: string[] = [];
    takeAction.mockImplementation(() => {
      order.push('call');
      return Promise.resolve({ success: true, uplId: 'u', message: 'ok' });
    });
    await svc.run();
    expect(created.length).toBe(1);
    expect(order).toEqual(['call']);
  });
});

/**
 * The runner sweeps every parcel in DELIVERY_ATTEMPTED, whoever carries
 * it. Before this it read the fresh NSL from Delhivery for all of them,
 * so a Shiprocket parcel came back with no scans and was skipped as
 * TRACKING_READ_FAILED — silently, every night, forever. A gap that
 * shows up only as re-attempts nobody ever asked for.
 */
describe('NdrRunnerService — Shiprocket parcels are swept too', () => {
  const SR = {
    id: 'ship-sr',
    awbNumber: 'SR1',
    courierCode: 'shiprocket',
    courierAccountId: 'sr-1',
  };

  it('reads their NDR list instead of asking Delhivery for a Shiprocket AWB', async () => {
    const { svc, takeAction, fetchTracking, listNdr } = make({ candidates: [SR] });
    listNdr.mockResolvedValue([
      { awbNumber: 'SR1', attemptCount: 1, reason: 'customer unavailable' },
    ]);

    await svc.run();

    // Delhivery has never heard of this waybill; asking would return
    // nothing and read as "no scans yet".
    expect(fetchTracking).not.toHaveBeenCalled();
    expect(listNdr).toHaveBeenCalledWith('sr-1');
    expect(takeAction).toHaveBeenCalledTimes(1);
    expect((takeAction.mock.calls[0]?.[0] as { courierCode: string }).courierCode).toBe(
      'shiprocket',
    );
  });

  it('skips a parcel Shiprocket no longer considers failed', async () => {
    const { svc, takeAction, listNdr } = make({ candidates: [SR] });
    // Absent from their list means it moved on. Re-attempting would
    // send a van for something already resolved.
    listNdr.mockResolvedValue([]);

    const out = await svc.run();

    expect(takeAction).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
  });

  it('fetches their list ONCE per account, not once per parcel', async () => {
    const { svc, listNdr } = make({
      candidates: [SR, { ...SR, id: 'ship-sr2', awbNumber: 'SR2' }],
    });
    listNdr.mockResolvedValue([
      { awbNumber: 'SR1', attemptCount: 1, reason: null },
      { awbNumber: 'SR2', attemptCount: 1, reason: null },
    ]);

    await svc.run();

    // One call answers for every parcel on the account; per-parcel would
    // turn a sweep of two hundred into two hundred requests.
    expect(listNdr).toHaveBeenCalledTimes(1);
  });

  it('skips a Shiprocket parcel with no account rather than guessing one', async () => {
    const { svc, takeAction, listNdr } = make({
      candidates: [{ ...SR, courierAccountId: null }],
    });

    const out = await svc.run();

    expect(listNdr).not.toHaveBeenCalled();
    expect(takeAction).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
  });
});

/**
 * Delhivery answers asynchronously and hands back a UPL id to poll;
 * Shiprocket answers synchronously, so its reply IS the outcome. The
 * row has to record that difference at submit time, because the UPL
 * poller reads a missing handle as "the submit produced nothing" —
 * marking a re-attempt that actually worked as FAILED and escalating it
 * to a human.
 */
describe('NdrRunnerService — a synchronous courier has nothing to poll', () => {
  const SR = {
    id: 'ship-sr',
    awbNumber: 'SR1',
    courierCode: 'shiprocket',
    courierAccountId: 'sr-1',
  };

  it('CONFIRMS a successful submit that returned no UPL id', async () => {
    const { svc, takeAction, listNdr, updates } = make({ candidates: [SR] });
    listNdr.mockResolvedValue([{ awbNumber: 'SR1', attemptCount: 1, reason: null }]);
    takeAction.mockResolvedValue({ success: true, awbNumber: 'SR1', uplId: null, message: 'ok' });

    const out = await svc.run();

    expect(out.submitted).toBe(1);
    const written = updates.find((u) => u.data['uplId'] === null);
    expect(written?.data['status']).toBe('CONFIRMED');
  });

  it('leaves a Delhivery submit SUBMITTED, because its UPL is real and pollable', async () => {
    const { svc, takeAction, updates } = make({});
    takeAction.mockResolvedValue({
      success: true,
      awbNumber: 'AWB1',
      uplId: 'UPL-1',
      message: null,
    });

    const out = await svc.run();

    expect(out.submitted).toBe(1);
    const written = updates.find((u) => u.data['uplId'] === 'UPL-1');
    // No status change: the poller owns the outcome from here.
    expect(written?.data['status']).toBeUndefined();
  });
});
