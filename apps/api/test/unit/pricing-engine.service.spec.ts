import { Prisma } from '@skydrop/db';
import { PricingEngineService } from '../../src/modules/pricing/services/pricing-engine.service';
import { MarginCalculationService } from '../../src/modules/pricing/services/margin-calculation.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Flat pricing: one fee per seller, anywhere in India.
 *
 * These tests are deliberately short, and that is the point — the
 * previous engine needed five hundred lines of them because a price
 * passed through a rate card, a courier, a service type, a postal zone,
 * a weight slab and a stack of percentage surcharges before it became a
 * number. Every join was somewhere it could come out wrong quietly, and
 * one did: an unlisted pincode fell through to a "DEFAULT" zone nothing
 * matched, and the order priced at ₹0.00.
 *
 * What is left worth testing is the resolution — whose number wins — and
 * the guard that stops a missing setting being recorded as free
 * shipping.
 */

const SELLER = '019fad84-7acd-754e-8ee4-43cf858fed82';

function makeSut(opts: {
  deliveryFee?: string | null;
  rtoFee?: string | null;
  source?: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  gstPercent?: string;
}): { svc: PricingEngineService } {
  const resolve = jest.fn(async (_sellerId: string, key: string) => ({
    key,
    valueType: 'DECIMAL',
    value: key.includes('rto') ? (opts.rtoFee ?? null) : (opts.deliveryFee ?? null),
    source: opts.source ?? 'SYSTEM_DEFAULT',
  }));
  const settings = { resolve } as unknown as SettingsResolverService;

  const findUnique = jest.fn(async () => ({
    valueDecimal: new Prisma.Decimal(opts.gstPercent ?? '0'),
  }));
  const prisma = {
    client: { systemSetting: { findUnique } },
  } as unknown as PrismaService;

  return {
    svc: new PricingEngineService(prisma, settings, new MarginCalculationService()),
  };
}

const INPUT = {
  sellerId: SELLER,
  recipientPostalCode: '110001',
  paymentMode: 'COD' as never,
  codAmountInr: 1500,
  declaredValueInr: 1500,
  totalWeightGrams: 1000,
};

describe('PricingEngineService — flat fee', () => {
  it('charges the flat fee, and nothing else', async () => {
    const { svc } = makeSut({ deliveryFee: '200.00' });
    const r = await svc.compute(INPUT);

    expect(r.baseShippingInr).toBe('200.00');
    // No COD fee on a ₹1,500 COD order, no fuel surcharge, no remote
    // area fee. "Flat" means a seller can predict the number without
    // knowing where the parcel is going.
    expect(r.surcharges).toEqual([]);
    expect(r.totalInr).toBe('200.00');
    expect(r.unresolved).toEqual([]);
  });

  it('is the same price regardless of destination or weight', async () => {
    const { svc } = makeSut({ deliveryFee: '200.00' });
    const delhi = await svc.compute(INPUT);
    const remote = await svc.compute({
      ...INPUT,
      recipientPostalCode: '797112', // Nagaland — the old zone E, 2.6× Delhi
      totalWeightGrams: 9000,
    });
    expect(remote.totalInr).toBe(delhi.totalInr);
  });

  it("a seller's override beats the global default — that is the whole point", async () => {
    const { svc } = makeSut({ deliveryFee: '150.00', source: 'SELLER_OVERRIDE' });
    const r = await svc.compute(INPUT);
    expect(r.baseShippingInr).toBe('150.00');
    // Recorded in the snapshot so a past order can say WHY it was priced
    // that way, not merely what it cost.
    expect(r.computationContext.flatFee).toMatchObject({
      deliveryFeeInr: '150.00',
      source: 'SELLER_OVERRIDE',
    });
  });

  it('GST is zero by default, and the line is still written', async () => {
    const { svc } = makeSut({ deliveryFee: '200.00' });
    const r = await svc.compute(INPUT);
    expect(r.gstRatePercent).toBe('0.00');
    expect(r.gstAmountInr).toBe('0.00');
    // An ABSENT gst figure reads as "we forgot"; an explicit zero reads
    // as "none was charged". The invoice consumes this line.
    expect(r.totalInr).toBe('200.00');
  });

  it('adds GST on top once the setting says to', async () => {
    // The whole reason the rate is a setting: switching it on later is a
    // decision, not a deployment.
    const { svc } = makeSut({ deliveryFee: '200.00', gstPercent: '18' });
    const r = await svc.compute(INPUT);
    expect(r.gstAmountInr).toBe('36.00');
    expect(r.totalInr).toBe('236.00');
  });

  it('a missing setting is FLAGGED, not silently priced at zero', async () => {
    const { svc } = makeSut({ deliveryFee: null });
    const r = await svc.compute(INPUT);
    expect(r.totalInr).toBe('0.00');
    // OrderChargesService refuses to persist on this flag. Without it a
    // deleted setting would ship every parcel free and nothing would
    // fail — the exact shape of the bug the old engine had.
    expect(r.unresolved.map((u) => u.reason)).toEqual(['NO_FLAT_DELIVERY_FEE']);
  });

  it('resolves the RTO fee separately and does not fold it into the order price', async () => {
    const { svc } = makeSut({ deliveryFee: '200.00', rtoFee: '30.00' });
    const r = await svc.compute(INPUT);
    // The order costs 200. It only costs 230 if it comes back, and that
    // is charged at RTO receive — predicting it here would bill every
    // seller for a return that mostly does not happen.
    expect(r.totalInr).toBe('200.00');

    const rto = await svc.resolveRtoFee(SELLER);
    expect(rto.amount.toFixed(2)).toBe('30.00');
  });

  it('rejects a negative weight rather than pricing it', async () => {
    const { svc } = makeSut({ deliveryFee: '200.00' });
    await expect(svc.compute({ ...INPUT, totalWeightGrams: -1 })).rejects.toMatchObject({
      response: { code: 'INVALID_WEIGHT' },
    });
  });
});
