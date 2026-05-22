import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { AwbGenerationService } from '../../src/modules/courier-awb/services/awb-generation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { DelhiveryAwbService } from '../../src/modules/courier-delhivery/services/delhivery-awb.service';
import type { DelhiveryLabelService } from '../../src/modules/courier-delhivery/services/delhivery-label.service';
import type { DelhiveryAwbResult } from '../../src/modules/courier-delhivery/types/delhivery.types';
import { makeTestEnv } from '../helpers/env';

type AnyArgs = Record<string, unknown>;

const SHIP = 'ship-1';

function shipmentRow(over: AnyArgs = {}): AnyArgs {
  return {
    id: SHIP,
    shipmentNumber: 'SH-2026-05-000042',
    awbNumber: null,
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
    ...over,
  };
}

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    awbResult?: DelhiveryAwbResult;
    priorLabelVersion?: number;
  } = {},
) {
  const shipmentFindUnique = jest.fn(async () =>
    opts.shipment === undefined ? shipmentRow() : opts.shipment,
  );
  const awbLabelFindFirst = jest.fn(async () =>
    opts.priorLabelVersion === undefined
      ? null
      : { version: opts.priorLabelVersion },
  );
  const txShipmentUpdate = jest.fn(async () => ({}));
  const txAwbLabelCreate = jest.fn(async () => ({}));
  const txAwbLabelUpdateMany = jest.fn(async () => ({ count: 0 }));
  const txClient = {
    shipment: { update: txShipmentUpdate },
    awbLabel: { create: txAwbLabelCreate, updateMany: txAwbLabelUpdateMany },
  };
  const client = {
    shipment: { findUnique: shipmentFindUnique },
    awbLabel: { findFirst: awbLabelFindFirst },
  } as {
    shipment: { findUnique: typeof shipmentFindUnique };
    awbLabel: { findFirst: typeof awbLabelFindFirst };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn(txClient);

  const putObject = jest.fn<Promise<void>, [string, Buffer, string]>(
    async () => {},
  );
  const spaces = { putObject };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(
    async () => 'a',
  );
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
  const fetchLabel = jest.fn(async () => ({
    bytes: Buffer.from('%PDF-1.4 stub'),
    mimeType: 'application/pdf',
  }));
  const delhiveryLabel = { fetchLabel };

  const svc = new AwbGenerationService(
    { client } as unknown as PrismaService,
    makeTestEnv(),
    spaces as unknown as SpacesService,
    audit as unknown as AuditLogService,
    delhiveryAwb as unknown as DelhiveryAwbService,
    delhiveryLabel as unknown as DelhiveryLabelService,
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
  };
}

describe('AwbGenerationService.generateForShipment', () => {
  it('GENERATED: generates AWB, persists label to Spaces, stamps shipment + awb_labels', async () => {
    const { svc, putObject, txShipmentUpdate, txAwbLabelCreate, auditLog } =
      makeService();
    const r = await svc.generateForShipment(SHIP, { type: ActorType.SYSTEM });
    expect(r).toEqual({
      status: 'GENERATED',
      shipmentId: SHIP,
      awbNumber: 'DLVSTUB202605000042',
      courierShipmentId: 'DLVSHP202605000042',
      labelSpacesKey: 'awb-labels/ship-1/v1-DLVSTUB202605000042.pdf',
      labelVersion: 1,
    });
    expect(putObject).toHaveBeenCalledWith(
      'awb-labels/ship-1/v1-DLVSTUB202605000042.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(txShipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          awbNumber: 'DLVSTUB202605000042',
          status: ShipmentStatus.AWB_GENERATED,
        }),
      }),
    );
    expect(txAwbLabelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, isCurrent: true }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'awb.generated' }),
      expect.anything(),
    );
  });

  it('CUR-9: a shipment that already has an AWB is skipped (ALREADY_HAS_AWB)', async () => {
    const { svc, generateAwb, putObject, txShipmentUpdate } = makeService({
      shipment: shipmentRow({ awbNumber: 'EXISTING-AWB' }),
    });
    const r = await svc.generateForShipment(SHIP);
    expect(r).toEqual({
      status: 'ALREADY_HAS_AWB',
      shipmentId: SHIP,
      awbNumber: 'EXISTING-AWB',
    });
    expect(generateAwb).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(txShipmentUpdate).not.toHaveBeenCalled();
  });

  it('FAILED non-serviceable: returns FAILED serviceable:false, no DB write, no label upload', async () => {
    const { svc, putObject, txShipmentUpdate } = makeService({
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

  it('404 when the shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.generateForShipment(SHIP)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409 when the shipment is not CREATED', async () => {
    const { svc } = makeService({
      shipment: shipmentRow({ status: ShipmentStatus.HANDED_TO_COURIER }),
    });
    await expect(svc.generateForShipment(SHIP)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
