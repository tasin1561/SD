import {
  ChargeType,
  PaymentMode,
  Prisma,
  ServiceArea,
  SettingValueType,
  SurchargeComputationMethod,
  SurchargeType,
} from '@skydrop/db';
import { MarginCalculationService } from '../../src/modules/pricing/services/margin-calculation.service';
import { PricingEngineService } from '../../src/modules/pricing/services/pricing-engine.service';
import { ZoneResolverService } from '../../src/modules/pricing/services/zone-resolver.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

interface SetupOpts {
  readonly rateCard?: AnyArgs | null;
  readonly sellerPricing?: AnyArgs | null;
  readonly courier?: AnyArgs | null;
  readonly pin?: AnyArgs | null;
  readonly zoneMatrix?: AnyArgs | null;
  readonly rateCardItem?: AnyArgs | null;
  readonly surcharges?: AnyArgs[];
  readonly gstRate?: string;
  readonly defaultCourierCode?: string;
}

function makeSut(opts: SetupOpts = {}) {
  const pinCode = {
    findUnique: jest.fn(async () => opts.pin ?? null),
  };
  const zoneMatrixEntry = {
    findUnique: jest.fn(async () => opts.zoneMatrix ?? null),
  };
  const rateCard = {
    findFirst: jest.fn(async () => opts.rateCard ?? null),
  };
  const sellerPricing = {
    findFirst: jest.fn(async () => opts.sellerPricing ?? null),
  };
  const courier = {
    findUnique: jest.fn(async () => opts.courier ?? null),
  };
  const rateCardItem = {
    findFirst: jest.fn(async () => opts.rateCardItem ?? null),
  };
  const surchargeRule = {
    findMany: jest.fn(async () => opts.surcharges ?? []),
  };
  const systemSetting = {
    findUnique: jest.fn(async (args: AnyArgs) => {
      const where = args.where as { key: string };
      if (where.key === 'pricing.gst_rate') {
        return opts.gstRate
          ? {
              key: 'pricing.gst_rate',
              valueType: SettingValueType.DECIMAL,
              valueString: null,
              valueInt: null,
              valueDecimal: new Prisma.Decimal(opts.gstRate),
              valueBoolean: null,
              valueJson: null,
              valueDate: null,
            }
          : null;
      }
      if (where.key === 'ops.default_courier_code') {
        return opts.defaultCourierCode
          ? {
              key: 'ops.default_courier_code',
              valueType: SettingValueType.STRING,
              valueString: opts.defaultCourierCode,
              valueInt: null,
              valueDecimal: null,
              valueBoolean: null,
              valueJson: null,
              valueDate: null,
            }
          : null;
      }
      return null;
    }),
  };

  const client = {
    pinCode,
    zoneMatrixEntry,
    rateCard,
    sellerPricing,
    courier,
    rateCardItem,
    surchargeRule,
    systemSetting,
  };
  const prisma = { client } as unknown as PrismaService;
  const zoneResolver = new ZoneResolverService(prisma);
  return new PricingEngineService(prisma, zoneResolver, new MarginCalculationService());
}

describe('PricingEngineService.compute', () => {
  it('returns zero base + UNRESOLVED flags when no rate card item exists', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: {
        pinCode: '110001',
        serviceArea: ServiceArea.METRO,
        zone: 'Z1',
      },
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(out.baseShippingInr).toBe('0.00');
    expect(out.unresolved.some((u) => u.reason === 'NO_RATE_CARD_ITEM')).toBe(true);
    expect(out.surcharges).toHaveLength(0);
    expect(out.gstAmountInr).toBe('0.00');
  });

  it('computes base + flat surcharge + GST end-to-end', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: {
        pinCode: '110001',
        serviceArea: ServiceArea.METRO,
        zone: 'Z1',
      },
      rateCardItem: {
        id: 'rci-1',
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: null,
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
      surcharges: [
        {
          id: 'sr-1',
          type: SurchargeType.FUEL_SURCHARGE,
          name: 'Fuel surcharge',
          computationMethod: SurchargeComputationMethod.FLAT,
          flatAmountInr: new Prisma.Decimal('10'),
          percentage: null,
          minAmountInr: null,
          maxAmountInr: null,
          baseField: null,
          appliesOnlyIfPaymentMode: null,
          appliesOnlyForServiceAreas: [],
          isVisibleToSeller: true,
          displayOrder: 0,
          isActive: true,
        },
      ],
      gstRate: '18',
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(out.baseShippingInr).toBe('80.00');
    expect(out.surcharges).toHaveLength(1);
    expect(out.surcharges[0]?.amountInr).toBe('10.00');
    expect(out.surcharges[0]?.type).toBe(ChargeType.FUEL_SURCHARGE);
    // GST = (80 + 10) * 0.18 = 16.20
    expect(out.gstAmountInr).toBe('16.20');
    // Total = 80 + 10 + 16.20 = 106.20
    expect(out.totalInr).toBe('106.20');
    // R1c: no costToSkydropInr seeded on this rate card item → margin unknown, not zero.
    expect(out.margin).toEqual({ baseChargeInr: '80.00', costToSkydropInr: null, marginInr: null });
    expect(out.computationContext.margin).toEqual(out.margin);
  });

  it('R1c: computes a real margin when costToSkydropInr is seeded on the rate card item', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        id: 'rci-1',
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: null,
        costToSkydropInr: new Prisma.Decimal('55'),
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(out.margin).toEqual({
      baseChargeInr: '80.00',
      costToSkydropInr: '55.00',
      marginInr: '25.00',
    });
  });

  it('R1c: margin reflects the POST-discount seller charge, not the rate-card sticker price', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      sellerPricing: {
        id: 'sp-1',
        rateCardId: 'rc-1',
        discountPercent: new Prisma.Decimal('25'),
        codFeePercent: null,
        courierId: null,
      },
      rateCardItem: {
        id: 'rci-1',
        baseChargeInr: new Prisma.Decimal('100'),
        perKgChargeInr: null,
        costToSkydropInr: new Prisma.Decimal('55'),
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    // 100 - 25% = 75 charged to the seller; margin = 75 - 55 = 20 (not 100-55=45).
    expect(out.baseShippingInr).toBe('75.00');
    expect(out.margin).toEqual({
      baseChargeInr: '75.00',
      costToSkydropInr: '55.00',
      marginInr: '20.00',
    });
  });

  it('R1c: a deep discount can drive margin negative — surfaced, not clamped', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      sellerPricing: {
        id: 'sp-1',
        rateCardId: 'rc-1',
        discountPercent: new Prisma.Decimal('50'),
        codFeePercent: null,
        courierId: null,
      },
      rateCardItem: {
        id: 'rci-1',
        baseChargeInr: new Prisma.Decimal('100'),
        perKgChargeInr: null,
        costToSkydropInr: new Prisma.Decimal('55'),
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    // 100 - 50% = 50 charged; margin = 50 - 55 = -5.
    expect(out.margin).toEqual({
      baseChargeInr: '50.00',
      costToSkydropInr: '55.00',
      marginInr: '-5.00',
    });
  });

  it('applies SellerPricing.discountPercent to base shipping', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      sellerPricing: {
        id: 'sp-1',
        rateCardId: 'rc-1',
        discountPercent: new Prisma.Decimal('20'),
        codFeePercent: null,
      },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        baseChargeInr: new Prisma.Decimal('100'),
        perKgChargeInr: null,
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
      gstRate: '18',
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    // 100 * (1 - 0.20) = 80
    expect(out.baseShippingInr).toBe('80.00');
    expect(out.sellerDiscountPercent).toBe('20.00');
  });

  it('honors SellerPricing.codFeePercent (COD-only)', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      sellerPricing: {
        id: 'sp-1',
        rateCardId: 'rc-1',
        discountPercent: null,
        codFeePercent: new Prisma.Decimal('1.5'),
      },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: null,
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
      gstRate: '18',
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.COD,
      codAmountInr: 1000,
      declaredValueInr: 800,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    // COD fee = 1000 * 0.015 = 15
    const codLine = out.surcharges.find((l) => l.type === ChargeType.COD_FEE);
    expect(codLine?.amountInr).toBe('15.00');
  });

  it('PERCENTAGE surcharge with DECLARED_VALUE base + min/max clamps', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: null,
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
      surcharges: [
        {
          id: 'sr-1',
          type: SurchargeType.OTHER,
          name: 'Insurance',
          computationMethod: SurchargeComputationMethod.PERCENTAGE,
          flatAmountInr: null,
          percentage: new Prisma.Decimal('2'),
          minAmountInr: new Prisma.Decimal('5'),
          maxAmountInr: new Prisma.Decimal('25'),
          baseField: 'DECLARED_VALUE',
          appliesOnlyIfPaymentMode: null,
          appliesOnlyForServiceAreas: [],
          isVisibleToSeller: true,
          displayOrder: 0,
          isActive: true,
        },
      ],
      gstRate: '18',
    });
    // 2% of 1000 = 20 → no clamp needed
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 1000,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(out.surcharges[0]?.amountInr).toBe('20.00');

    // 2% of 100 = 2 → clamped UP to min=5
    const outLow = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 100,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(outLow.surcharges[0]?.amountInr).toBe('5.00');

    // 2% of 10000 = 200 → clamped DOWN to max=25
    const outHigh = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 10000,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(outHigh.surcharges[0]?.amountInr).toBe('25.00');
  });

  it('filters surcharges by paymentMode + serviceArea', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: null,
        weightSlabFromGrams: 0,
        weightSlabToGrams: 500,
      },
      surcharges: [
        // COD-only — skipped on prepaid order.
        {
          id: 'sr-1',
          type: SurchargeType.COD_FEE,
          name: 'COD handling',
          computationMethod: SurchargeComputationMethod.FLAT,
          flatAmountInr: new Prisma.Decimal('30'),
          percentage: null,
          minAmountInr: null,
          maxAmountInr: null,
          baseField: null,
          appliesOnlyIfPaymentMode: PaymentMode.COD,
          appliesOnlyForServiceAreas: [],
          isVisibleToSeller: true,
          displayOrder: 0,
          isActive: true,
        },
        // Special_NE only — skipped on METRO destination.
        {
          id: 'sr-2',
          type: SurchargeType.REMOTE_AREA_FEE,
          name: 'NE remote area',
          computationMethod: SurchargeComputationMethod.FLAT,
          flatAmountInr: new Prisma.Decimal('40'),
          percentage: null,
          minAmountInr: null,
          maxAmountInr: null,
          baseField: null,
          appliesOnlyIfPaymentMode: null,
          appliesOnlyForServiceAreas: [ServiceArea.SPECIAL_NE],
          isVisibleToSeller: true,
          displayOrder: 0,
          isActive: true,
        },
      ],
      gstRate: '18',
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
      courierCode: 'delhivery',
    });
    expect(out.surcharges).toHaveLength(0);
  });

  it('applies perKgChargeInr above the slab floor', async () => {
    const svc = makeSut({
      rateCard: { id: 'rc-1', code: 'default-2026' },
      courier: { id: 'c-1', code: 'delhivery' },
      pin: { pinCode: '110001', serviceArea: ServiceArea.METRO, zone: 'Z1' },
      rateCardItem: {
        baseChargeInr: new Prisma.Decimal('80'),
        perKgChargeInr: new Prisma.Decimal('20'),
        weightSlabFromGrams: 500,
        weightSlabToGrams: 5000,
      },
      gstRate: '18',
    });
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 1500,
      courierCode: 'delhivery',
    });
    // 80 + ((1500 - 500) / 1000) * 20 = 80 + 20 = 100
    expect(out.baseShippingInr).toBe('100.00');
  });

  it('NO_RATE_CARD + NO_COURIER unresolved when seeds are bare', async () => {
    const svc = makeSut({});
    const out = await svc.compute({
      sellerId: 's-1',
      recipientPostalCode: '110001',
      paymentMode: PaymentMode.PREPAID,
      codAmountInr: 0,
      declaredValueInr: 500,
      totalWeightGrams: 300,
    });
    const reasons = out.unresolved.map((u) => u.reason);
    expect(reasons).toContain('NO_RATE_CARD');
    expect(reasons).toContain('NO_COURIER');
    expect(out.baseShippingInr).toBe('0.00');
    expect(out.totalInr).toBe('0.00');
  });

  it('rejects negative weight with INVALID_WEIGHT', async () => {
    const svc = makeSut({});
    await expect(
      svc.compute({
        sellerId: 's-1',
        recipientPostalCode: '110001',
        paymentMode: PaymentMode.PREPAID,
        codAmountInr: 0,
        declaredValueInr: 500,
        totalWeightGrams: -1,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_WEIGHT' } });
  });
});
