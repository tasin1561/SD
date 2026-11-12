/**
 * The order header shows every AWB beside the client's own reference.
 *
 * Owner, 2026-11-12: the AWB is the number a courier, a customer and the
 * warehouse all quote, and it was only reachable by scrolling down to the
 * shipments section.
 *
 * This tests the derivation, not the whole page. Rendering OrderDetailView
 * to check one header line drags in every panel's data contract (a toast
 * provider, dated journey rows, charge shapes) and fails for reasons that
 * have nothing to do with the header — it did, three times, before this
 * was written.
 */
import { describe, expect, it } from 'vitest';
import { orderAwbs } from '@/app/(authed)/orders/_components/order-detail';

describe('orderAwbs — the AWBs shown in the order header', () => {
  it('returns the AWB of a booked shipment', () => {
    expect(orderAwbs([{ awbNumber: '38061110627406' }])).toEqual(['38061110627406']);
  });

  it('returns every AWB of a split order, each once, in shipment order', () => {
    expect(
      orderAwbs([{ awbNumber: 'AWB-ONE' }, { awbNumber: 'AWB-TWO' }, { awbNumber: 'AWB-ONE' }]),
    ).toEqual(['AWB-ONE', 'AWB-TWO']);
  });

  it('contributes nothing for a shipment not booked yet', () => {
    // Null, missing and whitespace-only must all drop out — any of them
    // left in would print "AWB:" with nothing after it.
    expect(orderAwbs([{ awbNumber: null }, {}, { awbNumber: '   ' }])).toEqual([]);
  });

  it('returns nothing for an order with no shipments', () => {
    expect(orderAwbs([])).toEqual([]);
  });
});
