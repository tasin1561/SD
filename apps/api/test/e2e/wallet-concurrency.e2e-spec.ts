import request from 'supertest';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { AdminSellerWalletService } from '../../src/modules/admin-seller-wallet/services/admin-seller-wallet.service';
import { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The wallet under concurrent writes.
 *
 * `applyEntry` reads the balance, adds a delta, and writes the result
 * into the new row's `runningBalanceAfter`. Read-then-write under READ
 * COMMITTED is not a guard: two transactions crediting the same seller
 * at the same instant both read the same balance and both stamp the
 * same running balance. The seller's statement then stops adding up,
 * and because the ledger is append-only there is no row to go back and
 * fix — only an adjusting entry that makes the history stranger.
 *
 * This is not hypothetical traffic. Two of a seller's parcels
 * delivering together, a top-up accepted while the accrual sweep runs,
 * the withdrawal cron overlapping a settlement — the webhook worker
 * alone processes scans concurrently.
 *
 * What makes it worth a test rather than an assertion: the ordinary
 * single-threaded path passes either way, and the corruption is
 * invisible until someone reads a statement closely. A mocked Prisma
 * has no concurrency to expose, so only a real database can tell the
 * two implementations apart — the same argument as the pack-box and
 * pickup-request partial uniques.
 */
describe('Wallet concurrency (e2e)', () => {
  let h: AppHarness;
  let sellerId: string;
  let wallet: WalletService;

  const CONCURRENT = 12;
  const AMOUNT = 10;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    wallet = h.app.get(WalletService);

    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    const staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: `wallet-conc-${Date.now()}@brand.com` })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Concurrency Brand',
        contactPersonName: 'Conc Owner',
        phone: '+8801712345693',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
  });

  /** One credit, in its own transaction, exactly as a real caller does. */
  function credit(): Promise<unknown> {
    return h.prisma.$transaction((tx) =>
      wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.TOPUP,
        amount: new Prisma.Decimal(AMOUNT),
        actorType: ActorType.SYSTEM,
      }),
    );
  }

  it('keeps the running balance a correct chain under concurrent credits', async () => {
    await Promise.all(Array.from({ length: CONCURRENT }, () => credit()));

    const entries = await h.prisma.sellerWalletEntry.findMany({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, runningBalanceAfter: true },
    });
    expect(entries).toHaveLength(CONCURRENT);

    // Every step adds up. Before the advisory lock, concurrent writers
    // read the same base and produced DUPLICATE running balances — this
    // walk is what catches it.
    let expected = new Prisma.Decimal(0);
    for (const [i, e] of entries.entries()) {
      expected = expected.add(e.amount);
      expect(`${i}:${e.runningBalanceAfter.toString()}`).toBe(`${i}:${expected.toString()}`);
    }

    // And no two entries claim the same balance.
    const distinct = new Set(entries.map((e) => e.runningBalanceAfter.toString()));
    expect(distinct.size).toBe(CONCURRENT);
  });

  it('the last running balance equals the summed ledger', async () => {
    // The two ways of answering "what is the balance" must agree: the
    // O(1) read applyEntry uses, and the full sum that verifies it. A
    // system that only ever reads its own last answer cannot notice it
    // was wrong.
    await Promise.all(Array.from({ length: CONCURRENT }, () => credit()));

    const last = await h.prisma.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    const summed = await wallet.balanceLive(sellerId, Currency.INR);

    expect(last!.runningBalanceAfter.toString()).toBe(summed.toString());
    expect(summed.toString()).toBe(String(CONCURRENT * AMOUNT));
  });

  it('mixed credits and debits still conserve', async () => {
    const debit = (): Promise<unknown> =>
      h.prisma.$transaction((tx) =>
        wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.ORDER_CHARGES,
          amount: new Prisma.Decimal(4),
          actorType: ActorType.SYSTEM,
        }),
      );

    await Promise.all([
      ...Array.from({ length: 6 }, () => credit()),
      ...Array.from({ length: 6 }, () => debit()),
    ]);

    const summed = await wallet.balanceLive(sellerId, Currency.INR);
    // 6 × +10, 6 × −4.
    expect(summed.toString()).toBe('36');

    const last = await h.prisma.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    expect(last!.runningBalanceAfter.toString()).toBe('36');
  });

  it('separate wallets do not block each other', async () => {
    // The lock is per (seller, currency): a busy seller must not make
    // every other seller's money wait behind them.
    await Promise.all([
      credit(),
      h.prisma.$transaction((tx) =>
        wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.BDT,
          direction: WalletEntryDirection.TOPUP,
          amount: new Prisma.Decimal(7),
          actorType: ActorType.SYSTEM,
        }),
      ),
    ]);

    expect((await wallet.balanceLive(sellerId, Currency.INR)).toString()).toBe(String(AMOUNT));
    expect((await wallet.balanceLive(sellerId, Currency.BDT)).toString()).toBe('7');
  });

  describe('the balance cache, against a real database', () => {
    it('applyEntry writes the cache in the SAME transaction, so it can never lag', async () => {
      await credit();

      const [cache, last] = await Promise.all([
        h.prisma.sellerWalletBalance.findUnique({
          where: { sellerId_currency: { sellerId, currency: Currency.INR } },
          select: { balance: true, lastEntryId: true },
        }),
        h.prisma.sellerWalletEntry.findFirst({
          where: { sellerId, currency: Currency.INR },
          orderBy: { id: 'desc' },
          select: { id: true, runningBalanceAfter: true },
        }),
      ]);

      // Before this, refreshing the cache was each caller's job
      // post-commit and 8 of 14 money paths never did it — so a seller
      // could carry a debt the admin page reported as zero.
      expect(cache).not.toBeNull();
      expect(cache?.lastEntryId).toBe(last?.id);
      expect(cache?.balance.toFixed(2)).toBe(last?.runningBalanceAfter.toFixed(2));
    });

    it('stays in step across many writes', async () => {
      for (let i = 0; i < 5; i += 1) await credit();

      const cache = await h.prisma.sellerWalletBalance.findUnique({
        where: { sellerId_currency: { sellerId, currency: Currency.INR } },
        select: { balance: true },
      });
      expect(cache?.balance.toFixed(2)).toBe((AMOUNT * 5).toFixed(2));
    });

    it('the admin overview runs its real queries and reports the real debt', async () => {
      // The query this replaced used groupBy({ _max: { id: true } }),
      // which Postgres refuses outright — there is no max() for uuid.
      // Prisma's types allow it and a mocked client has no database to
      // refuse it, so the page 500'd in production with every unit test
      // green. This exercises the actual SQL.
      await h.prisma.$transaction((tx) =>
        wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.INBOUND_FREIGHT,
          amount: new Prisma.Decimal(3000),
          actorType: ActorType.SYSTEM,
        }),
      );

      const admin = h.app.get(AdminSellerWalletService);
      const view = await admin.overview();

      const row = view.rows.find((r) => r.sellerId === sellerId);
      expect(row).toBeDefined();
      expect(row?.balanceInr).toBe('-3000.00');
      // The estate total must not read "0 in debt" while a seller owes.
      expect(Number(view.totals.owedBySellersInr)).toBeGreaterThanOrEqual(3000);
      expect(view.totals.sellersInDebt).toBeGreaterThanOrEqual(1);

      // And the per-seller detail, which had the same flaw.
      const detail = await admin.detail(sellerId);
      expect(detail.balanceInr).toBe('-3000.00');
    });
  });
});
