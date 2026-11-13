import type Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import {
  ActorType,
  ChargeType,
  Currency,
  SellerStatus,
  StaffRoleKey,
  WalletEntryDirection,
} from '@skydrop/db';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
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
 * ASSISTANT BATCH B — charges and stock, across two sellers, against Postgres.
 *
 * ── WHY THIS IS AN E2E ───────────────────────────────────────────────
 * The unit specs read back the `where` a mocked Prisma was handed. The two
 * lookups below are the ones whose scope lives in a JOIN of real rows: the
 * charges tool resolves a typed order number inside the caller's seller and
 * then reads `order_charges` + `seller_wallet_entries`; the stock tool
 * resolves a typed SKU through the catalog and then sums live availability.
 * Each denial is asserted against rows that REALLY belong to the other
 * seller, next to a control that proves the same call works for its owner.
 *
 * The model is never called: the gateway is replaced by the scripted
 * `FakeGateway`, so what the "model" asks for is under this file's control.
 */
type Auth = { Authorization: string };

describe('assistant batch B lookups (e2e)', () => {
  let h: AppHarness;
  let fake: FakeGateway;
  let staffAuth: Auth;
  let A: { auth: Auth; id: string; orderNumber: string; sku: string };
  let B: { auth: Auth; id: string; orderNumber: string; sku: string };

  const A_FEE = '162.60';
  const B_FEE = '4321.09';
  const INTERNAL = 'INTERNAL-ONLY-MARKUP';
  const MARGIN = 'MARGIN-SECRET-77';

  beforeAll(async () => {
    h = await bootTestApp();
    const gateway = h.app.get(AssistantModelGateway, { strict: false });
    jest.spyOn(gateway, 'isConfigured').mockReturnValue(true);
    jest
      .spyOn(gateway, 'complete')
      .mockImplementation((req: AssistantModelRequest, onText: (d: string) => void) =>
        fake.complete(req, onText),
      );
  });

  afterAll(async () => {
    await h.close();
  });

  async function makeSeller(label: string, phoneTail: string): Promise<{ auth: Auth; id: string }> {
    const email = `bb-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `BB ${label} ${Math.random().toString(36).slice(2, 6)}`,
        contactPersonName: `Owner ${label}`,
        phone: `+88017123457${phoneTail}`,
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

  /** An order with a persisted charge, an internal-only charge and a wallet entry, seeded directly: the READ is under test. */
  async function seedOrderWithCharges(sellerId: string, fee: string): Promise<string> {
    const store = await defaultStoreFor(h.prisma, sellerId);
    const orderNumber = `SD-2026-92-${Math.floor(Math.random() * 900000 + 100000)}`;
    const order = await h.prisma.order.create({
      data: {
        sellerId,
        storeId: store.id,
        storeNameSnapshot: store.name,
        orderNumber,
        status: 'DELIVERED',
        paymentMode: 'COD',
        codAmountInr: '777.00',
        recipientName: 'Some Customer',
        recipientPhoneE164: '+919812345678',
        recipientAddressLine1: '1 Private Road',
        recipientCity: 'Pune',
        recipientStateProvince: 'Maharashtra',
        recipientPostalCode: '411001',
        recipientCountryCode: 'IN',
        declaredValueInr: '777.00',
      },
      select: { id: true },
    });
    await h.prisma.orderCharge.create({
      data: {
        orderId: order.id,
        type: ChargeType.BASE_SHIPPING,
        amountInr: fee,
        totalAmountInr: fee,
        description: 'Base shipping',
        displayOrder: 0,
        isVisibleToSeller: true,
        computationContext: {
          engineVersion: 'flat-v1',
          margin: { note: MARGIN },
          flatFee: {
            deliveryFeeInr: fee,
            source: 'SYSTEM_DEFAULT',
            agreedAmount: '200.00',
            agreedCurrency: 'BDT',
            fxRate: '0.813',
            fxRatePair: 'BDT_INR',
            fxRateSource: 'HISTORY',
            fxRateRecordedAt: '2026-11-01T00:00:00.000Z',
          },
        },
      },
    });
    await h.prisma.orderCharge.create({
      data: {
        orderId: order.id,
        type: ChargeType.OTHER,
        amountInr: '55.55',
        totalAmountInr: '55.55',
        description: INTERNAL,
        displayOrder: 1,
        isVisibleToSeller: false,
      },
    });
    await h.prisma.sellerWalletEntry.create({
      data: {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.ORDER_CHARGES,
        amount: fee,
        runningBalanceAfter: '8888.88',
        linkedOrderId: order.id,
        actorType: ActorType.SYSTEM,
      },
    });
    return orderNumber;
  }

  /** A seller product with `qty` units received into the fulfilling warehouse. */
  async function seedStock(auth: Auth, sku: string, qty: number): Promise<void> {
    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const wh = (whs.body as Array<{ id: string; code: string }>).find((w) => w.code === 'CCU-01');
    expect(wh).toBeDefined();
    await h.prisma.warehouse.update({ where: { id: wh!.id }, data: { fulfilsOrders: true } });
    let zoneId = (
      await h.prisma.warehouseZone.findFirst({
        where: { warehouseId: wh!.id, code: 'BB' },
        select: { id: true },
      })
    )?.id;
    if (zoneId === undefined) {
      const zone = await request(h.baseUrl)
        .post(`/admin/warehouses/${wh!.id}/zones`)
        .set(staffAuth)
        .send({ code: 'BB', name: 'Batch B' })
        .expect(201);
      zoneId = zone.body.id as string;
    }
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${wh!.id}/bins`)
      .set(staffAuth)
      .send({
        zoneId,
        aisle: 'A',
        rack: String(Math.floor(Math.random() * 90 + 1)),
        shelf: String(Math.floor(Math.random() * 90 + 1)),
        type: 'STORAGE',
      });
    const binId = (
      bin.status === 201
        ? (bin.body as { id: string })
        : await h.prisma.warehouseBin.findFirstOrThrow({
            where: { warehouseId: wh!.id, type: 'STORAGE', deletedAt: null },
            select: { id: true },
          })
    ).id;
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(auth)
      .send({ name: `Widget ${sku}`, externalRef: sku })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(auth)
      .send({ skuCode: sku })
      .expect(201);
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(auth)
      .send({ lines: [{ variantId: variant.body.id, expectedQty: qty }] })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    const detail = await request(h.baseUrl)
      .get(`/admin/goods-receipts/${gr.body.id}`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(staffAuth)
      .send({
        lines: [{ lineId: detail.body.lines[0].id, receivedQty: qty, putawayBinId: binId }],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const a = await makeSeller('A', '30');
    const b = await makeSeller('B', '31');
    A = {
      ...a,
      orderNumber: await seedOrderWithCharges(a.id, A_FEE),
      sku: `BB-A-${Date.now()}`,
    };
    B = {
      ...b,
      orderNumber: await seedOrderWithCharges(b.id, B_FEE),
      sku: `BB-B-${Date.now()}`,
    };
    await seedStock(A.auth, A.sku, 7);
    await seedStock(B.auth, B.sku, 3);
    fake = new FakeGateway([]);
  });

  async function conversation(auth: Auth, prefix: string): Promise<string> {
    const res = await request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations`)
      .set(auth)
      .send({})
      .expect(201);
    return (res.body as { id: string }).id;
  }
  const toolUse = (name: string, input: Record<string, unknown>): Anthropic.Message =>
    message({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name, input } as unknown as Anthropic.ContentBlock],
    });
  const says = (text: string): Anthropic.Message =>
    message({ content: [{ type: 'text', text, citations: null } as Anthropic.ContentBlock] });

  /** Ask once with a scripted model that calls one tool; returns what the tool handed back. */
  async function callTool(
    auth: Auth,
    prefix: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    const conv = await conversation(auth, prefix);
    fake = new FakeGateway([toolUse(name, input), says('ok')]);
    const res = await request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations/${conv}/messages`)
      .set(auth)
      .send({ text: 'question' });
    expect(res.status).toBe(200);
    const last = fake.requests[1]?.messages.at(-1);
    const block = (last?.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block.type).toBe('tool_result');
    return { content: String(block.content), isError: block.is_error === true };
  }

  describe('explain_my_order_charges', () => {
    it('control: the owner sees the stored lines, the agreed BDT fee and rate, and the wallet entry', async () => {
      const r = await callTool(A.auth, 'seller', 'explain_my_order_charges', {
        identifier: A.orderNumber,
      });
      expect(r.isError).toBe(false);
      const body = JSON.parse(r.content) as {
        lines: Array<{ totalInr: string; agreed: { currency: string; fxRate: string } | null }>;
        walletEntries: Array<{ direction: string; amount: string }>;
      };
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({
        totalInr: A_FEE,
        agreed: { currency: 'BDT', fxRate: '0.813' },
      });
      expect(body.walletEntries).toEqual([
        expect.objectContaining({ direction: 'ORDER_CHARGES', amount: A_FEE }),
      ]);
    });

    it('never shows an internal-only charge, our margin, or the running balance', async () => {
      const r = await callTool(A.auth, 'seller', 'explain_my_order_charges', {
        identifier: A.orderNumber,
      });
      for (const hidden of [INTERNAL, '55.55', MARGIN, '8888.88']) {
        expect(r.content).not.toContain(hidden);
      }
    });

    it('the other seller’s order number is NOT_FOUND and none of its figures leak', async () => {
      const r = await callTool(A.auth, 'seller', 'explain_my_order_charges', {
        identifier: B.orderNumber,
      });
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content)).toEqual({ error: 'No order of yours matches that number.' });
      expect(r.content).not.toContain(B_FEE);
      expect(r.content).not.toContain(B.orderNumber);
      const calls = await h.prisma.assistantToolCall.findMany({
        where: { toolName: 'explain_my_order_charges' },
      });
      expect(calls[0]).toMatchObject({ ok: false, errorCode: 'NOT_FOUND', sellerId: A.id });
    });

    it('B reads B’s own', async () => {
      const r = await callTool(B.auth, 'seller', 'explain_my_order_charges', {
        identifier: B.orderNumber,
      });
      expect(r.content).toContain(B_FEE);
      expect(r.content).not.toContain(A_FEE);
    });
  });

  describe('get_my_stock', () => {
    it('control: each seller sees their own count', async () => {
      const a = await callTool(A.auth, 'seller', 'get_my_stock', { sku: A.sku });
      expect(JSON.parse(a.content)).toMatchObject({ sku: A.sku, qtyOnHand: 7, qtyAvailable: 7 });
      const b = await callTool(B.auth, 'seller', 'get_my_stock', { sku: B.sku });
      expect(JSON.parse(b.content)).toMatchObject({ sku: B.sku, qtyOnHand: 3, qtyAvailable: 3 });
    });

    it('the other seller’s SKU is NOT_FOUND, the same answer as a SKU that does not exist', async () => {
      const foreign = await callTool(A.auth, 'seller', 'get_my_stock', { sku: B.sku });
      const ghost = await callTool(A.auth, 'seller', 'get_my_stock', { sku: 'NO-SUCH-SKU-1' });
      expect(foreign.isError).toBe(true);
      expect(foreign.content).toBe(ghost.content);
      expect(foreign.content).not.toContain(B.sku);
    });
  });

  describe('staff ops_metrics', () => {
    it('a staff member with reports.view gets the same total as the Reports page', async () => {
      const day = (offset: number): string =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const from = day(-1);
      const to = day(1);
      const tool = await callTool(staffAuth, 'admin', 'ops_metrics', {
        metric: 'orders_created',
        from,
        to,
        groupBy: 'none',
      });
      const page = await request(h.baseUrl)
        .get('/admin/reports/summary')
        .query({ from: `${from}T00:00:00.000Z`, to: `${day(2)}T00:00:00.000Z` })
        .set(staffAuth)
        .expect(200);
      expect(JSON.parse(tool.content)).toMatchObject({
        total: String((page.body as { orders: { created: number } }).orders.created),
      });
      const byClient = await callTool(staffAuth, 'admin', 'ops_metrics', {
        metric: 'orders_created',
        from,
        to,
        groupBy: 'client',
      });
      expect((JSON.parse(byClient.content) as { rows: unknown[] }).rows).toHaveLength(2);
    });

    it('a client is never offered it', async () => {
      const conv = await conversation(A.auth, 'seller');
      fake = new FakeGateway([says('hi')]);
      await request(h.baseUrl)
        .post(`/seller/assistant/conversations/${conv}/messages`)
        .set(A.auth)
        .send({ text: 'hi' })
        .expect(200);
      const offered = (fake.requests[0]?.tools ?? []).map((t) => (t as { name: string }).name);
      expect(offered).toContain('explain_my_order_charges');
      expect(offered).not.toContain('ops_metrics');
      expect(offered).not.toContain('explain_address_check');
    });
  });
});
