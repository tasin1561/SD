import { NotFoundException } from '@nestjs/common';
import { ActorType, ShipmentStatus, SupersedeReason } from '@skydrop/db';
import { AwbSupersedeService } from '../../src/modules/courier-awb/services/awb-supersede.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ShipmentNumberingService } from '../../src/modules/shipment-provision/services/shipment-numbering.service';

type AnyArgs = Record<string, unknown>;

const OLD = 'ship-old';
const ORDER = 'order-1';

function oldShipment(over: AnyArgs = {}): AnyArgs {
  return {
    id: OLD,
    supersededAt: null,
    courierCode: 'delhivery',
    originWarehouseId: 'wh-1',
    serviceType: null,
    destRecipientName: 'Asha',
    destRecipientPhoneE164: '+919876543210',
    destAddressLine1: '12 MG Road',
    destAddressLine2: null,
    destLandmark: null,
    destCity: 'Bengaluru',
    destStateProvince: 'Karnataka',
    destPostalCode: '560001',
    destCountryCode: 'IN',
    totalWeightGrams: 500,
    declaredWeightGrams: null,
    actualWeightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    volumetricWeightGrams: null,
    chargeableWeightGrams: null,
    packageType: null,
    declaredValueInr: '999.00',
    codAmountInr: '999.00',
    pickStartedAt: new Date('2026-05-22T08:00:00Z'),
    pickStartedByStaffId: 'staff-1',
    pickCompletedAt: new Date('2026-05-22T08:30:00Z'),
    packCompletedAt: new Date('2026-05-22T09:00:00Z'),
    packedByStaffId: 'staff-2',
    orderShipments: [{ orderId: ORDER, isFullOrder: true, shipmentSequence: 1 }],
    items: [
      {
        orderItemId: 'oi-1',
        quantity: 2,
        skuCode: 'W-1-STD',
        productName: 'Widget',
        variantLabel: null,
        unitWeightGrams: 250,
        unitDeclaredValueInr: '499.50',
        hsCode: null,
        unitPriceInr: '499.50',
        pickedBatchId: 'bat-1',
        pickedBinId: 'bin-1',
      },
    ],
    ...over,
  };
}

function makeService(
  opts: { shipment?: AnyArgs | null; existingReplacement?: AnyArgs | null } = {},
) {
  const shipmentFindUnique = jest.fn(async () =>
    opts.shipment === undefined ? oldShipment() : opts.shipment,
  );
  const shipmentFindFirst = jest.fn(async () => opts.existingReplacement ?? null);
  const txCreate = jest.fn(async (args: AnyArgs) => ({
    id: 'ship-new',
    shipmentNumber: 'SH-2026-05-000099',
    _data: (args as { data: AnyArgs }).data,
  }));
  const txUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const txClient = { shipment: { create: txCreate, update: txUpdate } };
  const client = {
    shipment: { findUnique: shipmentFindUnique, findFirst: shipmentFindFirst },
  } as {
    shipment: {
      findUnique: typeof shipmentFindUnique;
      findFirst: typeof shipmentFindFirst;
    };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(async () => 'a');
  const audit = { log: auditLog };
  const nextShipmentNumber = jest.fn(async () => 'SH-2026-05-000099');
  const numbering = { nextShipmentNumber };

  const svc = new AwbSupersedeService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    numbering as unknown as ShipmentNumberingService,
  );
  return { svc, shipmentFindUnique, shipmentFindFirst, txCreate, txUpdate, auditLog };
}

describe('AwbSupersedeService.supersede', () => {
  it('creates a replacement, copies items, retires the old shipment', async () => {
    const { svc, txCreate, txUpdate, auditLog } = makeService();
    const r = await svc.supersede(OLD, SupersedeReason.AWB_REJECTED, {
      type: ActorType.SYSTEM,
    });
    expect(r).toMatchObject({
      oldShipmentId: OLD,
      newShipmentId: 'ship-new',
      newShipmentNumber: 'SH-2026-05-000099',
      orderId: ORDER,
      alreadySuperseded: false,
    });

    // New shipment: supersedesShipmentId set, status CREATED, AWB reset,
    // dest snapshot + pick/pack state copied, shipmentSequence incremented.
    const created = txCreate.mock.calls[0]?.[0].data as AnyArgs;
    expect(created.supersedesShipmentId).toBe(OLD);
    expect(created.status).toBe(ShipmentStatus.CREATED);
    expect(created.awbNumber).toBeUndefined(); // reset — not copied
    expect(created.destPostalCode).toBe('560001');
    expect(created.pickCompletedAt).toEqual(new Date('2026-05-22T08:30:00Z'));
    expect(created.packCompletedAt).toEqual(new Date('2026-05-22T09:00:00Z'));
    const os = (created.orderShipments as { create: AnyArgs }).create;
    expect(os.shipmentSequence).toBe(2);
    const items = (created.items as { create: AnyArgs[] }).create;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      orderItemId: 'oi-1',
      quantity: 2,
      pickedBinId: 'bin-1',
      pickedBatchId: 'bat-1',
    });

    // Old shipment retired.
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: OLD },
      data: {
        status: ShipmentStatus.FAILED_AT_CREATION,
        supersededAt: expect.any(Date),
        supersedeReason: SupersedeReason.AWB_REJECTED,
        manifestId: null,
      },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shipment.superseded', severity: 'MEDIUM' }),
      expect.anything(),
    );
  });

  it('idempotent: already-superseded old shipment returns the existing replacement', async () => {
    const { svc, txCreate, txUpdate } = makeService({
      shipment: oldShipment({ supersededAt: new Date('2026-05-22T10:00:00Z') }),
      existingReplacement: { id: 'ship-new', shipmentNumber: 'SH-PRIOR' },
    });
    const r = await svc.supersede(OLD, SupersedeReason.AWB_REJECTED);
    expect(r).toEqual({
      oldShipmentId: OLD,
      newShipmentId: 'ship-new',
      newShipmentNumber: 'SH-PRIOR',
      orderId: ORDER,
      alreadySuperseded: true,
    });
    expect(txCreate).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('recreates when the superseded marker is set but no replacement exists', async () => {
    const { svc, txCreate } = makeService({
      shipment: oldShipment({ supersededAt: new Date('2026-05-22T10:00:00Z') }),
      existingReplacement: null, // partial prior failure
    });
    const r = await svc.supersede(OLD, SupersedeReason.COURIER_FAILURE);
    expect(r.alreadySuperseded).toBe(false);
    expect(txCreate).toHaveBeenCalled();
  });

  it('404 when the shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.supersede(OLD, SupersedeReason.AWB_REJECTED)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 when the shipment has no OrderShipment junction', async () => {
    const { svc } = makeService({
      shipment: oldShipment({ orderShipments: [] }),
    });
    await expect(svc.supersede(OLD, SupersedeReason.AWB_REJECTED)).rejects.toMatchObject({
      response: { code: 'ORDER_SHIPMENT_MISSING' },
    });
  });

  it('carries the supersede reason through (NON_SERVICEABLE)', async () => {
    const { svc, txUpdate } = makeService();
    await svc.supersede(OLD, SupersedeReason.NON_SERVICEABLE);
    expect(txUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { supersedeReason: SupersedeReason.NON_SERVICEABLE },
    });
  });
});
