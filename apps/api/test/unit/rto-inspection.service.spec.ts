import { NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
} from '@skydrop/db';
import { RtoInspectionService } from '../../src/modules/warehouse-rto/services/rto-inspection.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

const ITEM = 'si-1';
const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';

function makeService(
  opts: { item?: AnyArgs | null; orderStatus?: OrderStatus | 'missing' } = {},
) {
  const defaultItem = {
    id: ITEM,
    shipmentId: SHIP,
    shipment: { id: SHIP, orderShipments: [{ orderId: ORDER }] },
  };
  const shipmentItemFindUnique = jest.fn(async () =>
    opts.item === undefined ? defaultItem : opts.item,
  );
  const shipmentItemUpdate = jest.fn(async () => ({}));
  const client = {
    shipmentItem: { findUnique: shipmentItemFindUnique, update: shipmentItemUpdate },
  };
  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.RTO_RECEIVED },
  );
  const orders = { getById };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const svc = new RtoInspectionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    audit as unknown as AuditLogService,
  );
  return { svc, shipmentItemFindUnique, shipmentItemUpdate, auditLog };
}

describe('RtoInspectionService.inspect', () => {
  it('writes the inspection + audits (MEDIUM)', async () => {
    const { svc, shipmentItemUpdate, auditLog } = makeService();
    const r = await svc.inspect(
      ITEM,
      {
        condition: RtoItemCondition.DAMAGED,
        disposition: RtoDisposition.WRITE_OFF,
        notes: 'box crushed',
      },
      STAFF,
    );
    expect(shipmentItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: {
        rtoCondition: RtoItemCondition.DAMAGED,
        rtoDisposition: RtoDisposition.WRITE_OFF,
        rtoDisposedByStaffId: STAFF,
        rtoInspectionNotes: 'box crushed',
      },
    });
    expect(r).toMatchObject({
      shipmentItemId: ITEM,
      shipmentId: SHIP,
      orderId: ORDER,
      rtoCondition: RtoItemCondition.DAMAGED,
      rtoDisposition: RtoDisposition.WRITE_OFF,
      rtoInspectionNotes: 'box crushed',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rto.inspected',
        severity: 'MEDIUM',
      }),
    );
  });

  it('null notes when omitted', async () => {
    const { svc, shipmentItemUpdate } = makeService();
    const r = await svc.inspect(
      ITEM,
      { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
      STAFF,
    );
    expect(r.rtoInspectionNotes).toBeNull();
    expect(shipmentItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rtoInspectionNotes: null }),
      }),
    );
  });

  it('re-inspection overwrites prior values (operator correction)', async () => {
    // Service has no special "already inspected" guard — re-inspecting
    // simply writes new values + re-audits. Verified by ensuring update
    // is called even when the item carries prior rto* values.
    const { svc, shipmentItemUpdate } = makeService({
      item: {
        id: ITEM,
        shipmentId: SHIP,
        shipment: { id: SHIP, orderShipments: [{ orderId: ORDER }] },
        rtoCondition: RtoItemCondition.GOOD,
        rtoDisposition: RtoDisposition.RESTOCK,
        rtoInspectionNotes: 'looks fine',
      },
    });
    await svc.inspect(
      ITEM,
      {
        condition: RtoItemCondition.DAMAGED,
        disposition: RtoDisposition.WRITE_OFF,
        notes: 'on closer look, water damage',
      },
      STAFF,
    );
    expect(shipmentItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rtoCondition: RtoItemCondition.DAMAGED,
          rtoDisposition: RtoDisposition.WRITE_OFF,
        }),
      }),
    );
  });

  it('404 when shipment_item is missing', async () => {
    const { svc } = makeService({ item: null });
    await expect(
      svc.inspect(
        ITEM,
        { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
        STAFF,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects ORDER_NOT_INSPECTABLE when order is not RTO_RECEIVED', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.PACKED });
    await expect(
      svc.inspect(
        ITEM,
        { condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
        STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_INSPECTABLE' } });
  });
});
