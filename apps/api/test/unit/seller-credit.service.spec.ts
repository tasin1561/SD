import { Prisma } from '@skydrop/db';
import { SellerCreditService } from '../../src/modules/seller-credit/services/seller-credit.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(opts: {
  balance?: Prisma.Decimal | null;
  limit?: string;
  stockBacked?: boolean;
  stock?: Array<{ qtyOnHand: number; batch: { unitCostInr: Prisma.Decimal | null } | null }>;
  settingsThrow?: boolean;
}) {
  const prisma = {
    client: {
      sellerWalletBalance: {
        findUnique: async () => (opts.balance === undefined ? null : { balance: opts.balance }),
      },
      stockLevel: { findMany: async () => opts.stock ?? [] },
    },
  } as unknown as PrismaService;

  const settings = {
    resolve: async (_sellerId: string, key: string) => {
      if (opts.settingsThrow === true) throw new Error('settings are down');
      return key === 'wallet.negative_balance_limit_inr'
        ? { value: opts.limit ?? '0' }
        : { value: opts.stockBacked ?? true };
    },
  } as unknown as SettingsResolverService;

  return new SellerCreditService(prisma, settings);
}

describe('SellerCreditService', () => {
  it('a seller in credit is never blocked, and their stock is not even priced', async () => {
    const svc = makeSut({ balance: D('5000'), stock: [{ qtyOnHand: 99, batch: null }] });
    const s = await svc.standing('s1');
    expect(s.blocked).toBe(false);
    expect(s.reason).toBeNull();
    expect(s.stockValueInr).toBe('0.00');
  });

  it('lets stock in our warehouse carry the debt', async () => {
    // The whole reason a seller may go negative: their goods are in our
    // building. Refusing an order from someone holding ₹40,000 of stock
    // with us protects nothing.
    const svc = makeSut({
      balance: D('-8000'),
      limit: '0',
      stock: [{ qtyOnHand: 400, batch: { unitCostInr: D('100') } }],
    });
    const s = await svc.standing('s1');
    expect(s.stockValueInr).toBe('40000.00');
    expect(s.allowanceInr).toBe('40000.00');
    expect(s.headroomInr).toBe('32000.00');
    expect(s.blocked).toBe(false);
  });

  it('blocks once the debt passes what the stock and the limit can carry', async () => {
    const svc = makeSut({
      balance: D('-9000'),
      limit: '1000',
      stock: [{ qtyOnHand: 10, batch: { unitCostInr: D('500') } }], // 5,000
    });
    const s = await svc.standing('s1');
    expect(s.allowanceInr).toBe('6000.00');
    expect(s.headroomInr).toBe('-3000.00');
    expect(s.blocked).toBe(true);
    expect(s.reason).toContain('9000.00');
  });

  it('ignores stock entirely when the setting says to', async () => {
    const svc = makeSut({
      balance: D('-2000'),
      limit: '500',
      stockBacked: false,
      stock: [{ qtyOnHand: 1000, batch: { unitCostInr: D('100') } }],
    });
    const s = await svc.standing('s1');
    expect(s.stockValueInr).toBe('0.00');
    expect(s.allowanceInr).toBe('500.00');
    expect(s.blocked).toBe(true);
  });

  it('values a batch with no recorded cost at NOTHING rather than guessing', async () => {
    const svc = makeSut({
      balance: D('-1000'),
      limit: '0',
      stock: [
        { qtyOnHand: 500, batch: { unitCostInr: null } },
        { qtyOnHand: 3, batch: { unitCostInr: D('100') } },
      ],
    });
    const s = await svc.standing('s1');
    expect(s.stockValueInr).toBe('300.00');
    expect(s.blocked).toBe(true);
  });

  it('FAILS OPEN when settings cannot be read', async () => {
    // A settings outage must not stop a working seller trading. The
    // money at risk in the minutes before somebody notices is far
    // smaller than the whole platform refusing orders.
    const svc = makeSut({ balance: D('-999999'), settingsThrow: true });
    const s = await svc.standing('s1');
    expect(s.blocked).toBe(false);
  });

  it('assertCanPlaceOrder throws WALLET_OVERDRAWN, and stays quiet otherwise', async () => {
    await expect(
      makeSut({ balance: D('-5000'), limit: '0' }).assertCanPlaceOrder('s1'),
    ).rejects.toMatchObject({ response: { code: 'WALLET_OVERDRAWN' } });

    await expect(makeSut({ balance: D('100') }).assertCanPlaceOrder('s1')).resolves.toBeUndefined();
  });

  it('treats a seller with no wallet row as flat zero, not as a debt', async () => {
    const svc = makeSut({});
    const s = await svc.standing('s1');
    expect(s.balanceInr).toBe('0.00');
    expect(s.blocked).toBe(false);
  });
});
