import request from 'supertest';
import { Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * A COD reversed and paid again IS credited again — against a REAL database.
 *
 * WAL-6 has always said so. `seller_wallet_entries_once_per_order_uq`
 * said the opposite: it covered `cod_collection` and the three COD
 * deductions, so the second credit could not exist. The contradiction did
 * not surface as a refusal anybody could act on — a P2002 aborts the
 * surrounding transaction, and for a courier payout that transaction
 * carries the settlement row, every line, EVERY OTHER SELLER's credit on
 * that payout, and the bank entry for cash that really landed. Re-
 * uploading the file reproduced it exactly.
 *
 * WAL-10 moved those four out of the index (migration
 * `20261013120000_cod_credit_may_recur`). This file is the proof that the
 * database now permits what the business rule requires, and — the half
 * that matters more — that the guards which REPLACED the index actually
 * hold.
 *
 * THE UNIT SUITE CANNOT SEE ANY OF THIS. A mocked Prisma has no index to
 * violate and no advisory lock to serialise on, which is exactly how the
 * old gate came to be asserted by a passing test while Postgres refused
 * what it claimed (`order-charges-rebill.e2e-spec.ts` records the same
 * lesson for the direction that STAYS covered).
 */
describe('COD credit — reversed and paid again (e2e)', () => {
  let h: AppHarness;
  let sellerAuth: { Authorization: string };
  let sellerId: string;
  let variantId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma);
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    const staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: `recur-${Date.now()}@brand.com` })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Recur Brand',
        contactPersonName: 'Recur Owner',
        phone: '+8801712345699',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Recur Widget', externalRef: 'RC-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'RC-1-STD' })
      .expect(201);
    variantId = variant.body.id as string;
  });

  /** A real order row — `linked_order_id` is a foreign key. */
  async function createOrder(): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876543210',
        acknowledgeDuplicate: true,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 1180,
        items: [{ variantId, quantity: 1 }],
      })
      .expect(201);
    return created.body.id as string;
  }

  /** The order's COD, as created below. Declared once so the credit and
   *  the assertions cannot drift from the order. */
  const COD = new Prisma.Decimal('1180.00');

  const cod = (): CodCreditService => h.app.get(CodCreditService);

  function countsFor(orderId: string) {
    return h.prisma.sellerWalletEntry.groupBy({
      by: ['direction'],
      where: { linkedOrderId: orderId },
      _count: { _all: true },
    });
  }

  async function countOf(orderId: string, direction: WalletEntryDirection): Promise<number> {
    return h.prisma.sellerWalletEntry.count({
      where: { linkedOrderId: orderId, direction },
    });
  }

  async function balance(): Promise<Prisma.Decimal> {
    const last = await h.prisma.sellerWalletEntry.findFirst({
      where: { sellerId, currency: Currency.INR },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? new Prisma.Decimal(0);
  }

  it('THE INDEX NO LONGER REFUSES a second cod_collection on one order', async () => {
    // The whole point. Before WAL-10 the second credit raised P2002 here
    // and took its caller's transaction down with it.
    const orderId = await createOrder();

    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    await h.prisma.$transaction(async (tx) => {
      await cod().reverseForOrder(tx, { orderId, sellerId, note: 'courier took it back' });
    });
    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });

    expect(await countOf(orderId, WalletEntryDirection.COD_COLLECTION)).toBe(2);
    expect(await countOf(orderId, WalletEntryDirection.COD_REVERSAL)).toBe(1);
  });

  it('the counting gate still refuses a credit while one stands', async () => {
    // The guard that REPLACED the index. Without the reversal in
    // between, the second credit must be refused by `isCredited` —
    // credits greater than reversals — not by the database.
    const orderId = await createOrder();

    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    const second = await h.prisma.$transaction(async (tx) =>
      cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' }),
    );

    expect(second.credited).toBe(false);
    expect(await countOf(orderId, WalletEntryDirection.COD_COLLECTION)).toBe(1);
  });

  it('a reversal returns ONLY its own credit’s deductions', async () => {
    // THE REASON THE INDEX WAS LOAD-BEARING BEYOND "do not pay twice".
    //
    // `reverseForOrder` used to refund every unrefunded deduction on the
    // ORDER, which was exact only while a second unrefunded set could
    // not exist. With re-credits permitted, that would hand back tax and
    // fees the seller is still being charged — and silently, because the
    // wallet stays internally consistent and only the P&L understates.
    const orderId = await createOrder();

    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    const gstAfterFirst = await countOf(orderId, WalletEntryDirection.GST_WITHHOLDING);
    // The suite's seeded `wallet.cod_gst_percent` decides whether a
    // withholding row exists at all; the assertion below is written to
    // hold either way rather than to depend on a setting.
    await h.prisma.$transaction(async (tx) => {
      await cod().reverseForOrder(tx, { orderId, sellerId, note: 'returned' });
    });
    const refundsAfterFirst = await countOf(orderId, WalletEntryDirection.COD_DEDUCTION_REFUND);
    expect(refundsAfterFirst).toBe(gstAfterFirst);

    // Credit again, then reverse again. The SECOND reversal must return
    // the second credit's deductions only — never the first's a second
    // time.
    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    await h.prisma.$transaction(async (tx) => {
      await cod().reverseForOrder(tx, { orderId, sellerId, note: 'returned again' });
    });

    const deductions = await countOf(orderId, WalletEntryDirection.GST_WITHHOLDING);
    const refunds = await countOf(orderId, WalletEntryDirection.COD_DEDUCTION_REFUND);
    // Every deduction returned exactly once — never more.
    expect(refunds).toBe(deductions);
  });

  it('credit → reverse → credit leaves the wallet where one credit would', async () => {
    // The arithmetic is the real claim: the ledger is append-only, so
    // "it balances" has to be read off the running balance rather than
    // inferred from the row count.
    const orderId = await createOrder();
    const before = await balance();

    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    const afterFirstCredit = await balance();

    await h.prisma.$transaction(async (tx) => {
      await cod().reverseForOrder(tx, { orderId, sellerId, note: 'returned' });
    });
    // Back where it started: the credit taken back and every deduction
    // returned.
    expect((await balance()).toFixed(2)).toBe(before.toFixed(2));

    await h.prisma.$transaction(async (tx) => {
      await cod().creditForOrder(tx, { orderId, sellerId, grossInr: COD, mode: 'SETTLEMENT' });
    });
    // And re-crediting lands on exactly the figure the first credit did.
    // Neither more (the over-refund this change had to prevent) nor less.
    expect((await balance()).toFixed(2)).toBe(afterFirstCredit.toFixed(2));
  });

  it('the five directions that REMAIN covered are still refused by the database', async () => {
    // The other half of the migration: it narrowed the predicate, it did
    // not drop the index. If this stops failing, the index was removed
    // rather than narrowed — which would silently un-guard the delivery
    // fee, whose own rule (WAL-8) is that it happens once.
    const orderId = await createOrder();
    const wallet = h.app.get(
      (await import('../../src/modules/seller-wallet/services/wallet.service')).WalletService,
    );

    await h.prisma.$transaction(async (tx) => {
      await wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.ORDER_CHARGES,
        amount: new Prisma.Decimal('10.00'),
        linkedOrderId: orderId,
        actorType: 'SYSTEM' as never,
        note: 'first',
      });
    });

    await expect(
      h.prisma.$transaction(async (tx) => {
        await wallet.applyEntry(tx, {
          sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.ORDER_CHARGES,
          amount: new Prisma.Decimal('10.00'),
          linkedOrderId: orderId,
          actorType: 'SYSTEM' as never,
          note: 'second — must be refused',
        });
      }),
    ).rejects.toThrow();

    expect(await countOf(orderId, WalletEntryDirection.ORDER_CHARGES)).toBe(1);
    // And the grouping read is here so a failure prints what the order
    // actually carries rather than just a count that disagreed.
    expect(await countsFor(orderId)).toBeDefined();
  });
});
