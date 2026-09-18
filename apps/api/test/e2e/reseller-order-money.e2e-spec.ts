import { createHash, randomBytes } from 'node:crypto';
import type { HttpException } from '@nestjs/common';
import request from 'supertest';
import {
  ActorType,
  CredentialEnvironment,
  OrderStatus,
  Prisma,
  ProductStatus,
  SellerStatus,
  StaffRole,
} from '@skydrop/db';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { ResellerOrderMoneyService } from '../../src/modules/reseller-order-money/services/reseller-order-money.service';
import {
  bootTestApp,
  createTestStaff,
  drainAll,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * RS-6 phase 3c — a reseller store order's MONEY, against a real database.
 *
 * The unit specs pin the arithmetic (`reseller-money-plan.spec.ts`) and the
 * bank invariant over an in-memory book (`settlement-bank-invariant.spec.ts`);
 * this pins what only Postgres shows: the credit rows and their CHECKs, the
 * guarded status claims under the seller's WALLET lock, and the bank book
 * after a real courier payout — held for the seller = max(0, seller wallet
 * + Σ their store wallets), to the paisa, after every step.
 */
describe('reseller order money (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerId: string;
  let sellerAuth: { Authorization: string };
  let variantId: string;
  let binId: string;
  let courierAccountId: string;
  let bankAccountId: string;

  const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
  const ZERO = D(0);

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  /** Both parties credited at the courier payout; the store pays half the COD tax. */
  const TERMS = {
    deliveryFeeStorePercent: '50',
    returnFeeStorePercent: '50',
    customerReturnFeeStorePercent: '50',
    codFeeStorePercent: '50',
    codTaxStorePercent: '50',
    instantPayFeeStorePercent: '100',
    storeCreditTrigger: 'ON_PAYOUT',
    storeCreditDays: 0,
    sellerCreditTrigger: 'ON_PAYOUT',
    sellerCreditDays: 0,
    basedOnVersion: 0,
  };

  async function makeStore(): Promise<{ storeId: string; auth: { Authorization: string } }> {
    const email = `money-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(sellerAuth)
      .send({
        name: `Money ${Math.random().toString(36).slice(2, 8)}`,
        displayName: 'Money Store',
        contactEmail: email,
        contactPhone: '+919800000001',
        invite: { email, fullName: 'Money Owner', roleKey: 'owner' },
      })
      .expect(201);
    const storeId = (created.body as { id: string }).id;
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
      .send({ token: plaintext, password: 'StorePass-1234', fullName: 'Money Owner' })
      .expect(201);
    const auth = {
      Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}`,
    };
    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeId}/terms`)
      .set(sellerAuth)
      .send(TERMS)
      .expect(201);
    const termsVersionId = (published.body as { current: { id: string } }).current.id;
    await request(h.baseUrl)
      .post(`/store/terms/${termsVersionId}/accept`)
      .set(auth)
      .send({})
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
      .set(sellerAuth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
      .expect(200);
    return { storeId, auth };
  }

  async function receiveStock(qty: number): Promise<void> {
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(sellerAuth)
      .send({ lines: [{ variantId, expectedQty: qty }] })
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

  let phone = 0;
  async function placeOrder(
    store: { auth: { Authorization: string } },
    qty: number,
    paymentMode: 'COD' | 'PREPAID' = 'COD',
  ): Promise<request.Response> {
    phone += 1;
    return request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: `+9198765${String(10000 + phone).padStart(5, '0')}`,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientPostalCode: '560001',
        paymentMode,
        acknowledgeDuplicate: true,
        items: [{ variantId, quantity: qty, retailUnitPriceInr: 499 }],
      });
  }

  async function confirm(orderId: string): Promise<void> {
    const res = await h.app.get(OrderWriteService).transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect(res.status).toBe(OrderStatus.CONFIRMED);
    await drainAll(h.app);
  }

  /** The courier says delivered: the order moves, then its money listener runs. */
  async function deliver(orderId: string): Promise<void> {
    // The parcel was carried by OUR test account, whatever the default courier
    // booked it with — the payout checks the carrier and pays into its account.
    await h.prisma.shipment.updateMany({
      where: { orderShipments: { some: { orderId } } },
      data: { courierAccountId },
    });
    await h.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERED },
    });
    await h.app.get(ResellerOrderMoneyService).onDelivered(orderId, new Date(), true);
  }

  let payoutN = 0;
  async function pay(
    amountInr: string,
    lines: Array<[string, string]>,
    reversals: Array<[string, string]> = [],
  ): Promise<void> {
    payoutN += 1;
    await h.app.get(CourierSettlementService).record(staffId, {
      courierAccountId,
      reference: `RS-PAYOUT-${payoutN}-${Date.now()}`,
      amountInr,
      receivedAt: new Date().toISOString(),
      lines: lines.map(([orderId, settledInr]) => ({ orderId, settledInr })),
      ...(reversals.length === 0
        ? {}
        : {
            deductions: {
              rtoReversals: reversals.map(([orderId, amt]) => ({ orderId, amountInr: amt })),
            },
          }),
    });
  }

  async function codOf(orderId: string): Promise<string> {
    const o = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { codAmountInr: true },
    });
    return (o.codAmountInr ?? ZERO).toFixed(2);
  }

  async function storeBalance(storeId: string): Promise<Prisma.Decimal> {
    const last = await h.prisma.storeWalletEntry.findFirst({
      where: { storeId },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? ZERO;
  }

  async function sellerBalance(): Promise<Prisma.Decimal> {
    const last = await h.prisma.sellerWalletEntry.findFirst({
      where: { sellerId, currency: 'INR' },
      orderBy: { id: 'desc' },
      select: { runningBalanceAfter: true },
    });
    return last?.runningBalanceAfter ?? ZERO;
  }

  /** TRE-8c: the cash the bank book holds for the seller equals max(0, seller + Σ stores). */
  async function expectBookAgrees(storeIds: readonly string[]): Promise<void> {
    const held = await h.prisma.bankEntry.aggregate({
      where: { ownerKind: 'SELLER', sellerId, currency: 'INR' },
      _sum: { signedAmount: true },
    });
    let group = await sellerBalance();
    for (const s of storeIds) group = group.add(await storeBalance(s));
    const owed = group.lessThan(0) ? ZERO : group;
    expect((held._sum.signedAmount ?? ZERO).toFixed(2)).toBe(owed.toFixed(2));
  }

  async function creditsOf(orderId: string) {
    // Sorted by the party's NAME, deliberately not by `orderBy: { party }`.
    // Postgres orders an enum by its DECLARATION order, and
    // ResellerMoneyParty declares STORE before SELLER — so the database's
    // "ascending" is [STORE, SELLER] while every caller below destructures
    // [seller, store]. That read as a money bug on the first CI run of this
    // spec: a store balance compared against the seller's net. Sorting by
    // name here makes the positional reads honest and keeps them that way
    // if the enum is ever reordered.
    const rows = await h.prisma.resellerOrderCredit.findMany({ where: { orderId } });
    return [...rows].sort((a, b) => a.party.localeCompare(b.party));
  }

  async function accountTotal(): Promise<string> {
    const agg = await h.prisma.bankEntry.aggregate({
      where: { accountId: bankAccountId },
      _sum: { signedAmount: true },
    });
    return (agg._sum.signedAmount ?? ZERO).toFixed(2);
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    staffId = staff.id;
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const email = `rs6m-${Date.now()}-${Math.random().toString(36).slice(2)}@money.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'RS6 Money Brand',
        contactPersonName: 'RS6 Owner',
        phone: '+8801712345602',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    await h.prisma.seller.update({
      where: { id: sellerId },
      data: { status: SellerStatus.APPROVED },
    });
    const sLogin = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    sellerAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )?.id;
    expect(warehouseId).toBeDefined();
    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'M', name: 'Zone M' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: zone.body.id, aisle: 'M', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binId = bin.body.id as string;
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Kurta', externalRef: 'M-1' })
      .expect(201);
    await h.prisma.product.update({
      where: { id: product.body.id as string },
      data: { status: ProductStatus.ACTIVE },
    });
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'M-1-M' })
      .expect(201);
    variantId = variant.body.id as string;
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${variantId}`)
      .set(sellerAuth)
      .send({
        transferPriceInr: '300.00',
        minRetailInr: '400.00',
        maxRetailInr: '600.00',
        suggestedRetailInr: '499.00',
      })
      .expect(200);
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/reseller.orders_enabled`)
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: true, note: 'RS-6 money e2e — store orders on' })
      .expect(200);
    await receiveStock(10);

    // A courier account whose payouts land in our rupee account.
    const bank = await h.prisma.platformBankAccount.create({
      data: {
        label: 'HDFC current',
        bankName: 'HDFC Bank',
        accountName: 'Skydrop',
        accountNumber: `5020${Math.floor(Math.random() * 1e10)}`,
        currency: 'INR',
      },
      select: { id: true },
    });
    bankAccountId = bank.id;
    const courier = await h.prisma.courier.findFirstOrThrow({
      where: { code: 'delhivery' },
      select: { id: true },
    });
    const acct = await h.prisma.courierAccount.create({
      data: {
        courierId: courier.id,
        environment: CredentialEnvironment.PRODUCTION,
        label: 'Delhivery — reseller money e2e',
        isActive: true,
        payoutBankAccountId: bank.id,
      },
      select: { id: true },
    });
    courierAccountId = acct.id;
  });

  it('confirm → deliver → settle: each party is credited its net at the payout, to the paisa', async () => {
    const store = await makeStore();
    const placed = await placeOrder(store, 1);
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { id: string }).id;
    const cod = await codOf(orderId);

    await confirm(orderId);
    // Planned once, at confirmation: one row per party, nothing credited yet.
    const planned = await creditsOf(orderId);
    expect(planned.map((c) => `${c.party} ${c.status}`)).toEqual([
      'SELLER WAITING',
      'STORE WAITING',
    ]);
    await deliver(orderId);
    expect((await creditsOf(orderId)).map((c) => c.status)).toEqual(['WAITING', 'WAITING']);
    await expectBookAgrees([store.storeId]);

    await pay(cod, [[orderId, cod]]);
    const [seller, st] = await creditsOf(orderId);
    expect(seller?.status).toBe('CREDITED');
    expect(st?.status).toBe('CREDITED');
    // The store: COD in, the transfer price out, its shares out.
    expect(st?.grossInr.toFixed(2)).toBe(cod);
    expect(st?.transferInr.toFixed(2)).toBe('300.00');
    expect((await storeBalance(store.storeId)).toFixed(2)).toBe(st?.netInr.toFixed(2));
    // The seller: the transfer price, less its shares.
    expect(seller?.grossInr.toFixed(2)).toBe('300.00');
    expect((await sellerBalance()).toFixed(2)).toBe(seller?.netInr.toFixed(2));
    // Every fee's two shares add up, and the two nets are the channel credit.
    const tax = D(st?.taxShareInr ?? 0).add(seller?.taxShareInr ?? 0);
    const fees = D(st?.codFeeShareInr ?? 0)
      .add(seller?.codFeeShareInr ?? 0)
      .add(st?.instantFeeShareInr ?? 0)
      .add(seller?.instantFeeShareInr ?? 0);
    expect(
      D(st?.netInr ?? 0)
        .add(seller?.netInr ?? 0)
        .toFixed(2),
    ).toBe(D(cod).sub(tax).sub(fees).toFixed(2));
    const entries = await h.prisma.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId, direction: 'RESELLER_TRANSFER_CREDIT' },
    });
    expect(entries.map((e) => e.amount.toFixed(2))).toEqual(['300.00']);
    expect(await accountTotal()).toBe(cod);
    await expectBookAgrees([store.storeId]);

    // The same payout line recorded again credits nobody twice.
    await pay('1.00', [[orderId, '1.00']]).catch(() => undefined);
    expect(
      await h.prisma.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: 'RESELLER_TRANSFER_CREDIT' },
      }),
    ).toBe(1);
    await expectBookAgrees([store.storeId]);
  });

  it('RTO after the courier paid: its reversal on the next payout takes back both parties’ credits', async () => {
    const store = await makeStore();
    const a = (await placeOrder(store, 1)).body as { id: string };
    const b = (await placeOrder(store, 2)).body as { id: string };
    const codA = await codOf(a.id);
    const codB = await codOf(b.id);
    await confirm(a.id);
    await confirm(b.id);
    await deliver(a.id);
    await deliver(b.id);
    await pay(codA, [[a.id, codA]]);
    await expectBookAgrees([store.storeId]);

    // Payout 2 pays b and claws back a's COD: b − a lands.
    await pay(D(codB).sub(codA).toFixed(2), [[b.id, codB]], [[a.id, codA]]);
    expect((await creditsOf(a.id)).map((c) => c.status)).toEqual(['REVERSED', 'REVERSED']);
    const [sellerB, storeB] = await creditsOf(b.id);
    // Only b's credits stand.
    expect((await storeBalance(store.storeId)).toFixed(2)).toBe(storeB?.netInr.toFixed(2));
    expect((await sellerBalance()).toFixed(2)).toBe(sellerB?.netInr.toFixed(2));
    expect(await accountTotal()).toBe(codB);
    await expectBookAgrees([store.storeId]);
  });

  it('cancelled before dispatch: nothing is credited, nothing is held, and a prepaid order the wallet cannot cover is refused', async () => {
    const store = await makeStore();
    const placed = (await placeOrder(store, 1)).body as { id: string };
    await confirm(placed.id);
    await h.prisma.order.update({
      where: { id: placed.id },
      data: { status: OrderStatus.CANCELLED },
    });
    await h.app
      .get(ResellerOrderMoneyService)
      .onEnded(placed.id, { kind: 'CALLED_OFF', parcelLeft: false, note: 'Cancelled' });
    expect((await creditsOf(placed.id)).map((c) => `${c.status} ${c.skippedReason}`)).toEqual([
      'SKIPPED ORDER_CANCELLED',
      'SKIPPED ORDER_CANCELLED',
    ]);
    expect(
      await h.prisma.storeWalletEntry.count({
        where: { linkedOrderId: placed.id, direction: 'ORDER_CREDIT' },
      }),
    ).toBe(0);
    await expectBookAgrees([store.storeId]);

    // Prepaid is ON — and a store whose wallet cannot pay for the goods is refused.
    const prepaid = await placeOrder(store, 1, 'PREPAID');
    expect(prepaid.status).toBe(409);
    expect((prepaid.body as { code: string }).code).toBe('STORE_BALANCE_INSUFFICIENT');
  });

  /*
    ── THE ORDER CHANGED, AND THE MONEY FOLLOWED IT (owner, 2026-09-18) ──

    Seller staff may change a reseller store's order, and the window in
    which they may change its CONTENTS closes at CONFIRMATION
    (`CONTENTS_EDITABLE_STATUSES`): after it, stock is held, a waybill is
    booked and the parcel may already be packed, so what is IN it is
    fixed for both parties. Where it is GOING is a separate question with
    a separate answer.

    So the re-price is exercised where it can happen — before the call
    confirms the order — and the freeze afterwards is asserted BY NAME.
  */
  it('seller staff change the order before it is confirmed: the money is planned at the NEW figures', async () => {
    const store = await makeStore();
    const placed = (await placeOrder(store, 1)).body as { id: string };

    // A second unit, agreed on the call before the order is confirmed.
    // The seller may change the order outright now; what stays fixed is
    // the TERMS version and the line's snapshotted transfer price, so the
    // store's deal is not re-struck.
    const items = await h.prisma.orderItem.findMany({ where: { orderId: placed.id } });
    const edited = await request(h.baseUrl)
      .patch(`/seller/orders/${placed.id}`)
      .set(sellerAuth)
      .send({
        items: [{ variantId: items[0]!.variantId, quantity: 2, unitPriceInr: 499 }],
        codAmountInr: 998,
      });
    expect(edited.status).toBe(200);
    await drainAll(h.app);

    const line = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.id } });
    expect(line.quantity).toBe(2);
    // The kept line keeps the price it was PLACED at (RS-4).
    expect(line.resellerTransferPriceInr?.toFixed(2)).toBe('300.00');
    // Nothing is planned before confirmation, so there was nothing to
    // re-price — the plan below is simply made from the order as it now
    // stands.
    expect(await h.prisma.resellerOrderCredit.count({ where: { orderId: placed.id } })).toBe(0);

    await confirm(placed.id);
    const after = await creditsOf(placed.id);
    expect(after.map((c) => c.status)).toEqual(['WAITING', 'WAITING']);
    const sellerRow = after.find((c) => c.party === 'SELLER');
    expect(sellerRow?.grossInr.toFixed(2)).toBe('600.00');
    // The rates were stamped at the plan, so a later settings change
    // cannot move an order placed before it.
    expect(sellerRow?.gstPercentAtPlan).not.toBeNull();
    await expectBookAgrees([store.storeId]);

    // ── And now the window is SHUT, by name, for the same seller staff ──
    const frozen = await request(h.baseUrl)
      .patch(`/seller/orders/${placed.id}`)
      .set(sellerAuth)
      .send({ items: [{ variantId: items[0]!.variantId, quantity: 3, unitPriceInr: 499 }] });
    expect(frozen.status).toBe(409);
    expect((frozen.body as { code: string }).code).toBe('NOT_EDITABLE');
    // Refused means refused: the line, the COD and the plan are untouched.
    expect(
      (await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.id } })).quantity,
    ).toBe(2);
    expect(
      (await creditsOf(placed.id)).find((c) => c.party === 'SELLER')?.grossInr.toFixed(2),
    ).toBe('600.00');

    // Paid at the figures that were planned, and the book agrees at the paisa.
    const cod = await codOf(placed.id);
    expect(cod).toBe('998.00');
    await deliver(placed.id);
    await pay(cod, [[placed.id, cod]]);
    const paid = await creditsOf(placed.id);
    expect(paid.map((c) => c.status)).toEqual(['CREDITED', 'CREDITED']);
    expect((await sellerBalance()).toFixed(2)).toBe(
      paid.find((c) => c.party === 'SELLER')?.netInr.toFixed(2),
    );
    await expectBookAgrees([store.storeId]);
  });

  it('money already PAID is never re-worked-out: refused by name, nothing written, audited HIGH', async () => {
    /*
      This cannot be reached through `edit` — the contents freeze at
      confirmation and a reseller credit runs at or after delivery, so by
      the time money exists there is nothing left to change that moves it.
      The only way in is god mode putting a paid order back into a
      contents-editable status, which is a bypass by definition.

      Two things make refusing the right answer rather than a missing
      feature, and this pins both. Nine wallet directions may occur at
      most ONCE per order (`seller_wallet_entries_once_per_order_uq` —
      the double-credit guard), so reversing and re-writing a credit is
      something the DATABASE refuses; and a half-re-priced plan is worse
      than an unchanged one, so the whole transaction rolls back.

      Driven at the service, because that is the only place the bypass
      can arrive from.
    */
    const store = await makeStore();
    const placed = (await placeOrder(store, 1)).body as { id: string };
    await confirm(placed.id);
    const cod = await codOf(placed.id);
    await deliver(placed.id);
    await pay(cod, [[placed.id, cod]]);
    const credited = await creditsOf(placed.id);
    expect(credited.map((c) => c.status)).toEqual(['CREDITED', 'CREDITED']);
    const was = {
      store: (await storeBalance(store.storeId)).toFixed(2),
      seller: (await sellerBalance()).toFixed(2),
      storeNet: credited.find((c) => c.party === 'STORE')?.netInr.toFixed(2),
      sellerNet: credited.find((c) => c.party === 'SELLER')?.netInr.toFixed(2),
    };

    // An order that did not move is a no-op, not a refusal — a form
    // round-trips every field it renders, and pressing save must not
    // raise anything.
    const unmoved = await h.app
      .get(ResellerOrderMoneyService)
      .recalculateAfterEdit(placed.id, { reason: 'Nothing actually changed' });
    expect(unmoved.outcome).toBe('UNCHANGED');
    expect((await storeBalance(store.storeId)).toFixed(2)).toBe(was.store);

    // Now the bypass: the COD is moved underneath a credit already paid.
    await h.prisma.order.update({
      where: { id: placed.id },
      data: { codAmountInr: new Prisma.Decimal('1996.00') },
    });
    const failed = await h.app
      .get(ResellerOrderMoneyService)
      .recalculateAfterEdit(placed.id, { reason: 'Seller corrected the amount' })
      .then(
        () => null,
        (e: unknown) => e as HttpException,
      );
    expect(failed).not.toBeNull();
    expect(failed?.getResponse()).toMatchObject({ code: 'RESELLER_CREDIT_ALREADY_PAID' });

    // NOTHING was written: no reversal, no second credit, no moved
    // balance, and both plans still say what they were paid.
    expect(
      await h.prisma.storeWalletEntry.count({
        where: {
          linkedOrderId: placed.id,
          direction: { in: ['ORDER_CREDIT_REVERSAL', 'SHARE_REFUND'] },
        },
      }),
    ).toBe(0);
    expect(
      await h.prisma.storeWalletEntry.count({
        where: { linkedOrderId: placed.id, direction: 'ORDER_CREDIT' },
      }),
    ).toBe(1);
    expect((await storeBalance(store.storeId)).toFixed(2)).toBe(was.store);
    expect((await sellerBalance()).toFixed(2)).toBe(was.seller);
    const still = await creditsOf(placed.id);
    expect(still.map((c) => c.status)).toEqual(['CREDITED', 'CREDITED']);
    expect(still.find((c) => c.party === 'STORE')?.netInr.toFixed(2)).toBe(was.storeNet);
    expect(still.find((c) => c.party === 'SELLER')?.netInr.toFixed(2)).toBe(was.sellerNet);
    expect(still.every((c) => c.timesRepriced === 0)).toBe(true);
    await expectBookAgrees([store.storeId]);

    // And a person is told — the audit survives the rolled-back
    // transaction because it is written outside it.
    const audited = await h.prisma.auditLog.findFirst({
      where: { action: 'reseller_order.money_recalculation_refused', entityId: placed.id },
      select: { severity: true },
    });
    expect(audited?.severity).toBe('HIGH');
  });

  it('once the COURIER holds the address, neither party may write it — they must ask', async () => {
    /*
      "Never store an address the parcel is not going to" (owner answer B).

      The routing question is a FACT, not a status list: does anybody
      outside this building already hold this address? A waybill IS that
      fact, so this stamps one and checks that BOTH the seller's edit and
      the store's are refused by name, that the refusal points at the
      endpoint that asks the courier, and that the stored address did not
      move.
    */
    const store = await makeStore();
    const placed = (await placeOrder(store, 1)).body as { id: string };
    await confirm(placed.id);
    await h.prisma.shipment.updateMany({
      where: { orderShipments: { some: { orderId: placed.id } } },
      data: { awbNumber: `E2E${Date.now()}`, status: 'IN_TRANSIT' },
    });
    await h.prisma.order.update({
      where: { id: placed.id },
      data: { status: OrderStatus.IN_TRANSIT },
    });
    const was = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.id } });

    for (const [who, auth, path] of [
      ['seller', sellerAuth, `/seller/orders/${placed.id}`],
      ['store', store.auth, `/store/orders/${placed.id}/recipient`],
    ] as const) {
      const res = await request(h.baseUrl)
        .patch(path)
        .set(auth)
        .send({ recipientAddressLine1: '99 Somewhere Else' });
      expect([409, 403]).toContain(res.status);
      expect((res.body as { code: string }).code).toBe('COURIER_MUST_ACCEPT_ADDRESS_CHANGE');
      // It names where to go instead, rather than just saying no.
      expect(JSON.stringify(res.body)).toContain('consignee');
      expect(who).toBeTruthy();
    }

    const still = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(still.recipientAddressLine1).toBe(was.recipientAddressLine1);

    // With NO waybill the same edit is ours to write — the fact, not the
    // status, is what decides.
    await h.prisma.shipment.updateMany({
      where: { orderShipments: { some: { orderId: placed.id } } },
      data: { awbNumber: null },
    });
    await request(h.baseUrl)
      .patch(`/seller/orders/${placed.id}`)
      .set(sellerAuth)
      .send({ recipientAddressLine1: '99 Somewhere Else' })
      .expect(200);
    const moved = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(moved.recipientAddressLine1).toBe('99 Somewhere Else');
    // …and the CONTENTS still cannot change after confirmation, for
    // either party. That limit is real and did not move.
    const items = await h.prisma.orderItem.findMany({ where: { orderId: placed.id } });
    const contents = await request(h.baseUrl)
      .patch(`/seller/orders/${placed.id}`)
      .set(sellerAuth)
      .send({ items: [{ variantId: items[0]!.variantId, quantity: 5, unitPriceInr: 499 }] });
    expect(contents.status).toBe(409);
    expect((contents.body as { code: string }).code).toBe('NOT_EDITABLE');
  });

  it('a priced order’s payment mode cannot change — refused by name, nothing written', async () => {
    // COD and PREPAID are not two amounts of one thing: different rows,
    // a different debit, different deductions. Turning one into the
    // other once the plan exists means guessing, so it is refused.
    const store = await makeStore();
    const placed = (await placeOrder(store, 1)).body as { id: string };
    await confirm(placed.id);
    const res = await request(h.baseUrl)
      .patch(`/seller/orders/${placed.id}`)
      .set(sellerAuth)
      .send({ paymentMode: 'PREPAID' });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('RESELLER_PAYMENT_MODE_LOCKED');
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(row.paymentMode).toBe('COD');
  });
});
