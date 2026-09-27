import request from 'supertest';
import {
  ActorType,
  ChargeType,
  Currency,
  OrderChargeStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import {
  bootTestApp,
  createTestStaff,
  drainSystemIssueNotifier,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The delivery fee a "lost then found" order owes, against a REAL database.
 *
 * Two rules in this codebase contradicted each other, and only Postgres
 * could say which one wins.
 *
 *   - `OrderChargesAccrualService.debitIfNeeded` gates on `charged >
 *     refunded` on purpose (WAL-8): an order billed, refunded because the
 *     parcel was lost, and then delivered after all owes the fee AGAIN,
 *     and a plain "a charge exists" gate left it refunded and unbilled.
 *   - `seller_wallet_entries_once_per_order_uq` covers `(linked_order_id,
 *     direction)` for nine directions INCLUDING `order_charges`. So the
 *     second charge is not merely discouraged — it cannot exist.
 *
 * With one charge and one refund the gate therefore said "bill it" and
 * `applyEntry`'s bare create raised P2002. Nothing caught it, and the
 * blast radius was the whole delivered-money transaction: the Instant Pay
 * COD front and credit and the inbound-freight share roll back with it,
 * WAL-8 raises `delivered-accrual-failed:<orderId>` whose stated remedy is
 * "re-run `handle`", and every re-run hits the identical violation — an
 * issue that could never clear.
 *
 * The index WINS (CLAUDE.md forbids weakening it: it is the guard against
 * paying an order twice). A P2002 aborts the whole transaction, so the
 * conflict cannot be caught and carried on from either — the check must
 * come FIRST. This file proves both halves: the database really does
 * refuse the second entry, and the service now skips and raises rather
 * than throwing.
 *
 * The unit suite cannot see any of it. A mocked Prisma has no index to
 * violate (the `pack_boxes` / `courier_pickup_requests` lesson), so a
 * mocked test of the OLD gate passed while the database was refusing what
 * it asserted.
 */
describe('Order charges — a refunded fee cannot be re-billed (e2e)', () => {
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
      .send({ email: `rebill-${Date.now()}@brand.com` })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Rebill Brand',
        contactPersonName: 'Rebill Owner',
        phone: '+8801712345688',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Rebill Widget', externalRef: 'RB-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'RB-1-STD' })
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
        codAmountInr: 999,
        items: [{ variantId, quantity: 1 }],
      })
      .expect(201);
    return created.body.id as string;
  }

  /** One wallet entry through the sanctioned writer, in its own transaction. */
  function entry(
    orderId: string,
    direction: WalletEntryDirection,
    amount: string,
  ): Promise<unknown> {
    const wallet = h.app.get(WalletService);
    return h.prisma.$transaction((tx) =>
      wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction,
        amount: new Prisma.Decimal(amount),
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
      }),
    );
  }

  /** A billable line, so the skip below is a real refusal rather than "nothing to bill". */
  async function addCharge(orderId: string): Promise<void> {
    await h.prisma.orderCharge.create({
      data: {
        orderId,
        type: ChargeType.BASE_SHIPPING,
        amountInr: new Prisma.Decimal('200.00'),
        totalAmountInr: new Prisma.Decimal('200.00'),
        status: OrderChargeStatus.ESTIMATED,
      },
    });
  }

  it('the database itself refuses a SECOND order_charges entry on one order', async () => {
    const orderId = await createOrder();
    await entry(orderId, WalletEntryDirection.ORDER_CHARGES, '200.00');

    // The whole reason the gate cannot simply be "bill it again".
    await expect(
      entry(orderId, WalletEntryDirection.ORDER_CHARGES, '200.00'),
    ).rejects.toMatchObject({ code: 'P2002' });

    const charges = await h.prisma.sellerWalletEntry.count({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
    });
    expect(charges).toBe(1);
  });

  it('a refunded order delivered again is SKIPPED and raises a HIGH money issue', async () => {
    const orderId = await createOrder();
    await addCharge(orderId);
    await entry(orderId, WalletEntryDirection.ORDER_CHARGES, '200.00');
    await entry(orderId, WalletEntryDirection.ORDER_CHARGES_REFUND, '200.00');

    const accrual = h.app.get(OrderChargesAccrualService);

    // The caller's own transaction, exactly as AccrualExecutionService
    // opens it. The OLD code threw P2002 here and took the whole
    // delivered-money transaction with it.
    const billed = await h.prisma.$transaction((tx) =>
      accrual.debitIfNeeded(tx, orderId, sellerId),
    );
    expect(billed).toBe(false);

    // Still exactly one charge and one refund — nothing was written.
    const [charged, refunded] = await Promise.all([
      h.prisma.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
      }),
      h.prisma.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES_REFUND },
      }),
    ]);
    expect(charged).toBe(1);
    expect(refunded).toBe(1);

    await drainSystemIssueNotifier(h.app);
    const issue = await h.prisma.systemIssue.findFirst({
      where: { dedupeKey: `order-charges-not-rebillable:${orderId}`, resolvedAt: null },
    });
    expect(issue).not.toBeNull();
    expect(issue?.severity).toBe('HIGH');
    expect(issue?.kind).toBe('MONEY');
    // Named the order, so whoever works /wallet-transfers knows which one.
    expect(JSON.stringify(issue?.metadata)).toContain(orderId);
  });

  it('is idempotent — a second attempt bumps the issue rather than raising a new one', async () => {
    const orderId = await createOrder();
    await addCharge(orderId);
    await entry(orderId, WalletEntryDirection.ORDER_CHARGES, '200.00');
    await entry(orderId, WalletEntryDirection.ORDER_CHARGES_REFUND, '200.00');

    const accrual = h.app.get(OrderChargesAccrualService);
    for (let i = 0; i < 2; i += 1) {
      await expect(
        h.prisma.$transaction((tx) => accrual.debitIfNeeded(tx, orderId, sellerId)),
      ).resolves.toBe(false);
    }

    await drainSystemIssueNotifier(h.app);
    const issues = await h.prisma.systemIssue.findMany({
      where: { dedupeKey: `order-charges-not-rebillable:${orderId}` },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.occurrenceCount).toBe(2);
  });
});
