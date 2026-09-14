import { Prisma, StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { AdvisoryLock, advisoryKey } from '../../src/common/db/advisory-lock';
import { StoreWalletService } from '../../src/modules/reseller-store-wallet/services/store-wallet.service';

/**
 * RS-6 — the store wallet primitive, in isolation: the ONE writer's lock,
 * its store check, its running balance and its hand-off to the bank-book
 * attribution; and the two decisions phase 3b and the withdrawal flow read
 * (`storeCanSpend`, `storeWithdrawable`). What a mocked Prisma cannot show
 * — concurrency — is `store-wallet-concurrency.e2e-spec`'s job.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Row {
  id: string;
  storeId: string;
  direction: string;
  amount: Prisma.Decimal;
  runningBalanceAfter: Prisma.Decimal;
}

function world(
  opts: {
    stores?: Array<{ id: string; sellerId: string }>;
    sellerBalance?: string;
    ownLimit?: string | null;
    cap?: string | 'throws';
    held?: Array<{ storeId: string; amount: string }>;
    sellerHeld?: string;
  } = {},
) {
  const stores = opts.stores ?? [{ id: 'st-1', sellerId: 's' }];
  const rows: Row[] = [];
  const events: string[] = [];
  let n = 0;
  const tx = {
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ns: number, key: number) => {
      events.push(`lock:${ns}:${key}`);
      return 1;
    }),
    sellerStore: {
      findFirst: jest.fn(async (a: { where: { id: string; sellerId?: string } }) => {
        const s = stores.find(
          (x) =>
            x.id === a.where.id &&
            (a.where.sellerId === undefined || x.sellerId === a.where.sellerId),
        );
        return s === undefined ? null : { id: s.id };
      }),
      findMany: jest.fn(async (a: { where: { sellerId: string } }) =>
        stores.filter((x) => x.sellerId === a.where.sellerId).map((x) => ({ id: x.id })),
      ),
    },
    storeWalletEntry: {
      findFirst: jest.fn(async (a: { where: { storeId: string } }) => {
        events.push('read-balance');
        return rows.filter((r) => r.storeId === a.where.storeId).at(-1) ?? null;
      }),
      create: jest.fn(async (a: { data: Omit<Row, 'id'> }) => {
        n += 1;
        const row = { ...a.data, id: `e-${n}` };
        rows.push(row);
        events.push(`write:${row.direction}`);
        return { id: row.id, runningBalanceAfter: row.runningBalanceAfter };
      }),
    },
    storeWalletSettings: {
      findUnique: jest.fn(async () =>
        opts.ownLimit === undefined || opts.ownLimit === null
          ? null
          : { negativeLimitInr: D(opts.ownLimit) },
      ),
    },
    storeWithdrawalRequest: {
      groupBy: jest.fn(async () =>
        (opts.held ?? []).map((h) => ({ storeId: h.storeId, _sum: { amountInr: D(h.amount) } })),
      ),
    },
    withdrawalRequest: {
      aggregate: jest.fn(async () => ({
        _sum: { amountRequested: opts.sellerHeld === undefined ? null : D(opts.sellerHeld) },
      })),
    },
  };
  const attribution = {
    applyStore: jest.fn(async (_t: unknown, input: { storeEntryId: string }) => {
      events.push(`attribution:${input.storeEntryId}`);
    }),
    walletBalance: jest.fn(async () => D(opts.sellerBalance ?? '0')),
  };
  const settings = {
    resolve: jest.fn(async () => {
      if (opts.cap === 'throws') throw new Error('settings down');
      return { value: opts.cap ?? '25000.00' };
    }),
  };
  const svc = new StoreWalletService(
    { client: tx } as never,
    attribution as never,
    settings as never,
    { log: jest.fn(async () => 'a1') } as never,
  );
  const write = (direction: StoreWalletEntryDirection, amount: string, extra = {}) =>
    svc.applyEntry(tx as never, {
      storeId: 'st-1',
      sellerId: 's',
      direction,
      amount: D(amount),
      actorType: 'SYSTEM' as never,
      ...extra,
    });
  const seed = (storeId: string, balance: string): void => {
    rows.push({
      id: `seed-${storeId}`,
      storeId,
      direction: 'TOPUP',
      amount: D('1'),
      runningBalanceAfter: D(balance),
    });
  };
  return { svc, tx, rows, events, attribution, write, seed };
}

describe('StoreWalletService.applyEntry — the one writer', () => {
  it('takes the SELLER’s WALLET lock before it reads the balance', async () => {
    const w = world();
    await w.write(StoreWalletEntryDirection.TOPUP, '100');
    const lock = `lock:${AdvisoryLock.WALLET}:${advisoryKey('s|INR')}`;
    expect(w.events.indexOf(lock)).toBeGreaterThanOrEqual(0);
    expect(w.events.indexOf(lock)).toBeLessThan(w.events.indexOf('read-balance'));
  });

  it('carries a running balance: credits add, debits subtract — and may go below zero (callers enforce the limit)', async () => {
    const w = world();
    await w.write(StoreWalletEntryDirection.TOPUP, '100');
    await w.write(StoreWalletEntryDirection.SELLER_TOPUP, '50.25');
    await w.write(StoreWalletEntryDirection.FEE_SHARE, '200', {
      shareOf: WalletEntryDirection.ORDER_CHARGES,
    });
    expect(w.rows.map((r) => r.runningBalanceAfter.toFixed(2))).toEqual([
      '100.00',
      '150.25',
      '-49.75',
    ]);
  });

  it('hands every entry to the bank-book attribution, after writing it, in the same transaction', async () => {
    const w = world();
    const out = await w.write(StoreWalletEntryDirection.TOPUP, '10');
    expect(w.attribution.applyStore).toHaveBeenCalledWith(w.tx, {
      sellerId: 's',
      direction: StoreWalletEntryDirection.TOPUP,
      amount: D('10'),
      storeEntryId: out.id,
    });
    expect(w.events.indexOf(`attribution:${out.id}`)).toBeGreaterThan(
      w.events.indexOf('write:TOPUP'),
    );
  });

  it('refuses a store that is not this seller’s, and writes nothing', async () => {
    const w = world({ stores: [{ id: 'st-1', sellerId: 'other' }] });
    await expect(w.write(StoreWalletEntryDirection.TOPUP, '10')).rejects.toThrow(
      /STORE_WALLET_STORE_MISMATCH/,
    );
    expect(w.rows).toHaveLength(0);
    expect(w.attribution.applyStore).not.toHaveBeenCalled();
  });

  it('refuses a zero, negative or sub-paisa amount, and a fee share that names no fee', async () => {
    const w = world();
    await expect(w.write(StoreWalletEntryDirection.TOPUP, '0')).rejects.toThrow(/INVALID_AMOUNT/);
    await expect(w.write(StoreWalletEntryDirection.TOPUP, '-5')).rejects.toThrow(/INVALID_AMOUNT/);
    await expect(w.write(StoreWalletEntryDirection.TOPUP, '1.005')).rejects.toThrow(
      /INVALID_AMOUNT/,
    );
    await expect(w.write(StoreWalletEntryDirection.FEE_SHARE, '5')).rejects.toThrow(
      /SHARE_OF_REQUIRED/,
    );
    expect(w.rows).toHaveLength(0);
  });
});

describe('StoreWalletService.storeCanSpend — phase 3b’s order-create check', () => {
  const spend = (w: ReturnType<typeof world>, amount: string) =>
    w.svc.storeCanSpend(w.tx as never, { storeId: 'st-1', sellerId: 's', amount: D(amount) });

  it('allows down to minus the LOWER of the seller’s limit and Skydrop’s cap', async () => {
    const w = world({ ownLimit: '500', cap: '300' });
    w.seed('st-1', '100');
    expect(await spend(w, '400')).toMatchObject({
      allowed: true,
      afterInr: '-300.00',
      limitInr: '300.00',
    });
    expect((await spend(w, '400.01')).allowed).toBe(false);
  });

  it('with no limit set, a store may not go below zero', async () => {
    const w = world();
    w.seed('st-1', '100');
    expect((await spend(w, '100')).allowed).toBe(true);
    expect((await spend(w, '100.01')).allowed).toBe(false);
  });

  it('FAILS CLOSED: an unreadable cap is zero', async () => {
    const w = world({ ownLimit: '5000', cap: 'throws' });
    w.seed('st-1', '100');
    expect(await spend(w, '101')).toMatchObject({ allowed: false, limitInr: '0.00' });
  });

  it('takes the seller’s WALLET lock itself (the check and the debit cannot be separated)', async () => {
    const w = world();
    await spend(w, '1');
    expect(w.events[0]).toBe(`lock:${AdvisoryLock.WALLET}:${advisoryKey('s|INR')}`);
  });
});

describe('StoreWalletService.storeWithdrawable — the one method a store withdrawal reads', () => {
  it('is the LOWER of the store’s own free balance and its seller’s group free balance', async () => {
    // Seller −100; store A 300 with 50 asked for; store B 0.
    const w = world({
      stores: [
        { id: 'st-1', sellerId: 's' },
        { id: 'st-2', sellerId: 's' },
      ],
      sellerBalance: '-100',
      held: [{ storeId: 'st-1', amount: '50' }],
    });
    w.seed('st-1', '300');
    const out = await w.svc.storeWithdrawable(w.tx as never, { storeId: 'st-1', sellerId: 's' });
    expect(out.ownFree.toFixed(2)).toBe('250.00');
    expect(out.groupFree.toFixed(2)).toBe('150.00'); // −100 + 300 − 50
    expect(out.withdrawable.toFixed(2)).toBe('150.00');
  });

  it('the seller’s own requests come off the group too', async () => {
    const w = world({ sellerBalance: '200', sellerHeld: '200' });
    w.seed('st-1', '300');
    const out = await w.svc.storeWithdrawable(w.tx as never, { storeId: 'st-1', sellerId: 's' });
    expect(out.withdrawable.toFixed(2)).toBe('300.00');
  });

  it('never negative', async () => {
    const w = world({ sellerBalance: '-1000' });
    w.seed('st-1', '300');
    const out = await w.svc.storeWithdrawable(w.tx as never, { storeId: 'st-1', sellerId: 's' });
    expect(out.withdrawable.toFixed(2)).toBe('0.00');
  });
});

describe('StoreWalletService.setNegativeLimit — the seller’s risk, Skydrop’s cap', () => {
  it('refuses above the cap rather than silently lowering it', async () => {
    const w = world({ cap: '1000' });
    const prisma = w.tx as unknown as Record<string, unknown>;
    prisma['sellerStore'] = {
      ...(prisma['sellerStore'] as object),
      findFirst: jest.fn(async () => ({
        id: 'st-1',
        sellerId: 's',
        name: 'Kolkata Kurtis',
        displayName: null,
        status: 'ACTIVE',
        walletManagedBy: 'SELLER',
        seller: { companyName: 'Menev Store' },
      })),
    };
    await expect(
      w.svc.setNegativeLimit('s', 'st-1', '1000.01', { sellerUserId: 'su-1' }),
    ).rejects.toMatchObject({ response: { code: 'STORE_NEGATIVE_LIMIT_ABOVE_CAP' } });
  });
});
