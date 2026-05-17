import { RecipientAddressCacheService } from '../../src/modules/order/services/recipient-address-cache.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeService() {
  const orderRecipientAddressCache = {
    upsert: jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => a),
    findMany: jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [{ id: 'a1' }]),
    findFirst: jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({ id: 'a1' })),
    delete: jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'a1' })),
  };
  const client = { orderRecipientAddressCache } as unknown as PrismaService['client'];
  const svc = new RecipientAddressCacheService({ client } as unknown as PrismaService);
  return { svc, client, cache: orderRecipientAddressCache };
}

const BASE = {
  line1: '12 MG Road',
  city: 'Bengaluru',
  stateProvince: 'Karnataka',
  postalCode: '560001',
};

describe('RecipientAddressCacheService', () => {
  describe('computeHash', () => {
    it('is stable across case / whitespace / punctuation', () => {
      const a = RecipientAddressCacheService.computeHash(BASE);
      const b = RecipientAddressCacheService.computeHash({
        ...BASE,
        line1: '  12,  mg   road. ',
      });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs for a different address and for a different landmark', () => {
      const base = RecipientAddressCacheService.computeHash(BASE);
      expect(RecipientAddressCacheService.computeHash({ ...BASE, postalCode: '560002' })).not.toBe(base);
      expect(RecipientAddressCacheService.computeHash({ ...BASE, landmark: 'near park' })).not.toBe(base);
    });
  });

  describe('recordAddress', () => {
    it('upserts on the (customerId, addressHash) compound key with seenCount semantics', async () => {
      const { svc, client, cache } = makeService();
      const now = new Date('2026-05-17T00:00:00Z');
      await svc.recordAddress(client, 'c1', BASE, now);

      const arg = cache.upsert.mock.calls[0]![0] as AnyArgs;
      const where = arg.where as { customerId_addressHash: { customerId: string; addressHash: string } };
      expect(where.customerId_addressHash.customerId).toBe('c1');
      expect(where.customerId_addressHash.addressHash).toBe(
        RecipientAddressCacheService.computeHash(BASE),
      );
      expect(arg.create).toMatchObject({ seenCount: 1, firstSeenAt: now, lastSeenAt: now });
      expect(arg.update).toMatchObject({ seenCount: { increment: 1 }, lastSeenAt: now });
    });
  });

  describe('autocomplete', () => {
    it('scopes through the customer relation and ranks by use then recency', async () => {
      const { svc, cache } = makeService();
      await svc.autocomplete('s1', { customerId: 'c1', search: '560' });
      const a = cache.findMany.mock.calls[0]![0] as AnyArgs;
      expect(a.where).toMatchObject({
        customer: { sellerId: 's1', deletedAt: null },
        customerId: 'c1',
      });
      expect((a.where as AnyArgs).OR).toHaveLength(3);
      expect(a.orderBy).toEqual([{ seenCount: 'desc' }, { lastSeenAt: 'desc' }]);
      expect(a.take).toBe(10); // default
    });

    it('clamps limit into [1, 50]', async () => {
      const { svc, cache } = makeService();
      await svc.autocomplete('s1', { limit: 999 });
      expect((cache.findMany.mock.calls[0]![0] as AnyArgs).take).toBe(50);
      await svc.autocomplete('s1', { limit: 0 });
      expect((cache.findMany.mock.calls[1]![0] as AnyArgs).take).toBe(1);
    });
  });

  describe('getById / remove', () => {
    it('getById throws NotFound (scoped via customer relation)', async () => {
      const { svc, cache } = makeService();
      cache.findFirst.mockResolvedValueOnce(null);
      await expect(svc.getById('s1', 'aX')).rejects.toThrow(/not found/);
      expect((cache.findFirst.mock.calls[0]![0] as AnyArgs).where).toMatchObject({
        id: 'aX',
        customer: { sellerId: 's1', deletedAt: null },
      });
    });

    it('remove guards scope then hard-deletes', async () => {
      const { svc, cache } = makeService();
      await svc.remove('s1', 'a1');
      expect(cache.findFirst).toHaveBeenCalledTimes(1);
      expect((cache.delete.mock.calls[0]![0] as AnyArgs).where).toEqual({ id: 'a1' });
    });
  });
});
