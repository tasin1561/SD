import { createHash, randomBytes } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { ProductStatus, SellerStatus, StaffRoleKey } from '@skydrop/db';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
import { IMPERSONATION_COOKIE } from '../../src/common/impersonation/impersonation-cookie';
import { EmailQueue } from '../../src/modules/email/queue/email.queue';
import { FakeGateway, message } from '../helpers/assistant-fixtures';
import {
  bootTestApp,
  createTestStaff,
  defaultStoreFor,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * ASSISTANT PRIVACY, against Postgres.
 *
 * ── WHY THIS IS AN E2E ───────────────────────────────────────────────
 * The unit specs hand a mocked Prisma the `where` clause and read it
 * back. A mock has no WHERE engine: a predicate that names the wrong
 * column, or one Prisma silently ignores, passes there and leaks here.
 * Every denial below is asserted against rows that REALLY exist and
 * belong to somebody else, next to a control that proves the same call
 * works for the owner — otherwise a 404 for the wrong reason would pass.
 *
 * The model is never called: the gateway the app booted with is
 * replaced, per test, by the scripted `FakeGateway` the unit specs use.
 * What the "model" asks for is therefore under this file's control, and
 * so is what comes back — which is the point, because a tool call is the
 * model asking, and the question is whether the server answers for the
 * CALLER or for whoever the model named.
 */
type Auth = { Authorization: string };

describe('assistant privacy (e2e)', () => {
  let h: AppHarness;
  let fake: FakeGateway;
  let enqueueSpy: jest.SpyInstance;
  const customRoleIds: string[] = [];

  let staffAuth: Auth;
  let staffId: string;
  let A: { auth: Auth; sellerId: string; orderNumber: string };
  let B: { auth: Auth; sellerId: string; orderNumber: string };

  const B_CUSTOMER = 'Bravo Secretcustomer';
  const A_CUSTOMER = 'Alpha Customer';
  const UNKNOWN_ID = '0191a000-0000-7000-8000-000000000999';

  beforeAll(async () => {
    h = await bootTestApp();
    // Recorded, not replaced: impersonation's OTP mail is read back from it.
    enqueueSpy = jest.spyOn(h.app.get(EmailQueue, { strict: false }), 'enqueue');
    const gateway = h.app.get(AssistantModelGateway, { strict: false });
    jest.spyOn(gateway, 'isConfigured').mockReturnValue(true);
    jest
      .spyOn(gateway, 'complete')
      .mockImplementation((req: AssistantModelRequest, onText: (d: string) => void) =>
        fake.complete(req, onText),
      );
  });

  afterAll(async () => {
    enqueueSpy.mockRestore();
    await h.prisma.staffUserRoleAssignment.deleteMany({ where: { roleId: { in: customRoleIds } } });
    await h.prisma.staffRoleDefinition.deleteMany({ where: { id: { in: customRoleIds } } });
    await h.close();
  });

  // ── fixtures ────────────────────────────────────────────────────────

  async function makeSeller(label: string, phoneTail: string): Promise<{ auth: Auth; id: string }> {
    const email = `iso-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `Iso ${label} ${Math.random().toString(36).slice(2, 6)}`,
        contactPersonName: `Owner ${label}`,
        phone: `+88017123456${phoneTail}`,
        password: 'SellerPass-1234',
      })
      .expect(201);
    const id = reg.body.seller.id as string;
    await h.prisma.seller.update({ where: { id }, data: { status: SellerStatus.APPROVED } });
    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    return { auth: { Authorization: `Bearer ${login.body.accessToken}` }, id };
  }

  /** A seller order seeded directly: the READ is under test, not order creation. */
  async function seedOrder(sellerId: string, customer: string, city: string): Promise<string> {
    const store = await defaultStoreFor(h.prisma, sellerId);
    const orderNumber = `SD-2026-91-${Math.floor(Math.random() * 900000 + 100000)}`;
    await h.prisma.order.create({
      data: {
        sellerId,
        storeId: store.id,
        storeNameSnapshot: store.name,
        orderNumber,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'COD',
        codAmountInr: '777.00',
        recipientName: customer,
        recipientPhoneE164: '+919812345678',
        recipientAddressLine1: '1 Private Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: city,
        recipientStateProvince: 'Rajasthan',
        recipientPostalCode: '302001',
        recipientCountryCode: 'IN',
        declaredValueInr: '777.00',
      },
      select: { id: true },
    });
    return orderNumber;
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    enqueueSpy.mockClear();
    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    staffId = staff.id;

    const a = await makeSeller('A', '20');
    const b = await makeSeller('B', '21');
    A = { ...a, sellerId: a.id, orderNumber: await seedOrder(a.id, A_CUSTOMER, 'Pune') };
    B = { ...b, sellerId: b.id, orderNumber: await seedOrder(b.id, B_CUSTOMER, 'Jaipur') };
    fake = new FakeGateway([]);
  });

  // ── helpers ─────────────────────────────────────────────────────────

  async function conversation(auth: Auth, prefix: string): Promise<string> {
    const res = await request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations`)
      .set(auth)
      .send({})
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function toolUse(name: string, input: Record<string, unknown>, id = 'tu_1'): Anthropic.Message {
    return message({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name, input } as unknown as Anthropic.ContentBlock],
    });
  }
  const says = (text: string): Anthropic.Message =>
    message({ content: [{ type: 'text', text, citations: null } as Anthropic.ContentBlock] });

  /** Ask a question with a scripted model; returns the HTTP response and what the "model" was sent. */
  async function ask(
    auth: Auth,
    prefix: string,
    conversationId: string,
    text: string,
    script: Anthropic.Message[],
    cookie?: string,
  ): Promise<{ res: request.Response; requests: AssistantModelRequest[] }> {
    fake = new FakeGateway(script);
    const req = request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations/${conversationId}/messages`)
      .send({ text });
    const res = await (cookie === undefined ? req.set(auth) : req.set('Cookie', cookie));
    return { res, requests: fake.requests };
  }

  /** The tool_result string the "model" was handed back for the one call it made. */
  function toolResultOf(requests: AssistantModelRequest[]): { content: string; isError: boolean } {
    const last = requests[1]?.messages.at(-1);
    expect(last?.role).toBe('user');
    const block = (last?.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block.type).toBe('tool_result');
    return { content: String(block.content), isError: block.is_error === true };
  }

  const toolNames = (r: AssistantModelRequest): string[] =>
    (r.tools ?? []).map((t) => (t as { name: string }).name);

  function keysDeep(v: unknown, out: string[] = []): string[] {
    if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        out.push(k);
        keysDeep(x, out);
      }
    }
    return out;
  }

  async function everythingStoredFor(conversationId: string): Promise<string> {
    const [msgs, calls] = await Promise.all([
      h.prisma.assistantMessage.findMany({ where: { conversationId } }),
      h.prisma.assistantToolCall.findMany({ where: { conversationId } }),
    ]);
    return JSON.stringify({ msgs, calls });
  }

  // ── 1. conversations are private ────────────────────────────────────

  describe('seller A and seller B', () => {
    it('B can neither list, read nor post to A’s conversation — a 404, never a 403', async () => {
      const convA = await conversation(A.auth, 'seller');
      const convB = await conversation(B.auth, 'seller');
      const asked = await ask(A.auth, 'seller', convA, 'where is my parcel A-ONLY-WORDS?', [
        says('It is on its way.'),
      ]);
      expect(asked.res.status).toBe(200);

      // Controls: the owner reads and lists their own.
      const mine = await request(h.baseUrl)
        .get(`/seller/assistant/conversations/${convA}`)
        .set(A.auth)
        .expect(200);
      expect(JSON.stringify(mine.body)).toContain('A-ONLY-WORDS');
      const aList = await request(h.baseUrl)
        .get('/seller/assistant/conversations')
        .set(A.auth)
        .expect(200);
      expect((aList.body as Array<{ id: string }>).map((c) => c.id)).toEqual([convA]);

      // B reading A's: 404, and the body is the SAME one an id that never existed gets.
      const read = await request(h.baseUrl)
        .get(`/seller/assistant/conversations/${convA}`)
        .set(B.auth);
      const nothing = await request(h.baseUrl)
        .get(`/seller/assistant/conversations/${UNKNOWN_ID}`)
        .set(B.auth);
      expect(read.status).toBe(404);
      expect(nothing.status).toBe(404);
      // Same body but for the per-request correlation id.
      const bare = (b: Record<string, unknown>) => ({ code: b['code'], message: b['message'] });
      expect(bare(read.body)).toEqual(bare(nothing.body));
      expect(JSON.stringify(read.body)).not.toContain('A-ONLY-WORDS');

      // B posting into A's: 404 BEFORE any stream, the model is never reached,
      // and nothing is written into A's conversation.
      const before = await h.prisma.assistantMessage.count({ where: { conversationId: convA } });
      const post = await ask(B.auth, 'seller', convA, 'I am B', [says('should never run')]);
      expect(post.res.status).toBe(404);
      expect(post.requests).toHaveLength(0);
      expect(await h.prisma.assistantMessage.count({ where: { conversationId: convA } })).toBe(
        before,
      );

      // B's list holds only B's.
      const bList = await request(h.baseUrl)
        .get('/seller/assistant/conversations')
        .set(B.auth)
        .expect(200);
      expect((bList.body as Array<{ id: string }>).map((c) => c.id)).toEqual([convB]);
    });

    it('a conversation is not reachable through another console either', async () => {
      const convA = await conversation(A.auth, 'seller');
      // Staff and a seller token are different audiences: the same id on /admin is nobody's.
      await request(h.baseUrl)
        .get(`/admin/assistant/conversations/${convA}`)
        .set(staffAuth)
        .expect(404);
      await request(h.baseUrl)
        .get(`/store/assistant/conversations/${convA}`)
        .set(A.auth)
        .expect((r) => expect([401, 403]).toContain(r.status));
    });
  });

  // ── 2. tools run as the caller ──────────────────────────────────────

  describe('tools answer for the caller, not for whoever the model names', () => {
    it('A asking for B’s order number gets NOT_FOUND and none of B’s data', async () => {
      const convA = await conversation(A.auth, 'seller');
      const { res, requests } = await ask(
        A.auth,
        'seller',
        convA,
        'status of the other seller’s order',
        [toolUse('get_my_order', { identifier: B.orderNumber }), says('I could not find it.')],
      );
      expect(res.status).toBe(200);

      const result = toolResultOf(requests);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content)).toEqual({
        error: 'No order of yours matches that number.',
      });
      for (const leak of [B_CUSTOMER, 'Jaipur', '302001', 'Rajasthan', '777']) {
        expect(result.content).not.toContain(leak);
      }

      // The audit row says what happened, and holds no result.
      const calls = await h.prisma.assistantToolCall.findMany({ where: { conversationId: convA } });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        toolName: 'get_my_order',
        ok: false,
        errorCode: 'NOT_FOUND',
        sellerId: A.sellerId,
      });
      // Nothing of B's reached anything A's conversation stored.
      const stored = await everythingStoredFor(convA);
      for (const leak of [B_CUSTOMER, 'Jaipur', '302001']) expect(stored).not.toContain(leak);
    });

    it('control: the same tool finds A’s own order, and B’s finds B’s', async () => {
      const convA = await conversation(A.auth, 'seller');
      const own = await ask(A.auth, 'seller', convA, 'my order?', [
        toolUse('get_my_order', { identifier: A.orderNumber }),
        says('ok'),
      ]);
      const ownResult = toolResultOf(own.requests);
      expect(ownResult.isError).toBe(false);
      expect(ownResult.content).toContain(A_CUSTOMER);
      expect(ownResult.content).not.toContain(B_CUSTOMER);

      const convB = await conversation(B.auth, 'seller');
      const theirs = await ask(B.auth, 'seller', convB, 'my order?', [
        toolUse('get_my_order', { identifier: B.orderNumber }),
        says('ok'),
      ]);
      expect(toolResultOf(theirs.requests).content).toContain(B_CUSTOMER);
    });

    it('a list never contains another seller’s orders', async () => {
      const convA = await conversation(A.auth, 'seller');
      const { requests } = await ask(A.auth, 'seller', convA, 'my recent orders', [
        toolUse('list_my_recent_orders', { limit: 10 }),
        says('ok'),
      ]);
      const text = toolResultOf(requests).content;
      expect(text).toContain(A.orderNumber);
      expect(text).not.toContain(B.orderNumber);
      expect(text).not.toContain(B_CUSTOMER);
    });
  });

  // ── 3. a store owner and its associate ──────────────────────────────

  describe('a store user and its associate (orderScope OWN)', () => {
    let storeId: string;
    let variantId: string;
    let binId: string;
    let ownerAuth: Auth;
    let assocAuth: Auth;
    let ownerOrderNumber: string;
    let assocOrderNumber: string;

    async function acceptInvite(label: string): Promise<Auth> {
      const invitation = await h.prisma.storeUserInvitation.findFirstOrThrow({
        where: { storeId, usedAt: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const plaintext = `e2e-invite-${randomBytes(24).toString('hex')}`;
      await h.prisma.storeUserInvitation.update({
        where: { id: invitation.id },
        data: { token: createHash('sha256').update(plaintext, 'utf8').digest('hex') },
      });
      const accepted = await request(h.baseUrl)
        .post('/auth/store/invitations/accept')
        .send({ token: plaintext, password: 'StorePass-1234', fullName: label })
        .expect(201);
      return { Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}` };
    }

    async function placeAs(auth: Auth, phone: string): Promise<string> {
      const created = await request(h.baseUrl)
        .post('/store/orders')
        .set(auth)
        .send({
          recipientName: 'Asha Verma',
          recipientPhoneE164: phone,
          recipientAddressLine1: '12 MG Road',
          recipientAddressLine2: 'Near City Hospital',
          recipientPostalCode: '560001',
          paymentMode: 'COD',
          acknowledgeDuplicate: true,
          items: [{ variantId, quantity: 1 }],
        })
        .expect(201);
      const detail = await request(h.baseUrl)
        .get(`/store/orders/${(created.body as { id: string }).id}`)
        .set(auth)
        .expect(200);
      return (detail.body as { orderNumber: string }).orderNumber;
    }

    // The same store set-up associate-scope.e2e-spec.ts drives: seller A owns the store.
    beforeEach(async () => {
      const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
      const warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
        (w) => w.code === 'CCU-01',
      )?.id;
      expect(warehouseId).toBeDefined();
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

      const product = await request(h.baseUrl)
        .post('/seller/products')
        .set(A.auth)
        .send({ name: 'Kurta', externalRef: 'K-1' })
        .expect(201);
      await h.prisma.product.update({
        where: { id: product.body.id as string },
        data: { status: ProductStatus.ACTIVE },
      });
      const variant = await request(h.baseUrl)
        .post(`/seller/products/${product.body.id}/variants`)
        .set(A.auth)
        .send({ skuCode: 'K-1-M' })
        .expect(201);
      variantId = variant.body.id as string;
      await request(h.baseUrl)
        .put(`/seller/reseller-price-list/${variantId}`)
        .set(A.auth)
        .send({
          transferPriceInr: '300.00',
          minRetailInr: '400.00',
          maxRetailInr: '600.00',
          suggestedRetailInr: '499.00',
        })
        .expect(200);

      const storeEmail = `iso-store-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
      const created = await request(h.baseUrl)
        .post('/seller/reseller-stores')
        .set(A.auth)
        .send({
          name: `Iso Shop ${Math.random().toString(36).slice(2, 8)}`,
          displayName: 'Iso Shop',
          contactEmail: storeEmail,
          contactPhone: '+919800000007',
          invite: { email: storeEmail, fullName: 'Shop Owner', roleKeys: ['owner'] },
        })
        .expect(201);
      storeId = (created.body as { id: string }).id;
      ownerAuth = await acceptInvite('Shop Owner');

      const published = await request(h.baseUrl)
        .post(`/seller/reseller-stores/${storeId}/terms`)
        .set(A.auth)
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
        .post(`/store/terms/${(published.body as { current: { id: string } }).current.id}/accept`)
        .set(ownerAuth)
        .send({})
        .expect(200);

      await request(h.baseUrl)
        .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
        .set(A.auth)
        .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
        .expect(200);
      const gr = await request(h.baseUrl)
        .post('/seller/goods-receipts')
        .set(A.auth)
        .send({ lines: [{ variantId, expectedQty: 20 }] })
        .expect(201);
      await request(h.baseUrl)
        .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
        .set(staffAuth)
        .expect(200);
      await request(h.baseUrl)
        .post(`/admin/goods-receipts/${gr.body.id}/lines`)
        .set(staffAuth)
        .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: 20, putawayBinId: binId }] })
        .expect(200);
      await request(h.baseUrl)
        .post(`/admin/goods-receipts/${gr.body.id}/complete`)
        .set(staffAuth)
        .expect(200);
      await request(h.baseUrl)
        .patch(`/admin/sellers/${A.sellerId}/settings/reseller.orders_enabled`)
        .set(staffAuth)
        .send({ valueType: 'BOOLEAN', value: true, note: 'assistant isolation e2e' })
        .expect(200);

      await request(h.baseUrl)
        .post('/store/team/invitations')
        .set(ownerAuth)
        .send({
          email: `iso-assoc-${Date.now()}@scope.test`,
          fullName: 'Assoc',
          roleKeys: ['associate'],
        })
        .expect(201);
      assocAuth = await acceptInvite('Assoc');
      const me = await request(h.baseUrl).get('/auth/store/me').set(assocAuth).expect(200);
      await request(h.baseUrl)
        .put(`/store/associates/${(me.body as { id: string }).id}/prices/${variantId}`)
        .set(ownerAuth)
        .send({ retailPriceInr: '450.00' })
        .expect(200);

      ownerOrderNumber = await placeAs(ownerAuth, '+919876500011');
      assocOrderNumber = await placeAs(assocAuth, '+919876500012');
    });

    it('the associate cannot read the store owner’s conversations, nor the reverse', async () => {
      const ownerConv = await conversation(ownerAuth, 'store');
      const assocConv = await conversation(assocAuth, 'store');
      await ask(ownerAuth, 'store', ownerConv, 'OWNER-ONLY-WORDS', [says('ok')]);

      await request(h.baseUrl)
        .get(`/store/assistant/conversations/${ownerConv}`)
        .set(assocAuth)
        .expect(404);
      const post = await ask(assocAuth, 'store', ownerConv, 'let me in', [says('never')]);
      expect(post.res.status).toBe(404);
      expect(post.requests).toHaveLength(0);
      await request(h.baseUrl)
        .get(`/store/assistant/conversations/${assocConv}`)
        .set(ownerAuth)
        .expect(404);

      const assocList = await request(h.baseUrl)
        .get('/store/assistant/conversations')
        .set(assocAuth)
        .expect(200);
      expect((assocList.body as Array<{ id: string }>).map((c) => c.id)).toEqual([assocConv]);
      const ownerList = await request(h.baseUrl)
        .get('/store/assistant/conversations')
        .set(ownerAuth)
        .expect(200);
      expect((ownerList.body as Array<{ id: string }>).map((c) => c.id)).toEqual([ownerConv]);
      // The rows say who they belong to, and the two are different audiences.
      const rows = await h.prisma.assistantConversation.findMany({
        where: { id: { in: [ownerConv, assocConv] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.audience)).toEqual(['STORE', 'ASSOCIATE']);
    });

    it('an associate’s tool finds only the orders they placed; the owner’s finds both', async () => {
      const assocConv = await conversation(assocAuth, 'store');
      const foreign = await ask(assocAuth, 'store', assocConv, 'the owner’s order?', [
        toolUse('get_my_store_order', { identifier: ownerOrderNumber }),
        says('not found'),
      ]);
      const denied = toolResultOf(foreign.requests);
      expect(denied.isError).toBe(true);
      expect(JSON.parse(denied.content)).toEqual({
        error: 'No order of this store matches that number.',
      });
      expect(denied.content).not.toContain('Asha Verma');
      const calls = await h.prisma.assistantToolCall.findMany({
        where: { conversationId: assocConv },
      });
      expect(calls[0]).toMatchObject({ ok: false, errorCode: 'NOT_FOUND' });

      const own = await ask(assocAuth, 'store', assocConv, 'my order?', [
        toolUse('get_my_store_order', { identifier: assocOrderNumber }),
        says('ok'),
      ]);
      const mine = toolResultOf(own.requests);
      expect(mine.isError).toBe(false);
      expect(mine.content).toContain(assocOrderNumber);
      // Associates never see the store's costs: not a single money-shaped KEY.
      const keys = keysDeep(JSON.parse(mine.content)).map((k) => k.toLowerCase());
      for (const k of keys) {
        expect(k).not.toMatch(
          /cost|margin|transfer|total|fee|discount|terms|earning|profit|payout/,
        );
      }

      // The owner (ALL scope) sees the associate's order — the narrowing is a narrowing.
      const ownerConv = await conversation(ownerAuth, 'store');
      const all = await ask(ownerAuth, 'store', ownerConv, 'the associate’s order?', [
        toolUse('get_my_store_order', { identifier: assocOrderNumber }),
        says('ok'),
      ]);
      expect(toolResultOf(all.requests).isError).toBe(false);
    });
  });

  // ── 4. staff are offered only what their role allows ────────────────

  describe('staff permissions', () => {
    it('a staff user without orders.view is not offered get_order, and a forged call is refused', async () => {
      const role = await h.prisma.staffRoleDefinition.create({
        data: {
          key: `e2e-iso-queue-only-${randomBytes(4).toString('hex')}`,
          name: 'E2E queue only',
          description: 'Created by assistant-isolation.e2e-spec; removed in afterAll.',
          permissions: { create: [{ permission: 'callcenter.queue.view' }] },
        },
        select: { id: true },
      });
      customRoleIds.push(role.id);
      const limited = await createTestStaff(h.prisma, { role: StaffRoleKey.READONLY });
      await h.prisma.staffUserRoleAssignment.deleteMany({ where: { staffUserId: limited.id } });
      await h.prisma.staffUserRoleAssignment.create({
        data: { staffUserId: limited.id, roleId: role.id },
      });
      const login = await request(h.baseUrl)
        .post('/auth/staff/login')
        .send({ email: limited.email, password: limited.password })
        .expect(200);
      const limitedAuth = { Authorization: `Bearer ${login.body.accessToken}` };

      const conv = await conversation(limitedAuth, 'admin');
      const { res, requests } = await ask(limitedAuth, 'admin', conv, 'look up SD-2026-1', [
        toolUse('get_order', { identifier: A.orderNumber }),
        says('no'),
      ]);
      expect(res.status).toBe(200);
      // What the model was OFFERED: the queue tool and the permission-less ones, never get_order.
      expect(toolNames(requests[0]!)).toEqual([
        'explain_error',
        'find_page',
        'get_ops_queue_counts',
        'search_help',
      ]);
      // The forged call is refused as "not available", and returns nothing of the order.
      const refused = toolResultOf(requests);
      expect(refused.isError).toBe(true);
      expect(JSON.parse(refused.content)).toEqual({ error: 'That tool is not available.' });
      expect(refused.content).not.toContain(A_CUSTOMER);
      const calls = await h.prisma.assistantToolCall.findMany({ where: { conversationId: conv } });
      expect(calls[0]).toMatchObject({ toolName: 'get_order', ok: false, errorCode: 'FORBIDDEN' });

      // Control: a super admin IS offered it and gets the order.
      const superConv = await conversation(staffAuth, 'admin');
      const ok = await ask(staffAuth, 'admin', superConv, 'look up', [
        toolUse('get_order', { identifier: A.orderNumber }),
        says('ok'),
      ]);
      expect(toolNames(ok.requests[0]!)).toContain('get_order');
      expect(toolResultOf(ok.requests).content).toContain(A_CUSTOMER);
    });

    it('a seller-only tool is never offered to staff, nor a staff tool to a seller', async () => {
      const conv = await conversation(staffAuth, 'admin');
      const staff = await ask(staffAuth, 'admin', conv, 'hi', [says('hi')]);
      expect(toolNames(staff.requests[0]!)).not.toContain('get_my_order');
      expect(toolNames(staff.requests[0]!)).not.toContain('get_my_wallet_summary');

      const convA = await conversation(A.auth, 'seller');
      const seller = await ask(A.auth, 'seller', convA, 'hi', [says('hi')]);
      expect(toolNames(seller.requests[0]!)).not.toContain('get_order');
      expect(toolNames(seller.requests[0]!)).not.toContain('get_ops_queue_counts');
    });
  });

  // ── 5. a support session ────────────────────────────────────────────

  describe('staff impersonating a seller (support session)', () => {
    async function makeSupportRole(permissions: string[]): Promise<string> {
      const role = await h.prisma.staffRoleDefinition.create({
        data: {
          key: `e2e-iso-imp-${randomBytes(4).toString('hex')}`,
          name: 'E2E impersonator',
          description: 'Created by assistant-isolation.e2e-spec; removed in afterAll.',
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        select: { id: true },
      });
      customRoleIds.push(role.id);
      return role.id;
    }

    async function enter(mayWrite: boolean): Promise<{ cookie: string; operatorId: string }> {
      const roleId = await makeSupportRole(
        mayWrite ? ['support.impersonate', 'support.impersonate.write'] : ['support.impersonate'],
      );
      const operator = await createTestStaff(h.prisma, { role: StaffRoleKey.READONLY });
      await h.prisma.staffUserRoleAssignment.deleteMany({ where: { staffUserId: operator.id } });
      await h.prisma.staffUserRoleAssignment.create({
        data: { staffUserId: operator.id, roleId },
      });
      const login = await request(h.baseUrl)
        .post('/auth/staff/login')
        .send({ email: operator.email, password: operator.password })
        .expect(200);
      const auth = { Authorization: `Bearer ${login.body.accessToken}` };

      const reason = `Looking into the assistant for this account, e2e ${randomBytes(4).toString('hex')}`;
      const started = await request(h.baseUrl)
        .post('/admin/impersonation/start')
        .set(auth)
        .send({ subjectKind: 'SELLER', subjectId: A.sellerId, reason, mayWrite })
        .expect(201);
      const mail = [...enqueueSpy.mock.calls]
        .reverse()
        .find(
          ([input]) =>
            (input as { templateCode?: string }).templateCode === 'staff.impersonation_otp.email' &&
            (input as { variables?: Record<string, unknown> }).variables?.['reason'] === reason,
        );
      const code = (mail?.[0] as { variables: { code: string } } | undefined)?.variables.code;
      expect(code).toMatch(/^[0-9]{6}$/);
      const verified = await request(h.baseUrl)
        .post(`/admin/impersonation/${started.body.sessionId}/verify`)
        .set(auth)
        .send({ code })
        .expect(200);
      const exchanged = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: verified.body.handoff.token })
        .expect(200);
      const jar = (exchanged.headers['set-cookie'] ?? []) as unknown as string[];
      const hit = jar.find((c) => c.startsWith(`${IMPERSONATION_COOKIE}=`));
      expect(hit).toBeDefined();
      return { cookie: hit!.split(';')[0]!, operatorId: operator.id };
    }

    it('a read-only session cannot use the assistant at all (every POST is refused)', async () => {
      const { cookie } = await enter(false);
      const res = await request(h.baseUrl)
        .post('/seller/assistant/conversations')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_WHILE_IMPERSONATING');
      expect(await h.prisma.assistantConversation.count()).toBe(0);
    });

    it('in a write session the conversation is the seller’s by identity, the operator’s by attribution, and hidden from the real owner', async () => {
      const { cookie, operatorId } = await enter(true);

      const created = await request(h.baseUrl)
        .post('/seller/assistant/conversations')
        .set('Cookie', cookie)
        .send({})
        .expect(201);
      const convId = (created.body as { id: string }).id;

      // WHAT IT DOES TODAY, recorded: the row carries the seller's own user as
      // owner, the seller company, AND the operator who was at the keyboard.
      const owner = await h.prisma.sellerUser.findFirstOrThrow({
        where: {
          sellerId: A.sellerId,
          deletedAt: null,
          roles: { some: { role: { isOwner: true } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const row = await h.prisma.assistantConversation.findUniqueOrThrow({ where: { id: convId } });
      expect(row).toMatchObject({
        audience: 'SELLER',
        ownerUserId: owner.id,
        sellerId: A.sellerId,
        impersonatedByStaffId: operatorId,
      });

      // The session sees it, asks as the seller (tools run on the seller's data),
      // and the usage rows carry the operator too.
      const asked = await ask(
        {} as Auth,
        'seller',
        convId,
        'my order?',
        [toolUse('get_my_order', { identifier: A.orderNumber }), says('ok')],
        cookie,
      );
      expect(asked.res.status).toBe(200);
      expect(toolResultOf(asked.requests).content).toContain(A_CUSTOMER);
      const call = await h.prisma.assistantToolCall.findFirstOrThrow({
        where: { conversationId: convId },
      });
      expect(call).toMatchObject({ callerUserId: owner.id, impersonatedByStaffId: operatorId });
      const usage = await h.prisma.assistantUsage.findMany({ where: { conversationId: convId } });
      expect(usage.length).toBeGreaterThan(0);
      for (const u of usage) expect(u.impersonatedByStaffId).toBe(operatorId);
      const sessionList = await request(h.baseUrl)
        .get('/seller/assistant/conversations')
        .set('Cookie', cookie)
        .expect(200);
      expect((sessionList.body as Array<{ id: string }>).map((c) => c.id)).toEqual([convId]);

      // The REAL seller, signing in later, never sees what support asked on their account.
      const realList = await request(h.baseUrl)
        .get('/seller/assistant/conversations')
        .set(A.auth)
        .expect(200);
      expect(realList.body).toEqual([]);
      await request(h.baseUrl)
        .get(`/seller/assistant/conversations/${convId}`)
        .set(A.auth)
        .expect(404);
      const intrusion = await ask(A.auth, 'seller', convId, 'hello', [says('never')]);
      expect(intrusion.res.status).toBe(404);

      // ...and the operator's own admin conversations are a different list entirely.
      const adminList = await request(h.baseUrl)
        .get('/admin/assistant/conversations')
        .set(staffAuth)
        .expect(200);
      expect((adminList.body as Array<{ id: string }>).map((c) => c.id)).not.toContain(convId);
      expect(staffId).not.toBe(operatorId);
    });
  });
});
