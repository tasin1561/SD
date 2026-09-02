import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { AwbGenerationService } from '../../src/modules/courier-awb/services/awb-generation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { DelhiveryAwbResult } from '../../src/modules/courier-delhivery/types/delhivery.types';
import type {
  CourierAwbDispatchService,
  DispatchAwbInput,
  DispatchAwbResult,
} from '../../src/modules/courier-awb/services/courier-awb-dispatch.service';
import type { CourierAccountRoutingService } from '../../src/modules/courier-shared/services/courier-account-routing.service';
import type { CourierDistributionService } from '../../src/modules/courier-shared/services/courier-distribution.service';
import { makeTestEnv } from '../helpers/env';

type AnyArgs = Record<string, unknown>;

const SHIP = 'ship-1';

function shipmentRow(over: AnyArgs = {}): AnyArgs {
  return {
    id: SHIP,
    shipmentNumber: 'SH-2026-05-000042',
    awbNumber: null,
    courierShipmentId: null,
    courierCode: 'delhivery',
    orderShipments: [{ order: { sellerId: 'seller-1' } }],
    status: ShipmentStatus.CREATED,
    destRecipientName: 'Asha',
    destRecipientPhoneE164: '+919876543210',
    destAddressLine1: '12 MG Road',
    destAddressLine2: null,
    destCity: 'Bengaluru',
    destStateProvince: 'Karnataka',
    destPostalCode: '560001',
    destCountryCode: 'IN',
    totalWeightGrams: 500,
    declaredValueInr: { toString: () => '999.00' },
    codAmountInr: { toString: () => '999.00', greaterThan: () => true },
    originWarehouseId: 'wh-1',
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    items: [{ productName: 'Widget', quantity: 2 }],
    // M10 commit 1: CUR-9 gate considers "current awb_label" alongside
    // shipment.awbNumber. Default: no current label.
    awbLabels: [],
    ...over,
  };
}

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    awbResult?: DelhiveryAwbResult;
    priorLabelVersion?: number;
    /** Configure spaces.putObject to throw on first call. */
    putObjectThrows?: Error;
    /** Configure delhiveryLabel.fetchLabel to throw on first call. */
    fetchLabelThrows?: Error;
    /** Configure courierAccountRouting.selectAccount's result/behavior. */
    courierAccountResult?:
      | { courierAccountId: string; source: 'SELLER_LINK' | 'DEFAULT_ACCOUNT' }
      | Error;
    courierRow?: AnyArgs | null;
    /** Script the dispatcher per courier code, so a failover test can
     *  say "Shiprocket refuses, Delhivery takes it" and vice versa. */
    dispatchByCourier?: Record<string, DispatchAwbResult>;
    /** What CourierDistributionService.pickAlternate returns. */
    alternate?: { courierCode: string; courierAccountId: string } | null;
    /** Courier codes answering from a stub rather than themselves. */
    stubCouriers?: string[];
  } = {},
) {
  const shipmentFindUnique = jest.fn(async () =>
    opts.shipment === undefined ? shipmentRow() : opts.shipment,
  );
  const courierFindUnique = jest.fn(async () =>
    opts.courierRow === undefined ? { id: 'courier-1' } : opts.courierRow,
  );
  const selectAccount = jest.fn(async () => {
    if (opts.courierAccountResult instanceof Error) throw opts.courierAccountResult;
    if (opts.courierAccountResult) return opts.courierAccountResult;
    throw Object.assign(new Error('NO_COURIER_ACCOUNT_AVAILABLE'), {
      response: { code: 'NO_COURIER_ACCOUNT_AVAILABLE' },
    });
  });
  const courierAccountRouting = { selectAccount };
  const awbLabelFindFirst = jest.fn(async () =>
    opts.priorLabelVersion === undefined ? null : { version: opts.priorLabelVersion },
  );
  const txShipmentUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const txAwbLabelCreate = jest.fn(async () => ({}));
  const txAwbLabelUpdateMany = jest.fn(async () => ({ count: 0 }));
  const txClient = {
    shipment: { update: txShipmentUpdate },
    awbLabel: { create: txAwbLabelCreate, updateMany: txAwbLabelUpdateMany },
  };
  const client = {
    shipment: { findUnique: shipmentFindUnique },
    awbLabel: { findFirst: awbLabelFindFirst },
    courier: { findUnique: courierFindUnique },
  } as {
    shipment: { findUnique: typeof shipmentFindUnique };
    awbLabel: { findFirst: typeof awbLabelFindFirst };
    courier: { findUnique: typeof courierFindUnique };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const putObject = jest.fn<Promise<void>, [string, Buffer, string]>(async () => {
    if (opts.putObjectThrows) throw opts.putObjectThrows;
  });
  const spaces = { putObject };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(async () => 'a');
  const audit = { log: auditLog };
  const generateAwb = jest.fn<Promise<DelhiveryAwbResult>, [unknown]>(
    async () =>
      opts.awbResult ?? {
        ok: true,
        awbNumber: 'DLVSTUB202605000042',
        courierShipmentId: 'DLVSHP202605000042',
        labelUrl: null,
      },
  );

  // The saga no longer speaks to a courier directly — it asks the
  // dispatcher, which is the only thing that knows Delhivery takes one
  // call and Shiprocket takes two. The harness translates the legacy
  // `awbResult` fixture so the pre-failover cases still read the same.
  const generate = jest.fn<Promise<DispatchAwbResult>, [DispatchAwbInput, unknown]>(
    async (input: DispatchAwbInput) => {
      const scripted = opts.dispatchByCourier?.[input.courierCode];
      if (scripted !== undefined) return scripted;
      const r = await generateAwb(input);
      return r.ok
        ? {
            ok: true,
            awbNumber: r.awbNumber,
            courierShipmentId: r.courierShipmentId,
            serviceable: true,
            errorCode: null,
            errorMessage: null,
          }
        : {
            ok: false,
            awbNumber: null,
            courierShipmentId: null,
            serviceable: r.serviceable,
            errorCode: r.errorCode,
            errorMessage: r.errorMessage,
          };
    },
  );
  const dispatchFetchLabel = jest.fn(async () => {
    if (opts.fetchLabelThrows) throw opts.fetchLabelThrows;
    return { bytes: Buffer.from('%PDF-1.4 stub'), mimeType: 'application/pdf' };
  });
  // Which couriers are answering from a stub. Defaults to "everything
  // is live", so the existing failover tests keep exercising a real
  // failover rather than accidentally hitting the mixed-config guard.
  const isStubMode = jest.fn(async (courierCode: string) =>
    (opts.stubCouriers ?? []).includes(courierCode),
  );
  const dispatch = { generate, fetchLabel: dispatchFetchLabel, isStubMode };

  const pickAlternate = jest.fn(async () => opts.alternate ?? null);
  const distribution = { pickAlternate };

  const svc = new AwbGenerationService(
    { client } as unknown as PrismaService,
    makeTestEnv(),
    spaces as unknown as SpacesService,
    audit as unknown as AuditLogService,
    dispatch as unknown as CourierAwbDispatchService,
    distribution as unknown as CourierDistributionService,
    courierAccountRouting as unknown as CourierAccountRoutingService,
  );
  return {
    svc,
    generate,
    pickAlternate,
    isStubMode,
    putObject,
    txShipmentUpdate,
    txAwbLabelCreate,
    txAwbLabelUpdateMany,
    auditLog,
    generateAwb,
    fetchLabel: dispatchFetchLabel,
    selectAccount,
    courierFindUnique,
  };
}

/** Filter the audit-log mock calls by action name. */
function auditCalls(
  log: jest.Mock<Promise<string | null>, [Record<string, unknown>, unknown]>,
  action: string,
): Array<[Record<string, unknown>, unknown]> {
  return log.mock.calls.filter(([entry]) => (entry as { action?: string }).action === action);
}

describe('AwbGenerationService.generateForShipment', () => {
  it('GENERATED: generates AWB, persists label to Spaces, stamps shipment (tx1) + awb_labels (tx2), writes both audits', async () => {
    const {
      svc,
      putObject,
      txShipmentUpdate,
      txAwbLabelCreate,
      auditLog,
      generateAwb,
      fetchLabel,
    } = makeService();
    const r = await svc.generateForShipment(SHIP, { type: ActorType.SYSTEM });
    expect(r).toEqual({
      status: 'GENERATED',
      shipmentId: SHIP,
      awbNumber: 'DLVSTUB202605000042',
      courierShipmentId: 'DLVSHP202605000042',
      labelSpacesKey: 'awb-labels/ship-1/v1-DLVSTUB202605000042.pdf',
      labelVersion: 1,
    });
    // tx1 stamped the AWB (the source-of-truth-first write).
    expect(txShipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          awbNumber: 'DLVSTUB202605000042',
          courierShipmentId: 'DLVSHP202605000042',
        }),
      }),
    );
    // …and deliberately did NOT touch the status. The AWB is generated
    // at order confirmation now, and both warehouse queues select on
    // `status = 'created'` — advancing it here took the parcel out of
    // the pick and pack flow entirely. `awbNumber` is the authoritative
    // "has an AWB" fact (CUR-9); the status says where the parcel
    // physically is, and it moves at hand-over.
    const stampData = (txShipmentUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(stampData).not.toHaveProperty('status');
    // Phase D ran AFTER tx1: fetchLabel + putObject + tx2 awb_labels create.
    expect(fetchLabel).toHaveBeenCalledWith(
      // Now an input object, because the label has to be asked of
      // whichever courier actually carries the parcel — not of
      // Delhivery by default.
      expect.objectContaining({ awbNumber: 'DLVSTUB202605000042', courierCode: 'delhivery' }),
      // AWB generation is a queue worker, so the credential decrypt must
      // attribute to the RUNNER branch — CUR-10 as amended turns on
      // telling that apart from an operator having clicked something.
      expect.objectContaining({
        type: 'SYSTEM',
        trigger: expect.objectContaining({ kind: 'RUNNER' }),
      }),
    );
    expect(putObject).toHaveBeenCalledWith(
      'awb-labels/ship-1/v1-DLVSTUB202605000042.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(txAwbLabelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, isCurrent: true }),
      }),
    );
    // Both audits present (tx1: awb.generated; tx2: awb.label_persisted).
    expect(auditCalls(auditLog, 'awb.generated')).toHaveLength(1);
    expect(auditCalls(auditLog, 'awb.label_persisted')).toHaveLength(1);
    // Delhivery generateAwb was called exactly once (no second real call).
    expect(generateAwb).toHaveBeenCalledTimes(1);
  });

  it('CUR-9: a shipment with awbNumber AND a current awb_label is ALREADY_HAS_AWB (no Delhivery call, no upload, no DB write)', async () => {
    const { svc, generateAwb, putObject, txShipmentUpdate, fetchLabel } = makeService({
      shipment: shipmentRow({
        awbNumber: 'EXISTING-AWB',
        courierShipmentId: 'EXISTING-CS',
        awbLabels: [{ id: 'label-1' }],
      }),
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toEqual({
      status: 'ALREADY_HAS_AWB',
      shipmentId: SHIP,
      awbNumber: 'EXISTING-AWB',
    });
    expect(generateAwb).not.toHaveBeenCalled();
    expect(fetchLabel).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(txShipmentUpdate).not.toHaveBeenCalled();
  });

  it('M10 commit 1 — GENERATED_AWB_LABEL_PENDING: tx1 commits then Spaces.putObject throws → AWB durably persisted, NO awb_labels row, only awb.generated audit', async () => {
    const { svc, generateAwb, txShipmentUpdate, txAwbLabelCreate, auditLog, putObject } =
      makeService({
        putObjectThrows: new Error('SpacesUnavailable'),
      });
    const r = await svc.generateForShipment(SHIP);
    // The half-finished run is SELF-ANNOUNCING — the outcome carries
    // the AWB so the caller (job service) can throw to BullMQ.
    expect(r).toEqual({
      status: 'GENERATED_AWB_LABEL_PENDING',
      shipmentId: SHIP,
      awbNumber: 'DLVSTUB202605000042',
      courierShipmentId: 'DLVSHP202605000042',
      errorMessage: 'SpacesUnavailable',
    });
    // tx1 ran (AWB IS persisted — the CUR-9 gate will now fire on retry).
    expect(txShipmentUpdate).toHaveBeenCalledTimes(1);
    expect(auditCalls(auditLog, 'awb.generated')).toHaveLength(1);
    // tx2 did NOT run (label upload failed before it).
    expect(txAwbLabelCreate).not.toHaveBeenCalled();
    expect(auditCalls(auditLog, 'awb.label_persisted')).toHaveLength(0);
    // Spaces was attempted.
    expect(putObject).toHaveBeenCalledTimes(1);
    // Delhivery was called exactly once (the whole point of the reorder).
    expect(generateAwb).toHaveBeenCalledTimes(1);
  });

  it('M10 commit 1 — recovery path: a re-call on a shipment with awbNumber set + NO current label SKIPS Delhivery and runs label-only (no double AWB / no double charge)', async () => {
    const {
      svc,
      generateAwb,
      fetchLabel,
      putObject,
      txShipmentUpdate,
      txAwbLabelCreate,
      auditLog,
    } = makeService({
      shipment: shipmentRow({
        awbNumber: 'DLVSTUB202605000042',
        courierShipmentId: 'DLVSHP202605000042',
        status: ShipmentStatus.AWB_GENERATED,
        awbLabels: [], // tx1 ran on the prior attempt; tx2 didn't.
      }),
    });
    const r = await svc.generateForShipment(SHIP);
    // Recovery completes the run cleanly: no second generateAwb,
    // label now uploaded + persisted.
    expect(r).toEqual({
      status: 'GENERATED',
      shipmentId: SHIP,
      awbNumber: 'DLVSTUB202605000042',
      courierShipmentId: 'DLVSHP202605000042',
      labelSpacesKey: 'awb-labels/ship-1/v1-DLVSTUB202605000042.pdf',
      labelVersion: 1,
    });
    // CUR-9 honored — NO second Delhivery call.
    expect(generateAwb).not.toHaveBeenCalled();
    // tx1 NOT re-run (AWB was already persisted).
    expect(txShipmentUpdate).not.toHaveBeenCalled();
    expect(auditCalls(auditLog, 'awb.generated')).toHaveLength(0);
    // Phase D ran to completion.
    expect(fetchLabel).toHaveBeenCalledWith(
      // Now an input object, because the label has to be asked of
      // whichever courier actually carries the parcel — not of
      // Delhivery by default.
      expect.objectContaining({ awbNumber: 'DLVSTUB202605000042', courierCode: 'delhivery' }),
      // AWB generation is a queue worker, so the credential decrypt must
      // attribute to the RUNNER branch — CUR-10 as amended turns on
      // telling that apart from an operator having clicked something.
      expect.objectContaining({
        type: 'SYSTEM',
        trigger: expect.objectContaining({ kind: 'RUNNER' }),
      }),
    );
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(txAwbLabelCreate).toHaveBeenCalledTimes(1);
    expect(auditCalls(auditLog, 'awb.label_persisted')).toHaveLength(1);
  });

  it('M10 commit 1 — recovery path also catches a fetchLabel failure (same GENERATED_AWB_LABEL_PENDING outcome, AWB stays durable)', async () => {
    const { svc, txShipmentUpdate, auditLog, putObject } = makeService({
      shipment: shipmentRow({
        awbNumber: 'DLVSTUB202605000042',
        courierShipmentId: 'DLVSHP202605000042',
        status: ShipmentStatus.AWB_GENERATED,
        awbLabels: [],
      }),
      fetchLabelThrows: new Error('LabelFetchTimeout'),
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toMatchObject({
      status: 'GENERATED_AWB_LABEL_PENDING',
      shipmentId: SHIP,
      awbNumber: 'DLVSTUB202605000042',
      errorMessage: 'LabelFetchTimeout',
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(txShipmentUpdate).not.toHaveBeenCalled();
    expect(auditCalls(auditLog, 'awb.label_persisted')).toHaveLength(0);
  });

  it('FAILED non-serviceable: returns FAILED serviceable:false, no DB write, no label upload', async () => {
    const { svc, putObject, txShipmentUpdate, auditLog } = makeService({
      awbResult: {
        ok: false,
        serviceable: false,
        errorCode: 'STUB_NON_SERVICEABLE',
        errorMessage: 'no service',
      },
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toMatchObject({
      status: 'FAILED',
      serviceable: false,
      errorCode: 'STUB_NON_SERVICEABLE',
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(txShipmentUpdate).not.toHaveBeenCalled();
    expect(auditCalls(auditLog, 'awb.generated')).toHaveLength(0);
  });

  it('FAILED transient: returns FAILED serviceable:true', async () => {
    const { svc } = makeService({
      awbResult: {
        ok: false,
        serviceable: true,
        errorCode: 'STUB_COURIER_FAILURE',
        errorMessage: 'transient',
      },
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toMatchObject({ status: 'FAILED', serviceable: true });
  });

  it('label versioning: a prior label → version incremented, prior demoted', async () => {
    const { svc, txAwbLabelCreate, txAwbLabelUpdateMany } = makeService({
      priorLabelVersion: 1,
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toMatchObject({ status: 'GENERATED', labelVersion: 2 });
    expect(txAwbLabelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shipmentId: SHIP, isCurrent: true },
        data: { isCurrent: false },
      }),
    );
    expect(txAwbLabelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
    );
  });

  it('R1: stamps courierAccountId in tx1 when an account resolves', async () => {
    const { svc, txShipmentUpdate, selectAccount } = makeService({
      courierAccountResult: { courierAccountId: 'acct-42', source: 'DEFAULT_ACCOUNT' },
    });
    await svc.generateForShipment(SHIP);
    expect(selectAccount).toHaveBeenCalledWith('seller-1', 'courier-1', expect.any(String));
    expect(txShipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courierAccountId: 'acct-42' }) }),
    );
  });

  it('R1: leaves courierAccountId unset (no field in the update) when no account resolves — never blocks AWB generation', async () => {
    const { svc, txShipmentUpdate } = makeService(); // default: selectAccount throws NO_COURIER_ACCOUNT_AVAILABLE
    const r = await svc.generateForShipment(SHIP);
    expect(r.status).toBe('GENERATED');
    const data = txShipmentUpdate.mock.calls[0]![0]!.data as AnyArgs;
    expect('courierAccountId' in data).toBe(false);
  });

  it('R1: leaves courierAccountId unset when the shipment has no resolvable order/seller', async () => {
    const { svc, txShipmentUpdate, selectAccount } = makeService({
      shipment: shipmentRow({ orderShipments: [] }),
    });
    await svc.generateForShipment(SHIP);
    expect(selectAccount).not.toHaveBeenCalled();
    const data = txShipmentUpdate.mock.calls[0]![0]!.data as AnyArgs;
    expect('courierAccountId' in data).toBe(false);
  });

  it('404 when the shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.generateForShipment(SHIP)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 when the shipment is not CREATED (and has no awbNumber so the recovery path does not apply)', async () => {
    const { svc } = makeService({
      shipment: shipmentRow({
        awbNumber: null,
        status: ShipmentStatus.HANDED_TO_COURIER,
      }),
    });
    await expect(svc.generateForShipment(SHIP)).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * Failover is SYMMETRIC by construction, and these tests are what say so.
 *
 * The saga never names a courier: on a refusal it asks the distribution
 * service for a DIFFERENT one, excluding whoever just said no. So the
 * direction is decided by which courier the parcel was routed to first,
 * not by anything in this code — which is exactly the property that
 * would rot silently if only the Delhivery-first case were covered.
 *
 * A refusal, not a wobble. `serviceable: false` is "this courier will
 * not carry this parcel"; a timeout leaves it true and the existing
 * BullMQ retries handle it (CUR-2b). Failing over on a bad minute would
 * quietly move volume, and cost, to a courier nobody chose.
 */
describe('AwbGenerationService — courier failover (symmetric)', () => {
  const REFUSED: DispatchAwbResult = {
    ok: false,
    awbNumber: null,
    courierShipmentId: null,
    serviceable: false,
    errorCode: 'NON_SERVICEABLE',
    errorMessage: 'pin not served',
  };

  it('Delhivery refuses → Shiprocket carries it, and the shipment records SHIPROCKET', async () => {
    const { svc, generate, txShipmentUpdate } = makeService({
      dispatchByCourier: {
        delhivery: REFUSED,
        shiprocket: {
          ok: true,
          awbNumber: 'SR1234567890',
          courierShipmentId: '887766',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    expect(res.status).toBe('GENERATED');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0].courierCode).toBe('delhivery');
    expect(generate.mock.calls[1]?.[0].courierCode).toBe('shiprocket');

    // The parcel is now with a different company. If the row still said
    // 'delhivery', every later label fetch, tracking scan match and
    // cancel would be sent to a courier that never had it.
    const written = txShipmentUpdate.mock.calls[0]?.[0].data as AnyArgs;
    expect(written.courierCode).toBe('shiprocket');
    expect(written.awbNumber).toBe('SR1234567890');
    expect(written.courierShipmentId).toBe('887766');
  });

  it('Shiprocket refuses → Delhivery carries it (the same path, the other way)', async () => {
    const { svc, generate, txShipmentUpdate } = makeService({
      shipment: shipmentRow({ courierCode: 'shiprocket' }),
      dispatchByCourier: {
        shiprocket: REFUSED,
        delhivery: {
          ok: true,
          awbNumber: 'DLVSTUB202605000042',
          courierShipmentId: null,
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'delhivery', courierAccountId: 'dl-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    expect(res.status).toBe('GENERATED');
    expect(generate.mock.calls[0]?.[0].courierCode).toBe('shiprocket');
    expect(generate.mock.calls[1]?.[0].courierCode).toBe('delhivery');
    const written = txShipmentUpdate.mock.calls[0]?.[0].data as AnyArgs;
    expect(written.courierCode).toBe('delhivery');
  });

  it('both refuse → FAILED with serviceable false, which is what routes it to a human', async () => {
    const { svc, generate } = makeService({
      dispatchByCourier: { delhivery: REFUSED, shiprocket: REFUSED },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('FAILED');
    if (res.status === 'FAILED') {
      expect(res.serviceable).toBe(false);
      // The FIRST courier's reason survives: it answers "why is this in
      // manual placement". The alternate's message is about a courier
      // nobody chose.
      expect(res.errorMessage).toBe('pin not served');
    }
  });

  it('a transient failure does NOT fail over — the retries own that case', async () => {
    const { svc, generate, pickAlternate } = makeService({
      dispatchByCourier: {
        delhivery: {
          ok: false,
          awbNumber: null,
          courierShipmentId: null,
          serviceable: true,
          errorCode: 'UPSTREAM_TIMEOUT',
          errorMessage: 'gateway timeout',
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(pickAlternate).not.toHaveBeenCalled();
    expect(res.status).toBe('FAILED');
    if (res.status === 'FAILED') expect(res.serviceable).toBe(true);
  });

  it('no alternate configured → one attempt, then manual placement', async () => {
    const { svc, generate } = makeService({
      dispatchByCourier: { delhivery: REFUSED },
      alternate: null,
    });

    const res = await svc.generateForShipment(SHIP);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('FAILED');
    if (res.status === 'FAILED') expect(res.serviceable).toBe(false);
  });
});

/**
 * The trap a mixed configuration sets, and it is not hypothetical:
 * production runs Delhivery LIVE against their real API while Shiprocket
 * has no base URL yet, so it answers from a stub.
 *
 * A stub returns a FABRICATED success — a waybill derived from the
 * shipment id. Right in dev and CI, where both couriers are stubbed and
 * the failover under test is a real one. Catastrophic when the courier
 * that refused is live: the parcel comes back "booked" with a waybill
 * nobody issued, gets dispatched, decrements stock and tells the
 * customer it shipped, and no van is ever coming. It surfaces as a
 * parcel that simply never moves.
 */
describe('AwbGenerationService — a stub must not answer for a live courier', () => {
  const REFUSED_LIVE: DispatchAwbResult = {
    ok: false,
    awbNumber: null,
    courierShipmentId: null,
    serviceable: false,
    errorCode: 'NON_SERVICEABLE',
    errorMessage: 'pin not served',
  };

  it('does NOT fail over when the alternate is stubbed and the refuser is live', async () => {
    const { svc, generate } = makeService({
      // Production today: Delhivery live, Shiprocket not yet configured.
      stubCouriers: ['shiprocket'],
      dispatchByCourier: {
        delhivery: REFUSED_LIVE,
        shiprocket: {
          ok: true,
          awbNumber: 'SR00000042',
          courierShipmentId: '900000042',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    // The second courier is never asked, so no fabricated AWB exists to
    // be believed.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('FAILED');
    if (res.status === 'FAILED') {
      // serviceable:false routes it to manual placement — which is
      // exactly where it went before failover existed, and strictly
      // better than a parcel nobody is collecting.
      expect(res.serviceable).toBe(false);
    }
  });

  it('DOES fail over when both are stubbed — that is dev and CI', async () => {
    const { svc, generate } = makeService({
      stubCouriers: ['delhivery', 'shiprocket'],
      dispatchByCourier: {
        delhivery: REFUSED_LIVE,
        shiprocket: {
          ok: true,
          awbNumber: 'SR00000042',
          courierShipmentId: '900000042',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    // Neither answer is real, so neither is more trustworthy than the
    // other — the failover being exercised is the genuine one.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('GENERATED');
  });

  it('DOES fail over when both are live — the case this was built for', async () => {
    const { svc, generate } = makeService({
      stubCouriers: [],
      dispatchByCourier: {
        delhivery: REFUSED_LIVE,
        shiprocket: {
          ok: true,
          awbNumber: 'SR1234567890',
          courierShipmentId: '887766',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('GENERATED');
  });
});

describe('AwbGenerationService — a manual courier is a destination, not a refusal', () => {
  const NO_ADAPTER: DispatchAwbResult = {
    ok: false,
    awbNumber: null,
    courierShipmentId: null,
    serviceable: false,
    errorCode: 'NO_ADAPTER',
    errorMessage: 'manual has no integration — book it by hand',
  };

  it('does NOT fail over to a live courier when the parcel was routed to manual', async () => {
    // The bug this pins, found on production while trying to exercise
    // manual placement: `pickAlternate` falls back to a GLOBAL_SPLIT
    // across every active account, so a seller linked ONLY to the manual
    // courier had their parcel refused by manual (correctly, there is no
    // adapter) and then booked with Delhivery for real. Choosing manual
    // did nothing, and the operator who chose it was overruled silently.
    const { svc, generate } = makeService({
      shipment: { ...shipmentRow(), courierCode: 'manual' },
      dispatchByCourier: {
        manual: NO_ADAPTER,
        delhivery: {
          ok: true,
          awbNumber: 'DLV99999999',
          courierShipmentId: '777',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'delhivery', courierAccountId: 'dlv-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);

    // Asked once — manual — and never Delhivery.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('FAILED');
    if (res.status === 'FAILED') {
      // Still routes to a person, which is the whole point of manual.
      expect(res.serviceable).toBe(false);
    }
  });

  it('a REAL carrier refusal still fails over — the narrowing is only about NO_ADAPTER', async () => {
    // Guarding against over-correction: CUR-14's symmetric failover must
    // survive. A courier that genuinely will not carry a parcel is a
    // different fact from a courier that does not exist.
    const { svc, generate } = makeService({
      dispatchByCourier: {
        delhivery: {
          ok: false,
          awbNumber: null,
          courierShipmentId: null,
          serviceable: false,
          errorCode: 'NON_SERVICEABLE',
          errorMessage: 'pin not served',
        },
        shiprocket: {
          ok: true,
          awbNumber: 'SR00000042',
          courierShipmentId: '900000042',
          serviceable: true,
          errorCode: null,
          errorMessage: null,
        },
      },
      alternate: { courierCode: 'shiprocket', courierAccountId: 'sr-acc-1' },
    });

    const res = await svc.generateForShipment(SHIP);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('GENERATED');
  });
});

// ---------------------------------------------------------------------
// A manually-placed parcel has no label leg.
//
// This became reachable when recording a manual AWB on an unpicked order
// started routing it to PENDING_PICK instead of refusing (CUR-8, amended
// 2026-09-02): the parcel now flows through pick and pack, gets attached
// to a DRAFT manifest, and reaches manifest close — which runs the AWB
// job over every CREATED shipment on it.
// ---------------------------------------------------------------------
describe('AwbGenerationService — a manual courier has nothing to fetch', () => {
  it('treats a manual AWB with no label row as complete, not as label recovery', async () => {
    // The trap: a manual shipment has an AWB and NO awb_labels row,
    // which is byte-identical to the "the label leg failed, resume it"
    // shape. Taking that path asks a courier called `manual` — which has
    // no adapter — for a PDF, gets NO_ADAPTER back, and is re-queued by
    // BullMQ to ask again forever.
    //
    // There is nothing to fetch: the waybill is a number an operator
    // read off a paper docket from whoever took the parcel.
    const { svc, fetchLabel, generate } = makeService({
      shipment: shipmentRow({
        awbNumber: 'BD-4471',
        isManualCourier: true,
        courierCode: 'manual',
        courierShipmentId: null,
        awbLabels: [],
      }),
    });

    const out = await svc.generateForShipment('ship-1', { type: ActorType.SYSTEM });

    expect(out).toMatchObject({ status: 'ALREADY_HAS_AWB', awbNumber: 'BD-4471' });
    expect(fetchLabel).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
