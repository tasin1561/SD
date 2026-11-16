import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { SellerFailedAttemptsService } from '../../src/modules/order-attention/services/seller-failed-attempts.service';

function make(rows: unknown[], attempts: Map<string, unknown>, snaps: unknown[] = []) {
  const orderFindMany = jest.fn(async (_a: unknown) => rows);
  const prisma = {
    client: {
      order: { findMany: orderFindMany },
      courierNdrPanelSnapshot: { findMany: jest.fn(async () => snaps) },
    },
  };
  const tracking = { failedAttemptsFor: jest.fn(async () => attempts) };
  const svc = new SellerFailedAttemptsService(prisma as never, tracking as never);
  return { svc, orderFindMany };
}

const row = (id: string, status: OrderStatus, ship: ShipmentStatus) => ({
  id,
  orderNumber: `SD-${id}`,
  status,
  recipientName: 'A',
  recipientPhoneE164: '+911',
  codAmountInr: { toFixed: () => '500.00' },
  orderShipments: [
    { shipment: { id: `s-${id}`, awbNumber: `AWB${id}`, courierCode: 'DELHIVERY', status: ship } },
  ],
});
const att = (d: string, n = 1) => ({
  count: n,
  latest: { eventAt: new Date(d), description: 'Consignee Unavailable', location: 'Pune' },
});

describe('SellerFailedAttemptsService', () => {
  it('scopes the query by the seller and excludes deleted orders', async () => {
    const { svc, orderFindMany } = make([], new Map());
    await svc.list('sel-1');
    const where = (orderFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where.sellerId).toBe('sel-1');
    expect(where.deletedAt).toBeNull();
  });

  it('lists DELIVERY_FAILED and a lagging order whose shipment is DELIVERY_ATTEMPTED; drops the rest', async () => {
    const rows = [
      row('a', OrderStatus.DELIVERY_FAILED, ShipmentStatus.DELIVERY_ATTEMPTED),
      row('b', OrderStatus.OUT_FOR_DELIVERY, ShipmentStatus.DELIVERY_ATTEMPTED),
      row('c', OrderStatus.OUT_FOR_DELIVERY, ShipmentStatus.OUT_FOR_DELIVERY),
      row('d', OrderStatus.DELIVERY_FAILED, ShipmentStatus.RTO_IN_TRANSIT),
      row('e', OrderStatus.OUT_FOR_DELIVERY, ShipmentStatus.DELIVERED),
    ];
    const { svc } = make(
      rows,
      new Map([
        ['s-a', att('2026-11-10T10:00:00Z', 2)],
        ['s-b', att('2026-11-12T10:00:00Z')],
      ]),
    );
    const out = await svc.list('sel-1');
    expect(out.map((o) => o.orderId)).toEqual(['b', 'a']); // newest failed first
    expect(out[1]).toMatchObject({
      attemptCount: 2,
      lastRemark: 'Consignee Unavailable',
      lastLocation: 'Pune',
    });
    expect(out[0]?.codAmountInr).toBe('500.00');
  });

  it('is live: a re-attempt drops the parcel, a shipment-less DELIVERY_FAILED order still lists', async () => {
    const noShip = {
      ...row('n', OrderStatus.DELIVERY_FAILED, ShipmentStatus.DELIVERY_ATTEMPTED),
      orderShipments: [],
    };
    const rows = [
      row('r', OrderStatus.DELIVERY_FAILED, ShipmentStatus.OUT_FOR_DELIVERY), // went out again
      row('i', OrderStatus.DELIVERY_FAILED, ShipmentStatus.IN_TRANSIT),
      row('x', OrderStatus.DELIVERY_FAILED, ShipmentStatus.CANCELLED),
      row('l', OrderStatus.DELIVERY_FAILED, ShipmentStatus.LOST),
      noShip,
    ];
    const { svc } = make(rows, new Map());
    expect((await svc.list('sel-1')).map((o) => o.orderId)).toEqual(['n']);
  });

  it('snapshot fields are optional and never carry reasonText', async () => {
    const rows = [
      row('a', OrderStatus.DELIVERY_FAILED, ShipmentStatus.DELIVERY_ATTEMPTED),
      row('b', OrderStatus.DELIVERY_FAILED, ShipmentStatus.DELIVERY_ATTEMPTED),
    ];
    const { svc } = make(rows, new Map([['s-a', att('2026-11-10T10:00:00Z')]]), [
      {
        shipmentId: 's-a',
        attemptsFailed: 2,
        attemptsMax: 3,
        deadlineDays: 4,
        remarkVerified: false,
      },
    ]);
    const out = await svc.list('sel-1');
    const a = out.find((o) => o.orderId === 'a');
    const b = out.find((o) => o.orderId === 'b');
    expect(a).toMatchObject({
      attemptsFailed: 2,
      attemptsMax: 3,
      deadlineDays: 4,
      remarkVerified: false,
    });
    expect(b).toMatchObject({
      attemptsFailed: null,
      deadlineDays: null,
      remarkVerified: null,
      failedAt: null,
    });
    expect(JSON.stringify(out)).not.toContain('reasonText');
  });
});
