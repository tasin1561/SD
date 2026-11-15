import request from 'supertest';
import { OrderStatus, TicketStatus } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * "Cancel order" past the packing window raises ONE ticket (2026-11-15).
 * Real database: the exactly-once guard is an advisory lock plus a check
 * inside the transaction, which only Postgres can prove.
 */
describe('Cancel request (e2e)', () => {
  let h: AppHarness;
  let sellerAuth: { Authorization: string };
  let otherAuth: { Authorization: string };
  let variantId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function newSeller(tag: string, staffAuth: { Authorization: string }) {
    const email = `cancelreq-${tag}-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `Cancel ${tag}`,
        contactPersonName: 'Owner',
        phone: tag === 'a' ? '+8801712345601' : '+8801712345602',
        password: 'SellerPass-1234',
      })
      .expect(201);
    return { Authorization: `Bearer ${reg.body.accessToken}` };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    const staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    sellerAuth = await newSeller('a', staffAuth);
    otherAuth = await newSeller('b', staffAuth);

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Widget', externalRef: 'W-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'W-1-STD' })
      .expect(201);
    variantId = variant.body.id as string;
  });

  async function placeOrder(): Promise<string> {
    const res = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Cancel Customer',
        recipientPhoneE164: `+9198765${String(Date.now()).slice(-5)}`,
        recipientAddressLine1: '12 Test Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'New Delhi',
        recipientStateProvince: 'Delhi',
        recipientPostalCode: '110001',
        paymentMode: 'COD',
        codAmountInr: 500,
        items: [{ variantId, quantity: 1 }],
      })
      .expect(201);
    return res.body.id as string;
  }

  async function setStatus(orderId: string, status: OrderStatus): Promise<void> {
    // Test-only direct write: the lifecycle that gets here is covered elsewhere.
    await h.prisma.order.update({ where: { id: orderId }, data: { status } });
  }

  it('offers the request in flight, opens one ticket for concurrent taps, reopens after close', async () => {
    const orderId = await placeOrder();
    await setStatus(orderId, OrderStatus.IN_TRANSIT);

    const detail = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(detail.body.cancelRequest).toEqual({ available: true, openTicket: null });

    const [a, b] = await Promise.all([
      request(h.baseUrl)
        .post(`/seller/orders/${orderId}/cancel-request`)
        .set(sellerAuth)
        .send({ note: 'x' }),
      request(h.baseUrl).post(`/seller/orders/${orderId}/cancel-request`).set(sellerAuth).send({}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.ticket.id).toBe(b.body.ticket.id);
    expect([a.body.created, b.body.created].sort()).toEqual([false, true]);

    const tickets = await h.prisma.ticket.findMany({
      where: { orderId, issueCategoryExternalId: 'cancel' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.description).toContain('Shipment has been returned by merchant');

    const after = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(after.body.cancelRequest.openTicket.id).toBe(tickets[0]?.id);

    await h.prisma.ticket.update({
      where: { id: tickets[0]!.id },
      data: { status: TicketStatus.RESOLVED_RETURNED },
    });
    const reopened = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(reopened.body.cancelRequest).toEqual({ available: true, openTicket: null });
  });

  it('is not on offer before packing or after delivery, and another seller gets a 404', async () => {
    const orderId = await placeOrder();
    await setStatus(orderId, OrderStatus.CONFIRMED);
    const early = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(early.body.cancelRequest.available).toBe(false);
    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel-request`)
      .set(sellerAuth)
      .send({})
      .expect(409);

    await setStatus(orderId, OrderStatus.DELIVERED);
    const late = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(late.body.cancelRequest.available).toBe(false);

    await setStatus(orderId, OrderStatus.IN_TRANSIT);
    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel-request`)
      .set(otherAuth)
      .send({})
      .expect(404);
  });
});
