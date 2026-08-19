import { describe, expect, it } from 'vitest';
import {
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  ConsignmentStatus,
  GoodsReceiptStatus,
} from '@skydrop/db';
import { consignmentStatusKind } from '@skydrop/ui/status';
import type { ConsignmentLegView, ConsignmentView } from '@skydrop/api-client';
import {
  cancellable,
  countedUnits,
  countingInProgress,
  declaredUnits,
  eventWords,
  indiaLegs,
  legTitle,
  productCount,
  routeWords,
  statusWords,
} from '@/app/(authed)/inbound/_components/consignment-words';

/**
 * The consignment vocabulary a seller reads, and the one cosmetic rule
 * that decides whether cancelling is offered at all.
 *
 * Two things are worth pinning here. Every enum value must route — a
 * value that falls through throws, and the whole point of the F2
 * switches is that a new route or status cannot appear as a blank cell.
 * And `AT_BD` must not read like `COMPLETED`: counted in Dhaka is not
 * sellable stock, and a seller who reads it as arrived starts taking
 * orders against goods that are in the wrong country.
 */

function leg(over: Partial<ConsignmentLegView> = {}): ConsignmentLegView {
  return {
    id: 'leg-1',
    receiptNumber: 'GR-1',
    leg: ConsignmentLeg.IN_FINAL,
    status: GoodsReceiptStatus.PENDING,
    warehouseId: 'wh-1',
    dispatchedAt: null,
    receivedAt: null,
    hasDiscrepancies: false,
    discrepancyNotes: null,
    warehouse: { id: 'wh-1', code: 'IN-BLR', name: 'Bangalore', countryCode: 'IN' },
    lines: [],
    ...over,
  };
}

function line(over: Partial<ConsignmentLegView['lines'][number]> = {}) {
  return {
    id: 'l-1',
    variantId: 'v-1',
    expectedQty: 10,
    receivedQty: null,
    damagedQty: null,
    batchId: null,
    variant: { skuCode: 'SKU-1', variantLabel: null, product: { name: 'Sunglasses' } },
    ...over,
  };
}

function consignment(over: Partial<ConsignmentView> = {}): ConsignmentView {
  return {
    id: 'c-1',
    consignmentNumber: 'CN-2026-08-0001',
    sellerId: 's-1',
    route: ConsignmentRoute.VIA_BD,
    status: ConsignmentStatus.PENDING,
    labellingSite: 'NONE',
    labelsPrintedAt: null,
    expectedArrivalAt: null,
    sellerReference: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    seller: { id: 's-1', companyName: 'Acme', emailDisplay: 'a@b.c' },
    receipts: [],
    freightCharge: null,
    ...over,
  };
}

describe('every consignment value is routed', () => {
  it('maps every status to a kind and to words', () => {
    for (const s of Object.values(ConsignmentStatus)) {
      expect(() => consignmentStatusKind(s)).not.toThrow();
      expect(statusWords(s).length).toBeGreaterThan(0);
    }
  });

  it('maps every route and every event type', () => {
    for (const r of Object.values(ConsignmentRoute)) {
      expect(routeWords(r).title.length).toBeGreaterThan(0);
      expect(routeWords(r).blurb.length).toBeGreaterThan(0);
    }
    for (const t of Object.values(ConsignmentEventType)) {
      expect(eventWords(t).length).toBeGreaterThan(0);
    }
  });

  it('does NOT paint stock sitting in Dhaka like stock that arrived in India', () => {
    expect(consignmentStatusKind(ConsignmentStatus.AT_BD)).not.toBe(
      consignmentStatusKind(ConsignmentStatus.COMPLETED),
    );
  });

  it('says which country the goods are in, in words a seller reads', () => {
    expect(statusWords(ConsignmentStatus.AT_BD)).toMatch(/dhaka/i);
    expect(routeWords(ConsignmentRoute.VIA_BD).blurb).toMatch(/freight/i);
  });
});

describe('cancelling is offered only before anything has left', () => {
  it('is offered on a freshly announced consignment', () => {
    expect(cancellable(consignment())).toBe(true);
  });

  it('is withdrawn the moment ONE leg has been dispatched', () => {
    const c = consignment({
      status: ConsignmentStatus.AT_BD,
      receipts: [
        leg({ id: 'bd', leg: ConsignmentLeg.BD_INTAKE }),
        leg({ id: 'in', dispatchedAt: '2026-08-05T00:00:00.000Z' }),
      ],
    });
    expect(cancellable(c)).toBe(false);
  });

  it('is withdrawn once it is finished or already cancelled', () => {
    expect(cancellable(consignment({ status: ConsignmentStatus.COMPLETED }))).toBe(false);
    expect(cancellable(consignment({ status: ConsignmentStatus.CANCELLED }))).toBe(false);
  });
});

describe('what the seller is told about the contents', () => {
  it('counts a product once even when it flew in two shipments', () => {
    const c = consignment({
      receipts: [
        leg({
          id: 'a',
          lines: [line({ variantId: 'v-1' }), line({ id: 'l-2', variantId: 'v-2' })],
        }),
        leg({ id: 'b', lines: [line({ id: 'l-3', variantId: 'v-1' })] }),
      ],
    });
    expect(productCount(c)).toBe(2);
  });

  it('the STATUS decides whether anything has been counted, never the quantity', () => {
    // This asserted the opposite and shipped the bug it was meant to
    // prevent. `receivedQty` defaults to 0 on a line nobody has touched,
    // so "counted zero" and "not counted" were the same value — and a
    // seller who had announced 300 units a minute earlier was shown a
    // red warning saying 300 were missing.
    const pending = leg({ lines: [line({ expectedQty: 7, receivedQty: 0 })] });
    expect(declaredUnits(pending)).toBe(7);
    expect(countedUnits(pending)).toBeNull();

    // A warehouse that genuinely opened the carton and found nothing is
    // a real zero, and says so.
    const emptyOnArrival = leg({
      status: GoodsReceiptStatus.COMPLETED,
      lines: [line({ expectedQty: 7, receivedQty: 0 })],
    });
    expect(countedUnits(emptyOnArrival)).toBe(0);

    const counted = leg({
      status: GoodsReceiptStatus.COMPLETED,
      lines: [line({ expectedQty: 7, receivedQty: 5 })],
    });
    expect(countedUnits(counted)).toBe(5);
  });

  it('tells "being counted now" apart from "not counted yet"', () => {
    // Three states, not two. The middle one is a warehouse standing at
    // the bench with numbers already typed but the receipt not yet
    // completed — recorded, not committed. Collapsing it either way is
    // wrong: reading the quantities alone reported a shortfall on a
    // consignment nobody had opened, and ignoring them told the seller
    // nothing was happening while somebody was actively counting.
    const untouched = leg({
      status: GoodsReceiptStatus.ARRIVING,
      lines: [line({ expectedQty: 200, receivedQty: 0 })],
    });
    expect(countingInProgress(untouched)).toBe(false);
    expect(countedUnits(untouched)).toBeNull();

    const midCount = leg({
      status: GoodsReceiptStatus.ARRIVING,
      lines: [line({ expectedQty: 200, receivedQty: 198 })],
    });
    expect(countingInProgress(midCount)).toBe(true);
    // Still null: the numbers are provisional until Complete writes
    // stock, so no difference is computed against them.
    expect(countedUnits(midCount)).toBeNull();

    const done = leg({
      status: GoodsReceiptStatus.COMPLETED,
      lines: [line({ expectedQty: 200, receivedQty: 198 })],
    });
    expect(countingInProgress(done)).toBe(false);
    expect(countedUnits(done)).toBe(198);
  });

  it('numbers the India legs only when there is more than one', () => {
    const one = consignment({ receipts: [leg({ id: 'in-1' })] });
    expect(legTitle(leg({ id: 'in-1' }), one.route, indiaLegs(one))).toBe('Arrival in India');

    const two = consignment({ receipts: [leg({ id: 'in-1' }), leg({ id: 'in-2' })] });
    expect(legTitle(leg({ id: 'in-2' }), two.route, indiaLegs(two))).toBe(
      'Shipment 2 of 2 to India',
    );
  });

  it('names the Bangladesh leg by what it is, never by its enum', () => {
    const c = consignment();
    const bd = leg({ leg: ConsignmentLeg.BD_INTAKE });
    expect(legTitle(bd, c.route, indiaLegs(c))).toMatch(/bangladesh/i);
    expect(indiaLegs(consignment({ receipts: [bd] }))).toHaveLength(0);
  });
});
