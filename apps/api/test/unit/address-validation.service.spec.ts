import { AddressValidationService } from '../../src/modules/order/services/address-validation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeService(states: unknown = ['Karnataka', 'Maharashtra', 'Delhi']) {
  const findUnique = jest.fn<Promise<{ valueJson: unknown } | null>, [AnyArgs]>(
    async () => (states === null ? null : { valueJson: states }),
  );
  const client = { systemSetting: { findUnique } } as unknown as PrismaService['client'];
  const svc = new AddressValidationService({ client } as unknown as PrismaService);
  return { svc, findUnique };
}

const VALID = {
  recipientPhoneE164: '+919876543210',
  recipientPostalCode: '560001',
  recipientStateProvince: 'karnataka',
  recipientCountryCode: 'IN',
};

describe('AddressValidationService', () => {
  it('accepts a valid address and returns the canonical state casing', async () => {
    const { svc } = makeService();
    const r = await svc.validate(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.normalizedState).toBe('Karnataka');
  });

  it('rejects a malformed PIN', async () => {
    const { svc } = makeService();
    for (const pin of ['56001', '0560001', 'ABC123', '560 001']) {
      const r = await svc.validate({ ...VALID, recipientPostalCode: pin });
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toMatch(/PIN/);
    }
  });

  it('rejects a non-IN country', async () => {
    const { svc } = makeService();
    const r = await svc.validate({ ...VALID, recipientCountryCode: 'BD' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/India only/);
  });

  it('rejects non-E.164 recipient and alternate phones', async () => {
    const { svc } = makeService();
    const r = await svc.validate({
      ...VALID,
      recipientPhoneE164: '9876543210',
      recipientAltPhoneE164: '00919876543210',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => /E\.164/.test(e))).toHaveLength(2);
  });

  it('rejects a state not in the allowed list', async () => {
    const { svc } = makeService();
    const r = await svc.validate({ ...VALID, recipientStateProvince: 'Atlantis' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/not an allowed Indian state/);
    expect(r.normalizedState).toBeUndefined();
  });

  it('memoises the state list (one settings read across calls) and can invalidate', async () => {
    const { svc, findUnique } = makeService();
    await svc.validate(VALID);
    await svc.validate(VALID);
    expect(findUnique).toHaveBeenCalledTimes(1);
    svc.invalidateStatesCache();
    await svc.validate(VALID);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('soft-skips the state check when the setting is missing', async () => {
    const { svc } = makeService(null);
    const r = await svc.validate({ ...VALID, recipientStateProvince: 'Whatever' });
    expect(r.ok).toBe(true); // other fields valid; state unverified
    expect(r.normalizedState).toBe('Whatever');
  });

  describe('assertValid', () => {
    it('returns the canonical state on success', async () => {
      const { svc } = makeService();
      await expect(svc.assertValid(VALID)).resolves.toBe('Karnataka');
    });

    it('throws BadRequest aggregating all errors', async () => {
      const { svc } = makeService();
      await expect(
        svc.assertValid({
          ...VALID,
          recipientPostalCode: 'bad',
          recipientStateProvince: 'Nowhere',
        }),
      ).rejects.toThrow(/PIN.*;.*not an allowed Indian state|not an allowed Indian state/);
    });
  });
});
