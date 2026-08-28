import { Currency, Prisma } from '@skydrop/db';
import { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * Where the balance comes from.
 *
 * A wallet balance is cached in `seller_wallet_balances`, refreshed by
 * each money path calling recomputeCacheAfterCommit — and 14 services
 * write wallet entries while only 6 call it. So the cache being present
 * has never meant the cache is right.
 *
 * This was live: a seller carried an INBOUND_FREIGHT debit of ₹3,000
 * with no cache row at all. Their own page read the ledger and showed
 * −₹3,000; the admin page read the cache and showed ₹0.00, with the
 * estate total reading "0 in debt". Nobody chases a debt the system says
 * does not exist.
 */
function makeWallet(opts: {
  cached: { balance: string; lastEntryId: string } | null;
  latest: { id: string; runningBalanceAfter: string } | null;
}) {
  const prisma = {
    client: {
      sellerWalletBalance: {
        findUnique: jest.fn(async () =>
          opts.cached === null
            ? null
            : { balance: D(opts.cached.balance), lastEntryId: opts.cached.lastEntryId },
        ),
      },
      sellerWalletEntry: {
        findFirst: jest.fn(async () =>
          opts.latest === null
            ? null
            : { id: opts.latest.id, runningBalanceAfter: D(opts.latest.runningBalanceAfter) },
        ),
        aggregate: jest.fn(async () => ({ _sum: { amount: D('0') } })),
      },
    },
  };
  return new WalletService(prisma as never, { apply: async () => undefined } as never);
}

describe('WalletService.balanceCached — the cache is checked before it is trusted', () => {
  it('uses the cache when it matches the newest entry', async () => {
    const w = makeWallet({
      cached: { balance: '-3000.00', lastEntryId: 'e2' },
      latest: { id: 'e2', runningBalanceAfter: '-3000.00' },
    });
    expect((await w.balanceCached('s1', Currency.INR)).toFixed(2)).toBe('-3000.00');
  });

  it('falls back to the ledger when there is NO cache row', async () => {
    // The live case: freight debited ₹3,000 and never refreshed the
    // cache, so reading the table alone reported zero.
    const w = makeWallet({ cached: null, latest: { id: 'e1', runningBalanceAfter: '-3000.00' } });
    expect((await w.balanceCached('s1', Currency.INR)).toFixed(2)).toBe('-3000.00');
  });

  it('IGNORES a stale cache — confidently wrong is worse than missing', async () => {
    // A cache written before a later entry landed. The missing case
    // already fell back and was right; this one would have stayed wrong
    // forever.
    const w = makeWallet({
      cached: { balance: '0.00', lastEntryId: 'e1' },
      latest: { id: 'e9', runningBalanceAfter: '-3000.00' },
    });
    expect((await w.balanceCached('s1', Currency.INR)).toFixed(2)).toBe('-3000.00');
  });

  it('is zero when nothing has ever moved', async () => {
    const w = makeWallet({ cached: null, latest: null });
    expect((await w.balanceCached('s1', Currency.INR)).toFixed(2)).toBe('0.00');
  });
});
