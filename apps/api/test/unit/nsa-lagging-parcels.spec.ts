import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { OrderAttentionService } from '../../src/modules/order-attention/services/order-attention.service';

/**
 * The order row can lag its parcel. These pin that a delivered / returning
 * / lost / cancelled / failed-attempt parcel never shows as overdue, that
 * one sweep tidies its stale flag, and that a parcel still genuinely out
 * for delivery is left alone.
 */
const flagged = (id: string, ship: ShipmentStatus | null) => ({
  id,
  sellerId: 'sel-1',
  status: OrderStatus.OUT_FOR_DELIVERY,
  orderNumber: `SD-${id}`,
  recipientName: 'A',
  recipientCity: 'Pune',
  recipientPhoneE164: '+911',
  codAmountInr: null,
  nsaDayCount: 1,
  nsaRaisedAt: new Date(),
  nsaAcknowledgedAt: null,
  nsaNote: null,
  seller: { companyName: 'S' },
  orderShipments:
    ship === null
      ? []
      : [{ shipment: { awbNumber: `AWB${id}`, courierCode: 'DELHIVERY', status: ship } }],
});

function make(rows: ReturnType<typeof flagged>[]) {
  const updates: Array<{ where: Record<string, unknown> }> = [];
  const client = {
    order: {
      findMany: jest.fn(async () => rows),
      updateMany: jest.fn(async (a: { where: Record<string, unknown> }) => {
        updates.push(a);
        const ids = (a.where.id as { in?: string[] } | undefined)?.in;
        return { count: ids === undefined ? 0 : ids.length };
      }),
    },
    orderShipment: { findMany: jest.fn(async () => []) },
    orderEvent: { groupBy: jest.fn(async () => []) },
  };
  const args = new Array(12).fill({});
  args[0] = { client };
  args[8] = { reachedStatusAt: jest.fn(async () => new Map()) };
  const svc = new OrderAttentionService(
    ...(args as ConstructorParameters<typeof OrderAttentionService>),
  );
  return { svc, updates };
}

describe('NSA — parcels the order row lags behind', () => {
  const GONE = [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.RTO_INITIATED,
    ShipmentStatus.RTO_IN_TRANSIT,
    ShipmentStatus.RTO_DELIVERED,
    ShipmentStatus.LOST,
    ShipmentStatus.CANCELLED,
    ShipmentStatus.DELIVERY_ATTEMPTED,
  ];

  it.each(GONE)('list() hides an OUT_FOR_DELIVERY order whose shipment is %s', async (st) => {
    const { svc } = make([flagged('a', st)]);
    expect(await svc.list('sel-1')).toHaveLength(0);
  });

  it('list() keeps a parcel genuinely out for delivery, and one with no shipment', async () => {
    const { svc } = make([flagged('a', ShipmentStatus.OUT_FOR_DELIVERY), flagged('b', null)]);
    expect((await svc.list('sel-1')).map((r) => r.orderId)).toEqual(['a', 'b']);
  });

  it('one clearMoved run clears only the stale flags', async () => {
    const { svc, updates } = make([
      flagged('delivered', ShipmentStatus.DELIVERED),
      flagged('rto', ShipmentStatus.RTO_IN_TRANSIT),
      flagged('failed', ShipmentStatus.DELIVERY_ATTEMPTED),
      flagged('still-out', ShipmentStatus.OUT_FOR_DELIVERY),
      flagged('no-ship', null),
    ]);
    const cleared = await (svc as unknown as { clearMoved(): Promise<number> }).clearMoved();
    const heal = updates.find((u) => u.where.id !== undefined);
    expect((heal?.where.id as { in: string[] }).in).toEqual(['delivered', 'rto', 'failed']);
    expect(heal?.where).toMatchObject({ nsaClearedAt: null, status: 'OUT_FOR_DELIVERY' });
    expect(cleared).toBe(3);
  });
});
