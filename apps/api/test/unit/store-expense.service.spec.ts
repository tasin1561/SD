import { ActorType, SellerStoreKind, StoreExpenseCategory } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuthenticatedStoreUser } from '../../src/common/types/request';
import { StoreExpenseService } from '../../src/modules/reseller-reports/services/store-expense.service';
import { FakeDb, type Tables } from './pnl-fake-db';

const now = new Date('2026-09-15T10:00:00+05:30');

/** The fake applies no column defaults; the real table stamps created_at and nulls the rest. */
class ExpenseDb extends FakeDb {
  override delegate(
    model: string,
  ): Record<string, (args?: Record<string, unknown>) => Promise<unknown>> {
    const d = super.delegate(model);
    const create = d['create'];
    if (model !== 'storeExpense' || create === undefined) return d;
    return {
      ...d,
      create: (args = {}) =>
        create({
          ...args,
          data: {
            createdAt: new Date(),
            deletedAt: null,
            deleteReason: null,
            ...(args['data'] as Record<string, unknown>),
          },
        }),
    };
  }
}
const KEY = '0190f7a0-0000-7000-8000-000000000001';

function user(storeId = 'store-1'): AuthenticatedStoreUser {
  return {
    id: 'u-1',
    storeId,
    sellerId: 'x1',
    email: 'a@store.test',
    fullName: 'A',
    emailVerifiedAt: null,
    jti: null,
    roleKey: 'finance',
    roleName: 'Finance',
    permissions: ['expenses.manage'],
  };
}

function setup(): { svc: StoreExpenseService; audit: jest.Mock; tables: Tables } {
  const tables: Tables = {
    sellerStore: [
      {
        id: 'store-1',
        kind: SellerStoreKind.RESELLER,
        createdAt: new Date('2026-07-10T00:00:00Z'),
      },
      {
        id: 'store-2',
        kind: SellerStoreKind.RESELLER,
        createdAt: new Date('2026-07-10T00:00:00Z'),
      },
    ],
    storeExpense: [],
  };
  const audit = jest.fn();
  const svc = new StoreExpenseService(
    { client: new ExpenseDb(tables).client() } as unknown as PrismaService,
    { log: audit } as never,
  );
  return { svc, audit, tables };
}

const input = {
  category: StoreExpenseCategory.AD_SPEND,
  amountInr: '500.00',
  expenseDate: '2026-09-14',
  description: 'Meta ads',
  idempotencyKey: KEY,
};

describe('store expenses (RS-8)', () => {
  it('records one, audited as the STORE, and a retried form replays it', async () => {
    const { svc, audit, tables } = setup();
    const first = await svc.record(user(), input, now);
    expect(first).toMatchObject({
      amountInr: '500.00',
      expenseDate: '2026-09-14',
      replayed: false,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: ActorType.STORE, action: 'store.expense.recorded' }),
    );
    const again = await svc.record(user(), input, now);
    expect(again.replayed).toBe(true);
    expect(tables['storeExpense']).toHaveLength(1);
  });

  it('the same form key on a different expense is refused', async () => {
    const { svc } = setup();
    await svc.record(user(), input, now);
    await expect(svc.record(user(), { ...input, amountInr: '600.00' }, now)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('refuses a date in the future or before the store’s books begin', async () => {
    const { svc } = setup();
    await expect(
      svc.record(user(), { ...input, idempotencyKey: undefined, expenseDate: '2026-09-16' }, now),
    ).rejects.toMatchObject({ response: { code: 'EXPENSE_DATE_IN_FUTURE' } });
    await expect(
      svc.record(user(), { ...input, idempotencyKey: undefined, expenseDate: '2026-06-30' }, now),
    ).rejects.toMatchObject({ response: { code: 'EXPENSE_BEFORE_STORE' } });
    await expect(
      svc.record(user(), { ...input, idempotencyKey: undefined, expenseDate: '2026-02-30' }, now),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DATE' } });
  });

  it('a removal needs a reason, happens once, and only in the caller’s own store', async () => {
    const { svc } = setup();
    const x = await svc.record(user(), input, now);
    await expect(svc.remove(user(), x.id, 'no')).rejects.toMatchObject({
      response: { code: 'REASON_REQUIRED' },
    });
    await expect(svc.remove(user('store-2'), x.id, 'not mine to remove')).rejects.toMatchObject({
      response: { code: 'EXPENSE_NOT_FOUND' },
    });
    const gone = await svc.remove(user(), x.id, 'typed twice');
    expect(gone.deleteReason).toBe('typed twice');
    await expect(svc.remove(user(), x.id, 'typed twice')).rejects.toMatchObject({
      response: { code: 'EXPENSE_NOT_FOUND' },
    });
    const list = await svc.list('store-1', {
      from: new Date('2026-09-01T00:00:00+05:30'),
      to: new Date('2026-10-01T00:00:00+05:30'),
    });
    expect(list.items).toHaveLength(1); // still shown, marked removed
    expect(list.totalInr).toBe('0.00'); // but not counted
  });
});
