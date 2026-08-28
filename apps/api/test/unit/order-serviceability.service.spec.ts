import { PaymentMode } from '@skydrop/db';
import { OrderServiceabilityService } from '../../src/modules/courier-serviceability/services/order-serviceability.service';
import type { ServiceabilityCacheService } from '../../src/modules/courier-serviceability/services/serviceability-cache.service';
import type { DelhiveryServiceabilityService } from '../../src/modules/courier-delhivery/services/delhivery-serviceability.service';
import type { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';
import type { CourierDistributionService } from '../../src/modules/courier-shared/services/courier-distribution.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function makeService(opts: {
  delhiveryOk?: boolean;
  shiprocketServiceable?: boolean;
  shiprocketThrows?: boolean;
  noShiprocketAccount?: boolean;
  originPin?: string | null;
}) {
  const canShip = jest.fn(async () => ({
    ok: opts.delhiveryOk ?? true,
    reason: opts.delhiveryOk === false ? 'pin not served' : null,
  }));
  const checkServiceability = jest.fn(async () => {
    if (opts.shiprocketThrows === true) throw new Error('shiprocket 503');
    return { serviceable: opts.shiprocketServiceable ?? false, fromLiveApi: true };
  });
  const anyAccountFor = jest.fn(async () =>
    opts.noShiprocketAccount === true
      ? null
      : { courierAccountId: 'sr-1', courierCode: 'shiprocket' },
  );

  // The cache is a pass-through here: what is under test is the verdict
  // the resolver produces, not the caching of it.
  const cache = {
    get: async (
      _pin: string,
      _mode: PaymentMode,
      resolve: () => Promise<{ ok: boolean; reason: string | null }>,
    ) => {
      const r = await resolve();
      return { serviceable: r.ok, reason: r.reason };
    },
  };

  const prisma = {
    client: {
      systemSetting: {
        findUnique: jest.fn(async () => ({
          valueString: opts.originPin === undefined ? '560001' : opts.originPin,
        })),
      },
    },
  };

  const svc = new OrderServiceabilityService(
    cache as unknown as ServiceabilityCacheService,
    { canShip } as unknown as DelhiveryServiceabilityService,
    { checkServiceability } as unknown as ShiprocketClientService,
    { anyAccountFor } as unknown as CourierDistributionService,
    prisma as unknown as PrismaService,
  );
  return { svc, canShip, checkServiceability, anyAccountFor };
}

const INPUT = { pincode: '110001', paymentMode: PaymentMode.COD };

/**
 * The check has to predict what the SYSTEM will do, not what one courier
 * will do. Since the AWB saga fails over, a pin Delhivery refuses is
 * still deliverable if Shiprocket serves it — and refusing the order
 * here would make the check stricter than the behaviour it exists to
 * predict, turning away business the warehouse would have shipped.
 */
describe('OrderServiceabilityService — two couriers', () => {
  it('does not ask the second courier when the first will carry it', async () => {
    const { svc, checkServiceability } = makeService({ delhiveryOk: true });
    const v = await svc.check(INPUT);

    expect(v.serviceable).toBe(true);
    // A second call per order, for an answer that cannot change the
    // verdict, is latency on the order form for nothing.
    expect(checkServiceability).not.toHaveBeenCalled();
  });

  it('one courier refusing is not an answer — the other is asked', async () => {
    const { svc, checkServiceability } = makeService({
      delhiveryOk: false,
      shiprocketServiceable: true,
    });
    const v = await svc.check(INPUT);

    expect(checkServiceability).toHaveBeenCalled();
    expect(v.serviceable).toBe(true);
  });

  it('BOTH refusing is the only unserviceable verdict, and keeps the first reason', async () => {
    const { svc } = makeService({ delhiveryOk: false, shiprocketServiceable: false });
    const v = await svc.check(INPUT);

    expect(v.serviceable).toBe(false);
    expect(v.reason).toBe('pin not served');
  });

  it('fails OPEN when the second courier cannot be asked', async () => {
    // An unconfigured or unreachable second courier must not be able to
    // block an order — unknown is not a refusal, which is the rule the
    // whole service is built on.
    for (const opts of [
      { delhiveryOk: false, noShiprocketAccount: true },
      { delhiveryOk: false, shiprocketThrows: true },
      { delhiveryOk: false, originPin: null },
    ]) {
      const { svc } = makeService(opts);
      const v = await svc.check(INPUT);
      expect(v.serviceable).toBe(true);
    }
  });

  it('a malformed pin never reaches a courier at all', async () => {
    const { svc, canShip, checkServiceability } = makeService({});
    const v = await svc.check({ ...INPUT, pincode: '12' });

    expect(canShip).not.toHaveBeenCalled();
    expect(checkServiceability).not.toHaveBeenCalled();
    // A validation problem, not a serviceability one.
    expect(v.known).toBe(false);
    expect(v.serviceable).toBe(true);
  });
});
