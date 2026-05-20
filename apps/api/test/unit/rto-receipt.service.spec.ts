import { NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { RtoReceiptService } from '../../src/modules/warehouse-rto/services/rto-receipt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

const AWB = 'AWB-9999';
const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    stampCount?: number;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    awbNumber: AWB,
    status: ShipmentStatus.RTO_IN_TRANSIT,
    rtoReceivedAt: null,
    orderShipments: [{ orderId: ORDER }],
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.stampCount ?? 1 }),
  );
  const client = {
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
  };
  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.RTO_IN_TRANSIT },
  );
  const orders = { getById };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    status: OrderStatus.RTO_RECEIVED,
  }));
  const orderWrite = { transitionStatus };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const svc = new RtoReceiptService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    audit as unknown as AuditLogService,
  );
  return {
    svc,
    shipmentFindFirst,
    shipmentUpdateMany,
    getById,
    transitionStatus,
    auditLog,
  };
}

describe('RtoReceiptService.receive', () => {
  it('happy from RTO_IN_TRANSIT: stamps rtoReceivedAt then transitions → RTO_RECEIVED', async () => {
    const { svc, shipmentUpdateMany, transitionStatus, auditLog } = makeService();
    const r = await svc.receive(AWB, STAFF);

    // Operational stamp BEFORE authoritative transition.
    const stampOrd = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrd).toBeLessThan(transOrd);

    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SHIP, rtoReceivedAt: null },
        data: expect.objectContaining({ rtoReceivedAt: expect.any(Date) }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.RTO_RECEIVED,
        expectedFrom: OrderStatus.RTO_IN_TRANSIT,
      }),
    );
    expect(r).toMatchObject({
      shipmentId: SHIP,
      orderId: ORDER,
      awbNumber: AWB,
      status: OrderStatus.RTO_RECEIVED,
      alreadyReceived: false,
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rto.received' }),
    );
  });

  it('happy from RTO_INITIATED: expectedFrom=RTO_INITIATED on the transition', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.RTO_INITIATED,
    });
    await svc.receive(AWB, STAFF);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedFrom: OrderStatus.RTO_INITIATED }),
    );
  });

  it('idempotent: already RTO_RECEIVED + stamped → no-op', async () => {
    const stampedAt = new Date('2026-05-20T09:00:00Z');
    const { svc, shipmentUpdateMany, transitionStatus, auditLog } = makeService({
      orderStatus: OrderStatus.RTO_RECEIVED,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: stampedAt,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    const r = await svc.receive(AWB, STAFF);
    expect(r).toEqual({
      shipmentId: SHIP,
      orderId: ORDER,
      awbNumber: AWB,
      status: OrderStatus.RTO_RECEIVED,
      rtoReceivedAt: stampedAt,
      alreadyReceived: true,
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('404 when AWB has no shipment', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.receive(AWB, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects ORDER_NOT_RTO_RECEIVABLE for a non-RTO status (e.g. DELIVERED)', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.DELIVERED });
    await expect(svc.receive(AWB, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_RTO_RECEIVABLE' },
    });
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.receive(AWB, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('stamp idempotency: updateMany count=0 preserves prior rtoReceivedAt', async () => {
    const prior = new Date('2026-05-20T08:00:00Z');
    const { svc } = makeService({
      stampCount: 0,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: prior,
        orderShipments: [{ orderId: ORDER }],
      },
      orderStatus: OrderStatus.RTO_IN_TRANSIT,
    });
    const r = await svc.receive(AWB, STAFF);
    expect(r.rtoReceivedAt).toBe(prior); // preserves original timestamp on retry
  });
});
