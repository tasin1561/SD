import request from 'supertest';
import {
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  StaffRole,
  WalletEntryDirection,
} from '@skydrop/db';
import { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Our own money, against a real database.
 *
 * These paths are exactly the shape that only a real database can
 * verify. In one week a mocked Prisma failed to notice `max(uuid)` — a
 * function Postgres does not have — and failed to notice a cache row
 * that was never written, reporting a seller owing ₹3,000 as ₹0.00. A
 * mock has no database to refuse a query, and every balance below is a
 * groupBy that a mock would happily agree with.
 *
 * So the assertions here are deliberately about SUMS and SPLITS rather
 * than about which service method was called.
 */
describe('Treasury (e2e)', () => {
  let h: AppHarness;
  let auth: { Authorization: string };
  let sellerA: string;
  let sellerB: string;
  let inrAccount: string;
  let bdtAccount: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    auth = { Authorization: `Bearer ${login.body.accessToken as string}` };

    const mk = async (name: string): Promise<string> => {
      const email = `${name.toLowerCase()}-${Date.now()}@brand.com`;
      const s = await h.prisma.seller.create({
        data: {
          companyName: name,
          email,
          emailDisplay: email,
          // Never signed in to — these sellers exist to own money, not
          // to log in.
          passwordHash: 'not-a-real-hash',
          contactPersonName: 'Owner',
          phone: '+8801712345600',
          status: 'APPROVED',
        },
        select: { id: true },
      });
      return s.id;
    };
    sellerA = await mk('TreasuryA');
    sellerB = await mk('TreasuryB');

    const acc = async (label: string, currency: Currency): Promise<string> => {
      const a = await h.prisma.platformBankAccount.create({
        data: {
          label,
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: `AC-${label}`,
          currency,
        },
        select: { id: true },
      });
      return a.id;
    };
    inrAccount = await acc('INR-Main', Currency.INR);
    bdtAccount = await acc('BDT-Payout', Currency.BDT);
  });

  /**
   * A wallet balance, written the way applyEntry writes it.
   *
   * The entry AND the balance row, because applyEntry now maintains both
   * in one transaction — a fixture that wrote only the entry would be
   * testing a state the application cannot produce.
   */
  async function giveWalletBalance(sellerId: string, running: string): Promise<void> {
    const entry = await h.prisma.sellerWalletEntry.create({
      data: {
        sellerId,
        currency: Currency.INR,
        direction: Number(running) >= 0 ? 'TOPUP' : 'INBOUND_FREIGHT',
        amount: Math.abs(Number(running)).toFixed(2),
        runningBalanceAfter: running,
        actorType: 'SYSTEM',
      },
      select: { id: true },
    });
    await h.prisma.sellerWalletBalance.upsert({
      where: { sellerId_currency: { sellerId, currency: Currency.INR } },
      create: { sellerId, currency: Currency.INR, balance: running, lastEntryId: entry.id },
      update: { balance: running, lastEntryId: entry.id },
    });
  }

  /**
   * Post an entry through the API, as an operator would.
   *
   * `amountCurrency` defaults to INR because most of these fixtures use
   * the INR account; the BDT cases state it, which is the point of the
   * field — the number has to say what it is.
   */
  async function post(body: Record<string, unknown>): Promise<void> {
    await request(h.baseUrl)
      .post('/admin/treasury/entries')
      .set(auth)
      .send({ amountCurrency: Currency.INR, occurredAt: new Date().toISOString(), ...body })
      .expect(200);
  }

  async function overview(): Promise<{
    accounts: Array<{
      accountId: string;
      total: string;
      capital: string;
      sellerHeld: string;
      bySeller: Array<{ sellerId: string; amount: string }>;
    }>;
    clientMoney: { owedToSellersInr: string; heldForSellersInr: string; covered: boolean };
  }> {
    const res = await request(h.baseUrl).get('/admin/treasury/overview').set(auth).expect(200);
    return res.body;
  }

  it('splits an account into what is ours and what is held, per seller', async () => {
    await post({
      accountId: inrAccount,
      type: BankEntryType.OPENING_BALANCE,
      signedAmount: '10000',
      ownerKind: BankOwnerKind.CAPITAL,
    });
    await post({
      accountId: inrAccount,
      type: BankEntryType.COURIER_SETTLEMENT,
      signedAmount: '2500',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerA,
    });
    await post({
      accountId: inrAccount,
      type: BankEntryType.COURIER_SETTLEMENT,
      signedAmount: '1500',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerB,
    });
    await post({
      accountId: inrAccount,
      type: BankEntryType.SELLER_WITHDRAWAL,
      signedAmount: '-500',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerA,
    });

    const o = await overview();
    const acc = o.accounts.find((a) => a.accountId === inrAccount);

    // The whole point of the table: one account, three claims on it.
    expect(acc?.capital).toBe('10000.00');
    expect(acc?.sellerHeld).toBe('3500.00');
    expect(acc?.total).toBe('13500.00');
    expect(acc?.bySeller.find((s) => s.sellerId === sellerA)?.amount).toBe('2000.00');
    expect(acc?.bySeller.find((s) => s.sellerId === sellerB)?.amount).toBe('1500.00');
  });

  it('refuses a seller entry with no seller, and capital with one', async () => {
    // A row that says neither, or both, is one somebody will later read
    // as either.
    await request(h.baseUrl)
      .post('/admin/treasury/entries')
      .set(auth)
      .send({
        accountId: inrAccount,
        type: BankEntryType.COURIER_SETTLEMENT,
        signedAmount: '100',
        ownerKind: BankOwnerKind.SELLER,
        occurredAt: new Date().toISOString(),
      })
      .expect(400);

    await request(h.baseUrl)
      .post('/admin/treasury/entries')
      .set(auth)
      .send({
        accountId: inrAccount,
        type: BankEntryType.EXPENSE,
        signedAmount: '-100',
        ownerKind: BankOwnerKind.CAPITAL,
        sellerId: sellerA,
        occurredAt: new Date().toISOString(),
      })
      .expect(400);
  });

  describe('cross-currency transfer — the quoted rate is a promise', () => {
    it('credits the seller at the quoted rate and books the spread as ours', async () => {
      await post({
        accountId: inrAccount,
        type: BankEntryType.COURIER_SETTLEMENT,
        signedAmount: '1000',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });

      const res = await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send({
          fromAccountId: inrAccount,
          toAccountId: bdtAccount,
          amountOut: '1000',
          // The bank gave 1.35 while the seller was quoted 1.30.
          amountIn: '1350',
          quotedRate: '1.30',
          sellerId: sellerA,
          movedAt: new Date().toISOString(),
        })
        .expect(200);

      expect(res.body.creditedToSeller).toBe('1300.00');
      expect(res.body.fxSpread).toBe('50.00');

      const o = await overview();
      const inr = o.accounts.find((a) => a.accountId === inrAccount);
      const bdt = o.accounts.find((a) => a.accountId === bdtAccount);

      // The rupees left entirely; the taka arrived split two ways.
      expect(inr?.sellerHeld).toBe('0.00');
      expect(bdt?.bySeller.find((s) => s.sellerId === sellerA)?.amount).toBe('1300.00');
      expect(bdt?.capital).toBe('50.00');
      expect(bdt?.total).toBe('1350.00');
    });

    it('honours the quote from capital when the rate goes against us', async () => {
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '5000',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });

      await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send({
          fromAccountId: inrAccount,
          toAccountId: bdtAccount,
          amountOut: '1000',
          amountIn: '1250',
          quotedRate: '1.30',
          sellerId: sellerA,
          movedAt: new Date().toISOString(),
        })
        .expect(200);

      const o = await overview();
      const bdt = o.accounts.find((a) => a.accountId === bdtAccount);
      // The seller gets what they were promised; we carry the shortfall.
      expect(bdt?.bySeller.find((s) => s.sellerId === sellerA)?.amount).toBe('1300.00');
      expect(bdt?.capital).toBe('-50.00');
      expect(bdt?.total).toBe('1250.00');
    });

    it('refuses a same-currency transfer that loses money on the way', async () => {
      // A bank fee is an expense with a name, not a quiet shortfall.
      const second = await h.prisma.platformBankAccount.create({
        data: {
          label: 'INR-Second',
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: 'AC-2',
          currency: Currency.INR,
        },
        select: { id: true },
      });
      await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send({
          fromAccountId: inrAccount,
          toAccountId: second.id,
          amountOut: '300',
          amountIn: '295',
          movedAt: new Date().toISOString(),
        })
        .expect(400);
    });
  });

  it('reconciling posts the DIFFERENCE and leaves the history intact', async () => {
    await post({
      accountId: inrAccount,
      type: BankEntryType.OPENING_BALANCE,
      signedAmount: '1000',
      ownerKind: BankOwnerKind.CAPITAL,
    });

    const res = await request(h.baseUrl)
      .post(`/admin/treasury/accounts/${inrAccount}/reconcile`)
      .set(auth)
      .send({
        ownerKind: BankOwnerKind.CAPITAL,
        statedBalance: '1120',
        reason: 'Bank statement shows interest credited that we had not recorded',
      })
      .expect(200);

    expect(res.body.delta).toBe('120.00');

    // TWO entries, not one edited: a discrepancy that disappears is one
    // nobody investigates.
    const entries = await h.prisma.bankEntry.findMany({ where: { accountId: inrAccount } });
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.type === BankEntryType.RECONCILIATION_ADJUSTMENT)).toBe(true);

    const o = await overview();
    expect(o.accounts.find((a) => a.accountId === inrAccount)?.capital).toBe('1120.00');
  });

  it('reports client-money coverage from what we owe against what we hold', async () => {
    // Owe: a positive wallet balance. Hold: cash marked as theirs.
    await giveWalletBalance(sellerA, '3000');
    await post({
      accountId: inrAccount,
      type: BankEntryType.SELLER_TOPUP,
      signedAmount: '3000',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerA,
    });

    const o = await overview();
    expect(o.clientMoney.owedToSellersInr).toBe('3000.00');
    expect(o.clientMoney.heldForSellersInr).toBe('3000.00');
    expect(o.clientMoney.covered).toBe(true);
  });

  it('a NEGATIVE wallet is a receivable — it must not flatter the coverage', async () => {
    // Seller B owes us. Netting that against what we owe seller A would
    // make it look as though less cash is needed than actually is.
    await giveWalletBalance(sellerA, '3000');
    await giveWalletBalance(sellerB, '-5000');

    const o = await overview();
    // 3000, not -2000: we still owe seller A every rupee of it.
    expect(o.clientMoney.owedToSellersInr).toBe('3000.00');
  });

  it("shows where one seller's money is sitting, for a payout decision", async () => {
    await post({
      accountId: inrAccount,
      type: BankEntryType.COURIER_SETTLEMENT,
      signedAmount: '700',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerA,
    });
    await post({
      accountId: bdtAccount,
      amountCurrency: Currency.BDT,
      type: BankEntryType.COURIER_SETTLEMENT,
      signedAmount: '500',
      ownerKind: BankOwnerKind.SELLER,
      sellerId: sellerA,
    });

    const res = await request(h.baseUrl)
      .get(`/admin/treasury/sellers/${sellerA}/holdings`)
      .set(auth)
      .expect(200);

    // The question a payout asks: is it in one place, and is that place
    // the currency we are paying from.
    expect(res.body).toHaveLength(2);
    expect(res.body.find((r: { currency: string }) => r.currency === 'INR').amount).toBe('700.00');
    expect(res.body.find((r: { currency: string }) => r.currency === 'BDT').amount).toBe('500.00');
  });

  describe('the flows that move money write BOTH sides', () => {
    it('refuses a figure denominated in a currency the account does not hold', async () => {
      // Before this guard the entry was stamped with the ACCOUNT's
      // currency whatever arrived, so 500 BDT posted to the INR account
      // became 500 INR — wrong by a factor of the exchange rate, with
      // nothing in the row to show it had happened.
      await request(h.baseUrl)
        .post('/admin/treasury/entries')
        .set(auth)
        .send({
          accountId: inrAccount,
          amountCurrency: Currency.BDT,
          type: BankEntryType.SELLER_TOPUP,
          signedAmount: '500',
          ownerKind: BankOwnerKind.SELLER,
          sellerId: sellerA,
          occurredAt: new Date().toISOString(),
        })
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('BANK_CURRENCY_MISMATCH'));
    });

    it('an accepted top-up credits the wallet AND records the cash, in one go', async () => {
      const req = await h.prisma.walletTopupRequest.create({
        data: {
          sellerId: sellerA,
          bankAccountId: inrAccount,
          currency: Currency.INR,
          amount: '1500.00',
          transactionRef: 'TRX-TOPUP-1',
          status: 'PENDING',
        },
        select: { id: true },
      });

      await request(h.baseUrl)
        .post(`/admin/wallet/topups/${req.id}/accept`)
        .set(auth)
        .send({})
        .expect(200);

      const entry = await h.prisma.bankEntry.findFirst({
        where: { topupRequestId: req.id },
        select: {
          signedAmount: true,
          currency: true,
          ownerKind: true,
          sellerId: true,
          type: true,
        },
      });
      // The two halves of one fact: the seller is owed it, and it is
      // sitting in a named account with their name against it.
      expect(entry).not.toBeNull();
      expect(entry?.signedAmount.toString()).toBe('1500');
      expect(entry?.currency).toBe(Currency.INR);
      expect(entry?.ownerKind).toBe(BankOwnerKind.SELLER);
      expect(entry?.sellerId).toBe(sellerA);
      expect(entry?.type).toBe(BankEntryType.SELLER_TOPUP);

      const balance = await h.prisma.sellerWalletBalance.findUnique({
        where: { sellerId_currency: { sellerId: sellerA, currency: Currency.INR } },
        select: { balance: true },
      });
      expect(balance?.balance.toString()).toBe('1500');

      // And the whole point of writing both: the coverage page now
      // reconciles instead of reporting a gap it cannot explain.
      const ov = await overview();
      expect(ov.clientMoney.owedToSellersInr).toBe('1500.00');
      expect(ov.clientMoney.heldForSellersInr).toBe('1500.00');
      expect(ov.clientMoney.covered).toBe(true);
    });
  });

  describe('spending and investing — ours only', () => {
    it('an expense leaves the account and is booked against OUR money', async () => {
      const cat = await request(h.baseUrl)
        .post('/admin/treasury/expense-categories')
        .set(auth)
        .send({ code: 'office rent', name: 'Office rent' })
        .expect(201);
      // Normalised, so RENT / rent / Rent cannot become three categories
      // each holding a third of the year's rent.
      expect(cat.body.code).toBe('OFFICE_RENT');

      await request(h.baseUrl)
        .post('/admin/treasury/expense-categories')
        .set(auth)
        .send({ code: 'OFFICE_RENT', name: 'Rent again' })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('EXPENSE_CATEGORY_EXISTS'));

      await post({
        accountId: inrAccount,
        type: BankEntryType.EXPENSE,
        signedAmount: '-25000',
        ownerKind: BankOwnerKind.CAPITAL,
        expenseCategoryId: cat.body.id,
      });

      const ov = await overview();
      const acc = ov.accounts.find((a) => a.accountId === inrAccount);
      expect(acc?.capital).toBe('-25000.00');
      // Nobody's held money moved.
      expect(acc?.sellerHeld).toBe('0.00');
    });

    it('placing capital moves it out of the bank WITHOUT spending it', async () => {
      // The point of modelling this: a fixed deposit must not read as
      // the money vanishing, or coverage would say we no longer hold
      // what sellers are owed.
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '500000',
        ownerKind: BankOwnerKind.CAPITAL,
      });

      const inv = await request(h.baseUrl)
        .post('/admin/treasury/investments')
        .set(auth)
        .send({
          label: '6-month FD',
          counterparty: 'HDFC Bank',
          fromAccountId: inrAccount,
          amount: '200000',
          placedAt: new Date().toISOString(),
        })
        .expect(201);
      expect(inv.body.netInr).toBe('-200000.00');

      const afterPlace = await overview();
      expect(afterPlace.accounts.find((a) => a.accountId === inrAccount)?.capital).toBe(
        '300000.00',
      );

      // Interest first, principal later — partial returns accumulate and
      // the investment stays open until somebody says it is finished.
      const partial = await request(h.baseUrl)
        .post(`/admin/treasury/investments/${inv.body.id as string}/return`)
        .set(auth)
        .send({ toAccountId: inrAccount, amount: '8000', receivedAt: new Date().toISOString() })
        .expect(200);
      expect(partial.body.returnedInr).toBe('8000.00');
      expect(partial.body.closedAt).toBeNull();

      const closed = await request(h.baseUrl)
        .post(`/admin/treasury/investments/${inv.body.id as string}/return`)
        .set(auth)
        .send({
          toAccountId: inrAccount,
          amount: '200000',
          receivedAt: new Date().toISOString(),
          close: true,
        })
        .expect(200);
      expect(closed.body.netInr).toBe('8000.00');
      expect(closed.body.closedAt).not.toBeNull();

      const afterReturn = await overview();
      expect(afterReturn.accounts.find((a) => a.accountId === inrAccount)?.capital).toBe(
        '508000.00',
      );
    });

    it("refuses to invest a seller's money — it is not ours to place", async () => {
      await request(h.baseUrl)
        .post('/admin/treasury/entries')
        .set(auth)
        .send({
          accountId: inrAccount,
          amountCurrency: Currency.INR,
          type: BankEntryType.INVESTMENT_OUT,
          signedAmount: '-1000',
          ownerKind: BankOwnerKind.CAPITAL,
          sellerId: sellerA,
          occurredAt: new Date().toISOString(),
        })
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('BANK_CAPITAL_HAS_SELLER'));
    });
  });

  describe('whose money is it — the cash follows the wallet', () => {
    /** Charge the wallet the way every fee path does: through applyEntry. */
    async function chargeWallet(
      sellerId: string,
      direction: 'ORDER_CHARGES' | 'INBOUND_FREIGHT',
      amount: string,
    ): Promise<void> {
      const wallet = h.app.get(WalletService);
      await h.prisma.$transaction(async (tx) => {
        await wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection[direction],
          amount: new Prisma.Decimal(amount),
          actorType: 'SYSTEM',
        });
      });
    }

    it('a charge converts held cash to OURS without changing the account total', async () => {
      // The seller pays ₹5,000 in. ₹800 of freight is then charged. The
      // bank still holds ₹5,000 — what changed is that ₹800 of it is now
      // ours, which is the whole point: freight we paid a forwarder out
      // of capital is being recovered INTO capital.
      await post({
        accountId: inrAccount,
        type: BankEntryType.SELLER_TOPUP,
        signedAmount: '5000',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });

      await chargeWallet(sellerA, 'INBOUND_FREIGHT', '800');

      const ov = await overview();
      const acc = ov.accounts.find((a) => a.accountId === inrAccount);
      expect(acc?.total).toBe('5000.00');
      expect(acc?.sellerHeld).toBe('4200.00');
      expect(acc?.capital).toBe('800.00');
      expect(acc?.bySeller.find((b) => b.sellerId === sellerA)?.amount).toBe('4200.00');
    });

    it('a charge against a seller holding NOTHING writes no bank entry at all', async () => {
      // The correction that matters. A negative wallet has no cash
      // behind it in any account; it is a receivable. Inventing a bank
      // entry for it would put a number in the book that no statement
      // will ever agree with.
      await chargeWallet(sellerB, 'ORDER_CHARGES', '250');

      const entries = await h.prisma.bankEntry.count({ where: { sellerId: sellerB } });
      expect(entries).toBe(0);

      const balance = await h.prisma.sellerWalletBalance.findUnique({
        where: { sellerId_currency: { sellerId: sellerB, currency: Currency.INR } },
        select: { balance: true },
      });
      // The debt is real and recorded — just not as cash.
      expect(balance?.balance.toString()).toBe('-250');
    });

    it('coverage still reconciles once a charge has moved money to capital', async () => {
      // Both sides of the top-up: the wallet credit and the cash. The
      // real flow writes them together (TRE-3); here they are set up
      // separately so the charge afterwards is the only thing under test.
      await giveWalletBalance(sellerA, '3000');
      await post({
        accountId: inrAccount,
        type: BankEntryType.SELLER_TOPUP,
        signedAmount: '3000',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });
      await chargeWallet(sellerA, 'ORDER_CHARGES', '200');

      const ov = await overview();
      // Wallet says we owe 2,800; the bank says we hold 2,800 for them.
      // Before this change the bank would still have said 3,000 and the
      // page would have reported us over-covered by money we had earned.
      expect(ov.clientMoney.owedToSellersInr).toBe('2800.00');
      expect(ov.clientMoney.heldForSellersInr).toBe('2800.00');
      expect(ov.clientMoney.covered).toBe(true);
    });
  });
});
