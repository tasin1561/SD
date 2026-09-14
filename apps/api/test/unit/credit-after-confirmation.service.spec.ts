import { ConflictException } from '@nestjs/common';
import { ResellerCreditTrigger, SettingValueType } from '@skydrop/db';
import {
  CREDIT_AFTER_CONFIRMATION_KEY,
  CreditAfterConfirmationService,
} from '../../src/modules/reseller-store-terms/services/credit-after-confirmation.service';
import {
  DEDICATED_OVERRIDE_KEYS,
  SettingsResolverService,
} from '../../src/modules/settings/services/settings-resolver.service';

const SELLER_ID = '0190bbbb-0000-7000-8000-000000000001';

function harness(
  initial: boolean,
  stores: Array<{ id: string; trigger: ResellerCreditTrigger }> = [],
) {
  let enabled = initial;
  const settings = {
    resolve: jest.fn(async () => ({
      key: CREDIT_AFTER_CONFIRMATION_KEY,
      valueType: SettingValueType.BOOLEAN,
      value: enabled,
      source: 'SELLER_OVERRIDE',
    })),
    setOverride: jest.fn(async (_s: string, _k: string, input: { value: unknown }) => {
      enabled = input.value === true;
      return {};
    }),
  };
  const prisma = {
    client: {
      seller: { findFirst: jest.fn(async () => ({ id: SELLER_ID })) },
      sellerStore: {
        findMany: jest.fn(async () =>
          stores.map((s) => ({
            id: s.id,
            name: `Store ${s.id.slice(-1)}`,
            displayName: null,
            termsVersions: [
              {
                version: 3,
                storeCreditTrigger: s.trigger,
                sellerCreditTrigger: ResellerCreditTrigger.ON_PAYOUT,
              },
            ],
          })),
        ),
      },
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const notifier = { needsRevision: jest.fn(async () => undefined) };
  const svc = new CreditAfterConfirmationService(
    prisma as never,
    audit as never,
    settings as never,
    notifier as never,
  );
  return { svc, settings, audit, notifier };
}

describe('CreditAfterConfirmationService (RS-4, decision 10)', () => {
  it('writes through the settings resolver as the DEDICATED writer, and audits HIGH', async () => {
    const h = harness(false);
    await h.svc.set(
      SELLER_ID,
      { enabled: true, reason: 'Agreed with the owner on the call.' },
      'staff-1',
    );
    expect(h.settings.setOverride).toHaveBeenCalledWith(
      SELLER_ID,
      CREDIT_AFTER_CONFIRMATION_KEY,
      expect.objectContaining({ valueType: SettingValueType.BOOLEAN, value: true }),
      { staffId: 'staff-1', dedicated: true },
    );
    const entry = (h.audit.log.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(entry).toMatchObject({
      severity: 'HIGH',
      action: 'staff.reseller_credit_after_confirmation.enabled',
      entityId: SELLER_ID,
    });
  });

  it('switching OFF flags the stores still using it and tells the seller — rewriting nothing', async () => {
    const h = harness(true, [
      {
        id: '0190aaaa-0000-7000-8000-000000000001',
        trigger: ResellerCreditTrigger.AFTER_CONFIRMATION,
      },
      { id: '0190aaaa-0000-7000-8000-000000000002', trigger: ResellerCreditTrigger.ON_PAYOUT },
    ]);
    const after = await h.svc.set(
      SELLER_ID,
      { enabled: false, reason: 'Risk review: paused for this seller.' },
      'staff-1',
    );
    expect(after.enabled).toBe(false);
    expect(after.flaggedStores).toEqual([
      { storeId: '0190aaaa-0000-7000-8000-000000000001', storeName: 'Store 1', version: 3 },
    ]);
    expect(h.notifier.needsRevision).toHaveBeenCalledTimes(1);
  });

  it('reports no flagged stores while it is on', async () => {
    const h = harness(true, [
      {
        id: '0190aaaa-0000-7000-8000-000000000001',
        trigger: ResellerCreditTrigger.AFTER_CONFIRMATION,
      },
    ]);
    expect((await h.svc.status(SELLER_ID)).flaggedStores).toEqual([]);
  });

  it('fails CLOSED: an unreadable setting reads as off', async () => {
    const h = harness(true);
    h.settings.resolve.mockRejectedValueOnce(new Error('db down'));
    expect(await h.svc.isEnabled(SELLER_ID)).toBe(false);
  });
});

describe('SettingsResolverService — a dedicated key has one door (RS-4)', () => {
  const prisma = { client: { $transaction: jest.fn() } };
  const svc = new SettingsResolverService(prisma as never, { log: jest.fn() } as never);

  it('names the credit-after-confirmation key', () => {
    expect(Object.keys(DEDICATED_OVERRIDE_KEYS)).toContain(CREDIT_AFTER_CONFIRMATION_KEY);
  });

  it('refuses the generic writer (staff or seller) before touching the database', async () => {
    for (const actor of ['staff-1', { staffId: 'staff-1' }, { sellerActor: true as const }]) {
      await expect(
        svc.setOverride(
          SELLER_ID,
          CREDIT_AFTER_CONFIRMATION_KEY,
          { valueType: SettingValueType.BOOLEAN, value: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    await expect(
      svc.clearOverride(SELLER_ID, CREDIT_AFTER_CONFIRMATION_KEY, 'staff-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });
});
