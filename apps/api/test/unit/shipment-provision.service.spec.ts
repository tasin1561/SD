import { ActorType, ShipmentStatus } from '@skydrop/db';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ShipmentNumberingService } from '../../src/modules/shipment-provision/services/shipment-numbering.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    existing?: AnyArgs | null; // orderShipment.findFirst (idempotency probe)
    openForVoid?: AnyArgs[]; // orderShipment.findMany (void)
    settings?: Record<string, string | null>;
  } = {},
) {
  const settings = opts.settings ?? {
    'ops.default_courier_code': 'delhivery',
    'ops.default_warehouse_id': 'wh-1',
  };
  const orderShipmentFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => opts.existing ?? null,
  );
  const orderShipmentFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.openForVoid ?? [],
  );
  const systemSettingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (a) => {
    const key = (a.where as AnyArgs).key as string;
    const v = settings[key];
    return v == null ? null : { valueString: v };
  });
  const shipmentCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    id: 'sh1',
    shipmentNumber: 'SH-2026-05-000001',
  }));
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: 1,
  }));
  const txClient = {
    shipment: { create: shipmentCreate, updateMany: shipmentUpdateMany },
  };
  const client = {
    orderShipment: {
      findFirst: orderShipmentFindFirst,
      findMany: orderShipmentFindMany,
    },
    systemSetting: { findUnique: systemSettingFindUnique },
  } as {
    orderShipment: {
      findFirst: typeof orderShipmentFindFirst;
      findMany: typeof orderShipmentFindMany;
    };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog };
  const nextShipmentNumber = jest.fn(async () => 'SH-2026-05-000001');
  const numbering = { nextShipmentNumber };

  const svc = new ShipmentProvisionService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    numbering as unknown as ShipmentNumberingService,
  );
  return {
    svc,
    orderShipmentFindFirst,
    shipmentCreate,
    shipmentUpdateMany,
    auditLog,
    nextShipmentNumber,
  };
}

const SNAPSHOT = {
  orderId: 'o1',
  recipient: {
    name: 'Asha Verma',
    phoneE164: '+919876543210',
    addressLine1: '12 MG Road',
    city: 'Bengaluru',
    stateProvince: 'Karnataka',
    postalCode: '560001',
  },
  declaredValueInr: 999,
  items: [
    {
      orderItemId: 'oi1',
      quantity: 2,
      skuCode: 'W-1-STD',
      productName: 'Widget',
      unitWeightGrams: 150,
    },
  ],
};

describe('ShipmentProvisionService.provisionFromSnapshot', () => {
  it('idempotent: an existing non-CANCELLED shipment is returned, no create', async () => {
    const { svc, shipmentCreate } = makeService({
      existing: { shipmentId: 'sh-existing' },
    });
    const r = await svc.provisionFromSnapshot(SNAPSHOT);
    expect(r).toEqual({ shipmentId: 'sh-existing', created: false });
    expect(shipmentCreate).not.toHaveBeenCalled();
  });

  it('creates the parcel: settings-resolved courier/warehouse, dest snapshot, computed weight', async () => {
    const { svc, shipmentCreate, auditLog, nextShipmentNumber } = makeService();
    const r = await svc.provisionFromSnapshot(SNAPSHOT);
    expect(r).toEqual({ shipmentId: 'sh1', created: true });
    expect(nextShipmentNumber).toHaveBeenCalled();
    const data = shipmentCreate.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({
      shipmentNumber: 'SH-2026-05-000001',
      courierCode: 'delhivery',
      originWarehouseId: 'wh-1',
      destRecipientName: 'Asha Verma',
      destCity: 'Bengaluru',
      destCountryCode: 'IN',
      totalWeightGrams: 300, // 150 * 2, computed (not supplied)
      status: ShipmentStatus.CREATED,
    });
    const os = (data.orderShipments as AnyArgs).create as AnyArgs;
    expect(os).toMatchObject({ orderId: 'o1', isFullOrder: true, shipmentSequence: 1 });
    const items = (data.items as AnyArgs).create as AnyArgs[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ orderItemId: 'oi1', quantity: 2, skuCode: 'W-1-STD' });
    expect(auditLog.mock.calls[0]![0]).toMatchObject({ action: 'shipment.provisioned' });
  });

  it('honors a supplied totalWeightGrams over the computed sum', async () => {
    const { svc, shipmentCreate } = makeService();
    await svc.provisionFromSnapshot({ ...SNAPSHOT, totalWeightGrams: 999 });
    expect((shipmentCreate.mock.calls[0]![0].data as AnyArgs).totalWeightGrams).toBe(999);
  });

  it('throws SHIPMENT_PROVISION_SETTING_MISSING when default courier is unset', async () => {
    const { svc } = makeService({
      settings: { 'ops.default_courier_code': null, 'ops.default_warehouse_id': 'wh-1' },
    });
    await expect(svc.provisionFromSnapshot(SNAPSHOT)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_PROVISION_SETTING_MISSING' },
    });
  });
});

describe('ShipmentProvisionService.voidForOrder', () => {
  it('no-ops when the order has no open shipment (idempotent)', async () => {
    const { svc, shipmentUpdateMany } = makeService({ openForVoid: [] });
    const r = await svc.voidForOrder('o1', 'cancelled');
    expect(r).toEqual({ voided: 0 });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
  });

  it('CANCELs + soft-deletes open shipments, MEDIUM audit', async () => {
    const { svc, shipmentUpdateMany, auditLog } = makeService({
      openForVoid: [{ shipmentId: 'sh1' }, { shipmentId: 'sh2' }],
    });
    const r = await svc.voidForOrder('o1', 'order cancelled', {
      type: ActorType.STAFF,
      id: 'staff-1',
    });
    expect(r).toEqual({ voided: 2 });
    const upd = shipmentUpdateMany.mock.calls[0]![0] as AnyArgs;
    expect((upd.where as AnyArgs).id).toEqual({ in: ['sh1', 'sh2'] });
    expect((upd.data as AnyArgs).status).toBe(ShipmentStatus.CANCELLED);
    expect((upd.data as AnyArgs).deletedAt).toBeInstanceOf(Date);
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'shipment.voided',
      severity: 'MEDIUM',
    });
  });
});
