import { BadRequestException } from '@nestjs/common';
import { ChargeType, Prisma } from '@skydrop/db';
import { CourierMarginReportService } from '../../src/modules/courier-ops/services/courier-margin-report.service';
import { CourierWarehouseRegistrationService } from '../../src/modules/courier-ops/services/courier-warehouse-registration.service';

const CLIENT = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

function shipment(over: Record<string, unknown> = {}) {
  return {
    id: 'ship-1',
    shipmentNumber: 'SH-1',
    awbNumber: '38061110478262',
    destPostalCode: '560001',
    totalWeightGrams: 1500,
    declaredWeightGrams: null,
    chargeableWeightGrams: null,
    codAmountInr: new Prisma.Decimal('2400'),
    courierCode: 'delhivery',
    courierAccountId: 'dl-1',
    orderShipments: [{ orderId: 'order-1' }],
    ...over,
  };
}

function makeReport(
  opts: {
    originPin?: string | null;
    shipments?: ReturnType<typeof shipment>[];
    charges?: { type: ChargeType; totalAmountInr: Prisma.Decimal }[];
    checkThrows?: Error;
    failPersist?: boolean;
  } = {},
) {
  const chargeFindMany = jest.fn(async (args: { where: { type?: { in: ChargeType[] } } }) => {
    const all = opts.charges ?? [
      { type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('100') },
    ];
    const allowed = args.where.type?.in;
    return allowed === undefined ? all : all.filter((c) => allowed.includes(c.type));
  });

  const check = jest.fn(async (input: { billedToSellerInr: string }) => ({
    lane: '110042→560001',
    billedToSellerInr: input.billedToSellerInr,
    actualCourierCostInr: '176.29',
    marginInr: new Prisma.Decimal(input.billedToSellerInr).sub('176.29').toFixed(2),
    marginPercent: '0.00',
    lossMaking: new Prisma.Decimal(input.billedToSellerInr).lt('176.29'),
    assumedCostInr: null,
    assumptionDriftInr: null,
  }));
  if (opts.checkThrows !== undefined) {
    check.mockRejectedValue(opts.checkThrows);
  }

  const shipmentUpdate = jest.fn<
    Promise<unknown>,
    [{ where: { id: string }; data: Record<string, unknown> }]
  >(async () => {
    if (opts.failPersist === true) throw new Error('db is down');
    return {};
  });
  const prisma = {
    client: {
      shipment: {
        findMany: jest.fn(async () => opts.shipments ?? [shipment()]),
        // Persisting the priced cost. `failPersist` proves a write
        // failure cannot discard a reading we already paid an API call
        // to obtain.
        update: shipmentUpdate,
      },
      orderCharge: { findMany: chargeFindMany },
    },
  };
  const context = {
    originPin: jest.fn(async () => (opts.originPin === undefined ? '110042' : opts.originPin)),
  };
  const estimateLane = jest.fn();
  const svc = new CourierMarginReportService(
    prisma as never,
    context as never,
    { check } as never,
    // Shiprocket rows are priced against Shiprocket. Every fixture here
    // is Delhivery, so this double asserts by never being called.
    { estimateLane } as never,
  );
  return { svc, check, chargeFindMany, shipmentUpdate, estimateLane };
}

const WINDOW = {
  from: new Date('2026-07-01T00:00:00.000Z'),
  to: new Date('2026-07-31T00:00:00.000Z'),
  limit: 25,
};

describe('CourierMarginReportService', () => {
  it('compares billed against the courier cost and totals both', async () => {
    const { svc } = makeReport({
      charges: [{ type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('200') }],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.sampledShipments).toBe(1);
    expect(r.totalBilledInr).toBe('200.00');
    expect(r.totalActualCostInr).toBe('176.29');
    expect(r.totalMarginInr).toBe('23.71');
    expect(r.lossMakingCount).toBe(0);
  });

  it('flags a loss-making lane', async () => {
    // The whole point of measuring against the real cost rather than a
    // typed-in one: a rate card written when fuel was cheaper.
    const { svc } = makeReport({
      charges: [{ type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('120') }],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.lossMakingCount).toBe(1);
    expect(r.rows[0]?.lossMaking).toBe(true);
  });

  it('EXCLUDES GST from the billed figure', async () => {
    // The courier's cost figure is pre-tax. Including our GST would
    // inflate every margin by 18% and make loss-making lanes look fine.
    const { svc } = makeReport({
      charges: [
        { type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('200') },
        { type: ChargeType.GST, totalAmountInr: new Prisma.Decimal('36') },
      ],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.totalBilledInr).toBe('200.00');
  });

  it('EXCLUDES RTO and reshipment fees — they price a SECOND movement', async () => {
    // Folding a return leg into the forward margin would make a
    // returned parcel look like the profitable kind.
    const { svc } = makeReport({
      charges: [
        { type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('200') },
        { type: ChargeType.RTO_FEE, totalAmountInr: new Prisma.Decimal('150') },
        { type: ChargeType.RESHIPMENT_FEE, totalAmountInr: new Prisma.Decimal('90') },
      ],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.totalBilledInr).toBe('200.00');
  });

  it('INCLUDES the COD fee and fuel surcharge — both are the price of this carriage', async () => {
    const { svc } = makeReport({
      charges: [
        { type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('200') },
        { type: ChargeType.COD_FEE, totalAmountInr: new Prisma.Decimal('25') },
        { type: ChargeType.FUEL_SURCHARGE, totalAmountInr: new Prisma.Decimal('15') },
      ],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.totalBilledInr).toBe('240.00');
  });

  it('lists what it skipped rather than silently shrinking the sample', async () => {
    // A report that quietly covered 1 of 2 shipments reads as complete.
    const { svc } = makeReport({
      shipments: [shipment(), shipment({ id: 'ship-2', orderShipments: [] })],
    });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.sampledShipments).toBe(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/no linked order/i);
  });

  it('skips an order with no persisted charges instead of scoring it zero', async () => {
    const { svc } = makeReport({ charges: [] });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.sampledShipments).toBe(0);
    expect(r.skipped[0]?.reason).toMatch(/no shipping charges/i);
  });

  it('survives a failed cost lookup, keeping the rest of the sample', async () => {
    const { svc } = makeReport({ checkThrows: new Error('rate budget exhausted') });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.sampledShipments).toBe(0);
    expect(r.skipped[0]?.reason).toContain('rate budget exhausted');
  });

  it('explains itself when the origin pincode is unconfigured', async () => {
    const { svc, check } = makeReport({ originPin: null });
    const r = await svc.report('staff-1', WINDOW);
    expect(r.rows).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/origin pincode is not configured/i);
    expect(check).not.toHaveBeenCalled();
  });
});

/**
 * The pickup-location name is matched character-for-character on every
 * shipment create and CANNOT be changed after registration. A trailing
 * space would permanently break manifesting, so it is refused before it
 * can reach the wire.
 */
describe('CourierWarehouseRegistrationService — the exact-name guard', () => {
  function make() {
    const audit = jest.fn(async () => undefined);
    const register = jest.fn(async () => ({
      success: true,
      name: 'Skydrop',
      message: null,
      raw: null,
    }));
    const svc = new CourierWarehouseRegistrationService(
      { log: audit } as never,
      { register, update: register } as never,
      // Registration now goes through the courier-agnostic dispatcher.
      // The double forwards to the SAME `register` mock, so the
      // exact-name assertions below keep testing what they did — the
      // name guard is the point of this suite, not the transport.
      {
        registerWarehouse: async (input: { name: string }) => {
          const r = await register();
          return { success: r.success, message: r.message, name: input.name };
        },
      } as never,
    );
    return { svc, register, audit };
  }

  const BASE = {
    name: 'Skydrop',
    phone: '+919812345678',
    pin: '110042',
    returnAddress: '1 Warehouse Road',
  };

  it('accepts an exact name', async () => {
    const { svc, register } = make();
    const out = await svc.register('staff-1', BASE, CLIENT);
    expect(out.success).toBe(true);
    expect(register).toHaveBeenCalled();
  });

  it('refuses a trailing space BEFORE anything reaches the courier', async () => {
    const { svc, register } = make();
    await expect(
      svc.register('staff-1', { ...BASE, name: 'Skydrop ' }, CLIENT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(register).not.toHaveBeenCalled();
  });

  it('refuses a leading space too', async () => {
    const { svc, register } = make();
    await expect(
      svc.register('staff-1', { ...BASE, name: ' Skydrop' }, CLIENT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(register).not.toHaveBeenCalled();
  });

  it('audits registration at HIGH — the name becomes permanent', async () => {
    const { svc, audit } = make();
    await svc.register('staff-1', BASE, CLIENT);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.warehouse.registered',
        severity: 'HIGH',
      }),
    );
  });

  it('audits an update at MEDIUM — everything but the name can change', async () => {
    const { svc, audit } = make();
    await svc.update('staff-1', BASE, CLIENT);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.warehouse.updated',
        severity: 'MEDIUM',
      }),
    );
  });
});

describe('CourierMarginReportService — the cost it learns is kept', () => {
  it('persists the real cost onto the shipment, so the P&L has a base to read', async () => {
    // Each row costs a live call to a rate-limited API. Discarding the
    // answer meant every report, and the P&L behind it, started from
    // nothing again.
    const sut = makeReport();
    await sut.svc.report('staff-1', WINDOW);
    expect(sut.shipmentUpdate).toHaveBeenCalledTimes(1);
    const arg = sut.shipmentUpdate.mock.calls[0]?.[0];
    expect(arg?.where.id).toBe('ship-1');
    expect(String(arg?.data['actualCourierCostInr'])).toBe('176.29');
  });

  it('a failed write does NOT discard the reading it already paid for', async () => {
    // The persist sits outside the cost-lookup try on purpose: the price
    // is already known and already in the report, so a database blip
    // must not turn a successful reading into a skipped row.
    const sut = makeReport({ failPersist: true });
    const r = await sut.svc.report('staff-1', WINDOW);
    expect(r.sampledShipments).toBe(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.rows[0]?.actualCourierCostInr).toBe('176.29');
  });
});

/**
 * The report sweeps every non-manual shipment and asks what each one
 * cost. Asking one courier about another's parcel does not fail — it
 * returns a plausible number for a lane that company never carried, and
 * the margin computed from it is fiction that accumulates into the P&L.
 */
describe('CourierMarginReportService — each row is priced by the courier that carried it', () => {
  it('prices a Shiprocket parcel against Shiprocket, never against Delhivery', async () => {
    const { svc, check, estimateLane } = makeReport({
      shipments: [shipment({ id: 'ship-sr', courierCode: 'shiprocket', courierAccountId: 'sr-1' })],
      charges: [{ type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('120') }],
    });
    (estimateLane as jest.Mock).mockResolvedValue({
      etdDays: 3,
      totalInr: 90,
      carrierName: 'Delhivery Surface via SR',
      fromLiveApi: true,
    });

    const report = await svc.report('staff-1', WINDOW);

    expect(estimateLane).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.actualCourierCostInr).toBe('90');
    expect(report.rows[0]?.marginInr).toBe('30');
    // Their quote has no rate-card assumption to drift against. Zero
    // would claim the card is exactly right about a courier it has
    // never priced.
    expect(report.rows[0]?.assumedCostInr).toBeNull();
    expect(report.rows[0]?.assumptionDriftInr).toBeNull();
  });

  it('SKIPS a Shiprocket parcel with no rate rather than counting it as free', async () => {
    const { svc, estimateLane } = makeReport({
      shipments: [shipment({ id: 'ship-sr', courierCode: 'shiprocket', courierAccountId: 'sr-1' })],
      charges: [{ type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('120') }],
    });
    (estimateLane as jest.Mock).mockResolvedValue({
      etdDays: null,
      totalInr: null,
      carrierName: null,
      fromLiveApi: true,
    });

    const report = await svc.report('staff-1', WINDOW);

    // A zero cost would make the parcel look perfectly profitable and
    // drag the report's average with it.
    expect(report.rows).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
  });

  it('skips, rather than mis-prices, a Shiprocket parcel with no account recorded', async () => {
    const { svc, estimateLane } = makeReport({
      shipments: [shipment({ id: 'ship-sr', courierCode: 'shiprocket', courierAccountId: null })],
      charges: [{ type: ChargeType.BASE_SHIPPING, totalAmountInr: new Prisma.Decimal('120') }],
    });

    const report = await svc.report('staff-1', WINDOW);

    expect(estimateLane).not.toHaveBeenCalled();
    expect(report.skipped).toHaveLength(1);
  });
});
