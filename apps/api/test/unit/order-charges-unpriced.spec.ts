import { ConflictException } from '@nestjs/common';
import { OrderChargesService } from '../../src/modules/order-charges/services/order-charges.service';
import type { PricingComputeOutput } from '../../src/modules/pricing/services/pricing-engine.service';

/**
 * An order whose price could not be resolved must NOT be recorded at ₹0.
 *
 * The pricing engine answers even when the fee behind it is missing — it
 * returns ₹0.00 and a flag. Persisting that writes ₹0 onto the order as
 * its real price.
 *
 * Under the old zone/slab engine this was the COMMON case, not the edge
 * one: an unlisted pincode fell through to a "DEFAULT" zone no rate card
 * item matched. Verified against production at the time — with 27
 * pincodes loaded out of roughly 19,000, Meerut, Rewa, Jamshedpur and
 * Karaikudi all quoted ₹0.00 total.
 *
 * Flat pricing removed that seam, but a deleted or zeroed setting can
 * still land here, so the guard stays. Nothing fails on its own: a zero
 * is a perfectly valid Decimal, the transaction commits, the UI renders
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

  it('throws PRICING_UNRESOLVED when the flat fee resolved to zero', async () => {
    const { svc, created } = build([{ reason: 'NO_FLAT_DELIVERY_FEE' }]);

    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toThrow(ConflictException);
    // The important half: nothing was written. A guard that throws AFTER
    // persisting would leave the ₹0 rows behind.
    expect(created).toEqual([]);
  });

  it('carries a machine-readable code, not just a message', async () => {
    const { svc } = build([{ reason: 'NO_FLAT_DELIVERY_FEE' }]);
    // The code lives on the response body, not in `.message` — the UI
    // renders `[CODE] message` from the body (FE-2), so that is what
    // has to be right.
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toMatchObject({
      response: { code: 'PRICING_UNRESOLVED' },
    });
  });

  it('names the setting to fix, so the operator is not left guessing', async () => {
    const { svc } = build([{ reason: 'NO_FLAT_DELIVERY_FEE' }]);
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).rejects.toThrow(
      /pricing\.flat_delivery_fee_inr/,
    );
  });

  it('prices normally when the fee resolved', async () => {
    // Nothing unresolved — the ordinary path, which must not be
    // collateral damage of the guard above.
    const { svc, created } = build([], '200.00');
    await expect(svc.persistForOrder(ORDER_ID, 'staff-1')).resolves.toBeDefined();
    expect(created.length).toBeGreaterThan(0);
  });
});
