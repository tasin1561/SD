import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { AwbGenerationService } from '../../src/modules/courier-awb/services/awb-generation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { DelhiveryAwbService } from '../../src/modules/courier-delhivery/services/delhivery-awb.service';
import type { DelhiveryLabelService } from '../../src/modules/courier-delhivery/services/delhivery-label.service';
import type { DelhiveryAwbResult } from '../../src/modules/courier-delhivery/types/delhivery.types';
import type { CourierAccountRoutingService } from '../../src/modules/courier-shared/services/courier-account-routing.service';
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
    codAmountInr: { toString: () => '999.00' },
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
  const delhiveryAwb = { generateAwb };
  const fetchLabel = jest.fn(async () => {
    if (opts.fetchLabelThrows) throw opts.fetchLabelThrows;
    return {
      bytes: Buffer.from('%PDF-1.4 stub'),
      mimeType: 'application/pdf',
    };
  });
  const delhiveryLabel = { fetchLabel };

  const svc = new AwbGenerationService(
    { client } as unknown as PrismaService,
    makeTestEnv(),
    spaces as unknown as SpacesService,
    audit as unknown as AuditLogService,
    delhiveryAwb as unknown as DelhiveryAwbService,
    delhiveryLabel as unknown as DelhiveryLabelService,
    courierAccountRouting as unknown as CourierAccountRoutingService,
  );
  return {
    svc,
    putObject,
    txShipmentUpdate,
    txAwbLabelCreate,
    txAwbLabelUpdateMany,
    auditLog,
    generateAwb,
    fetchLabel,
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
    expect(fetchLabel).toHaveBeenCalledWith('DLVSTUB202605000042');
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
    expect(fetchLabel).toHaveBeenCalledWith('DLVSTUB202605000042');
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
