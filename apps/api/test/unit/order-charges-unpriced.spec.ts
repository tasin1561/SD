import { ConflictException } from '@nestjs/common';
import { OrderChargesService } from '../../src/modules/order-charges/services/order-charges.service';
import type { PricingComputeOutput } from '../../src/modules/pricing/services/pricing-engine.service';

/**
 * An order whose price could not be computed must NOT be recorded at ₹0.
 *
 * The pricing engine answers even when the data behind it is missing: an
 * unresolved destination falls back to the DEFAULT zone, no rate card
 * item matches DEFAULT, base shipping comes out ₹0, and GST — being a
 * percentage of that — comes out ₹0 too. The whole order prices at
 * ₹0.00 with nothing but a flag in `unresolved` to say why.
 *
 * Persisting that wrote ₹0 onto the order as its real price. Verified
 * against production before the fix: with 27 pincodes loaded out of
 * roughly 19,000, Meerut, Rewa, Jamshedpur and Karaikudi all quoted
 * ₹0.00 total. Every one of those parcels would have shipped free.
 *
 * Nothing failed. That is what makes this worth a test: a zero is a
 * perfectly valid Decimal, the transaction commits, the UI renders
 * "₹0.00" without complaint, and the loss only surfaces when someone
 * reconciles courier invoices against what sellers were billed.
 */
describe('OrderChargesService — refuses to price what it could not compute', () => {
  const ORDER_ID = '019fad84-7acd-754e-8ee4-43cf858fed82';

  function build(unresolved: PricingComputeOutput['unresolved'], baseShippingInr = '0.00') {
    const created: unknown[] = [];
    const order = {
      id: ORDER_ID,
      sellerId: 'seller-1',
      recipientPostalCode: '250001',
      recipientCountryCode: 'IN',
      paymentMode: 'PREPAID',
      codAmountInr: '0',
      declaredValueInr: '500',
      totalWeightGrams: 500,
    };
    const tx = {
      orderCharge: {
        create: (a: unknown) => {
          created.push(a);
          return Promise.resolve({});
        },
      },
    };
    const prisma = {
      client: {
        order: { findFirst: () => Promise.resolve(order) },
        orderCharge: { count: () => Promise.resolve(0) },
        $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      },
    };
    const pricing = {
      compute: () =>
        Promise.resolve({
          rateCardId: 'rc-1',
          rateCardCode: 'DEFAULT',
          courierId: 'c-1',
          courierCode: 'delhivery',
          serviceType: 'SURFACE',
          zone: 'DEFAULT',
          serviceArea: null,
          chargeableWeightGrams: 500,
          baseShippingInr,
          sellerDiscountPercent: null,
          surcharges: [],
          gstRatePercent: '18',
          gstAmountInr: '0.00',
          totalInr: '0.00',
          computationContext: {},
          unresolved,
          margin: { baseChargeInr: baseShippingInr, costToSkydropInr: null, marginInr: null },
        } as unknown as PricingComputeOutput),
    };
    const audit = { log: () => Promise.resolve(undefined) };

    // (prisma, audit, pricing) — the real order.
    const svc = new OrderChargesService(prisma as never, audit as never, pricing as never);
    return { svc, created };
  }

  it('throws PRICING_UNRESOLVED when no rate card item matched', async () => {
    const { svc, created } = build([
      { reason: 'ZONE_FALLBACK_DEFAULT' },
      { reason: 'NO_RATE_CARD_ITEM' },
    ]);

    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toThrow(ConflictException);
    // The important half: nothing was written. A guard that throws AFTER
    // persisting would leave the ₹0 rows behind.
    expect(created).toEqual([]);
  });

  it('throws when there is no rate card at all, with a machine-readable code', async () => {
    const { svc } = build([{ reason: 'NO_RATE_CARD' }]);
    // The code lives on the response body, not in `.message` — the UI
    // renders `[CODE] message` from the body (FE-2), so that is what
    // has to be right.
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toMatchObject({
      response: { code: 'PRICING_UNRESOLVED' },
    });
  });

  it('names the destination and zone, so the operator knows what to fix', async () => {
    const { svc } = build([{ reason: 'NO_RATE_CARD_ITEM' }]);
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toThrow(/250001/);
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toThrow(/DEFAULT/);
  });

  it('does NOT block on the soft fallbacks', async () => {
    // A GST-rate fallback, or a DEFAULT zone that still matched a rate,
    // are warnings — the price is real. Blocking on these would refuse
    // to price perfectly good orders.
    const { svc, created } = build(
      [{ reason: 'NO_GST_RATE' }, { reason: 'ZONE_FALLBACK_DEFAULT' }],
      '130.00',
    );
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).resolves.toBeDefined();
    expect(created.length).toBeGreaterThan(0);
  });
});
