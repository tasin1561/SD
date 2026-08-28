import {
  CourierNdrDispatchService,
  type NdrDispatchInput,
} from '../../src/modules/courier-ops/services/courier-ndr-dispatch.service';
import type { DelhiveryNdrService } from '../../src/modules/courier-delhivery/services/delhivery-ndr.service';
import type { ShiprocketNdrService } from '../../src/modules/courier-shiprocket/services/shiprocket-ndr.service';
import { ActorType } from '@skydrop/db';

type AnyArgs = any;

const ACTOR = { type: ActorType.SYSTEM };

function input(over: Partial<NdrDispatchInput> = {}): NdrDispatchInput {
  return {
    courierCode: 'delhivery',
    courierAccountId: 'acc-1',
    awbNumber: 'AWB123',
    action: 'RE-ATTEMPT',
    currentNslCode: 'EOD-74',
    attemptCount: 1,
    comment: 'Customer asked for a retry tomorrow',
    ...over,
  };
}

function makeService(opts: { delhivery?: AnyArgs; shiprocket?: AnyArgs } = {}) {
  const dlTake = jest.fn<Promise<AnyArgs>, [AnyArgs, AnyArgs]>(
    async () =>
      opts.delhivery ?? { success: true, awbNumber: 'AWB123', uplId: 'UPL1', message: null },
  );
  const dlEligible = jest.fn<AnyArgs, [AnyArgs]>(() => ({ eligible: true, reason: null }));
  const srTake = jest.fn<Promise<AnyArgs>, [AnyArgs]>(
    async () => opts.shiprocket ?? { success: true, awbNumber: 'AWB123', message: 'ok', raw: null },
  );
  const srEligible = jest.fn<AnyArgs, [AnyArgs]>(() => ({ eligible: true, reason: null }));

  const svc = new CourierNdrDispatchService(
    { takeAction: dlTake, checkEligibility: dlEligible } as unknown as DelhiveryNdrService,
    { takeAction: srTake, checkEligibility: srEligible } as unknown as ShiprocketNdrService,
  );
  return { svc, dlTake, dlEligible, srTake, srEligible };
}

/**
 * The point of this layer is that an operator clicking "re-attempt" gets
 * the same thing whichever company has the parcel — and that where the
 * two genuinely differ, the difference stays VISIBLE rather than being
 * flattened into a shape that lies about one of them.
 */
describe('CourierNdrDispatchService', () => {
  it('routes to the courier that actually has the parcel', async () => {
    const { svc, dlTake, srTake } = makeService();

    await svc.takeAction(input({ courierCode: 'delhivery' }), ACTOR);
    expect(dlTake).toHaveBeenCalledTimes(1);
    expect(srTake).not.toHaveBeenCalled();

    await svc.takeAction(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(srTake).toHaveBeenCalledTimes(1);
    expect(dlTake).toHaveBeenCalledTimes(1);
  });

  it("keeps Delhivery's UPL id and reports null for Shiprocket, which has none", async () => {
    const { svc } = makeService();

    // Delhivery decides asynchronously: the id is how the outcome is
    // polled, so dropping it would make a refused re-attempt look
    // identical to one that worked.
    const dl = await svc.takeAction(input({ courierCode: 'delhivery' }), ACTOR);
    expect(dl.uplId).toBe('UPL1');

    // Shiprocket answers synchronously. Inventing an id here would give
    // the poller something it can never resolve.
    const sr = await svc.takeAction(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(sr.uplId).toBeNull();
    expect(sr.success).toBe(true);
  });

  it('refuses a Shiprocket action with no account recorded, without calling them', async () => {
    const { svc, srTake } = makeService();
    const r = await svc.takeAction(
      input({ courierCode: 'shiprocket', courierAccountId: null }),
      ACTOR,
    );
    // Their API is per-account; with no account there is no credential
    // to call with, and guessing one would act on the wrong contract.
    expect(srTake).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toContain('No Shiprocket account');
  });

  it('a manual courier is refused with something an operator can act on', async () => {
    const { svc, dlTake, srTake } = makeService();
    const r = await svc.takeAction(input({ courierCode: 'bluedart' }), ACTOR);

    expect(dlTake).not.toHaveBeenCalled();
    expect(srTake).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    // Not "unsupported courier" — the operator can still fix this, by
    // phoning them.
    expect(r.message).toContain('by hand');
  });

  it('checks eligibility before spending a Shiprocket call', async () => {
    const { svc, srTake, srEligible } = makeService();
    srEligible.mockReturnValueOnce({ eligible: false, reason: 'Already re-attempted 2 times' });

    const r = await svc.takeAction(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(srTake).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toBe('Already re-attempted 2 times');
  });

  it("maps PICKUP_RESCHEDULE onto Shiprocket's return, because they have no reschedule", async () => {
    const { svc, srTake } = makeService();
    await svc.takeAction(input({ courierCode: 'shiprocket', action: 'PICKUP_RESCHEDULE' }), ACTOR);
    // The nearest honest thing. Sending it as a re-attempt would tell a
    // seller their parcel is being retried when it is coming back.
    expect((srTake.mock.calls[0]?.[0] as AnyArgs).action).toBe('RETURN');
  });

  it('eligibility for a manual courier is refused rather than assumed true', () => {
    const { svc } = makeService();
    const v = svc.checkEligibility(input({ courierCode: 'bluedart' }));
    // A button that looks enabled and then cannot do anything is worse
    // than one that explains itself.
    expect(v.eligible).toBe(false);
  });
});
