import { BadRequestException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { CourierShipmentActionService } from '../../src/modules/courier-ops/services/courier-shipment-action.service';
import { DelhiveryNdrService } from '../../src/modules/courier-delhivery/services/delhivery-ndr.service';
import type { ShipmentCourierContext } from '../../src/modules/courier-ops/services/shipment-courier-context.service';

const SHIPMENT_ID = '0198f3c2-0000-7000-8000-00000000ship';
const AWB = '38061110478262';

function ctx(over: Partial<ShipmentCourierContext> = {}): ShipmentCourierContext {
  return {
    shipmentId: SHIPMENT_ID,
    shipmentNumber: 'SH-2026-07-000001',
    awbNumber: AWB,
    courierCode: 'delhivery',
    isManualCourier: false,
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
}

function make(
  opts: {
    context?: Partial<ShipmentCourierContext>;
    latestAttempt?: { courierNslCode: string | null; attemptNumber: number } | null;
  } = {},
): Deps {
  const audit = jest.fn(async () => undefined);
  const edit = jest.fn(async () => ({
    success: true,
    awbNumber: AWB,
    message: 'ok',
    raw: null,
  }));
  const cancel = jest.fn(async () => ({
    success: true,
    awbNumber: AWB,
    message: 'cancelled',
    raw: null,
  }));
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

  const prisma = {
    client: { deliveryAttempt: { findFirst: deliveryAttemptFindFirst } },
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
    { edit, cancel } as never,
    { requiresEwaybill: (v: number) => v > 50_000, update: ewaybillUpdate } as never,
    ndr as never,
  );
  return { svc, edit, cancel, ndrTakeAction, ewaybillUpdate, audit };
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
      svc.cancelWithCourier('staff-1', SHIPMENT_ID, 'customer changed mind', CLIENT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a manually-placed parcel — that courier is not integrated', async () => {
    const { svc, cancel } = make({ context: { isManualCourier: true } });
    await expect(
      svc.cancelWithCourier('staff-1', SHIPMENT_ID, 'customer changed mind', CLIENT),
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
    await svc.cancelWithCourier('staff-1', SHIPMENT_ID, 'seller withdrew', CLIENT);
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
