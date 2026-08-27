import { SellerWithdrawalScheduleController } from '../../src/modules/seller-wallet-withdrawal/controllers/seller-withdrawal-schedule.controller';

function make() {
  const setOverride = jest.fn().mockResolvedValue({});
  const resolve = jest.fn(async (_id: string, key: string) =>
    key.endsWith('enabled')
      ? { value: true, source: 'SELLER_OVERRIDE' }
      : { value: 14, source: 'SYSTEM_DEFAULT' },
  );
  const prisma = {
    client: { seller: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Dhaka' })) } },
  };
  const c = new SellerWithdrawalScheduleController(
    { resolve, setOverride } as never,
    prisma as never,
  );
  return { c, setOverride, resolve };
}

const SELLER = { id: 's1' } as never;

describe('SellerWithdrawalScheduleController', () => {
  it('reports the schedule with the zone the hour is read in', async () => {
    const { c } = make();
    await expect(c.get(SELLER)).resolves.toEqual({
      autoEnabled: true,
      hourLocal: 14,
      // An hour means nothing without its zone, and the sweep uses the
      // seller's own (WAL-3).
      timezone: 'Asia/Dhaka',
      isOwnValue: true,
    });
  });

  it('writes ONLY the two hardcoded keys', async () => {
    const { c, setOverride } = make();
    await c.set(SELLER, { autoEnabled: false, hourLocal: 9 });

    const keys = (setOverride.mock.calls as unknown as Array<[string, string]>).map((k) => k[1]);
    // `sellerOverridable` marks keys an ADMIN may set per seller — the
    // same flag is on pricing.flat_delivery_fee_inr. An endpoint taking
    // a key NAME would let a seller zero their own delivery fee.
    expect(keys).toEqual(['wallet.auto_withdraw_enabled', 'wallet.auto_withdraw_hour_local']);
  });

  it('writes as the SELLER, so the audit does not misattribute it to staff', async () => {
    const { c, setOverride } = make();
    await c.set(SELLER, { autoEnabled: true });
    expect(setOverride.mock.calls[0]?.[3]).toEqual({ sellerActor: true });
  });

  it('leaves a field alone when it was not sent', async () => {
    const { c, setOverride } = make();
    await c.set(SELLER, { hourLocal: 6 });
    expect(setOverride).toHaveBeenCalledTimes(1);
    expect((setOverride.mock.calls[0] as unknown as [string, string])[1]).toBe(
      'wallet.auto_withdraw_hour_local',
    );
  });

  it('sends VALUES of the right type, not stringified ones', async () => {
    const { c, setOverride } = make();
    await c.set(SELLER, { autoEnabled: true, hourLocal: 9 });

    const calls = setOverride.mock.calls as unknown as Array<
      [string, string, { valueType: string; value: unknown }]
    >;
    // The resolver's BOOLEAN branch takes nothing but a real boolean,
    // unlike INT and DECIMAL which both accept a numeric string. This
    // spec previously asserted only WHICH keys were written, so passing
    // String(true) sailed through it and failed in production with
    // INVALID_VALUE "expected a boolean". A mock validates nothing on
    // its own — assert the value, not just the call.
    expect(calls[0]?.[2]).toEqual({ valueType: 'BOOLEAN', value: true });
    expect(typeof calls[0]?.[2].value).toBe('boolean');
    expect(calls[1]?.[2]).toEqual({ valueType: 'INT', value: 9 });
    expect(typeof calls[1]?.[2].value).toBe('number');
  });
});
