import { CustomerService } from '../../src/modules/order/services/customer.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeService() {
  const customer = {
    upsert: jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({ id: 'c1', ...a })),
    update: jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'c1' })),
    findUnique: jest.fn<Promise<{ firstOrderAt: Date | null } | null>, [AnyArgs]>(async () => ({
      firstOrderAt: null,
    })),
    findFirst: jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
      id: 'c1',
      sellerId: 's1',
    })),
    findMany: jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [{ id: 'c1' }]),
    count: jest.fn<Promise<number>, [AnyArgs]>(async () => 1),
  };
  const client = { customer } as unknown as PrismaService['client'];
  const svc = new CustomerService({ client } as unknown as PrismaService);
  return { svc, client, customer };
}

describe('CustomerService', () => {
  describe('findOrCreate (per-seller dedup, ORD-7)', () => {
    it('upserts on the (sellerId, phoneE164) compound key', async () => {
      const { svc, client, customer } = makeService();
      await svc.findOrCreate(client, {
        sellerId: 's1',
        phoneE164: '+919876543210',
        name: 'Asha',
      });
      expect(customer.upsert).toHaveBeenCalledTimes(1);
      const arg = customer.upsert.mock.calls[0]![0] as AnyArgs;
      expect(arg.where).toEqual({
        sellerId_phoneE164: { sellerId: 's1', phoneE164: '+919876543210' },
      });
      expect(arg.create).toMatchObject({
        sellerId: 's1',
        phoneE164: '+919876543210',
        name: 'Asha',
        preferredLanguage: 'en',
      });
    });

    it('revives a soft-deleted customer without clobbering name/email', async () => {
      const { svc, client, customer } = makeService();
      await svc.findOrCreate(client, { sellerId: 's1', phoneE164: '+919876543210' });
      // update branch only resets deletedAt — no name/email overwrite
      expect(customer.upsert.mock.calls[0]![0].update).toEqual({ deletedAt: null });
    });

    it('rejects a non-E.164 phone', async () => {
      const { svc, client } = makeService();
      await expect(
        svc.findOrCreate(client, { sellerId: 's1', phoneE164: '9876543210' }),
      ).rejects.toThrow(/E\.164/);
    });
  });

  describe('recordNewOrder', () => {
    it('increments totalOrdersCount and sets firstOrderAt when null', async () => {
      const { svc, client, customer } = makeService();
      customer.findUnique.mockResolvedValueOnce({ firstOrderAt: null });
      const now = new Date('2026-05-17T00:00:00Z');
      await svc.recordNewOrder(client, 'c1', now);
      const data = customer.update.mock.calls[0]![0].data as AnyArgs;
      expect(data.totalOrdersCount).toEqual({ increment: 1 });
      expect(data.lastOrderAt).toBe(now);
      expect(data.firstOrderAt).toBe(now);
    });

    it('does NOT overwrite an existing firstOrderAt', async () => {
      const { svc, client, customer } = makeService();
      customer.findUnique.mockResolvedValueOnce({
        firstOrderAt: new Date('2026-01-01T00:00:00Z'),
      });
      await svc.recordNewOrder(client, 'c1', new Date('2026-05-17T00:00:00Z'));
      const data = customer.update.mock.calls[0]![0].data as AnyArgs;
      expect('firstOrderAt' in data).toBe(false);
      expect(data.totalOrdersCount).toEqual({ increment: 1 });
    });
  });

  describe('getById', () => {
    it('throws NotFound when absent / wrong seller / soft-deleted', async () => {
      const { svc, customer } = makeService();
      customer.findFirst.mockResolvedValueOnce(null);
      await expect(svc.getById('s1', 'cX')).rejects.toThrow(/not found/);
      // scope is enforced in the query filter
      expect(customer.findFirst.mock.calls[0]![0].where).toEqual({
        id: 'cX',
        sellerId: 's1',
        deletedAt: null,
      });
    });

    it('returns the customer when found', async () => {
      const { svc } = makeService();
      await expect(svc.getById('s1', 'c1')).resolves.toEqual({
        id: 'c1',
        sellerId: 's1',
      });
    });
  });

  describe('update — phone immutability + scope', () => {
    it('has no phoneE164 parameter and only writes provided fields', async () => {
      const { svc, customer } = makeService();
      await svc.update('s1', 'c1', { name: 'New Name' });
      // getById ran first (ownership/scope guard)
      expect(customer.findFirst).toHaveBeenCalledTimes(1);
      const data = customer.update.mock.calls[0]![0].data as AnyArgs;
      expect(data).toEqual({ name: 'New Name' }); // omitted fields → skipped
      expect('phoneE164' in data).toBe(false);
      expect('sellerId' in data).toBe(false);
    });

    it('null is a deliberate clear (distinct from undefined skip)', async () => {
      const { svc, customer } = makeService();
      await svc.update('s1', 'c1', { riskNotes: null });
      expect(customer.update.mock.calls[0]![0].data).toEqual({ riskNotes: null });
    });
  });

  describe('list', () => {
    it('scopes to seller, excludes soft-deleted, applies search + pagination', async () => {
      const { svc, customer } = makeService();
      const res = await svc.list('s1', { page: 2, pageSize: 10, search: 'asha' });
      const where = customer.findMany.mock.calls[0]![0].where as AnyArgs;
      expect(where.sellerId).toBe('s1');
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toHaveLength(3);
      expect(customer.findMany.mock.calls[0]![0].skip).toBe(10);
      expect(customer.findMany.mock.calls[0]![0].take).toBe(10);
      expect(res).toEqual({ items: [{ id: 'c1' }], total: 1, page: 2, pageSize: 10 });
    });
  });

  it('softDelete sets deletedAt after the scope check', async () => {
    const { svc, customer } = makeService();
    await svc.softDelete('s1', 'c1');
    expect(customer.findFirst).toHaveBeenCalledTimes(1);
    expect((customer.update.mock.calls[0]![0].data as AnyArgs).deletedAt).toBeInstanceOf(Date);
  });
});
