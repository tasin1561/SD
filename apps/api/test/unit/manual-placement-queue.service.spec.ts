import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { ManualPlacementQueueService } from '../../src/modules/courier-manual-placement/services/manual-placement-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';

type Res = { binId: string | null; batchId: string | null };

function link(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: 'o-1',
    shipmentId: 'live-1',
    order: {
      orderNumber: 'SD-2026-26-000003',
      sellerId: 'sel-1',
      codAmountInr: null,
      updatedAt: new Date('2026-09-02T08:00:00Z'),
      seller: { companyName: 'Acme' },
    },
    shipment: {
      shipmentNumber: 'SH-2026-09-000013',
      createdAt: new Date('2026-09-02T09:00:00Z'),
      destCity: 'Bangalore',
      destPostalCode: '560001',
      supersedesShipmentId: 'retired-1',
    },
    ...over,
  };
}

function makeService(opts: {
  links?: Array<Record<string, unknown>>;
  reservations?: Res[];
  auditError?: string | null;
  retiredReason?: string | null;
}) {
  const findMany = jest.fn(async (_args: { where: unknown }) => opts.links ?? [link()]);
  const auditFindMany = jest.fn(async () =>
    opts.auditError === undefined || opts.auditError === null
      ? []
      : [
          {
            entityId: 'o-1',
            metadata: { error: opts.auditError },
            createdAt: new Date('2026-09-02T09:00:01Z'),
          },
        ],
  );
  const shipmentFindMany = jest.fn(async () => [
    { id: 'retired-1', supersedeReason: opts.retiredReason ?? 'awb_rejected' },
  ]);

  const client = {
    orderShipment: { findMany },
    auditLog: { findMany: auditFindMany },
    shipment: { findMany: shipmentFindMany },
  };
  const reservations = {
    listActiveForOrderWithLocations: jest.fn(
      async () => opts.reservations ?? [{ binId: 'b1', batchId: 'ba1' }],
    ),
  };
  const svc = new ManualPlacementQueueService(
    { client } as unknown as PrismaService,
    reservations as unknown as StockReservationService,
  );
  return { svc, findMany };
}

describe('ManualPlacementQueueService.list', () => {
  const NOW = new Date('2026-09-02T15:00:00Z');

  it('selects only the LIVE shipment — never the retired one it replaced', async () => {
    // A refusal retires the old shipment and creates a replacement
    // (CUR-7), so an order here usually has two. Typing the waybill on
    // the retired one is refused, so a worklist that offered either
    // would be handing out a broken row half the time.
    const { svc, findMany } = makeService({});
    await svc.list(NOW);

    const where = findMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      shipment: {
        status: ShipmentStatus.CREATED,
        awbNumber: null,
        supersededAt: null,
        deletedAt: null,
      },
      order: { status: OrderStatus.PENDING_MANUAL_PLACEMENT },
    });
  });

  it("surfaces the courier's own words, not a paraphrase", async () => {
    // "[ER0005] suspicious order/consignee" and "pincode not served"
    // need completely different responses, and they look identical in a
    // list of order numbers.
    const { svc } = makeService({
      auditError:
        '[ER0005] Crashing while saving package due to exception suspicious order/consignee',
    });
    const [row] = await svc.list(NOW);

    expect(row?.reason).toContain('ER0005');
    expect(row?.reasonCode).toBe('awb_rejected');
  });

  it('says whether the parcel still needs picking', async () => {
    // Decides what happens after the waybill is typed — out today, or
    // into the warehouse queue (CUR-8 as amended). Worth knowing before
    // promising a courier a collection time.
    const picked = await makeService({ reservations: [{ binId: 'b1', batchId: 'ba1' }] }).svc.list(
      NOW,
    );
    expect(picked[0]?.needsPicking).toBe(false);

    const unpicked = await makeService({
      reservations: [
        { binId: 'b1', batchId: 'ba1' },
        { binId: null, batchId: null },
      ],
    }).svc.list(NOW);
    expect(unpicked[0]?.needsPicking).toBe(true);
  });

  it('counts the wait from when the parcel arrived here, not from the order', async () => {
    const { svc } = makeService({});
    const [row] = await svc.list(NOW);
    // Shipment created 09:00, now 15:00.
    expect(row?.waitingHours).toBe(6);
  });

  it('returns nothing — and asks nothing further — when the queue is empty', async () => {
    const { svc } = makeService({ links: [] });
    expect(await svc.list(NOW)).toEqual([]);
  });
});
