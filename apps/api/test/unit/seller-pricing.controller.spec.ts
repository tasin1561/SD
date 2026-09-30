import { Prisma } from '@skydrop/db';
import {
  SellerPricingController,
  type SellerFeeView,
} from '../../src/modules/pricing/controllers/seller-pricing.controller';
import type {
  PricedFee,
  PricingEngineService,
} from '../../src/modules/pricing/services/pricing-engine.service';

/**
 * The seller's own read of what a parcel costs them.
 *
 * Until this endpoint existed, NOT ONE of the three flat fees was
 * readable anywhere in the seller app: `/wallet/limits` names only when
 * the delivery fee is taken, and the single figure on any screen was the
 * literal `₹200` in the return dialog's copy. Every one of them is a
 * per-seller setting with its own currency (PRC-8).
 *
 * The property that matters here is the one the dialogs rely on: an
 * UNPRICEABLE fee comes back as `amountInr: null`, never as a zero. PRC-8
 * already refuses to charge a zero in that case; answering one here
 * would put "free return" on screen and then take money for it.
 */
function priced(over: Partial<PricedFee> = {}): PricedFee {
  return {
    amountInr: new Prisma.Decimal('200'),
    priced: true,
    sourceAmount: new Prisma.Decimal('200'),
    sourceCurrency: 'INR' as PricedFee['sourceCurrency'],
    rate: null,
    source: 'SYSTEM_DEFAULT',
    currencySource: 'SYSTEM_DEFAULT',
    unresolved: [],
    ...over,
  };
}

function controller(fees: { delivery: PricedFee; rto: PricedFee; customerReturn: PricedFee }): {
  ctl: SellerPricingController;
  instants: Date[];
} {
  const instants: Date[] = [];
  const engine = {
    priceDeliveryFee: (_s: string, at: Date) => {
      instants.push(at);
      return Promise.resolve(fees.delivery);
    },
    priceRtoFee: (_s: string, at: Date) => {
      instants.push(at);
      return Promise.resolve(fees.rto);
    },
    priceCustomerReturnFee: (_s: string, at: Date) => {
      instants.push(at);
      return Promise.resolve(fees.customerReturn);
    },
  };
  // A hand-built double for the one collaborator: the three methods the
  // controller calls, and nothing else the engine happens to have.
  return { ctl: new SellerPricingController(engine as PricingEngineService), instants };
}

const SELLER = { id: 'seller-1' } as Parameters<SellerPricingController['fees']>[0];

function byKind(items: readonly SellerFeeView[], kind: SellerFeeView['kind']): SellerFeeView {
  const f = items.find((i) => i.kind === kind);
  if (f === undefined) throw new Error(`no ${kind} fee in the response`);
  return f;
}

describe('SellerPricingController', () => {
  it('returns all three fees in rupees', async () => {
    const { ctl } = controller({
      delivery: priced({ amountInr: new Prisma.Decimal('162.60') }),
      rto: priced({ amountInr: new Prisma.Decimal('24.39') }),
      customerReturn: priced({ amountInr: new Prisma.Decimal('200') }),
    });
    const { items } = await ctl.fees(SELLER);
    expect(items.map((i) => i.kind)).toEqual(['delivery', 'return', 'customerReturn']);
    expect(byKind(items, 'delivery').amountInr).toBe('162.60');
    expect(byKind(items, 'return').amountInr).toBe('24.39');
    expect(byKind(items, 'customerReturn').amountInr).toBe('200.00');
  });

  it('carries what was AGREED beside the rupee figure, with the rate', async () => {
    const { ctl } = controller({
      delivery: priced({
        amountInr: new Prisma.Decimal('162.60'),
        sourceAmount: new Prisma.Decimal('200'),
        sourceCurrency: 'BDT' as PricedFee['sourceCurrency'],
        rate: {
          inrPerUnit: new Prisma.Decimal('0.813'),
          storedPair: 'INR/BDT',
          storedRate: '1.23',
          source: 'CURRENT',
          recordedAt: null,
        },
      }),
      rto: priced(),
      customerReturn: priced(),
    });
    const d = byKind((await ctl.fees(SELLER)).items, 'delivery');
    expect(d.agreedAmount).toBe('200.00');
    expect(d.agreedCurrency).toBe('BDT');
    // The rate AS STORED, which is the number on the FX screen — not
    // the reciprocal the conversion used, which matches nothing.
    expect(d.fxRate).toBe('1.23');
    expect(d.fxRatePair).toBe('INR/BDT');
  });

  it('answers NULL rather than zero for a fee it could not price', async () => {
    const { ctl } = controller({
      delivery: priced(),
      rto: priced(),
      customerReturn: priced({
        priced: false,
        // PRC-8 leaves amountInr at 0 so downstream arithmetic needs no
        // null-handling; nothing should ever SHOW that zero.
        amountInr: new Prisma.Decimal('0'),
        sourceAmount: new Prisma.Decimal('200'),
        sourceCurrency: 'BDT' as PricedFee['sourceCurrency'],
      }),
    });
    const f = byKind((await ctl.fees(SELLER)).items, 'customerReturn');
    expect(f.amountInr).toBeNull();
    // The agreed figure survives — it is the only true thing left.
    expect(f.agreedAmount).toBe('200.00');
    expect(f.agreedCurrency).toBe('BDT');
  });

  it('prices all three at ONE instant', async () => {
    const { ctl, instants } = controller({
      delivery: priced(),
      rto: priced(),
      customerReturn: priced(),
    });
    await ctl.fees(SELLER);
    expect(instants).toHaveLength(3);
    // Two figures on one screen converted at two different rates would
    // be a screen that disagrees with itself.
    expect(new Set(instants.map((d) => d.getTime())).size).toBe(1);
  });
});
