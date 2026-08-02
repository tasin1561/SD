import request from 'supertest';
import { StaffRole } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Money going INTO the wallet.
 *
 * Before this existed, a seller shipping prepaid orders accrued nothing
 * but debits — delivery fees, inbound freight, returns — and had no way
 * to settle them. The balance went negative and stayed there.
 *
 * The load-bearing property is that a CLAIM is not a PAYMENT. Crediting
 * on submission would let anyone raise their own balance by filling in a
 * form; the reversal on rejection would land after they had already
 * withdrawn against it. Every test below is really about that.
 */
describe('Wallet top-up flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let sellerId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const email = `topup-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Topup Brand',
        contactPersonName: 'Topup Owner',
        phone: '+8801712345688',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };
    sellerId = reg.body.seller.id as string;

    const bank = await request(h.baseUrl)
      .post('/admin/platform-bank-accounts')
      .set(staffAuth)
      .send({
        label: 'HDFC — current',
        bankName: 'HDFC Bank',
        accountName: 'Skydrop Logistics Pvt Ltd',
        accountNumber: '50200012345678',
        branchCode: 'HDFC0001234',
        currency: 'INR',
        instructions: 'Put your seller code in the transfer remark.',
      })
      .expect(201);
    bankAccountId = bank.body.id as string;
  });

  async function balance(): Promise<number> {
    const entries = await h.prisma.sellerWalletEntry.findMany({ where: { sellerId } });
    return entries.reduce(
      (n, e) => n + (['TOPUP', 'COD_COLLECTION'].includes(e.direction) ? 1 : -1) * Number(e.amount),
      0,
    );
  }

  it('a claim is not a payment: submitting credits nothing', async () => {
    const res = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({ bankAccountId, amount: 5000, transactionRef: 'UTR123456789' })
      .expect(201);
    expect(res.body.status).toBe('PENDING');

    // The whole point. If this were non-zero, anyone could raise their
    // balance with a form.
    expect(await balance()).toBe(0);
  });

  it('refuses a claim with no reference and no proof', async () => {
    const res = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({ bankAccountId, amount: 5000 })
      .expect(400);
    // Without one there is nothing to match against the bank statement.
    expect(res.body.code).toBe('PROOF_REQUIRED');
  });

  it('refuses a proof key from another seller namespace', async () => {
    const res = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({
        bankAccountId,
        amount: 5000,
        proofSpacesKey: 'topups/019fad84-0000-7000-8000-000000000000/stolen.png',
      })
      .expect(400);
    // Otherwise a seller could attach — and then read back through the
    // presigned download — another seller's bank screenshot.
    expect(res.body.code).toBe('INVALID_PROOF_KEY');
  });

  it('accepting credits the wallet exactly once, even under a double click', async () => {
    const sub = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({ bankAccountId, amount: 5000, transactionRef: 'UTR123456789' })
      .expect(201);
    const topupId = sub.body.id as string;

    await request(h.baseUrl)
      .post(`/admin/wallet/topups/${topupId}/accept`)
      .set(staffAuth)
      .send({ note: 'Found on the 2nd Aug statement' })
      .expect(200);

    expect(await balance()).toBe(5000);
    const entries = await h.prisma.sellerWalletEntry.findMany({
      where: { sellerId, direction: 'TOPUP' },
    });
    expect(entries).toHaveLength(1);

    // The status claim is a guarded updateMany, not a read-then-write,
    // so a second reviewer cannot mint a second credit.
    const again = await request(h.baseUrl)
      .post(`/admin/wallet/topups/${topupId}/accept`)
      .set(staffAuth)
      .send({})
      .expect(409);
    expect(again.body.code).toBe('TOPUP_ALREADY_REVIEWED');
    expect(await balance()).toBe(5000);
  });

  it('rejecting credits nothing and tells the seller why', async () => {
    const sub = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({ bankAccountId, amount: 5000, transactionRef: 'NOT-A-REAL-UTR' })
      .expect(201);

    const rejected = await request(h.baseUrl)
      .post(`/admin/wallet/topups/${sub.body.id}/reject`)
      .set(staffAuth)
      .send({ reason: 'No credit matching this reference on our statement' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(await balance()).toBe(0);

    // The seller can see the reason — "rejected" alone is not actionable.
    const mine = await request(h.baseUrl).get('/seller/wallet/topups').set(sellerAuth).expect(200);
    expect(mine.body[0].reviewNote).toContain('No credit matching');
  });

  it('a bare rejection is refused — the seller has to be told something', async () => {
    const sub = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({ bankAccountId, amount: 100, transactionRef: 'X' })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/wallet/topups/${sub.body.id}/reject`)
      .set(staffAuth)
      .send({ reason: 'no' })
      .expect(400);
  });

  it('never returns the proof storage key, only whether one exists', async () => {
    const sub = await request(h.baseUrl)
      .post('/seller/wallet/topups')
      .set(sellerAuth)
      .send({
        bankAccountId,
        amount: 250,
        proofSpacesKey: `topups/${sellerId}/proof.png`,
        proofMimeType: 'image/png',
      })
      .expect(201);
    // The key stays server-side; a caller asks for a short-lived
    // presigned read when they actually want to look at it. Storing or
    // handing out a durable URL is what made every object in the bucket
    // world-readable before the 2026-07-28 storage pass.
    expect(sub.body.proofSpacesKey).toBeUndefined();
    expect(sub.body.hasProof).toBe(true);
  });
});
