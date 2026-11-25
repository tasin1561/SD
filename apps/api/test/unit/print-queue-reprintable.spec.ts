import { OrderStatus } from '@skydrop/db';
import { PrintQueueService } from '../../src/modules/warehouse-printing/services/print-queue.service';

/**
 * Owner, 2026-11-25: a label torn while the parcel is in a picker's tote
 * must still be reprintable — the boundary is NOT PACKED, not "not picked".
 */
function svc() {
  const findMany = jest.fn(async () => []);
  const s = new PrintQueueService({ client: { orderShipment: { findMany } } } as never);
  return { s, findMany };
}
type Where = { order: { status: { in: OrderStatus[] } }; shipment: Record<string, unknown> };
const whereOf = (m: jest.Mock): Where =>
  (m.mock.calls[0] as unknown as [{ where: Where }])[0].where;

describe('reprint list', () => {
  it('includes PICKED parcels, and still only unpacked, labelled ones', async () => {
    const { s, findMany } = svc();
    await s.reprintable();
    const w = whereOf(findMany);
    expect(w.order.status.in).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.PENDING_PICK,
      OrderStatus.PICKED,
    ]);
    expect(w.shipment).toMatchObject({ packCompletedAt: null, labelPrintedAt: { not: null } });
  });

  it('the label queue is unchanged (no PICKED there)', async () => {
    const { s, findMany } = svc();
    await s.awaitingLabel();
    expect(whereOf(findMany).order.status.in).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.PENDING_PICK,
    ]);
  });
});
