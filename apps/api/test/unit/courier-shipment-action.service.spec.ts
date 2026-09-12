import { BadRequestException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { CourierShipmentActionService } from '../../src/modules/courier-ops/services/courier-shipment-action.service';
import { DelhiveryNdrService } from '../../src/modules/courier-delhivery/services/delhivery-ndr.service';
import type { ShipmentCourierContext } from '../../src/modules/courier-ops/services/shipment-courier-context.service';
import { courierActor } from '../../src/modules/courier-shared/services/courier-credential.service';

const SHIPMENT_ID = '0198f3c2-0000-7000-8000-00000000ship';
const AWB = '38061110478262';

function ctx(over: Partial<ShipmentCourierContext> = {}): ShipmentCourierContext {
  return {
    shipmentId: SHIPMENT_ID,
    shipmentNumber: 'SH-2026-07-000001',
    awbNumber: AWB,
    courierCode: 'delhivery',
    courierAccountId: 'dl-acc-1',
    courierShipmentId: null,
    courierOrderId: null,
    isManualCourier: false,
    destination: {
      name: 'A Customer',
      addressLine1: '14 MG Road',
      addressLine2: 'near the water tank',
      city: 'Bengaluru',
      stateProvince: 'Karnataka',
      postalCode: '560001',
      phoneE164: '+919876543210',
      email: null,
    },
    currentNslCode: null,
    courierCancelledAt: null,
    status: ShipmentStatus.OUT_FOR_DELIVERY,
    originPin: '110042',
    destinationPin: '560001',
    chargeableWeightGrams: 1500,
    declaredValueInr: '2400.00',
    codAmountInr: '2400.00',
    isCod: true,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    orderId: 'order-1',
    ...over,
  };
}

interface Deps {
  svc: CourierShipmentActionService;
  edit: jest.Mock;
  cancel: jest.Mock;
  ndrTakeAction: jest.Mock;
  ewaybillUpdate: jest.Mock;
  audit: jest.Mock;
  /** shipment.updateMany — the courier-cancel stamp. */
  stamp: jest.Mock;
  /** The context resolver, to see whether voided shipments were asked for. */
  resolve: jest.Mock;
}

function make(
  opts: {
    context?: Partial<ShipmentCourierContext>;
    latestAttempt?: { courierNslCode: string | null; attemptNumber: number } | null;
    /** Production, with this courier answering from its stub. */
    stubbed?: boolean;
    /** The cancel claim is held by somebody else. */
    claimTaken?: boolean;
  } = {},
): Deps {
  const audit = jest.fn(async () => undefined);
  const edit = jest.fn<Promise<{ success: boolean; message: string | null }>, [unknown, unknown]>(
    async () => ({
      success: true,
      awbNumber: AWB,
      message: 'ok',
      raw: null,
    }),
  );
  const cancel = jest.fn<Promise<{ success: boolean; message: string | null }>, [string, unknown]>(
    async () => ({
      success: true,
      awbNumber: AWB,
      message: 'cancelled',
      raw: null,
    }),
  );
  const ndrTakeAction = jest.fn(async () => ({
    success: true,
    awbNumber: AWB,
    uplId: 'upl-123',
    message: 'accepted for processing',
    raw: null,
  }));
  const ewaybillUpdate = jest.fn(async () => ({
    success: true,
    awbNumber: AWB,
    message: 'ok',
    raw: null,
  }));

  const deliveryAttemptFindFirst = jest.fn(async () => opts.latestAttempt ?? null);

  // Every shipment.updateMany: the cancel CLAIM, the stamp, the release.
  const stamp = jest.fn(async (a: { data: Record<string, unknown> }) => ({
    count:
      opts.claimTaken &&
      'courierCancelStartedAt' in a.data &&
      a.data.courierCancelStartedAt !== null
        ? 0
        : 1,
  }));
  const prisma = {
    client: {
      deliveryAttempt: { findFirst: deliveryAttemptFindFirst },
      shipment: { updateMany: stamp },
    },
  };
  const contextSvc = { resolve: jest.fn(async () => ctx(opts.context ?? {})) };

  // The REAL eligibility logic — the whole point of the test is that the
  // NSL table is consulted, so mocking it would test nothing.
  const realNdr = new DelhiveryNdrService({} as never, {} as never);
  const ndr = {
    checkEligibility: realNdr.checkEligibility.bind(realNdr),
    takeAction: ndrTakeAction,
    checkStatus: jest.fn(),
  };

  const svc = new CourierShipmentActionService(
    prisma as never,
    { log: audit } as never,
    contextSvc as never,
    // Cancel and edit both go through the courier-agnostic dispatcher
    // now. The double forwards to the SAME mocks so every existing
    // assertion keeps meaning what it did — including the ones that
    // assert the courier was never called at all.
    {
      isStubbedInProduction: async () => opts.stubbed ?? false,
      cancel: (
        _courierCode: string,
        _accountId: string | null,
        awbNumber: string,
        actor: unknown,
      ) => cancel(awbNumber, actor),
      edit: (input: Record<string, unknown>, actor: unknown) => {
        // The dispatcher takes routing fields the Delhivery service
        // never saw; strip them so the existing payload assertions
        // still compare like for like.
        const { courierCode, courierAccountId, courierShipmentId, ...rest } = input;
        void courierCode;
        void courierAccountId;
        void courierShipmentId;
        return edit(rest, actor);
      },
    } as never,
    { requiresEwaybill: (v: number) => v > 50_000, update: ewaybillUpdate } as never,
    ndr as never,
  );
  return {
    svc,
    edit,
    cancel,
    ndrTakeAction,
    ewaybillUpdate,
    audit,
    stamp,
    resolve: contextSvc.resolve,
  };
}

const CLIENT = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

/**
 * The NDR gate is the reason the NSL code is now persisted. Delhivery
 * refuses an ineligible re-attempt, so checking locally is the
 * difference between an operator seeing "not eligible: the parcel is
 * marked address-incorrect" and seeing a raw courier rejection.
 */
describe('CourierShipmentActionService — NDR readiness', () => {
  it('is eligible on a re-attemptable NSL within the attempt limit', async () => {
    const { svc } = make({
      latestAttempt: { courierNslCode: 'EOD-74', attemptNumber: 1 },
    });
    const r = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(r.eligible).toBe(true);
    expect(r.nslCode).toBe('EOD-74');
    expect(r.attemptCount).toBe(1);
  });

  it('refuses when we never captured an NSL — acting blind earns a rejection', async () => {
    // This is the pre-fix world: the parser dropped the code, so every
    // shipment looked like this and no re-attempt could be made safely.
    const { svc } = make({
      latestAttempt: { courierNslCode: null, attemptNumber: 1 },
    });
    const r = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no current nsl code/i);
  });

  it('refuses an NSL that Delhivery does not accept for a re-attempt', async () => {
    const { svc } = make({
      latestAttempt: { courierNslCode: 'EOD-999', attemptNumber: 1 },
    });
    const r = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain('EOD-999');
  });

  it('refuses past the third failure — Delhivery allows attempts 1 and 2 only', async () => {
    const { svc } = make({
      latestAttempt: { courierNslCode: 'EOD-74', attemptNumber: 3 },
    });
    const r = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/attempt count 3/i);
  });

  it('reports not-eligible rather than throwing when there is no AWB', async () => {
    const { svc } = make({ context: { awbNumber: null } });
    const r = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no awb/i);
  });
});

describe('CourierShipmentActionService — NDR action', () => {
  it('returns the UPL id and does NOT claim the re-attempt succeeded', async () => {
    // Delhivery answers asynchronously. Reporting "re-attempt booked"
    // off this response would tell a seller their parcel is being
    // retried when it may yet be refused.
    const { svc, ndrTakeAction } = make({
      latestAttempt: { courierNslCode: 'EOD-74', attemptNumber: 1 },
    });
    const out = await svc.takeNdrAction('staff-1', SHIPMENT_ID, 'RE-ATTEMPT', CLIENT);
    expect(out.uplId).toBe('upl-123');
    expect(out.nslCode).toBe('EOD-74');
    expect(ndrTakeAction).toHaveBeenCalledWith(
      expect.objectContaining({ currentNslCode: 'EOD-74', attemptCount: 1 }),
      // The actor is the point of the second argument: an NDR re-attempt
      // sends a real van, and CUR-10 as amended distinguishes an operator
      // doing that from a runner doing it. Asserting the SHAPE here means
      // a refactor that drops attribution fails a behavioural test too,
      // not only the structural one.
      expect.objectContaining({
        type: 'STAFF',
        id: 'staff-1',
        trigger: { kind: 'OPERATOR', staffId: 'staff-1' },
      }),
    );
  });

  it('audits who asked, on which parcel, with which code', async () => {
    const { svc, audit } = make({
      latestAttempt: { courierNslCode: 'EOD-74', attemptNumber: 2 },
    });
    await svc.takeNdrAction('staff-1', SHIPMENT_ID, 'RE-ATTEMPT', CLIENT);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.shipment.ndr_action',
        staffUserId: 'staff-1',
        entityId: SHIPMENT_ID,
        metadata: expect.objectContaining({ nslCode: 'EOD-74', uplId: 'upl-123' }),
      }),
    );
  });
});

describe('CourierShipmentActionService — guards before the wire', () => {
  it('refuses to act on a parcel with no AWB', async () => {
    const { svc, cancel } = make({ context: { awbNumber: null } });
    await expect(
      svc.cancelWithCourier(
        courierActor.operator('staff-1'),
        SHIPMENT_ID,
        'customer changed mind',
        CLIENT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a manually-placed parcel — that courier is not integrated', async () => {
    const { svc, cancel } = make({ context: { isManualCourier: true } });
    await expect(
      svc.cancelWithCourier(
        courierActor.operator('staff-1'),
        SHIPMENT_ID,
        'customer changed mind',
        CLIENT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses an empty edit rather than sending a no-op to the courier', async () => {
    const { svc, edit } = make();
    await expect(svc.editDestination('staff-1', SHIPMENT_ID, {}, CLIENT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it('audits a cancel at HIGH — a moving parcel becomes a return, which costs a leg', async () => {
    const { svc, audit } = make();
    await svc.cancelWithCourier(
      courierActor.operator('staff-1'),
      SHIPMENT_ID,
      'seller withdrew',
      CLIENT,
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.shipment.cancelled',
        severity: 'HIGH',
      }),
    );
  });

  it('logs which recipient fields changed, never their values', async () => {
    // An audit row is not the place for a customer's address.
    const { svc, audit } = make();
    await svc.editDestination(
      'staff-1',
      SHIPMENT_ID,
      { address: '12 Residency Road, Bengaluru', phone: '+919812345678' },
      CLIENT,
    );
    const call = audit.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(call.metadata.fieldsChanged).toEqual(['address', 'phone']);
    expect(JSON.stringify(call.metadata)).not.toContain('Residency Road');
    expect(JSON.stringify(call.metadata)).not.toContain('9812345678');
  });
});

/** The refusal's `code`, or null when the call did not throw. */
async function refusalCode(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as BadRequestException).getResponse();
  }
}

/**
 * A cancelled order's shipment is VOIDED locally, but its waybill —
 * booked and charged at confirmation (CUR-2b) — stays live with the
 * courier until it is cancelled with them, and only then is the charge
 * credited back. Cancelling it is the one courier action a voided
 * shipment still accepts, and a success is RECORDED so the sweep can
 * tell done from not done.
 */
describe('CourierShipmentActionService — a voided shipment’s waybill', () => {
  const VOIDED = { status: ShipmentStatus.CANCELLED };

  it('cancels the live waybill of a shipment voided with its order, and records it', async () => {
    const { svc, cancel, stamp, resolve, audit } = make({ context: VOIDED });
    const r = await svc.cancelWithCourier(
      courierActor.operator('staff-1'),
      SHIPMENT_ID,
      'order cancelled before pickup',
      CLIENT,
    );
    expect(r.success).toBe(true);
    // It had to ask for voided shipments — the ordinary lookup hides them.
    expect(resolve).toHaveBeenCalledWith(SHIPMENT_ID, { includeVoided: true });
    expect(cancel).toHaveBeenCalledWith(AWB, expect.anything());
    // Guarded on the stamp being empty, so a second success cannot move it.
    expect(stamp).toHaveBeenCalledWith({
      where: { id: SHIPMENT_ID, courierCancelledAt: null },
      data: { courierCancelledAt: expect.any(Date), courierCancelStartedAt: null },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.shipment.cancelled',
        severity: 'HIGH',
        metadata: expect.objectContaining({
          voidedShipment: true,
          courierCancelRecorded: true,
          orderId: 'order-1',
        }),
      }),
    );
  });

  it('records nothing when the courier refuses — the waybill is still live', async () => {
    const { svc, cancel, stamp } = make({ context: VOIDED });
    cancel.mockResolvedValueOnce({ success: false, message: 'Shipment already manifested' });
    const r = await svc.cancelWithCourier(
      courierActor.operator('staff-1'),
      SHIPMENT_ID,
      'order cancelled before pickup',
      CLIENT,
    );
    expect(r.success).toBe(false);
    // The claim was taken and released; nothing was STAMPED cancelled.
    const stamped = stamp.mock.calls.filter((c) => c[0].data.courierCancelledAt !== undefined);
    expect(stamped).toEqual([]);
  });

  it('in production, refuses a STUBBED courier — its "cancelled" reached nobody', async () => {
    // A stub reports success before any guard; recording that would mark
    // a live, charged waybill closed.
    const { svc, cancel, stamp } = make({ context: VOIDED, stubbed: true });
    expect(
      await refusalCode(
        svc.cancelWithCourier(
          courierActor.operator('staff-1'),
          SHIPMENT_ID,
          'x'.repeat(12),
          CLIENT,
        ),
      ),
    ).toMatchObject({ code: 'COURIER_STUBBED' });
    expect(cancel).not.toHaveBeenCalled();
    expect(stamp).not.toHaveBeenCalled();
  });

  it('CLAIMS before calling: a second operator mid-cancel is refused and the courier asked once', async () => {
    const { svc, cancel } = make({ context: VOIDED, claimTaken: true });
    expect(
      await refusalCode(
        svc.cancelWithCourier(
          courierActor.operator('staff-2'),
          SHIPMENT_ID,
          'x'.repeat(12),
          CLIENT,
        ),
      ),
    ).toMatchObject({ code: 'WAYBILL_CANCEL_IN_PROGRESS' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('the claim is guarded (unstamped, free or stale) and released after the call', async () => {
    const { svc, stamp } = make({ context: VOIDED });
    await svc.cancelWithCourier(
      courierActor.operator('staff-1'),
      SHIPMENT_ID,
      'order cancelled before pickup',
      CLIENT,
    );
    const claim = stamp.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(claim.where).toMatchObject({ id: SHIPMENT_ID, courierCancelledAt: null });
    expect(claim.where.OR).toEqual([
      { courierCancelStartedAt: null },
      { courierCancelStartedAt: { lt: expect.any(Date) } },
    ]);
    expect(claim.data).toEqual({ courierCancelStartedAt: expect.any(Date) });
    const release = stamp.mock.calls.at(-1)![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(release).toEqual({
      where: { id: SHIPMENT_ID, courierCancelStartedAt: claim.data.courierCancelStartedAt },
      data: { courierCancelStartedAt: null },
    });
  });

  it('a courier call that THROWS releases the claim, so the next attempt is not locked out', async () => {
    const { svc, cancel, stamp } = make({ context: VOIDED });
    cancel.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(
      svc.cancelWithCourier(courierActor.operator('staff-1'), SHIPMENT_ID, 'x'.repeat(12), CLIENT),
    ).rejects.toThrow('socket hang up');
    const last = stamp.mock.calls.at(-1)![0] as unknown as { data: Record<string, unknown> };
    expect(last.data).toEqual({ courierCancelStartedAt: null });
  });

  it('records a waybill cancelled OUTSIDE Skydrop without calling the courier, audited HIGH', async () => {
    const { svc, cancel, stamp, audit } = make({ context: VOIDED });
    const r = await svc.recordCancelledOutside(
      'staff-1',
      SHIPMENT_ID,
      'cancelled in the Delhivery portal',
      CLIENT,
    );
    expect(r.success).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(stamp).toHaveBeenCalledWith({
      where: { id: SHIPMENT_ID, courierCancelledAt: null },
      data: { courierCancelledAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.shipment.cancel_recorded_outside',
        severity: 'HIGH',
        metadata: expect.objectContaining({ courierCalled: false }),
      }),
    );
  });

  it('refuses to record an outside cancel on a LIVE (non-voided) parcel', async () => {
    const { svc, stamp } = make({});
    expect(
      await refusalCode(svc.recordCancelledOutside('staff-1', SHIPMENT_ID, 'x'.repeat(12), CLIENT)),
    ).toMatchObject({ code: 'NOT_A_VOIDED_SHIPMENT' });
    expect(stamp).not.toHaveBeenCalled();
  });

  it('refuses to record an outside cancel twice', async () => {
    const { svc } = make({
      context: { ...VOIDED, courierCancelledAt: new Date('2026-09-12T10:00:00Z') },
    });
    expect(
      await refusalCode(svc.recordCancelledOutside('staff-1', SHIPMENT_ID, 'x'.repeat(12), CLIENT)),
    ).toMatchObject({ code: 'WAYBILL_ALREADY_CANCELLED' });
  });

  it('refuses a voided shipment that never had a waybill — nothing at the courier', async () => {
    const { svc, cancel } = make({ context: { ...VOIDED, awbNumber: null } });
    expect(
      await refusalCode(
        svc.cancelWithCourier(
          courierActor.operator('staff-1'),
          SHIPMENT_ID,
          'x'.repeat(12),
          CLIENT,
        ),
      ),
    ).toMatchObject({ code: 'SHIPMENT_HAS_NO_AWB' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a waybill already cancelled with the courier rather than asking again', async () => {
    const { svc, cancel } = make({
      context: { ...VOIDED, courierCancelledAt: new Date('2026-09-12T10:00:00Z') },
    });
    expect(
      await refusalCode(
        svc.cancelWithCourier(
          courierActor.operator('staff-1'),
          SHIPMENT_ID,
          'x'.repeat(12),
          CLIENT,
        ),
      ),
    ).toMatchObject({ code: 'WAYBILL_ALREADY_CANCELLED' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a manual courier waybill — there is no courier account to cancel it on', async () => {
    const { svc, cancel } = make({ context: { ...VOIDED, isManualCourier: true } });
    expect(
      await refusalCode(
        svc.cancelWithCourier(
          courierActor.operator('staff-1'),
          SHIPMENT_ID,
          'x'.repeat(12),
          CLIENT,
        ),
      ),
    ).toMatchObject({ code: 'MANUAL_COURIER_SHIPMENT' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('every OTHER action still refuses a voided shipment', async () => {
    const { svc, edit, resolve } = make({ context: VOIDED });
    expect(
      await refusalCode(svc.editDestination('staff-1', SHIPMENT_ID, { name: 'New' }, CLIENT)),
    ).toMatchObject({ code: 'SHIPMENT_CANCELLED' });
    expect(resolve).toHaveBeenCalledWith(SHIPMENT_ID, { includeVoided: false });
    expect(edit).not.toHaveBeenCalled();
  });
});

describe('CourierShipmentActionService — e-way bill', () => {
  it('flags the legal requirement above ₹50,000', async () => {
    const { svc } = make({ context: { declaredValueInr: '75000.00' } });
    const r = await svc.ewaybillRequirement(SHIPMENT_ID);
    expect(r.required).toBe(true);
    expect(r.thresholdInr).toBe(50_000);
  });

  it('does not require one at or below the threshold', async () => {
    const { svc } = make({ context: { declaredValueInr: '50000.00' } });
    expect((await svc.ewaybillRequirement(SHIPMENT_ID)).required).toBe(false);
  });

  it('still accepts a number below the threshold — the operator may know better', async () => {
    const { svc, ewaybillUpdate } = make({
      context: { declaredValueInr: '1000.00' },
    });
    await svc.attachEwaybill(
      'staff-1',
      SHIPMENT_ID,
      { invoiceNumber: 'INV-1', ewaybillNumber: 'EWB-1' },
      CLIENT,
    );
    expect(ewaybillUpdate).toHaveBeenCalled();
  });
});

describe('NDR readiness reads the SHIPMENT’s current NSL', () => {
  /**
   * The production bug this closes.
   *
   * Delhivery permits a RE-ATTEMPT only when the shipment's CURRENT NSL
   * is in their allow-list. We looked for it on the latest
   * delivery_attempt, which held whatever the per-scan NSL was — and the
   * Track API never sends one, because Delhivery puts NSLCode at the
   * SHIPMENT level. So the field was null on every parcel and the panel
   * answered "No current NSL code known for this shipment" for all of
   * them. Verified against the live endpoint on 2026-09-01, which said
   * exactly that.
   */
  it('uses the shipment’s NSL when the attempt row has none', async () => {
    const { svc } = make({
      context: ctx({ currentNslCode: 'EOD-74' }),
      latestAttempt: { courierNslCode: null, attemptNumber: 1 },
    });
    const out = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(out.nslCode).toBe('EOD-74');
    expect(out.eligible).toBe(true);
  });

  it('prefers the shipment’s NSL over a stale one on the attempt', async () => {
    // The attempt row is a snapshot of what was true when it was
    // written; the shipment carries what is true now, and "now" is the
    // question Delhivery asks.
    const { svc } = make({
      context: ctx({ currentNslCode: 'EOD-74' }),
      latestAttempt: { courierNslCode: 'X-UCI', attemptNumber: 2 },
    });
    const out = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(out.nslCode).toBe('EOD-74');
  });

  it('still falls back to the attempt row when the shipment has none', async () => {
    // Parcels tracked before the shipment-level read existed, and any
    // courier that reports the NSL per scan rather than per parcel.
    const { svc } = make({
      context: ctx({ currentNslCode: null }),
      latestAttempt: { courierNslCode: 'EOD-15', attemptNumber: 1 },
    });
    const out = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(out.nslCode).toBe('EOD-15');
  });

  it('refuses honestly when neither has one', async () => {
    const { svc } = make({
      context: ctx({ currentNslCode: null }),
      latestAttempt: { courierNslCode: null, attemptNumber: 0 },
    });
    const out = await svc.ndrReadiness(SHIPMENT_ID, 'RE-ATTEMPT');
    expect(out.eligible).toBe(false);
    expect(out.nslCode).toBeNull();
  });
});
