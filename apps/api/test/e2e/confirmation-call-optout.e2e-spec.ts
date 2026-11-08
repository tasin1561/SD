import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import {
  ActorType,
  CallOutcome,
  CallQueueStatus,
  OrderStatus,
  ProductStatus,
  ReservationStatus,
  SellerStatus,
  StaffRoleKey,
} from '@skydrop/db';
import { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';
import {
  AUTO_CONFIRM_EVENT_TEXT,
  ConfirmationTtlSweeperService,
} from '../../src/modules/call-center/services/confirmation-ttl-sweeper.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Confirmation-call opt-out (ops.call_confirmation_required + the no-call
 * TTL auto-confirm), against a real database.
 *
 * The sweeper is called directly: its BullMQ schedule is not under test,
 * what it DOES to an order is. The race case forces a real interleaving
 * (a human confirm paused between its stock reservation and its status
 * write while the sweeper runs to completion) and then also fires real
 * concurrent human/sweeper pairs.
 */
describe('Confirmation-call opt-out (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let binId: string;

  interface Client {
    id: string;
    auth: { Authorization: string };
    variantId: string;
  }
  let a: Client;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  const OPEN = [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED];

  async function makeClient(label: string, phone: string): Promise<Client> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@optout.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `${label} Brand`,
        contactPersonName: `${label} Owner`,
        phone,
        password: 'SellerPass-1234',
      })
      .expect(201);
    const id = reg.body.seller.id as string;
    await h.prisma.seller.update({ where: { id }, data: { status: SellerStatus.APPROVED } });
    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(auth)
      .send({ name: `${label} Widget`, externalRef: `${label}-W` })
      .expect(201);
    // A resellable variant needs an ACTIVE product (store-order case).
    await h.prisma.product.update({
      where: { id: product.body.id as string },
      data: { status: ProductStatus.ACTIVE },
    });
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(auth)
      .send({ skuCode: `${label}-W-STD` })
      .expect(201);
    return { id, auth, variantId: variant.body.id as string };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    staffId = staff.id;
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken as string}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )!.id;
    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'A', name: 'Zone A' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: zone.body.id, aisle: 'A', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binId = bin.body.id as string;

    a = await makeClient('OptA', '+8801712345611');
  });

  async function receiveStock(c: Client, qty: number): Promise<void> {
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(c.auth)
      .send({ lines: [{ variantId: c.variantId, expectedQty: qty }] })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(staffAuth)
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  async function createSubmitted(c: Client, qty = 1): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(c.auth)
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
        items: [{ variantId: c.variantId, quantity: qty }],
      })
      .expect(201);
    const id = created.body.id as string;
    await request(h.baseUrl).post(`/seller/orders/${id}/submit`).set(c.auth).expect(200);
    return id;
  }

  function setCalls(c: Client, callsRequired: boolean, ttlHours?: number): request.Test {
    return request(h.baseUrl)
      .patch('/seller/order-defaults/confirmation-calls')
      .set(c.auth)
      .send({ callsRequired, ...(ttlHours === undefined ? {} : { ttlHours }) });
  }

  const openEntries = (orderId: string): Promise<number> =>
    h.prisma.callQueueEntry.count({ where: { orderId, status: { in: OPEN } } });

  const order = (id: string) => h.prisma.order.findUniqueOrThrow({ where: { id } });

  /** Make an order's TTL already expired (the sweeper reads the column). */
  async function expire(orderId: string): Promise<void> {
    await h.prisma.order.update({
      where: { id: orderId },
      data: { confirmationDeadlineAt: new Date(Date.now() - 60_000) },
    });
  }

  function expectWindow(deadline: Date | null, ttlHours: number, before: number): void {
    expect(deadline).not.toBeNull();
    const t = deadline!.getTime();
    const ttlMs = ttlHours * 3_600_000;
    expect(t).toBeGreaterThanOrEqual(before + ttlMs - 2_000);
    expect(t).toBeLessThanOrEqual(Date.now() + ttlMs + 2_000);
  }

  const staffConfirm = (orderId: string) =>
    h.app.get(OrderWriteService).transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

  it('1. default is unchanged: calls ON, order is queued, no deadline', async () => {
    const view = await request(h.baseUrl)
      .get('/seller/order-defaults/confirmation-calls')
      .set(a.auth)
      .expect(200);
    expect(view.body.callsRequired).toBe(true);
    expect(view.body.ttlHours).toBe(24);

    const id = await createSubmitted(a);
    expect(await openEntries(id)).toBe(1);
    expect((await order(id)).confirmationDeadlineAt).toBeNull();
  });

  it('2. calls OFF defers: no queue entry, deadline within now + TTL', async () => {
    await setCalls(a, false, 2).expect(200);
    const before = Date.now();
    const id = await createSubmitted(a);
    expect(await openEntries(id)).toBe(0);
    expect(await h.prisma.callQueueEntry.count({ where: { orderId: id } })).toBe(0);
    const row = await order(id);
    expect(row.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expectWindow(row.confirmationDeadlineAt, 2, before);
  });

  it('3. re-entry restarts the clock; leaving PENDING_CONFIRMATION clears it', async () => {
    await setCalls(a, false, 2).expect(200);
    const id = await createSubmitted(a);
    const first = (await order(id)).confirmationDeadlineAt!;
    expect(first).not.toBeNull();

    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId: id,
      to: OrderStatus.CALL_NO_RESPONSE,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect((await order(id)).confirmationDeadlineAt).toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    const before = Date.now();
    await ow.transitionStatus({
      orderId: id,
      to: OrderStatus.PENDING_CONFIRMATION,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const again = await order(id);
    expect(again.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(again.confirmationDeadlineAt!.getTime()).toBeGreaterThan(first.getTime());
    expectWindow(again.confirmationDeadlineAt, 2, before);
    expect(await openEntries(id)).toBe(0);

    // A cancel is also an exit.
    await ow.transitionStatus({
      orderId: id,
      to: OrderStatus.CANCELLED_BY_ADMIN,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect((await order(id)).confirmationDeadlineAt).toBeNull();
  });

  it('4. the list shows the deferred order to admin and seller, and not another client’s', async () => {
    const b = await makeClient('OptB', '+8801712345622');
    await setCalls(a, false, 2).expect(200);
    await setCalls(b, false, 2).expect(200);
    const idA = await createSubmitted(a);
    const idB = await createSubmitted(b);

    const sellerList = await request(h.baseUrl)
      .get('/seller/orders/awaiting-confirmation')
      .set(a.auth)
      .expect(200);
    const sellerIds = (sellerList.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(sellerIds).toContain(idA);
    expect(sellerIds).not.toContain(idB);
    const row = (
      sellerList.body.items as Array<{ id: string; callsRequired: boolean; clientId: string }>
    ).find((i) => i.id === idA)!;
    expect(row.callsRequired).toBe(false);
    expect(row.clientId).toBe(a.id);

    const adminAll = await request(h.baseUrl)
      .get('/admin/orders/awaiting-confirmation')
      .set(staffAuth)
      .expect(200);
    const allIds = (adminAll.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(allIds).toEqual(expect.arrayContaining([idA, idB]));

    const adminB = await request(h.baseUrl)
      .get(`/admin/orders/awaiting-confirmation?sellerId=${b.id}`)
      .set(staffAuth)
      .expect(200);
    const bIds = (adminB.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(bIds).toEqual([idB]);
  });

  it('5. send to agents queues + clears the deadline, is idempotent, and is client-scoped', async () => {
    const b = await makeClient('OptB', '+8801712345622');
    await setCalls(a, false, 2).expect(200);
    await setCalls(b, false, 2).expect(200);
    const idA = await createSubmitted(a);
    const idB = await createSubmitted(b);

    const first = await request(h.baseUrl)
      .post('/seller/orders/confirmation-calls')
      .set(a.auth)
      .send({ orderIds: [idA] })
      .expect(200);
    expect(first.body.results).toEqual([{ orderId: idA, outcome: 'QUEUED' }]);
    expect(await openEntries(idA)).toBe(1);
    expect((await order(idA)).confirmationDeadlineAt).toBeNull();

    const second = await request(h.baseUrl)
      .post('/seller/orders/confirmation-calls')
      .set(a.auth)
      .send({ orderIds: [idA] })
      .expect(200);
    expect(second.body.results[0].outcome).toBe('ALREADY_QUEUED');
    expect(await h.prisma.callQueueEntry.count({ where: { orderId: idA } })).toBe(1);

    // Another client's order id: indistinguishable from "does not exist".
    const foreign = await request(h.baseUrl)
      .post('/seller/orders/confirmation-calls')
      .set(a.auth)
      .send({ orderIds: [idB] })
      .expect(200);
    expect(foreign.body.results).toEqual([{ orderId: idB, outcome: 'NOT_FOUND' }]);
    expect(await h.prisma.callQueueEntry.count({ where: { orderId: idB } })).toBe(0);
    expect((await order(idB)).confirmationDeadlineAt).not.toBeNull();

    // Admin route: queues B's order.
    const adm = await request(h.baseUrl)
      .post('/admin/orders/confirmation-calls')
      .set(staffAuth)
      .send({ orderIds: [idB] })
      .expect(200);
    expect(adm.body.results[0].outcome).toBe('QUEUED');
    expect(await openEntries(idB)).toBe(1);
    expect((await order(idB)).confirmationDeadlineAt).toBeNull();
  });

  it('6. the sweeper confirms an expired order with no call, and leaves the others alone', async () => {
    await receiveStock(a, 10);
    await setCalls(a, false, 2).expect(200);
    const due = await createSubmitted(a);
    const notDue = await createSubmitted(a);
    const queued = await createSubmitted(a);
    await request(h.baseUrl)
      .post('/seller/orders/confirmation-calls')
      .set(a.auth)
      .send({ orderIds: [queued] })
      .expect(200);
    await expire(due);

    const mapped = h.app.get(CallOutcomeMappingService).resolve(CallOutcome.CONFIRMED, {
      priorAttemptCount: 0,
      maxAttempts: 1,
      atCapPolicy: 'REJECT',
    }).targetStatus;
    expect(mapped).toBe(OrderStatus.CONFIRMED);

    const res = await h.app.get(ConfirmationTtlSweeperService).sweep();
    expect(res.confirmed).toBe(1);

    const dueRow = await order(due);
    expect(dueRow.status).toBe(mapped);
    expect(dueRow.confirmationDeadlineAt).toBeNull();
    expect(dueRow.confirmedAt).not.toBeNull();
    const events = await h.prisma.orderEvent.findMany({
      where: { orderId: due, toStatus: OrderStatus.CONFIRMED },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.description).toBe(AUTO_CONFIRM_EVENT_TEXT);
    expect(events[0]!.description).toMatch(/NO confirmation call was made/);
    expect(
      await h.prisma.stockReservation.count({
        where: { orderId: due, status: ReservationStatus.ACTIVE },
      }),
    ).toBe(1);

    // Not due: untouched. Already queued: untouched, still queued.
    const notDueRow = await order(notDue);
    expect(notDueRow.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(notDueRow.confirmationDeadlineAt).not.toBeNull();
    const queuedRow = await order(queued);
    expect(queuedRow.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(await openEntries(queued)).toBe(1);

    // A second sweep is a no-op.
    const again = await h.app.get(ConfirmationTtlSweeperService).sweep();
    expect(again).toEqual({ confirmed: 0, queued: 0, skipped: 0 });
  });

  it('7. calls switched back ON while an order waits: the sweeper queues it, does not confirm', async () => {
    await receiveStock(a, 10);
    await setCalls(a, false, 2).expect(200);
    const id = await createSubmitted(a);
    await expire(id);
    await setCalls(a, true).expect(200);

    const res = await h.app.get(ConfirmationTtlSweeperService).sweep();
    expect(res).toEqual({ confirmed: 0, queued: 1, skipped: 0 });
    const row = await order(id);
    expect(row.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(row.confirmationDeadlineAt).toBeNull();
    expect(await openEntries(id)).toBe(1);
  });

  it('8. a member-store order follows the CLIENT’s setting (orders.seller_id), not the store', async () => {
    const email = `store-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(a.auth)
      .send({
        name: `shop ${Math.random().toString(36).slice(2, 8)}`,
        displayName: 'shop Display',
        contactEmail: email,
        contactPhone: '+919800000004',
        invite: { email, fullName: 'Shop Owner', roleKeys: ['owner'] },
      })
      .expect(201);
    const storeId = created.body.id as string;
    const invitation = await h.prisma.storeUserInvitation.findFirstOrThrow({
      where: { storeId, usedAt: null, deletedAt: null },
      select: { id: true },
    });
    const plaintext = `e2e-invite-${randomBytes(24).toString('hex')}`;
    await h.prisma.storeUserInvitation.update({
      where: { id: invitation.id },
      data: { token: createHash('sha256').update(plaintext, 'utf8').digest('hex') },
    });
    const accepted = await request(h.baseUrl)
      .post('/auth/store/invitations/accept')
      .send({ token: plaintext, password: 'StorePass-1234', fullName: 'Shop Owner' })
      .expect(201);
    const storeAuth = { Authorization: `Bearer ${accepted.body.accessToken as string}` };
    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeId}/terms`)
      .set(a.auth)
      .send({
        deliveryFeeStorePercent: '80',
        returnFeeStorePercent: '100',
        customerReturnFeeStorePercent: '100',
        codFeeStorePercent: '0',
        codTaxStorePercent: '100',
        instantPayFeeStorePercent: '100',
        storeCreditTrigger: 'ON_PAYOUT',
        storeCreditDays: 0,
        sellerCreditTrigger: 'ON_PAYOUT',
        sellerCreditDays: 0,
        basedOnVersion: 0,
      })
      .expect(201);
    await request(h.baseUrl)
      .post(`/store/terms/${published.body.current.id as string}/accept`)
      .set(storeAuth)
      .send({})
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${a.variantId}`)
      .set(a.auth)
      .send({
        transferPriceInr: '300.00',
        minRetailInr: '400.00',
        maxRetailInr: '600.00',
        suggestedRetailInr: '499.00',
      })
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${a.variantId}`)
      .set(a.auth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
      .expect(200);
    await request(h.baseUrl)
      .patch(`/admin/sellers/${a.id}/settings/reseller.orders_enabled`)
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: true, note: 'optout e2e' })
      .expect(200);
    await receiveStock(a, 10);

    const placeStoreOrder = async (): Promise<string> => {
      const placed = await request(h.baseUrl)
        .post('/store/orders')
        .set(storeAuth)
        .send({
          recipientName: 'Asha Verma',
          recipientPhoneE164: '+919876500001',
          recipientEmail: 'asha@example.com',
          recipientAddressLine1: '12 MG Road',
          recipientAddressLine2: 'Near City Hospital',
          recipientPostalCode: '560001',
          paymentMode: 'COD',
          acknowledgeDuplicate: true,
          items: [{ variantId: a.variantId, quantity: 1, retailUnitPriceInr: 499 }],
        })
        .expect(201);
      return placed.body.id as string;
    };

    // Client ON (default): the store's order is queued.
    const onId = await placeStoreOrder();
    const onRow = await order(onId);
    expect(onRow.storeKind).toBe('RESELLER');
    expect(onRow.sellerId).toBe(a.id);
    expect(await openEntries(onId)).toBe(1);
    expect(onRow.confirmationDeadlineAt).toBeNull();

    // Client OFF: the SAME store's next order is deferred. The store has no
    // setting of its own to disagree with the client's.
    await setCalls(a, false, 3).expect(200);
    const before = Date.now();
    const offId = await placeStoreOrder();
    const offRow = await order(offId);
    expect(offRow.storeId).toBe(storeId);
    expect(await openEntries(offId)).toBe(0);
    expectWindow(offRow.confirmationDeadlineAt, 3, before);

    // And it shows in the client's awaiting list.
    const list = await request(h.baseUrl)
      .get('/seller/orders/awaiting-confirmation')
      .set(a.auth)
      .expect(200);
    expect((list.body.items as Array<{ id: string }>).map((i) => i.id)).toContain(offId);
  });

  it('9. the TTL clamp holds (1..168), at the seller route and the admin route', async () => {
    await setCalls(a, false, 0).expect(400);
    await setCalls(a, false, 200).expect(400);
    await setCalls(a, false, 1).expect(200);
    const low = await request(h.baseUrl)
      .get('/seller/order-defaults/confirmation-calls')
      .set(a.auth)
      .expect(200);
    expect(low.body.ttlHours).toBe(1);
    await setCalls(a, false, 168).expect(200);
    const high = await request(h.baseUrl)
      .get('/seller/order-defaults/confirmation-calls')
      .set(a.auth)
      .expect(200);
    expect(high.body.ttlHours).toBe(168);

    // Past the DTO: the resolver clamps at write time for the admin route.
    for (const bad of [0, 200]) {
      const r = await request(h.baseUrl)
        .patch(`/admin/sellers/${a.id}/settings/ops.call_auto_confirm_ttl_hours`)
        .set(staffAuth)
        .send({ valueType: 'INT', value: bad, note: 'clamp e2e' });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    const still = await request(h.baseUrl)
      .get('/seller/order-defaults/confirmation-calls')
      .set(a.auth)
      .expect(200);
    expect(still.body.ttlHours).toBe(168);
  });

  describe('10. a human confirm racing the sweeper', () => {
    async function counts(id: string): Promise<{ events: number; active: number }> {
      return {
        events: await h.prisma.orderEvent.count({
          where: {
            orderId: id,
            fromStatus: OrderStatus.PENDING_CONFIRMATION,
            toStatus: OrderStatus.CONFIRMED,
          },
        }),
        active: await h.prisma.stockReservation.count({
          where: { orderId: id, status: ReservationStatus.ACTIVE },
        }),
      };
    }

    it('forced interleaving: sweeper wins while the human is paused between reserve and write', async () => {
      await receiveStock(a, 10);
      await setCalls(a, false, 2).expect(200);
      const id = await createSubmitted(a);
      await expire(id);

      const ow = h.app.get(OrderWriteService) as unknown as {
        writeStatusTx: (...args: unknown[]) => Promise<unknown>;
      };
      const original = ow.writeStatusTx.bind(ow);
      let reachedWrite!: () => void;
      const reached = new Promise<void>((r) => {
        reachedWrite = r;
      });
      let open!: () => void;
      const gate = new Promise<void>((r) => {
        open = r;
      });
      // Only the FIRST write (the human's) is held; the sweeper's runs live.
      const spy = jest
        .spyOn(ow, 'writeStatusTx')
        .mockImplementationOnce(async (...args: unknown[]) => {
          reachedWrite();
          await gate;
          return original(...args);
        });
      try {
        const human = staffConfirm(id).then(
          (r) => ({ ok: true as const, r }),
          (e: unknown) => ({ ok: false as const, e }),
        );
        await reached; // the human has reserved stock and is about to write
        const swept = await h.app.get(ConfirmationTtlSweeperService).sweep();
        expect(swept.confirmed).toBe(1);
        open();
        const humanRes = await human;

        expect(humanRes.ok).toBe(false);
        expect(await counts(id)).toEqual({ events: 1, active: 1 });
        expect((await order(id)).status).toBe(OrderStatus.CONFIRMED);
      } finally {
        open();
        spy.mockRestore();
      }
    });

    it('forced interleaving: a sweep landing while send-to-agents is paused mid-enqueue cannot confirm the order', async () => {
      await receiveStock(a, 10);
      await setCalls(a, false, 2).expect(200);
      const id = await createSubmitted(a);
      await expire(id); // due: the sweeper WOULD claim it if the deadline were still set

      const cq = h.app.get(CallQueueService) as unknown as {
        enqueueOrder: (...args: unknown[]) => Promise<unknown>;
      };
      const original = cq.enqueueOrder.bind(cq);
      let reachedEnqueue!: () => void;
      const reached = new Promise<void>((r) => {
        reachedEnqueue = r;
      });
      let open!: () => void;
      const gate = new Promise<void>((r) => {
        open = r;
      });
      // Hold the human's enqueue; everything else runs live.
      const spy = jest
        .spyOn(cq, 'enqueueOrder')
        .mockImplementationOnce(async (...args: unknown[]) => {
          reachedEnqueue();
          await gate;
          return original(...args);
        });
      try {
        const send = request(h.baseUrl)
          .post('/seller/orders/confirmation-calls')
          .set(a.auth)
          .send({ orderIds: [id] })
          .then((r) => r);
        await reached; // the deadline clear has been written; the entry has not
        const swept = await h.app.get(ConfirmationTtlSweeperService).sweep();
        expect(swept.confirmed).toBe(0);
        expect((await order(id)).status).toBe(OrderStatus.PENDING_CONFIRMATION);
        open();
        const res = await send;
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([{ orderId: id, outcome: 'QUEUED' }]);

        const row = await order(id);
        expect(row.status).toBe(OrderStatus.PENDING_CONFIRMATION);
        expect(row.confirmationDeadlineAt).toBeNull();
        expect(await openEntries(id)).toBe(1);
        expect(
          await h.prisma.orderEvent.count({
            where: { orderId: id, toStatus: OrderStatus.CONFIRMED },
          }),
        ).toBe(0);
      } finally {
        open();
        spy.mockRestore();
      }
    });

    it('real concurrency: human and sweeper fired together, three times, one transition each', async () => {
      await receiveStock(a, 10);
      await setCalls(a, false, 2).expect(200);
      for (let i = 0; i < 3; i += 1) {
        const id = await createSubmitted(a);
        await expire(id);
        const [human] = await Promise.allSettled([
          staffConfirm(id),
          h.app.get(ConfirmationTtlSweeperService).sweep(),
        ]);
        // Either side may win; exactly one may.
        void human;
        expect(await counts(id)).toEqual({ events: 1, active: 1 });
        const row = await order(id);
        expect(row.status).toBe(OrderStatus.CONFIRMED);
        expect(row.confirmationDeadlineAt).toBeNull();
      }
    });
  });
});
