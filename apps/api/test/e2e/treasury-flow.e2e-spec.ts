import { randomUUID } from 'node:crypto';
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
import { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';
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
   * Put an entry in the book.
   *
   * An EXPENSE goes through the API, as an operator records one. Every
   * other type is fixture money — an opening balance, a settlement, a
   * withdrawal — posted straight through the ledger: POST
   * /admin/treasury/entries records expenses ONLY now, and each of those
   * has its own flow that these fixtures have no reason to drive.
   *
   * `amountCurrency` defaults to INR because most of these fixtures use
   * the INR account; the BDT cases state it, which is the point of the
   * field — the number has to say what it is.
   */
  async function post(body: Record<string, unknown>): Promise<void> {
    if (body['type'] === BankEntryType.EXPENSE) {
      await request(h.baseUrl)
        .post('/admin/treasury/entries')
        .set(auth)
        .send({ amountCurrency: Currency.INR, occurredAt: new Date().toISOString(), ...body })
        .expect(200);
      return;
    }
    const sellerId = body['sellerId'] as string | undefined;
    await h.app.get(BankLedgerService).post({
      accountId: body['accountId'] as string,
      type: body['type'] as BankEntryType,
      signedAmount: body['signedAmount'] as string,
      amountCurrency: (body['amountCurrency'] as Currency | undefined) ?? Currency.INR,
      owner: {
        kind: body['ownerKind'] as BankOwnerKind,
        ...(sellerId === undefined ? {} : { sellerId }),
      },
      occurredAt: new Date(),
    });
  }

  /** A category an expense can be filed under — the API now requires one. */
  async function category(): Promise<string> {
    const c = await h.prisma.expenseCategory.create({
      data: { code: `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, name: 'E2E' },
      select: { id: true },
    });
    return c.id;
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

    it('refuses a quote on a seller’s money moving INTO rupees, and records nothing', async () => {
      // Their wallet is in rupees: they are credited the book value of what
      // left and the gap against what arrived is our FX. A quote there would
      // move what the book holds for them away from what the wallet owes.
      await post({
        accountId: bdtAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '2000',
        amountCurrency: Currency.BDT,
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });

      await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send({
          fromAccountId: bdtAccount,
          toAccountId: inrAccount,
          amountOut: '2000',
          amountIn: '1480',
          quotedRate: '0.80',
          sellerId: sellerA,
          movedAt: new Date().toISOString(),
        })
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('TRANSFER_QUOTE_INTO_WALLET_CURRENCY'));

      expect(
        await h.prisma.bankTransfer.count({
          where: { sellerId: sellerA, currencyIn: Currency.INR },
        }),
      ).toBe(0);
    });

    it('books what a same-currency transfer loses on the way as a bank charge', async () => {
      // A bank fee is an expense with a name, not a quiet shortfall — and
      // not a refusal that leaves the real transfer unrecorded.
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
        .expect(200);
      const charge = await h.prisma.bankEntry.findFirst({
        where: {
          type: BankEntryType.EXPENSE,
          accountId: second.id,
          expenseCategory: { code: 'bank_charges' },
        },
        select: { signedAmount: true, ownerKind: true },
      });
      expect(charge?.signedAmount.toFixed(2)).toBe('-5.00');
      expect(charge?.ownerKind).toBe('CAPITAL');
    });

    it('a retried transfer with the same key is recorded ONCE — and a different one under it is refused', async () => {
      // A double-click or a timed-out save used to record the move twice.
      const key = randomUUID();
      const body = {
        fromAccountId: inrAccount,
        toAccountId: bdtAccount,
        amountOut: '100',
        amountIn: '130',
        movedAt: new Date().toISOString(),
        idempotencyKey: key,
      };
      const first = await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send(body)
        .expect(200);
      const again = await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send(body)
        .expect(200);
      expect(again.body.transferId).toBe(first.body.transferId);
      expect(await h.prisma.bankTransfer.count({ where: { idempotencyKey: key } })).toBe(1);
      await request(h.baseUrl)
        .post('/admin/treasury/transfers')
        .set(auth)
        .send({ ...body, amountIn: '131' })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('IDEMPOTENCY_KEY_REUSED'));
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
          type: BankEntryType.EXPENSE,
          signedAmount: '-500',
          ownerKind: BankOwnerKind.CAPITAL,
          expenseCategoryId: await category(),
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
        .send({ code: 'Office Rent', name: 'Office rent' })
        .expect(201);
      // Normalised, so RENT / rent / Rent cannot become three categories
      // each holding a third of the year's rent. LOWER, because that is
      // what the seed ships — upper-casing put a typed "salaries" beside
      // the seeded `salaries` as a separate category.
      expect(cat.body.code).toBe('office_rent');

      await request(h.baseUrl)
        .post('/admin/treasury/expense-categories')
        .set(auth)
        // Different case, same category — the collision must still fire.
        .send({ code: 'OFFICE RENT', name: 'Rent again' })
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
      expect(inv.body.net).toBe('-200000.00');

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
      expect(partial.body.returned).toBe('8000.00');
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
      expect(closed.body.net).toBe('8000.00');
      expect(closed.body.closedAt).not.toBeNull();

      const afterReturn = await overview();
      expect(afterReturn.accounts.find((a) => a.accountId === inrAccount)?.capital).toBe(
        '508000.00',
      );
    });

    it('the raw entry form cannot move money outside an investment — or anywhere else', async () => {
      // It used to post any type: an INVESTMENT_OUT with no investment, an
      // FX_SPREAD with no transfer (revenue from nothing), a SELLER_TOPUP
      // with no wallet credit (client money that was never owed). Each has
      // its own flow and its own guard; the form now takes expenses only.
      for (const [type, signedAmount, ownerKind, sellerId] of [
        [BankEntryType.INVESTMENT_OUT, '-1000', BankOwnerKind.CAPITAL, undefined],
        [BankEntryType.FX_SPREAD, '500', BankOwnerKind.CAPITAL, undefined],
        [BankEntryType.SELLER_TOPUP, '500', BankOwnerKind.SELLER, sellerA],
        [BankEntryType.RECONCILIATION_ADJUSTMENT, '500', BankOwnerKind.CAPITAL, undefined],
      ] as const) {
        await request(h.baseUrl)
          .post('/admin/treasury/entries')
          .set(auth)
          .send({
            accountId: inrAccount,
            amountCurrency: Currency.INR,
            type,
            signedAmount,
            ownerKind,
            ...(sellerId === undefined ? {} : { sellerId }),
            occurredAt: new Date().toISOString(),
          })
          .expect(400)
          .expect((r) => expect(r.body.code).toBe('TREASURY_ENTRY_NOT_ALLOWED'));
      }
      // A POSITIVE expense is income filed as spending.
      await request(h.baseUrl)
        .post('/admin/treasury/entries')
        .set(auth)
        .send({
          accountId: inrAccount,
          amountCurrency: Currency.INR,
          type: BankEntryType.EXPENSE,
          signedAmount: '1000',
          ownerKind: BankOwnerKind.CAPITAL,
          expenseCategoryId: await category(),
          occurredAt: new Date().toISOString(),
        })
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('TREASURY_EXPENSE_NOT_NEGATIVE'));
      // Nothing reached the book.
      expect(await h.prisma.bankEntry.count({ where: { accountId: inrAccount } })).toBe(0);
    });

    it('a return in another currency, or on a closed investment, is refused; the close date never moves', async () => {
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '100000',
        ownerKind: BankOwnerKind.CAPITAL,
      });
      const inv = await request(h.baseUrl)
        .post('/admin/treasury/investments')
        .set(auth)
        .send({
          label: 'Short FD',
          counterparty: 'HDFC Bank',
          fromAccountId: inrAccount,
          amount: '50000',
          placedAt: new Date().toISOString(),
        })
        .expect(201);
      const id = inv.body.id as string;

      // Rupees placed, taka returned: the two would be added as one figure.
      await request(h.baseUrl)
        .post(`/admin/treasury/investments/${id}/return`)
        .set(auth)
        .send({ toAccountId: bdtAccount, amount: '1000', receivedAt: new Date().toISOString() })
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('INVESTMENT_CURRENCY_MISMATCH'));

      const closedAt = '2026-09-01T00:00:00.000Z';
      await request(h.baseUrl)
        .post(`/admin/treasury/investments/${id}/return`)
        .set(auth)
        .send({ toAccountId: inrAccount, amount: '50500', receivedAt: closedAt, close: true })
        .expect(200);

      await request(h.baseUrl)
        .post(`/admin/treasury/investments/${id}/return`)
        .set(auth)
        .send({ toAccountId: inrAccount, amount: '10', receivedAt: new Date().toISOString() })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('INVESTMENT_CLOSED'));

      const row = await h.prisma.investment.findUniqueOrThrow({ where: { id } });
      expect(row.closedAt?.toISOString()).toBe(closedAt);
      expect(row.returnedInr.toFixed(2)).toBe('50500.00');
    });

    it('placing twice with the same key places ONCE', async () => {
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '100000',
        ownerKind: BankOwnerKind.CAPITAL,
      });
      const body = {
        label: 'FD',
        counterparty: 'HDFC Bank',
        fromAccountId: inrAccount,
        amount: '20000',
        placedAt: new Date().toISOString(),
        idempotencyKey: '3f8a2c1e-9b7d-4e6f-8a1b-2c3d4e5f6a7b',
      };
      const a = await request(h.baseUrl)
        .post('/admin/treasury/investments')
        .set(auth)
        .send(body)
        .expect(201);
      const b = await request(h.baseUrl)
        .post('/admin/treasury/investments')
        .set(auth)
        .send(body)
        .expect(201);
      expect(b.body.id).toBe(a.body.id);
      expect(
        await h.prisma.bankEntry.count({
          where: { accountId: inrAccount, type: BankEntryType.INVESTMENT_OUT },
        }),
      ).toBe(1);
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

  describe('the guards that only a real database can prove', () => {
    it('two operators reconciling at once correct the account ONCE, not twice', async () => {
      // The bug this pins: reconcile read the balance, computed a
      // difference, then posted it — all outside a transaction. Two
      // operators both read ₹1,000, both computed +₹200, and the account
      // landed at ₹1,400. The ledger is append-only, so the doubling was
      // permanent. A mocked Prisma has no concurrency to expose this;
      // only a real database does.
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '1000',
        ownerKind: BankOwnerKind.CAPITAL,
      });

      const body = {
        ownerKind: BankOwnerKind.CAPITAL,
        statedBalance: '1200.00',
        reason: 'Bank charged a wire fee we had not recorded',
      };
      const [a, b] = await Promise.all([
        request(h.baseUrl)
          .post(`/admin/treasury/accounts/${inrAccount}/reconcile`)
          .set(auth)
          .send(body),
        request(h.baseUrl)
          .post(`/admin/treasury/accounts/${inrAccount}/reconcile`)
          .set(auth)
          .send(body),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);

      // Whichever ran second saw 1,200 already and had nothing to do.
      const deltas = [a.body.delta, b.body.delta].sort();
      expect(deltas).toEqual(['0.00', '200.00']);

      const ov = await overview();
      expect(ov.accounts.find((x) => x.accountId === inrAccount)?.capital).toBe('1200.00');
    });

    it('refuses to retire an account that still holds money', async () => {
      // Retiring it would drop the money from every per-account figure
      // while the client-money total still counted it — the two halves
      // of the same page disagreeing, with neither obviously wrong.
      await post({
        accountId: bdtAccount,
        amountCurrency: Currency.BDT,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '500',
        ownerKind: BankOwnerKind.CAPITAL,
      });

      await request(h.baseUrl)
        .delete(`/admin/platform-bank-accounts/${bdtAccount}`)
        .set(auth)
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('BANK_ACCOUNT_NOT_EMPTY'));

      // Emptied, it retires cleanly.
      await post({
        accountId: bdtAccount,
        amountCurrency: Currency.BDT,
        type: BankEntryType.RECONCILIATION_ADJUSTMENT,
        signedAmount: '-500',
        ownerKind: BankOwnerKind.CAPITAL,
      });
      await request(h.baseUrl)
        .delete(`/admin/platform-bank-accounts/${bdtAccount}`)
        .set(auth)
        .expect(204);
    });

    it('a charge never reclassifies into a RETIRED account', async () => {
      // `post()` refuses a retired account, so reclassifying into one
      // would take the whole wallet write down with it and block a
      // charge over a bookkeeping decision made months ago. The seller's
      // holding there is excluded instead, and the charge simply becomes
      // a receivable.
      await giveWalletBalance(sellerA, '1000');
      await post({
        accountId: bdtAccount,
        amountCurrency: Currency.BDT,
        type: BankEntryType.SELLER_TOPUP,
        signedAmount: '1000',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });
      // Retire it by hand — the endpoint would refuse while it holds money.
      await h.prisma.platformBankAccount.update({
        where: { id: bdtAccount },
        data: { deletedAt: new Date(), isActive: false },
      });

      const wallet = h.app.get(WalletService);
      await h.prisma.$transaction(async (tx) => {
        await wallet.applyEntry(tx, {
          sellerId: sellerA,
          currency: Currency.BDT,
          direction: WalletEntryDirection.ORDER_CHARGES,
          amount: new Prisma.Decimal('100'),
          actorType: 'SYSTEM',
        });
      });

      // No reclassification was written, and nothing threw.
      const reclass = await h.prisma.bankEntry.count({
        where: { type: BankEntryType.RECLASSIFICATION },
      });
      expect(reclass).toBe(0);
    });
  });

  describe('getting money INTO the book, and correcting it', () => {
    it('an account can be created with what is already in it', async () => {
      // Without this the only way to set a starting balance was to
      // reconcile a brand-new account up from zero — which files the
      // money under "the book was wrong" when the book was not wrong, it
      // was empty. An account added without its balance also reads as
      // zero everywhere derived from it, with nothing saying it is
      // merely unentered.
      const created = await request(h.baseUrl)
        .post('/admin/platform-bank-accounts')
        .set(auth)
        .send({
          label: 'Opening Test',
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: 'OPEN-1',
          currency: Currency.INR,
          openingBalance: '125000.50',
        })
        .expect(201);

      const ov = await overview();
      const acc = ov.accounts.find((a) => a.accountId === created.body.id);
      expect(acc?.capital).toBe('125000.50');
      // OURS. Money held for a seller arrives through a top-up or a
      // settlement, each of which records why.
      expect(acc?.sellerHeld).toBe('0.00');
    });

    it('a zero opening balance writes no entry rather than a zero one', async () => {
      const created = await request(h.baseUrl)
        .post('/admin/platform-bank-accounts')
        .set(auth)
        .send({
          label: 'Empty Test',
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: 'EMPTY-1',
          currency: Currency.INR,
          openingBalance: '0',
        })
        .expect(201);

      const entries = await h.prisma.bankEntry.count({
        where: { accountId: created.body.id as string },
      });
      expect(entries).toBe(0);
    });

    it('an opening balance is MARKED when reconciled, and an account has only one', async () => {
      // The P&L reads the mark: a system reclassification landing first on
      // a new account used to make a real opening balance read as income.
      const res = await request(h.baseUrl)
        .post(`/admin/treasury/accounts/${bdtAccount}/reconcile`)
        .set(auth)
        .send({
          ownerKind: BankOwnerKind.CAPITAL,
          statedBalance: '100000',
          reason: 'Initial balance from the bank statement',
          isOpeningBalance: true,
        })
        .expect(200);
      const entry = await h.prisma.bankEntry.findUnique({
        where: { id: res.body.entryId as string },
        select: { isOpeningBalance: true },
      });
      expect(entry?.isOpeningBalance).toBe(true);
      await request(h.baseUrl)
        .post(`/admin/treasury/accounts/${bdtAccount}/reconcile`)
        .set(auth)
        .send({
          ownerKind: BankOwnerKind.CAPITAL,
          statedBalance: '100500',
          reason: 'Initial balance from the bank statement',
          isOpeningBalance: true,
        })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('OPENING_BALANCE_EXISTS'));
    });

    it('the balance an account is created with is its opening balance', async () => {
      const created = await request(h.baseUrl)
        .post('/admin/platform-bank-accounts')
        .set(auth)
        .send({
          label: 'Opening Mark Test',
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: 'OPEN-MARK-1',
          currency: Currency.INR,
          openingBalance: '5000',
        })
        .expect(201);
      const opening = await h.prisma.bankEntry.findFirst({
        where: { accountId: created.body.id as string },
        select: { isOpeningBalance: true },
      });
      expect(opening?.isOpeningBalance).toBe(true);
    });

    it('an existing capital correction can be MARKED as the opening balance later — once', async () => {
      // An account whose real opening balance was reconciled in before the
      // mark existed counted it as income; the operator names the entry.
      const created = await request(h.baseUrl)
        .post('/admin/platform-bank-accounts')
        .set(auth)
        .send({
          label: 'Mark Later Test',
          bankName: 'Test Bank',
          accountName: 'Skydrop',
          accountNumber: 'MARK-LATER-1',
          currency: Currency.INR,
          openingBalance: '0',
        })
        .expect(201);
      const accountId = created.body.id as string;
      const first = await request(h.baseUrl)
        .post(`/admin/treasury/accounts/${accountId}/reconcile`)
        .set(auth)
        .send({
          ownerKind: BankOwnerKind.CAPITAL,
          statedBalance: '5000',
          reason: 'Balance on the day the book started',
        })
        .expect(200);
      await request(h.baseUrl)
        .post(`/admin/treasury/entries/${first.body.entryId as string}/mark-opening-balance`)
        .set(auth)
        .send({ reason: 'This was the money already in the account' })
        .expect(200);
      const marked = await h.prisma.bankEntry.findUnique({
        where: { id: first.body.entryId as string },
        select: { isOpeningBalance: true },
      });
      expect(marked?.isOpeningBalance).toBe(true);

      const second = await request(h.baseUrl)
        .post(`/admin/treasury/accounts/${accountId}/reconcile`)
        .set(auth)
        .send({
          ownerKind: BankOwnerKind.CAPITAL,
          statedBalance: '5500',
          reason: 'A later correction, not an opening',
        })
        .expect(200);
      await request(h.baseUrl)
        .post(`/admin/treasury/entries/${second.body.entryId as string}/mark-opening-balance`)
        .set(auth)
        .send({ reason: 'Trying to mark a second one here' })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('OPENING_BALANCE_EXISTS'));
    });

    it("corrects a SELLER's holding without touching our own money", async () => {
      // Each owner is its own running sum in an account. Reconciling
      // could only ever correct capital before, so a seller's holding
      // that disagreed with the statement had no way to be fixed.
      await post({
        accountId: inrAccount,
        type: BankEntryType.SELLER_TOPUP,
        signedAmount: '42500',
        ownerKind: BankOwnerKind.SELLER,
        sellerId: sellerA,
      });
      await post({
        accountId: inrAccount,
        type: BankEntryType.OPENING_BALANCE,
        signedAmount: '100000',
        ownerKind: BankOwnerKind.CAPITAL,
      });

      const res = await request(h.baseUrl)
        .post(`/admin/treasury/accounts/${inrAccount}/reconcile`)
        .set(auth)
        .send({
          ownerKind: BankOwnerKind.SELLER,
          sellerId: sellerA,
          statedBalance: '40000.00',
          reason: 'Statement shows 40,000 held for them, not 42,500',
        })
        .expect(200);
      expect(res.body.delta).toBe('-2500.00');

      const ov = await overview();
      const acc = ov.accounts.find((a) => a.accountId === inrAccount);
      expect(acc?.sellerHeld).toBe('40000.00');
      // Untouched — the correction was about their money, not ours.
      expect(acc?.capital).toBe('100000.00');
    });
  });
});
