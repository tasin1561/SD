import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ActorType,
  Currency,
  Prisma,
  ResellerStoreOrigin,
  ResellerStoreStatus,
  ResellerWalletManager,
  SellerStoreKind,
  StoreWalletEntryDirection,
  TopupRequestStatus,
  WalletEntryDirection,
} from '@skydrop/db';
import { ResellerStoreService } from '../../src/modules/reseller-store/services/reseller-store.service';
import { SellerManagedStoreWalletService } from '../../src/modules/reseller-store-wallet/services/seller-managed-store-wallet.service';
import {
  STORE_CREDIT_DIRECTIONS,
  StoreWalletService,
} from '../../src/modules/reseller-store-wallet/services/store-wallet.service';
import { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * RS-6 — the store wallet under concurrent writes, against a real database.
 *
 * The WAL-7 regression shape, for stores: `applyEntry` reads the store's
 * last running balance and writes the next one. Unlocked, two writers read
 * the same balance and stamp the same running balance, and the append-only
 * ledger keeps the error forever. The store writer takes the SELLER's
 * WALLET lock — the one the seller's own wallet takes — so the seller and
 * every one of their stores are serialised TOGETHER; that is what lets the
 * bank invariant read `seller + Σ stores` as one consistent figure.
 *
 * A mocked Prisma has no concurrency to expose: only a real database can
 * tell the locked implementation from an unlocked one.
 */
describe('Store wallet concurrency (e2e)', () => {
  let h: AppHarness;
  let sellerId: string;
  let storeWallet: StoreWalletService;
  let wallet: WalletService;
  let moves: SellerManagedStoreWalletService;

  const CONCURRENT = 12;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    storeWallet = h.app.get(StoreWalletService);
    wallet = h.app.get(WalletService);
    moves = h.app.get(SellerManagedStoreWalletService);

    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    const staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    const email = `store-wallet-conc-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Store Wallet Brand',
        contactPersonName: 'Store Owner',
        phone: '+8801712345694',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    await h.prisma.seller.update({ where: { id: sellerId }, data: { status: 'APPROVED' } });
  });

  async function makeStore(
    managedBy: ResellerWalletManager = ResellerWalletManager.SELLER,
  ): Promise<string> {
    const store = await h.prisma.sellerStore.create({
      data: {
        sellerId,
        name: `Reseller ${randomUUID().slice(0, 8)}`,
        kind: SellerStoreKind.RESELLER,
        status: ResellerStoreStatus.ACTIVE,
        origin: ResellerStoreOrigin.SELLER,
        walletManagedBy: managedBy,
        isDefault: false,
        isActive: true,
        statusChangedAt: new Date(),
      },
      select: { id: true },
    });
    return store.id;
  }

  function storeWrite(
    storeId: string,
    direction: StoreWalletEntryDirection,
    amount: string,
  ): Promise<unknown> {
    return h.prisma.$transaction((tx) =>
      storeWallet.applyEntry(tx, {
        storeId,
        sellerId,
        direction,
        amount: new Prisma.Decimal(amount),
        ...(direction === StoreWalletEntryDirection.FEE_SHARE
          ? { shareOf: WalletEntryDirection.ORDER_CHARGES }
          : {}),
        actorType: ActorType.SYSTEM,
      }),
    );
  }

  function sellerCredit(amount: string): Promise<unknown> {
    return h.prisma.$transaction((tx) =>
      wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.TOPUP,
        amount: new Prisma.Decimal(amount),
        actorType: ActorType.SYSTEM,
      }),
    );
  }

  /** Every running balance equals the one before plus this entry — a correct chain. */
  async function expectStoreChain(storeId: string): Promise<Prisma.Decimal> {
    const rows = await h.prisma.storeWalletEntry.findMany({
      where: { storeId },
      orderBy: { id: 'asc' },
      select: { direction: true, amount: true, runningBalanceAfter: true },
    });
    let balance = new Prisma.Decimal(0);
    for (const r of rows) {
      balance = STORE_CREDIT_DIRECTIONS.has(r.direction)
        ? balance.add(r.amount)
        : balance.sub(r.amount);
      expect(r.runningBalanceAfter.toFixed(2)).toBe(balance.toFixed(2));
    }
    return balance;
  }

  async function sellerBalance(): Promise<Prisma.Decimal> {
    const last = await h.prisma.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? new Prisma.Decimal(0);
  }

  it('keeps the store’s running balance a correct chain under concurrent credits', async () => {
    const storeId = await makeStore();
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        storeWrite(storeId, StoreWalletEntryDirection.TOPUP, '10'),
      ),
    );
    const balance = await expectStoreChain(storeId);
    expect(balance.toFixed(2)).toBe('120.00');
  });

  it('seller and store writes interleaved at once: both chains stay correct', async () => {
    const storeId = await makeStore();
    await Promise.all([
      ...Array.from({ length: 6 }, () => sellerCredit('10')),
      ...Array.from({ length: 6 }, () =>
        storeWrite(storeId, StoreWalletEntryDirection.TOPUP, '10'),
      ),
      ...Array.from({ length: 6 }, () =>
        storeWrite(storeId, StoreWalletEntryDirection.FEE_SHARE, '10'),
      ),
    ]);
    expect((await expectStoreChain(storeId)).toFixed(2)).toBe('0.00');
    expect((await sellerBalance()).toFixed(2)).toBe('60.00');
  });

  it('two stores of one seller written at once: each chain correct', async () => {
    const a = await makeStore();
    const b = await makeStore();
    await Promise.all([
      ...Array.from({ length: 6 }, () => storeWrite(a, StoreWalletEntryDirection.TOPUP, '5')),
      ...Array.from({ length: 6 }, () => storeWrite(b, StoreWalletEntryDirection.TOPUP, '7')),
      ...Array.from({ length: 3 }, () => sellerCredit('1')),
    ]);
    expect((await expectStoreChain(a)).toFixed(2)).toBe('30.00');
    expect((await expectStoreChain(b)).toFixed(2)).toBe('42.00');
    expect((await sellerBalance()).toFixed(2)).toBe('3.00');
  });

  it('concurrent seller-managed top-ups and payouts: the pot never changes, and no payout overdraws the store', async () => {
    const storeId = await makeStore();
    await sellerCredit('1000');
    const actor = { sellerUserId: randomUUID() };
    await Promise.all(
      Array.from({ length: 8 }, () => moves.topUp(sellerId, storeId, { amountInr: '100' }, actor)),
    );
    expect((await expectStoreChain(storeId)).toFixed(2)).toBe('800.00');
    expect((await sellerBalance()).toFixed(2)).toBe('200.00');

    const payouts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        moves.recordPayout(sellerId, storeId, { amountInr: '100', note: 'Paid by UPI' }, actor),
      ),
    );
    // Exactly eight fit in ₹800; the other two were refused, not overdrawn.
    expect(payouts.filter((p) => p.status === 'fulfilled')).toHaveLength(8);
    expect((await expectStoreChain(storeId)).toFixed(2)).toBe('0.00');
    expect((await sellerBalance()).toFixed(2)).toBe('1000.00');
  });

  it('a top-up cannot take more than the seller could withdraw, however many race', async () => {
    const storeId = await makeStore();
    await sellerCredit('250');
    const actor = { sellerUserId: randomUUID() };
    const out = await Promise.allSettled(
      Array.from({ length: 5 }, () => moves.topUp(sellerId, storeId, { amountInr: '100' }, actor)),
    );
    expect(out.filter((p) => p.status === 'fulfilled')).toHaveLength(2);
    expect((await sellerBalance()).toFixed(2)).toBe('50.00');
    expect((await expectStoreChain(storeId)).toFixed(2)).toBe('200.00');
  });

  it('the wallet cannot change hands while a claim is open, and a store cannot close with money in it', async () => {
    const storeId = await makeStore(ResellerWalletManager.SKYDROP);
    const account = await h.prisma.platformBankAccount.create({
      data: {
        label: 'HDFC current',
        bankName: 'HDFC Bank',
        accountName: 'Skydrop',
        accountNumber: '50200000000001',
        currency: Currency.INR,
      },
      select: { id: true },
    });
    await h.prisma.storeTopupRequest.create({
      data: {
        storeId,
        sellerId,
        bankAccountId: account.id,
        amountInr: new Prisma.Decimal('500'),
        transactionRef: 'UTR-1',
        status: TopupRequestStatus.PENDING,
      },
    });
    const stores = h.app.get(ResellerStoreService);
    const actor = { kind: 'SELLER' as const, sellerUserId: randomUUID(), name: 'Owner' };
    await expect(
      stores.setWalletManager(sellerId, storeId, ResellerWalletManager.SELLER, actor),
    ).rejects.toMatchObject({ response: { code: 'STORE_WALLET_HAS_OPEN_REQUESTS' } });

    const other = await makeStore();
    await storeWrite(other, StoreWalletEntryDirection.TOPUP, '1');
    await expect(
      stores.close(sellerId, other, actor, 'Closing this reseller store for good'),
    ).rejects.toMatchObject({ response: { code: 'STORE_WALLET_NOT_SETTLED' } });
    const after = await h.prisma.sellerStore.findUniqueOrThrow({
      where: { id: other },
      select: { status: true },
    });
    expect(after.status).toBe(ResellerStoreStatus.ACTIVE);
  });
});
