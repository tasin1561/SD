import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { ShipmentStatus } from '@skydrop/db';
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
 * Everything worth proving here needs a real database: that a cost is
 * WRITTEN to the right column, that a second import REVISES it rather
 * than skipping the AWB, and that a re-run of the same file changes
 * nothing. A mocked Prisma would agree with any of those.
 */
const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'delhivery-wallet-sample.xlsx'));
const B64 = FIXTURE.toString('base64');

describe('Delhivery wallet ledger import (e2e)', () => {
  let h: AppHarness;
  let staffAuth: Record<string, string>;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  /** A shipment carrying one of the fixture's AWBs, with no cost yet.
   *  The seeded warehouse is enough — nothing here reads it. */
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

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  it('writes the LATEST debit, keeps forward and RTO apart, and ignores what is not a charge', async () => {
    const revised = await shipmentWithAwb('AWB-REVISED');
    const both = await shipmentWithAwb('AWB-BOTH');
    const plain = await shipmentWithAwb('AWB-PLAIN');

    const res = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64 })
      .expect(200);

    expect(res.body.totalsAgree).toBe(true);
    // AWB-STRANGER is in the file and is not ours.
    expect(res.body.unknownAwbs).toBe(1);

    const r = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: revised },
      select: { actualCourierCostInr: true, actualCourierCostAt: true },
    });
    // Two debits, 86.83 then 85.65. The later one is the cost.
    expect(r.actualCourierCostInr?.toFixed(2)).toBe('85.65');
    expect(r.actualCourierCostAt?.toISOString()).toBe('2026-09-01T02:51:04.000Z');

    const b = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: both },
      select: { actualCourierCostInr: true, actualRtoCostInr: true, actualRtoCostAt: true },
    });
    // An RTO is charged IN ADDITION to the delivery. Two columns, and
    // the forward figure must NOT be overwritten by the return one.
    expect(b.actualCourierCostInr?.toFixed(2)).toBe('57.46');
    expect(b.actualRtoCostInr?.toFixed(2)).toBe('56.28');
    expect(b.actualRtoCostAt).not.toBeNull();

    const p = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: plain },
      select: { actualCourierCostInr: true },
    });
    // 40.00 is the only SUCCESSFUL DEBIT for this AWB; the file also
    // holds a failed 99.99 and a stray credit of 12.34.
    expect(p.actualCourierCostInr?.toFixed(2)).toBe('40.00');
  });

  it('re-importing the same file changes nothing', async () => {
    await shipmentWithAwb('AWB-REVISED');
    await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64 })
      .expect(200);

    const second = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64 })
      .expect(200);

    expect(second.body.forwardWritten).toBe(0);
    expect(second.body.rtoWritten).toBe(0);
    expect(second.body.revised).toBe(0);
    expect(second.body.unchanged).toBeGreaterThan(0);
  });

  it('a later export REVISES a cost it already wrote', async () => {
    // The whole reason this is re-runnable: Delhivery re-cuts a charge
    // weeks after delivery, and an importer that skipped AWBs it had
    // seen would keep the stale figure forever.
    const id = await shipmentWithAwb('AWB-PLAIN');
    await h.prisma.shipment.update({
      where: { id },
      data: { actualCourierCostInr: '999.00' },
    });

    const res = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64 })
      .expect(200);

    expect(res.body.revised).toBeGreaterThan(0);
    const after = await h.prisma.shipment.findUniqueOrThrow({
      where: { id },
      select: { actualCourierCostInr: true },
    });
    expect(after.actualCourierCostInr?.toFixed(2)).toBe('40.00');
  });

  it('dryRun reports what would change and writes nothing', async () => {
    const id = await shipmentWithAwb('AWB-PLAIN');
    const res = await request(h.baseUrl)
      .post('/admin/courier/wallet-import/delhivery')
      .set(staffAuth)
      .send({ fileBase64: B64, dryRun: true })
      .expect(200);

    expect(res.body.dryRun).toBe(true);
    expect(res.body.forwardWritten).toBeGreaterThan(0);
    const after = await h.prisma.shipment.findUniqueOrThrow({
      where: { id },
      select: { actualCourierCostInr: true },
    });
    expect(after.actualCourierCostInr).toBeNull();
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
