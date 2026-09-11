import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  CourierWalletTxnCategory,
  CourierWalletTxnKind,
  CourierWalletTxnLeg,
  CredentialEnvironment,
  ShipmentStatus,
} from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Importing what Delhivery actually charged (the wallet ledger).
 *
 * A parcel's cost is the NET of its transactions — debits minus credits
 * — netted from OUR stored ledger, not from the file. Everything worth
 * proving here needs a real database: that transactions are stored
 * under the courier's own id and never twice, that a re-import inserts
 * nothing, that a transaction their ledger has since DROPPED is caught
 * and stops counting, and that one they have since CHANGED is reported
 * rather than applied. A mocked Prisma has no unique index to violate
 * and no rows to go missing.
 *
 * The fixture (`delhivery-wallet-sample.xlsx`):
 *   AWB-REVISED  debit 100.00, credit 100.00, debit 85.65   → 85.65
 *   AWB-BOTH     debit 57.46 (forward), debit 56.28 (RTO)   → 57.46 / 56.28
 *   AWB-ZERO     debit 60.04, credit 60.04                  → 0.00
 *   AWB-PLAIN    debit 40.00; a FAILED 99.99; a 58.83 adjustment → 40.00
 *   (no AWB)     a 1,290.00 lost-shipment credit note (adjustment)
 */
const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'delhivery-wallet-sample.xlsx'));
const B64 = FIXTURE.toString('base64');

describe('Delhivery wallet ledger import (e2e)', () => {
  let h: AppHarness;
  let staffAuth: Record<string, string>;
  let accountId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });

  afterAll(async () => {
    // Transactions FIRST: they reference the account with RESTRICT. A
    // row left behind would become the default for a later suite.
    await h.prisma.courierWalletTransaction.deleteMany({ where: { courierAccountId: accountId } });
    await h.prisma.courierAccount.deleteMany({ where: { id: accountId } });
    await h.close();
  });

  /** A shipment carrying one of the fixture's AWBs, with no cost yet. */
  async function shipmentWithAwb(awb: string): Promise<string> {
    const wh = await h.prisma.warehouse.findFirstOrThrow({ select: { id: true } });
    const s = await h.prisma.shipment.create({
      data: {
        shipmentNumber: `SH-WI-${Math.random().toString(36).slice(2, 10)}`,
        courierCode: 'delhivery',
        awbNumber: awb,
        status: ShipmentStatus.AWB_GENERATED,
        originWarehouseId: wh.id,
        totalWeightGrams: 250,
        declaredValueInr: '999.00',
        destRecipientName: 'Asha',
        destRecipientPhoneE164: '+919876543210',
        destAddressLine1: '12 MG Road',
        destCity: 'Bengaluru',
        destStateProvince: 'Karnataka',
        destPostalCode: '560001',
        destCountryCode: 'IN',
      },
      select: { id: true },
    });
    return s.id;
  }

  async function cost(id: string): Promise<{ fwd: string | null; rto: string | null }> {
    const s = await h.prisma.shipment.findUniqueOrThrow({
      where: { id },
      select: { actualCourierCostInr: true, actualRtoCostInr: true },
    });
    return {
      fwd: s.actualCourierCostInr?.toFixed(2) ?? null,
      rto: s.actualRtoCostInr?.toFixed(2) ?? null,
    };
  }

  const importFile = (extra: Record<string, unknown> = {}) =>
    request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64, ...extra });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    // A DEFAULT account, because that is what the manual upload resolves
    // when it is not told one — and the import refuses outright without
    // one. Created per test, AFTER the reset: resetPhase1bState truncates
    // platform_bank_accounts with CASCADE, and courier_accounts references
    // it, so an account made once in beforeAll is gone by the first test.
    const courier = await h.prisma.courier.findFirstOrThrow({
      where: { code: 'delhivery' },
      select: { id: true },
    });
    const acct = await h.prisma.courierAccount.create({
      data: {
        courierId: courier.id,
        environment: CredentialEnvironment.PRODUCTION,
        label: 'Delhivery — wallet e2e',
        isDefault: true,
        isActive: true,
      },
      select: { id: true },
    });
    accountId = acct.id;
  });

  it('a parcel costs its debits MINUS its credits — not the latest debit', async () => {
    const revised = await shipmentWithAwb('AWB-REVISED');
    const both = await shipmentWithAwb('AWB-BOTH');
    const zero = await shipmentWithAwb('AWB-ZERO');
    const plain = await shipmentWithAwb('AWB-PLAIN');

    const res = await importFile().expect(200);

    expect(res.body.totalsAgree).toBe(true);
    expect(res.body.unknownAwbs).toBe(0);

    // Charged, reversed, charged again: what is left.
    expect((await cost(revised)).fwd).toBe('85.65');
    // Charged and fully reversed. Latest-debit booked this at full
    // freight; the parcel cost nothing.
    expect((await cost(zero)).fwd).toBe('0.00');
    // Forward and return are two columns, never one (TRE-6).
    expect(await cost(both)).toEqual({ fwd: '57.46', rto: '56.28' });
    // The failed 99.99 is not money, and the 58.83 reconciliation is an
    // ACCOUNT cost even though it names this waybill.
    expect((await cost(plain)).fwd).toBe('40.00');

    const r = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: revised },
      select: { actualCourierCostAt: true },
    });
    // The latest transaction for the parcel: 2026-09-01 10:00 IST.
    expect(r.actualCourierCostAt?.toISOString()).toBe('2026-09-01T04:30:00.000Z');
  });

  it('stores every transaction under the default account, and reports the adjustments apart', async () => {
    await shipmentWithAwb('AWB-PLAIN');

    const res = await importFile().expect(200);

    // Ten successful rows; the failed one is not stored as money.
    expect(res.body.txnsNew).toBe(10);
    expect(
      await h.prisma.courierWalletTransaction.count({ where: { courierAccountId: accountId } }),
    ).toBe(10);
    // The 58.83 recon debit and the 1,290 credit note: account-level.
    expect(res.body.adjustments).toBe(2);
    expect(res.body.adjustmentsNetInr).toBe('-1231.17');
    const noAwb = await h.prisma.courierWalletTransaction.findFirstOrThrow({
      where: { courierAccountId: accountId, awbNumber: null },
    });
    expect(noAwb.category).toBe(CourierWalletTxnCategory.ADJUSTMENT);
  });

  it('re-importing the same file inserts nothing and changes nothing', async () => {
    await shipmentWithAwb('AWB-REVISED');
    await importFile().expect(200);

    const second = await importFile().expect(200);

    // Their txn id is the identity: every row is recognised.
    expect(second.body.txnsNew).toBe(0);
    expect(second.body.txnsAlreadyHeld).toBe(10);
    expect(second.body.forwardWritten).toBe(0);
    expect(second.body.revised).toBe(0);
    expect(second.body.unchanged).toBeGreaterThan(0);
    expect(
      await h.prisma.courierWalletTransaction.count({ where: { courierAccountId: accountId } }),
    ).toBe(10);
  });

  it('a later import REVISES a cost, and records what it was before', async () => {
    const id = await shipmentWithAwb('AWB-PLAIN');
    await h.prisma.shipment.update({ where: { id }, data: { actualCourierCostInr: '999.00' } });

    const res = await importFile().expect(200);

    expect(res.body.revised).toBeGreaterThan(0);
    expect((await cost(id)).fwd).toBe('40.00');
    // Before→after is what a dispute is argued from; the old figure must
    // survive the overwrite somewhere.
    const w = (res.body.writes as Array<{ awbNumber: string; previousInr: string | null }>).find(
      (x) => x.awbNumber === 'AWB-PLAIN',
    );
    expect(w?.previousInr).toBe('999');
  });

  it('a transaction their ledger has DROPPED is caught, kept, and no longer counted', async () => {
    const id = await shipmentWithAwb('AWB-PLAIN');
    // We recorded a ₹500 debit dated inside the span this file covers.
    // The file does not contain it — the 7-Sep shape seen on production.
    await h.prisma.courierWalletTransaction.create({
      data: {
        courierAccountId: accountId,
        txnId: 'MTX-VANISHED',
        awbNumber: 'AWB-PLAIN',
        kind: CourierWalletTxnKind.DEBIT,
        category: CourierWalletTxnCategory.PARCEL,
        leg: CourierWalletTxnLeg.FORWARD,
        amountInr: '500.00',
        occurredAt: new Date('2026-08-25T00:00:00Z'),
        status: 'success',
        shipmentStatus: 'Delivered',
      },
    });

    const res = await importFile().expect(200);

    expect(res.body.txnsMissing).toBe(1);
    expect(res.body.missing[0]?.txnId).toBe('MTX-VANISHED');
    // Kept as evidence…
    const gone = await h.prisma.courierWalletTransaction.findFirstOrThrow({
      where: { courierAccountId: accountId, txnId: 'MTX-VANISHED' },
    });
    expect(gone.missingFromExportAt).not.toBeNull();
    // …but not counted: the export still balances to the wallet without it.
    expect((await cost(id)).fwd).toBe('40.00');
  });

  it('a transaction they have CHANGED is reported, and our copy is not rewritten', async () => {
    await shipmentWithAwb('AWB-PLAIN');
    // We hold TX6 at ₹41.00; the file now says ₹40.00 under the same id.
    await h.prisma.courierWalletTransaction.create({
      data: {
        courierAccountId: accountId,
        txnId: 'TX6',
        awbNumber: 'AWB-PLAIN',
        kind: CourierWalletTxnKind.DEBIT,
        category: CourierWalletTxnCategory.PARCEL,
        leg: CourierWalletTxnLeg.FORWARD,
        amountInr: '41.00',
        occurredAt: new Date('2026-08-20T04:30:00Z'),
        status: 'success',
        shipmentStatus: 'Delivered',
      },
    });

    const res = await importFile().expect(200);

    expect(res.body.txnsMutated).toBe(1);
    expect(res.body.mutated[0]).toMatchObject({
      txnId: 'TX6',
      ourAmountInr: '41',
      theirAmountInr: '40.00',
    });
    const held = await h.prisma.courierWalletTransaction.findFirstOrThrow({
      where: { courierAccountId: accountId, txnId: 'TX6' },
    });
    expect(held.amountInr.toFixed(2)).toBe('41.00');
  });

  it('dryRun reports what would change and writes NOTHING — not even the ledger', async () => {
    const id = await shipmentWithAwb('AWB-PLAIN');

    const res = await importFile({ dryRun: true }).expect(200);

    expect(res.body.dryRun).toBe(true);
    expect(res.body.forwardWritten).toBeGreaterThan(0);
    expect((await cost(id)).fwd).toBeNull();
    expect(
      await h.prisma.courierWalletTransaction.count({ where: { courierAccountId: accountId } }),
    ).toBe(0);
  });

  it('refuses a file that is not a wallet export', async () => {
    const res = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: Buffer.from('definitely not a spreadsheet').toString('base64') })
      .expect(400);
    expect(res.body.code).toBe('LEDGER_UNREADABLE');
  });

  it('needs treasury permission — a courier role is not enough', async () => {
    const res = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .send({ fileBase64: B64 })
      .expect(401);
    expect(res.body.code).toBeDefined();
  });
});
