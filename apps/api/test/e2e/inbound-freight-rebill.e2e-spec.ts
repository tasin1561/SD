import request from 'supertest';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Void-and-re-bill, against a REAL database.
 *
 * FRT-6 offers it — the void's own message says "withdraw the bill if it
 * was wrong, then raise a new one" — and for one commit the database
 * refused: `inbound_freight_charges.goods_receipt_id` and
 * `inbound_freight_allocations.goods_receipt_line_id` were both
 * UNCONDITIONALLY unique, and the void deliberately KEEPS its rows. A
 * mistyped PAY_NOW bill therefore left that shipment's freight
 * permanently uncollectable, and a mistyped PAY_ADVANCE bill left the
 * goods unable to leave Bangladesh at all.
 *
 * The unit suite could not see it: its Prisma is a mock, and a mock has
 * no index to violate (the `pack_boxes` / `courier_pickup_requests`
 * lesson). A test written against it asserted re-billing worked while
 * the database was refusing it. Only a real Postgres tells the two
 * apart, which is the whole reason this file exists.
 */
describe('Inbound freight — void and re-bill (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let sellerId: string;
  let variantId: string;
  let bdWarehouseId: string;

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
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: `freight-rebill-${Date.now()}@brand.com` })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Rebill Brand',
        contactPersonName: 'Rebill Owner',
        phone: '+8801712345677',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    // A Bangladesh INTAKE warehouse, and the one setting that names it
    // (CNS-2: `ops.bd_intake_warehouse_id` is seeded EMPTY on purpose, so
    // a VIA_BD declaration is refused rather than quietly routed to
    // India). `fulfilsOrders: false` is what makes it an intake rather
    // than somewhere we ship from.
    const bd = await request(h.baseUrl)
      .post('/admin/warehouses')
      .set(staffAuth)
      .send({
        code: `DAC-${Date.now().toString().slice(-5)}`,
        name: 'Dhaka intake',
        countryCode: 'BD',
        fulfilsOrders: false,
      })
      .expect(201);
    bdWarehouseId = bd.body.id as string;
    await request(h.baseUrl)
      .patch('/admin/settings/ops.bd_intake_warehouse_id')
      .set(staffAuth)
      .send({ valueType: 'STRING', value: bdWarehouseId })
      .expect(200);

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Kettle', externalRef: 'K-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'K-1-STD', weightGrams: 900 })
      .expect(201);
    variantId = variant.body.id as string;
  });

  /**
   * A VIA_BD consignment counted at the Dhaka intake — the leg a
   * PAY_ADVANCE bill is priced from and hangs on.
   */
  async function countedAtDhaka(qty: number): Promise<{
    consignmentId: string;
    receiptId: string;
    receiptLineId: string;
  }> {
    const cn = await request(h.baseUrl)
      .post('/seller/consignments')
      .set(sellerAuth)
      .send({ route: 'VIA_BD', lines: [{ variantId, expectedQty: qty }] })
      .expect(201);
    const consignmentId = cn.body.id as string;
    const intake = (cn.body.receipts as Array<{ id: string; leg: string }>).find(
      (r) => r.leg === 'BD_INTAKE',
    );
    if (intake === undefined) throw new Error('no BD_INTAKE leg on the declared consignment');

    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${intake.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    const gr = await request(h.baseUrl)
      .get(`/admin/goods-receipts/${intake.id}`)
      .set(staffAuth)
      .expect(200);
    const lineId = (gr.body.lines as Array<{ id: string }>)[0]?.id;
    if (lineId === undefined) throw new Error('no line on the intake receipt');
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${intake.id}/lines`)
      .set(staffAuth)
      .send({ lines: [{ lineId, receivedQty: qty }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${intake.id}/complete`)
      .set(staffAuth)
      .expect(200);

    return { consignmentId, receiptId: intake.id, receiptLineId: lineId };
  }

  /** Raise a PAY_ADVANCE bill at the given per-piece rate. */
  async function bill(
    receiptId: string,
    receiptLineId: string,
    rate: string,
  ): Promise<{ id: string; totalInr: string }> {
    const res = await request(h.baseUrl)
      .post('/admin/inbound-freight')
      .set(staffAuth)
      .send({
        goodsReceiptId: receiptId,
        mode: 'PAY_ADVANCE',
        lines: [{ goodsReceiptLineId: receiptLineId, basis: 'PER_PIECE', rate }],
      })
      .expect(201);
    return { id: res.body.id as string, totalInr: res.body.totalInr as string };
  }

  it('a withdrawn bill leaves the receipt billable again, and both rows survive', async () => {
    const { consignmentId, receiptId, receiptLineId } = await countedAtDhaka(10);

    // ₹500 a piece — the mistyped one (it should have been ₹50).
    const wrong = await bill(receiptId, receiptLineId, '500.00');
    expect(wrong.totalInr).toBe('5000.00');

    await request(h.baseUrl)
      .post(`/admin/inbound-freight/${wrong.id}/void`)
      .set(staffAuth)
      .send({ reason: 'Rate typed as 500 a piece; the agreed rate was 50' })
      .expect(200);

    // THE ASSERTION THIS FILE EXISTS FOR: the same receipt takes a new
    // bill. Against the pre-fix schema this is a P2002 on
    // `inbound_freight_charges_goods_receipt_id_key`, and the unit suite
    // could not have told us.
    const right = await bill(receiptId, receiptLineId, '50.00');
    expect(right.totalInr).toBe('500.00');
    expect(right.id).not.toBe(wrong.id);

    // Both rows survive — the withdrawn one is the record of what was
    // billed — and exactly one of them is live.
    const rows = await h.prisma.inboundFreightCharge.findMany({
      where: { goodsReceiptId: receiptId },
      select: { id: true, voidedAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.voidedAt === null).map((r) => r.id)).toEqual([right.id]);
    expect(rows.find((r) => r.id === wrong.id)?.status).toBe('VOIDED');

    // And the ALLOCATIONS, which carry the second half of the same trap:
    // the per-line unique was absolute too, so the replacement could not
    // write its own line even once its bill existed.
    const allocs = await h.prisma.inboundFreightAllocation.findMany({
      where: { goodsReceiptLineId: receiptLineId },
      select: { freightChargeId: true, voidedAt: true },
    });
    expect(allocs).toHaveLength(2);
    expect(allocs.filter((a) => a.voidedAt === null).map((a) => a.freightChargeId)).toEqual([
      right.id,
    ]);

    // A second live bill is still refused — the partial unique narrowed
    // the key, it did not remove it.
    await request(h.baseUrl)
      .post('/admin/inbound-freight')
      .set(staffAuth)
      .send({
        goodsReceiptId: receiptId,
        lines: [{ goodsReceiptLineId: receiptLineId, basis: 'PER_PIECE', rate: '9.00' }],
      })
      .expect(409);

    // The consignment's own guard agrees: an advance-billed consignment
    // reads as billed again, so it may leave Bangladesh.
    const live = await h.prisma.inboundFreightCharge.findFirst({
      where: { consignmentId, voidedAt: null },
      select: { id: true },
    });
    expect(live?.id).toBe(right.id);
  });

  it('the WALLET nets to the corrected bill, not the sum of both', async () => {
    const { receiptId, receiptLineId } = await countedAtDhaka(10);
    const wrong = await bill(receiptId, receiptLineId, '500.00');
    await request(h.baseUrl)
      .post(`/admin/inbound-freight/${wrong.id}/void`)
      .set(staffAuth)
      .send({ reason: 'Rate typed as 500 a piece; the agreed rate was 50' })
      .expect(200);
    await bill(receiptId, receiptLineId, '50.00');

    // −5000 (wrong) +5000 (refund) −500 (right). PAY_ADVANCE settles in
    // full at record time, so all three have already been written.
    const entries = await h.prisma.sellerWalletEntry.findMany({
      where: {
        sellerId,
        direction: { in: ['INBOUND_FREIGHT', 'INBOUND_FREIGHT_REFUND'] },
      },
      select: { direction: true, amount: true },
      orderBy: { id: 'asc' },
    });
    expect(entries.map((e) => `${e.direction}:${e.amount.toFixed(2)}`)).toEqual([
      'INBOUND_FREIGHT:5000.00',
      'INBOUND_FREIGHT_REFUND:5000.00',
      'INBOUND_FREIGHT:500.00',
    ]);
  });

  it('a re-billed line is charged at the LIVE rate when its unit leaves — not skipped', async () => {
    // The half that costs money. Re-billing being POSSIBLE says nothing
    // about whether the re-billed freight is ever COLLECTED: a reader
    // that picks the withdrawn allocation hits the VOIDED guard in the
    // attribution walk and returns null, so the unit ships freight-free
    // forever with a perfectly good live bill sitting beside it. The
    // walk's query filters `voidedAt: null` for exactly this.
    const { receiptId, receiptLineId } = await countedAtDhaka(10);
    const wrong = await bill(receiptId, receiptLineId, '500.00');
    await request(h.baseUrl)
      .post(`/admin/inbound-freight/${wrong.id}/void`)
      .set(staffAuth)
      .send({ reason: 'Rate typed as 500 a piece; the agreed rate was 50' })
      .expect(200);
    // PAY_LATER this time: PAY_ADVANCE and PAY_NOW settle in full at
    // record time and are never amortised (`settlesImmediately`), so the
    // per-unit charge only exists on pay-as-it-sells terms.
    const right = await request(h.baseUrl)
      .post('/admin/inbound-freight')
      .set(staffAuth)
      .send({
        goodsReceiptId: receiptId,
        mode: 'PAY_LATER',
        lines: [{ goodsReceiptLineId: receiptLineId, basis: 'PER_PIECE', rate: '50.00' }],
      })
      .expect(201);

    // Which allocation does the walk reach for? Ask it the way the
    // amortisation does — LIVE only — and prove the answer is the new
    // bill's line at the new rate.
    const line = await h.prisma.goodsReceiptLine.findUniqueOrThrow({
      where: { id: receiptLineId },
      select: { batchId: true },
    });
    const reached = await h.prisma.goodsReceiptLine.findFirst({
      where: { batchId: line.batchId },
      select: {
        freightAllocations: {
          where: { voidedAt: null },
          take: 1,
          select: { freightChargeId: true, perUnitInr: true, lineGrossInr: true },
        },
      },
    });
    const alloc = reached?.freightAllocations[0];
    expect(alloc?.freightChargeId).toBe(right.body.id);
    // ₹50 a piece over ten pieces, gross of the pay-later service charge.
    // ONE line, so its gross IS the bill's total — the LIVE bill's
    // arithmetic, nowhere near the withdrawn ₹500-a-piece one.
    expect(alloc?.lineGrossInr.toFixed(2)).toBe(right.body.totalInr);
    expect(Number(alloc?.perUnitInr)).toBeCloseTo(Number(right.body.totalInr) / 10, 4);
    expect(Number(right.body.totalInr)).toBeGreaterThanOrEqual(500);
    expect(Number(right.body.totalInr)).toBeLessThan(1000);
  });

  it('a consignment carrying a live bill cannot be cancelled', async () => {
    // PAY_ADVANCE makes a state CNS-6 predates reachable: a fully-PAID
    // bill on a consignment that has not flown. Cancelling touched no
    // freight row, so the seller got their goods back and kept the debit.
    const { consignmentId, receiptId, receiptLineId } = await countedAtDhaka(10);
    const raised = await bill(receiptId, receiptLineId, '50.00');

    const refused = await request(h.baseUrl)
      .post(`/admin/consignments/${consignmentId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'Seller changed their mind about this shipment' })
      .expect(409);
    expect(refused.body.code).toBe('CONSIGNMENT_FREIGHT_BILLED');

    // Withdraw first, then cancel — the order the refusal asks for.
    await request(h.baseUrl)
      .post(`/admin/inbound-freight/${raised.id}/void`)
      .set(staffAuth)
      .send({ reason: 'Consignment called off before it flew; bill withdrawn' })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/consignments/${consignmentId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'Seller changed their mind about this shipment' })
      .expect(200);
  });
});
