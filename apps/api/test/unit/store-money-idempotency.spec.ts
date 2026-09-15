import { ConflictException } from '@nestjs/common';
import { Prisma, ResellerWalletManager, TopupRequestStatus } from '@skydrop/db';
import type { AuthenticatedStoreUser } from '../../src/common/types/request';
import { StoreTopupService } from '../../src/modules/reseller-store-wallet/services/store-topup.service';
import { StoreWithdrawalService } from '../../src/modules/reseller-store-wallet/services/store-withdrawal.service';

/**
 * IDEM-1 on a reseller store's OWN money forms (UI audit, 2026-09-15): the
 * top-up claim and the withdrawal request carry the key their form minted
 * when it opened. Same key + same request → the original row, nothing new
 * written and nothing audited twice; same key + a different request → 409
 * IDEMPOTENCY_KEY_REUSED; two copies racing (the unique index refuses the
 * second insert) → the loser answers with the winner.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const KEY = '0192e0a0-0000-7000-8000-000000000001';
const USER = { id: 'u-1', storeId: 'st-1', sellerId: 's-1' } as AuthenticatedStoreUser;

type Row = Record<string, unknown> & { id: string; idempotencyKey: string | null };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function world(opts: { raceWith?: Row } = {}) {
  const topups: Row[] = [];
  const withdrawals: Row[] = [];
  let n = 0;
  const shared = {
    store: { name: 'Kurta Co', displayName: null, seller: { companyName: 'Menev' } },
    createdAt: new Date('2026-09-15T04:00:00Z'),
  };
  const insert = (list: Row[], data: Record<string, unknown>, extra: Record<string, unknown>) => {
    if (opts.raceWith !== undefined) {
      // Another copy of the form committed first with the same key.
      list.push(opts.raceWith);
      throw p2002();
    }
    n += 1;
    const row = {
      ...shared,
      ...extra,
      ...data,
      id: `r-${n}`,
      idempotencyKey: (data.idempotencyKey as string | null | undefined) ?? null,
    } as Row;
    list.push(row);
    return row;
  };
  const find = (list: Row[]) =>
    jest.fn(
      async (a: { where: { idempotencyKey: string } }) =>
        list.find((r) => r.idempotencyKey === a.where.idempotencyKey) ?? null,
    );
  const topupCreate = jest.fn(async (a: { data: Record<string, unknown> }) =>
    insert(topups, a.data, {
      status: TopupRequestStatus.PENDING,
      reviewNote: null,
      reviewedAt: null,
      bankAccount: { label: 'HDFC', bankName: 'HDFC Bank', accountNumber: '0001' },
    }),
  );
  const withdrawalCreate = jest.fn(async (a: { data: Record<string, unknown> }) =>
    insert(withdrawals, a.data, {
      status: 'PENDING',
      rejectionReason: null,
      resolvedAt: null,
      paidFromAccount: null,
      bankReference: null,
      paidAt: null,
    }),
  );
  const tx = {
    platformBankAccount: {
      findFirst: jest.fn(async () => ({ id: 'acct-1', currency: 'INR' })),
    },
    storeTopupRequest: { create: topupCreate },
    storeWithdrawalRequest: { create: withdrawalCreate },
  };
  const prisma = {
    client: {
      storeTopupRequest: { findUnique: find(topups) },
      storeWithdrawalRequest: { findUnique: find(withdrawals) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
  const storeWallet = {
    lockSeller: jest.fn(async () => undefined),
    loadStore: jest.fn(async () => ({
      id: 'st-1',
      sellerId: 's-1',
      walletManagedBy: ResellerWalletManager.SKYDROP,
      sellerCompanyName: 'Menev',
    })),
    storeWithdrawable: jest.fn(async () => ({ withdrawable: D('100000') })),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const none = {} as never;
  const topupSvc = new StoreTopupService(
    prisma as never,
    none,
    audit as never,
    storeWallet as never,
    none,
    none,
  );
  const withdrawalSvc = new StoreWithdrawalService(
    prisma as never,
    audit as never,
    storeWallet as never,
    none,
    none,
  );
  return { topupSvc, withdrawalSvc, topupCreate, withdrawalCreate, audit, topups, withdrawals };
}

const CLAIM = { bankAccountId: 'acct-1', amountInr: '1250.50', transactionRef: 'UTR123' };
const ASK = {
  amountInr: '3000.00',
  payeeName: 'Kurta Co',
  payeeAccountNumber: '123456789',
  payeeIfsc: 'HDFC0001234',
  payeeBankName: 'HDFC Bank',
};

async function refused(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  return ((err as ConflictException).getResponse() as { code?: string }).code;
}

describe('store top-up claim — IDEM-1', () => {
  it('a replay with the same key and claim answers with the original, writing nothing', async () => {
    const w = world();
    const first = await w.topupSvc.submit(USER, { ...CLAIM, idempotencyKey: KEY });
    const again = await w.topupSvc.submit(USER, { ...CLAIM, idempotencyKey: KEY });
    expect(again.id).toBe(first.id);
    expect(w.topupCreate).toHaveBeenCalledTimes(1);
    expect(w.audit.log).toHaveBeenCalledTimes(1);
    expect(w.topupCreate.mock.calls[0]?.[0].data.idempotencyKey).toBe(KEY);
  });

  it('the same key on a different claim is refused, never answered with the old row', async () => {
    const w = world();
    await w.topupSvc.submit(USER, { ...CLAIM, idempotencyKey: KEY });
    expect(
      await refused(
        w.topupSvc.submit(USER, { ...CLAIM, amountInr: '1300.00', idempotencyKey: KEY }),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await refused(
        w.topupSvc.submit(USER, { ...CLAIM, transactionRef: 'UTR999', idempotencyKey: KEY }),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(w.topupCreate).toHaveBeenCalledTimes(1);
  });

  it('two copies racing: the loser answers with the winner', async () => {
    const winner = {
      id: 'winner',
      idempotencyKey: KEY,
      storeId: 'st-1',
      sellerId: 's-1',
      bankAccountId: 'acct-1',
      amountInr: D('1250.50'),
      transactionRef: 'UTR123',
      proofSpacesKey: null,
      status: TopupRequestStatus.PENDING,
      reviewNote: null,
      reviewedAt: null,
      store: { name: 'Kurta Co', displayName: null, seller: { companyName: 'Menev' } },
      bankAccount: { label: 'HDFC', bankName: 'HDFC Bank', accountNumber: '0001' },
      createdAt: new Date(),
    };
    const w = world({ raceWith: winner });
    const got = await w.topupSvc.submit(USER, { ...CLAIM, idempotencyKey: KEY });
    expect(got.id).toBe('winner');
    expect(w.audit.log).not.toHaveBeenCalled();
  });

  it('without a key every submit is its own claim', async () => {
    const w = world();
    const a = await w.topupSvc.submit(USER, CLAIM);
    const b = await w.topupSvc.submit(USER, CLAIM);
    expect(a.id).not.toBe(b.id);
    expect(w.topupCreate).toHaveBeenCalledTimes(2);
  });
});

describe('store withdrawal request — IDEM-1', () => {
  it('a replay with the same key and request answers with the original, writing nothing', async () => {
    const w = world();
    const first = await w.withdrawalSvc.request(USER, { ...ASK, idempotencyKey: KEY });
    const again = await w.withdrawalSvc.request(USER, { ...ASK, idempotencyKey: KEY });
    expect(again.id).toBe(first.id);
    expect(w.withdrawalCreate).toHaveBeenCalledTimes(1);
    expect(w.audit.log).toHaveBeenCalledTimes(1);
  });

  it('the same key with a different payee or amount is refused', async () => {
    const w = world();
    await w.withdrawalSvc.request(USER, { ...ASK, idempotencyKey: KEY });
    expect(
      await refused(
        w.withdrawalSvc.request(USER, {
          ...ASK,
          payeeAccountNumber: '999999',
          idempotencyKey: KEY,
        }),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await refused(
        w.withdrawalSvc.request(USER, { ...ASK, amountInr: '1.00', idempotencyKey: KEY }),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(w.withdrawalCreate).toHaveBeenCalledTimes(1);
  });

  it('two copies racing: the loser answers with the winner', async () => {
    const winner = {
      id: 'winner',
      idempotencyKey: KEY,
      storeId: 'st-1',
      sellerId: 's-1',
      amountInr: D('3000.00'),
      status: 'PENDING',
      payeeName: 'Kurta Co',
      payeeAccountNumber: '123456789',
      payeeIfsc: 'HDFC0001234',
      payeeBankName: 'HDFC Bank',
      note: null,
      rejectionReason: null,
      resolvedAt: null,
      paidFromAccount: null,
      bankReference: null,
      paidAt: null,
      store: { name: 'Kurta Co', displayName: null, seller: { companyName: 'Menev' } },
      createdAt: new Date(),
    };
    const w = world({ raceWith: winner });
    const got = await w.withdrawalSvc.request(USER, { ...ASK, idempotencyKey: KEY });
    expect(got.id).toBe('winner');
    expect(w.audit.log).not.toHaveBeenCalled();
  });
});
