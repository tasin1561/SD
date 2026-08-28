import { CourierDistributionService } from '../../src/modules/courier-shared/services/courier-distribution.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Link = { weight: number; code: string; courierId: string; id: string };

const COURIER = { isActive: true, deletedAt: null, supportsCod: true, supportsPrepaid: true };

function makeSut(
  opts: {
    links?: Link[];
    accounts?: Array<{ id: string; code: string; courierId: string }>;
    settings?: Record<string, { valueString?: string; valueInt?: number }>;
    anyActive?: { id: string; code: string; courierId: string } | null;
  } = {},
) {
  const client = {
    sellerCourierAccountLink: {
      findMany: async () =>
        (opts.links ?? []).map((l) => ({
          distributionWeight: l.weight,
          courierAccount: {
            id: l.id,
            label: l.id,
            courierId: l.courierId,
            courier: { ...COURIER, code: l.code },
          },
        })),
    },
    courierAccount: {
      findMany: async () =>
        (opts.accounts ?? []).map((a) => ({
          id: a.id,
          label: a.id,
          courierId: a.courierId,
          courier: { ...COURIER, code: a.code },
        })),
      findFirst: async () =>
        opts.anyActive === undefined
          ? {
              id: 'fallback',
              label: 'fallback',
              courierId: 'c-any',
              courier: { code: 'delhivery' },
            }
          : opts.anyActive === null
            ? null
            : {
                id: opts.anyActive.id,
                label: opts.anyActive.id,
                courierId: opts.anyActive.courierId,
                courier: { code: opts.anyActive.code },
              },
    },
    systemSetting: {
      findUnique: async (a: { where: { key: string } }) => opts.settings?.[a.where.key] ?? null,
    },
  };
  return new CourierDistributionService({ client } as unknown as PrismaService);
}

/** Draw many times so a weighted split is measurable rather than lucky. */
async function drawMany(
  svc: CourierDistributionService,
  n = 4000,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) {
    const r = await svc.pick('s1', { paymentMode: 'COD' as never });
    const key = r?.courierAccountId ?? 'none';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('CourierDistributionService — a seller with their own split', () => {
  it('honours weights that do NOT sum to 100', async () => {
    // The example that prompted this: 50/30/20/10 sums to 110. Demanding
    // exactly 100 would mean a seller cannot drop an account without
    // editing every other one, and the failure mode of getting it wrong
    // is a parcel with no account at all.
    const svc = makeSut({
      links: [
        { weight: 50, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-A' },
        { weight: 30, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-B' },
        { weight: 20, code: 'shiprocket', courierId: 'c-sr', id: 'sr-A' },
        { weight: 10, code: 'shiprocket', courierId: 'c-sr', id: 'sr-C' },
      ],
    });

    const counts = await drawMany(svc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // Normalised against 110, so ~45.5% / ~27.3% / ~18.2% / ~9.1%.
    expect((counts['dlv-A'] ?? 0) / total).toBeCloseTo(50 / 110, 1);
    expect((counts['sr-C'] ?? 0) / total).toBeCloseTo(10 / 110, 1);
    expect(Object.keys(counts).sort()).toEqual(['dlv-A', 'dlv-B', 'sr-A', 'sr-C']);
  });

  it('never draws an account weighted zero — that is how one is switched off', async () => {
    const svc = makeSut({
      links: [
        { weight: 100, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-A' },
        { weight: 0, code: 'shiprocket', courierId: 'c-sr', id: 'sr-A' },
      ],
    });
    const counts = await drawMany(svc, 500);
    expect(counts['sr-A']).toBeUndefined();
  });

  it('overrides the global split entirely', async () => {
    // The seller's own distribution is the answer, not a modifier on
    // top of the global one.
    const svc = makeSut({
      links: [{ weight: 1, code: 'shiprocket', courierId: 'c-sr', id: 'sr-A' }],
      settings: {
        'courier.default_account_delhivery': { valueString: 'dlv-default' },
        'courier.delhivery_share_percent': { valueInt: 100 },
      },
    });
    const r = await svc.pick('s1', { paymentMode: 'COD' as never });
    expect(r).toMatchObject({ courierAccountId: 'sr-A', source: 'SELLER_DISTRIBUTION' });
  });
});

describe('CourierDistributionService — the global split', () => {
  it('splits between the two defaults at roughly the configured share', async () => {
    const svc = makeSut({
      links: [],
      accounts: [
        { id: 'dlv-default', code: 'delhivery', courierId: 'c-dlv' },
        { id: 'sr-default', code: 'shiprocket', courierId: 'c-sr' },
      ],
      settings: {
        'courier.default_account_delhivery': { valueString: 'dlv-default' },
        'courier.default_account_shiprocket': { valueString: 'sr-default' },
        'courier.delhivery_share_percent': { valueInt: 70 },
      },
    });
    const counts = await drawMany(svc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect((counts['dlv-default'] ?? 0) / total).toBeCloseTo(0.7, 1);
    expect((counts['sr-default'] ?? 0) / total).toBeCloseTo(0.3, 1);
  });

  it('sends everything one way at 100, without ever drawing the other', async () => {
    const svc = makeSut({
      links: [],
      accounts: [
        { id: 'dlv-default', code: 'delhivery', courierId: 'c-dlv' },
        { id: 'sr-default', code: 'shiprocket', courierId: 'c-sr' },
      ],
      settings: {
        'courier.default_account_delhivery': { valueString: 'dlv-default' },
        'courier.default_account_shiprocket': { valueString: 'sr-default' },
        'courier.delhivery_share_percent': { valueInt: 100 },
      },
    });
    const counts = await drawMany(svc, 800);
    expect(counts['sr-default']).toBeUndefined();
  });

  it('falls back to any active account when nothing is configured', async () => {
    // A fresh install has no defaults set, and a parcel must still ship.
    const svc = makeSut({ links: [], accounts: [], settings: {} });
    const r = await svc.pick('s1', { paymentMode: 'COD' as never });
    expect(r).toMatchObject({ source: 'ONLY_ACTIVE' });
  });

  it('returns null when nothing at all can carry it, rather than inventing one', async () => {
    const svc = makeSut({ links: [], accounts: [], settings: {}, anyActive: null });
    expect(await svc.pick('s1', { paymentMode: 'COD' as never })).toBeNull();
  });
});

describe('CourierDistributionService.pickAlternate', () => {
  it('picks a different COURIER, not merely a different account', async () => {
    // A second Delhivery account refuses a pincode Delhivery does not
    // serve for the same reason the first did — retrying there spends a
    // call to learn what we already know.
    const svc = makeSut({
      links: [
        { weight: 50, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-A' },
        { weight: 50, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-B' },
        { weight: 10, code: 'shiprocket', courierId: 'c-sr', id: 'sr-A' },
      ],
    });
    for (let i = 0; i < 50; i += 1) {
      const r = await svc.pickAlternate('s1', {
        paymentMode: 'COD' as never,
        excludeCourierId: 'c-dlv',
      });
      expect(r?.courierAccountId).toBe('sr-A');
    }
  });

  it('returns null when there is no other courier to try', async () => {
    const svc = makeSut({
      links: [{ weight: 1, code: 'delhivery', courierId: 'c-dlv', id: 'dlv-A' }],
      anyActive: null,
    });
    const r = await svc.pickAlternate('s1', {
      paymentMode: 'COD' as never,
      excludeCourierId: 'c-dlv',
    });
    expect(r).toBeNull();
  });
});
