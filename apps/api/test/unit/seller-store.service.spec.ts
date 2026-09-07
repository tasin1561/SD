import { ConflictException, NotFoundException } from '@nestjs/common';
import { SellerStoreService } from '../../src/modules/seller-store/services/seller-store.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type Row = Record<string, unknown>;

/**
 * A seller's shopfronts.
 *
 * The cases that matter are the ones where a store id arrives from
 * OUTSIDE — from a form, or a CSV row — because that is where a store
 * belonging to somebody else, or one that was deliberately closed,
 * would otherwise be accepted.
 */
function makeSut(opts: { store?: Row | null; fallback?: Row | null } = {}) {
  const findFirst = jest.fn(async (args: { where: Row }) =>
    args.where['isDefault'] === true ? (opts.fallback ?? null) : (opts.store ?? null),
  );
  // Typed with its argument so `mock.calls[0][0]` is the input rather
  // than a zero-length tuple.
  const create = jest.fn(async (_a: { data: Row }) => ({ id: 'st-new' }));
  const update = jest.fn(async () => ({}));
  const updateMany = jest.fn(async (_a: { where: Row; data: Row }) => ({ count: 1 }));
  // The service re-lists after a write to return the fresh view, so the
  // fake has to contain every id the cases below touch.
  const findMany = jest.fn(async () =>
    ['st-new', 'st-1', 'st-2'].map((id) => ({
      id,
      name: 'Instagram',
      note: null,
      isDefault: false,
      isActive: true,
      createdAt: new Date('2026-09-07T00:00:00Z'),
      _count: { orders: 0 },
    })),
  );
  const log = jest.fn(async () => undefined);
  const client = {
    sellerStore: { findFirst, create, update, updateMany, findMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ sellerStore: { updateMany, update } }),
  };
  const svc = new SellerStoreService(
    { client } as unknown as PrismaService,
    { log } as unknown as AuditLogService,
  );
  return { svc, findFirst, create, update, updateMany, log };
}

describe('SellerStoreService.resolveForOrder', () => {
  it('refuses a store belonging to another seller', async () => {
    // Not a 403 with detail — a 404. The sellerId is in the WHERE, so a
    // miss says nothing about whether the row exists elsewhere.
    const { svc, findFirst } = makeSut({ store: null });
    await expect(svc.resolveForOrder('seller-1', 'st-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: 'st-other',
      sellerId: 'seller-1',
    });
  });

  it('refuses a CLOSED store by name', async () => {
    // Closing a shopfront blocks NEW orders. Naming it matters: the
    // person filing the order chose it from a list and needs to know
    // which one is shut, not that "something was wrong".
    const { svc } = makeSut({
      store: { id: 'st-1', name: 'Old Instagram', isActive: false },
    });
    await expect(svc.resolveForOrder('seller-1', 'st-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('falls back to the default when none is named', async () => {
    // The CSV importer reaches this same line, which is why a row with
    // no store column still lands somewhere rather than failing.
    const { svc } = makeSut({ fallback: { id: 'st-def', name: 'Default store' } });
    await expect(svc.resolveForOrder('seller-1', null)).resolves.toEqual({
      id: 'st-def',
      name: 'Default store',
    });
  });

  it('refuses rather than inventing a store when there is no default', async () => {
    // Unreachable for a seller created after this shipped — the default
    // is made in the same transaction as the company. Not papered over
    // either: an order filed under no store is invisible to every
    // filter that exists from here on.
    const { svc } = makeSut({ fallback: null });
    await expect(svc.resolveForOrder('seller-1', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SellerStoreService writes', () => {
  it('a new store is never the default', async () => {
    // Promoting one is its own act, so adding a store cannot quietly
    // move where every future order is filed.
    const { svc, create } = makeSut();
    await svc.create('seller-1', { name: 'Instagram' }, { sellerUserId: 'su-1' });
    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({ isDefault: false, isActive: true });
  });

  it('demote-then-promote happen in ONE transaction', async () => {
    // The partial unique means they cannot be two statements with a gap
    // between them: in that gap there are two defaults, and the index
    // refuses the second write with the first already committed.
    const { svc, updateMany, update } = makeSut({
      store: { id: 'st-2', name: 'Instagram', isActive: true, isDefault: false },
    });
    await svc.makeDefault('seller-1', 'st-2', { sellerUserId: 'su-1' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isDefault: false } }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'st-2' }, data: { isDefault: true } }),
    );
  });

  it('a CLOSED store cannot become the default', async () => {
    // Order create pre-selects the default, and a closed pre-selection
    // is a form that refuses its own initial state.
    const { svc } = makeSut({
      store: { id: 'st-2', name: 'Shut', isActive: false, isDefault: false },
    });
    await expect(
      svc.makeDefault('seller-1', 'st-2', { sellerUserId: 'su-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the DEFAULT store cannot be closed', async () => {
    const { svc } = makeSut({ store: { name: 'Default store', isDefault: true } });
    await expect(
      svc.setActive('seller-1', 'st-1', false, { sellerUserId: 'su-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('closing a NON-default store is guarded on what it read', async () => {
    // A concurrent promote-to-default must not have its store closed
    // underneath it, so the update carries the isDefault it saw.
    const { svc, updateMany } = makeSut({ store: { name: 'Instagram', isDefault: false } });
    updateMany.mockResolvedValueOnce({ count: 1 });
    await svc.setActive('seller-1', 'st-1', false, { sellerUserId: 'su-1' });
    expect(updateMany.mock.calls[0]?.[0]?.where).toMatchObject({ isDefault: false });
  });
});
