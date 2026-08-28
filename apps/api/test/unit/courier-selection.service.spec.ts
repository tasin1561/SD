import { CourierSelectionService } from '../../src/modules/courier-shared/services/courier-selection.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CourierAccountRoutingService } from '../../src/modules/courier-shared/services/courier-account-routing.service';

type Courier = {
  id: string;
  code: string;
  isActive: boolean;
  supportsCod: boolean;
  supportsPrepaid: boolean;
  priorityForRouting: number;
};

const DELHIVERY: Courier = {
  id: 'c-dlv',
  code: 'delhivery',
  isActive: true,
  supportsCod: true,
  supportsPrepaid: true,
  priorityForRouting: 100,
};
const SHIPROCKET: Courier = {
  id: 'c-sr',
  code: 'shiprocket',
  isActive: true,
  supportsCod: true,
  supportsPrepaid: true,
  priorityForRouting: 50,
};

function makeSut(
  opts: {
    linked?: Courier[];
    active?: Array<{ id: string; code: string }>;
    defaultCode?: string;
  } = {},
) {
  const client = {
    sellerCourierAccountLink: {
      findMany: async () =>
        (opts.linked ?? []).map((c) => ({ courierAccount: { courierId: c.id, courier: c } })),
    },
    courier: {
      findMany: async () => (opts.active ?? []).slice(0, 1),
      findUnique: async () => ({ id: 'c-dlv', code: opts.defaultCode ?? 'delhivery' }),
    },
    systemSetting: {
      findUnique: async () => ({ valueString: opts.defaultCode ?? 'delhivery' }),
    },
  };
  const accounts = {
    selectAccount: async (_s: string, courierId: string) => ({
      courierAccountId: `acct-${courierId}`,
      source: 'SELLER_LINK' as const,
    }),
  } as unknown as CourierAccountRoutingService;
  return new CourierSelectionService({ client } as unknown as PrismaService, accounts);
}

describe('CourierSelectionService', () => {
  it('uses what the seller is actually set up with', async () => {
    // The links already exist and already carry distribution weights. A
    // seller linked to Shiprocket accounts is a seller who ships
    // Shiprocket — no separate preference needed.
    const svc = makeSut({ linked: [SHIPROCKET] });
    const r = await svc.selectForSeller('s1', { paymentMode: 'COD' as never });
    expect(r).toMatchObject({
      courierCode: 'shiprocket',
      courierAccountId: 'acct-c-sr',
      reason: 'SELLER_LINK',
    });
  });

  it('prefers the lower priority number when a seller has both', async () => {
    const svc = makeSut({ linked: [DELHIVERY, SHIPROCKET] });
    const r = await svc.selectForSeller('s1', { paymentMode: 'COD' as never });
    expect(r.courierCode).toBe('shiprocket');
  });

  it('will not pick a courier that cannot carry the payment mode', async () => {
    // A prepaid-only courier on a COD order is a rejected AWB and a
    // manual placement, discovered after the parcel is picked.
    const prepaidOnly = { ...SHIPROCKET, supportsCod: false };
    const svc = makeSut({ linked: [DELHIVERY, prepaidOnly] });
    const r = await svc.selectForSeller('s1', { paymentMode: 'COD' as never });
    expect(r.courierCode).toBe('delhivery');
  });

  it('skips an inactive courier even when the seller is linked to it', async () => {
    const svc = makeSut({
      linked: [{ ...SHIPROCKET, isActive: false }, DELHIVERY],
    });
    const r = await svc.selectForSeller('s1', { paymentMode: 'COD' as never });
    expect(r.courierCode).toBe('delhivery');
  });

  it('falls back to the highest-priority courier when nobody linked them', async () => {
    const svc = makeSut({ linked: [], active: [{ id: 'c-sr', code: 'shiprocket' }] });
    const r = await svc.selectForSeller('s1', { paymentMode: 'PREPAID' as never });
    expect(r).toMatchObject({ courierCode: 'shiprocket', reason: 'PRIORITY' });
  });

  it('falls back to the configured default rather than failing the provision', async () => {
    // Reached only when no courier is active at all — a configuration
    // problem, not a routing one. Returning the default keeps the
    // parcel moving instead of blocking a transition.
    const svc = makeSut({ linked: [], active: [] });
    const r = await svc.selectForSeller('s1', { paymentMode: 'COD' as never });
    expect(r).toMatchObject({ courierCode: 'delhivery', reason: 'DEFAULT' });
  });
});
