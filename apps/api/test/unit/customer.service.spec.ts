import { CustomerService } from '../../src/modules/order/services/customer.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeService() {
  const customer = {
    create: jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({ id: 'c-new', ...a })),
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
  const order: string[] = [];
  const $executeRaw = jest.fn(async () => {
    order.push('lock');
    return 1;
  });
  const client = { customer, $executeRaw } as unknown as PrismaService['client'];
  const svc = new CustomerService({ client } as unknown as PrismaService);
  return { svc, client, customer, $executeRaw, order };
}

describe('CustomerService', () => {
  describe('findOrCreate (identity per OWNER — ORD-7 generalised, RS-5)', () => {
    it('creates the SELLER’s customer when none exists (reseller_store_id NULL)', async () => {
      const { svc, client, customer } = makeService();
      customer.findFirst.mockResolvedValueOnce(null);
      await svc.findOrCreate(client, {
        sellerId: 's1',
        phoneE164: '+919876543210',
        name: 'Asha',
      });
      expect(customer.findFirst.mock.calls[0]![0].where).toEqual({
        sellerId: 's1',
        resellerStoreId: null,
        phoneE164: '+919876543210',
      });
      const arg = customer.create.mock.calls[0]![0] as AnyArgs;
      expect(arg.data).toMatchObject({
        sellerId: 's1',
        resellerStoreId: null,
        phoneE164: '+919876543210',
        name: 'Asha',
        preferredLanguage: 'en',
      });
    });

    it('a STORE’s customer is a separate identity, keyed by the store', async () => {
      const { svc, client, customer } = makeService();
      customer.findFirst.mockResolvedValueOnce(null);
      await svc.findOrCreate(client, {
        sellerId: 's1',
        resellerStoreId: 'store-1',
        phoneE164: '+919876543210',
      });
      expect(customer.findFirst.mock.calls[0]![0].where).toEqual({
        sellerId: 's1',
        resellerStoreId: 'store-1',
        phoneE164: '+919876543210',
      });
      expect((customer.create.mock.calls[0]![0].data as AnyArgs).resellerStoreId).toBe('store-1');
    });

    it('takes the CUSTOMER_IDENTITY lock BEFORE looking, so two new orders cannot both create', async () => {
      const { svc, client, customer, order } = makeService();
      customer.findFirst.mockImplementationOnce(async () => {
        order.push('find');
        return null;
      });
      await svc.findOrCreate(client, { sellerId: 's1', phoneE164: '+919876543210' });
      expect(order).toEqual(['lock', 'find']);
    });

    it('a re-encounter never overwrites curated name/email; a removed customer is revived', async () => {
      const { svc, client, customer } = makeService();
      customer.findFirst.mockResolvedValueOnce({ id: 'c1', deletedAt: new Date() });
      await svc.findOrCreate(client, {
        sellerId: 's1',
        phoneE164: '+919876543210',
        name: 'Somebody Else',
      });
      expect(customer.create).not.toHaveBeenCalled();
      expect(customer.update.mock.calls[0]![0]).toMatchObject({
        where: { id: 'c1' },
        data: { deletedAt: null },
      });
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
      // Scope is enforced in the query filter. Since 2026-09-16 it is the
      // SELLER's scope only: a customer one of their reseller stores sold
      // to is theirs to READ (the order is theirs to ship).
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
      // Not scoped away from the stores' customers any more (2026-09-16).
      expect('resellerStoreId' in where).toBe(false);
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toHaveLength(3);
      expect(customer.findMany.mock.calls[0]![0].skip).toBe(10);
      expect(customer.findMany.mock.calls[0]![0].take).toBe(10);
      expect(res).toEqual({ items: [{ id: 'c1' }], total: 1, page: 2, pageSize: 10 });
    });
  });

  describe('a reseller store’s own customers (RS-5)', () => {
    it('listForStore scopes by the store, never the seller', async () => {
      const { svc, customer } = makeService();
      await svc.listForStore('store-1', {});
      const where = customer.findMany.mock.calls[0]![0].where as AnyArgs;
      expect(where.resellerStoreId).toBe('store-1');
      expect('sellerId' in where).toBe(false);
    });

    it('getForStore is a 404 for any customer that is not that store’s', async () => {
      const { svc, customer } = makeService();
      customer.findFirst.mockResolvedValueOnce(null);
      await expect(svc.getForStore('store-1', 'c-other')).rejects.toThrow();
      expect(customer.findFirst.mock.calls[0]![0].where).toEqual({
        id: 'c-other',
        resellerStoreId: 'store-1',
        deletedAt: null,
      });
    });
  });

  it('a WRITE is still the seller’s OWN customer only', async () => {
    // Reading widened on 2026-09-16; changing did not. A store's customer
    // row is the store's to maintain, so update and softDelete go through
    // `getOwnById`, which keeps `resellerStoreId: null` in the WHERE.
    const { svc, customer } = makeService();
    await svc.update('s1', 'c1', { name: 'X' });
    expect(customer.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'c1',
      sellerId: 's1',
      resellerStoreId: null,
      deletedAt: null,
    });
  });

  it('softDelete sets deletedAt after the scope check', async () => {
    const { svc, customer } = makeService();
    await svc.softDelete('s1', 'c1');
    expect(customer.findFirst).toHaveBeenCalledTimes(1);
    expect((customer.findFirst.mock.calls[0]![0].where as AnyArgs).resellerStoreId).toBeNull();
    expect((customer.update.mock.calls[0]![0].data as AnyArgs).deletedAt).toBeInstanceOf(Date);
  });
});
