import request from 'supertest';
import { SellerStatus } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

describe('Module 2 (e2e): onboarding flow + suspension + addresses + prefs', () => {
  let h: AppHarness;
  let staffAccess: string;
  let inviteEmail: string;

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
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAccess = login.body.accessToken as string;
    inviteEmail = `module2-${Date.now()}@brand.com`;
  });

  async function registerSeller() {
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);

    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara Khan',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);
    return reg.body as { accessToken: string; seller: { id: string; email: string } };
  }

  it('full onboarding flow: register → profile incomplete → add BD_ORIGIN → onboarding complete + email logged', async () => {
    const reg = await registerSeller();

    // 7 preference rows pre-seeded
    const prefs = await request(h.baseUrl)
      .get('/seller/notification-preferences')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(200);
    expect(prefs.body).toHaveLength(7);
    expect(prefs.body[0].timezone).toBe('Asia/Dhaka');

    // 8 onboarding rows initialized, REGISTRATION + COMPANY_INFO done
    const profile1 = await request(h.baseUrl)
      .get('/seller/profile')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(200);
    expect(profile1.body.onboarding.isComplete).toBe(false);
    // EMAIL_VERIFIED is ALREADY satisfied — registering through the
    // emailed invitation link is itself proof of email ownership, so
    // `register/invite` stamps SellerUser.emailVerifiedAt and marks the
    // onboarding step in the same tx. Only the BD origin address is
    // outstanding at this point.
    expect(profile1.body.onboarding.missingRequired).toEqual(
      expect.arrayContaining(['BD_ORIGIN_ADDRESS_ADDED']),
    );
    expect(profile1.body.onboarding.missingRequired).not.toContain('EMAIL_VERIFIED');

    // Re-requesting verification is a conflict, not a new round trip.
    const reRequest = await request(h.baseUrl)
      .post('/auth/seller/email-verification/request')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(409);
    expect(reRequest.body.code).toBe('ALREADY_VERIFIED');

    // Still missing BD_ORIGIN
    const profile2 = await request(h.baseUrl)
      .get('/seller/profile')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(200);
    expect(profile2.body.onboarding.missingRequired).toEqual(['BD_ORIGIN_ADDRESS_ADDED']);

    // Create BD_ORIGIN address — finishes onboarding
    await request(h.baseUrl)
      .post('/seller/addresses')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({
        type: 'BD_ORIGIN',
        contactName: 'Warehouse',
        contactPhone: '+8801712345678',
        line1: '12 Industrial Park',
        city: 'Dhaka',
        stateProvince: 'Dhaka',
        postalCode: '1212',
      })
      .expect(201);

    const profile3 = await request(h.baseUrl)
      .get('/seller/profile')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(200);
    expect(profile3.body.onboarding.isComplete).toBe(true);
    expect(profile3.body.onboarding.missingRequired).toEqual([]);

    // onboarding-complete email fired
    await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: {
            templateCode: 'seller.onboarding_complete.email',
            recipientId: reg.seller.id,
          },
        }),
      { description: 'onboarding-complete log' },
    );
  });

  it('admin suspend: seller can still GET /profile (allow-suspended); PATCH /profile returns 403; reapprove restores', async () => {
    const reg = await registerSeller();

    // Admin lists shows the new seller
    const list = await request(h.baseUrl)
      .get('/admin/sellers?pageSize=50')
      .set('Authorization', `Bearer ${staffAccess}`)
      .expect(200);
    expect(list.body.items.some((s: { id: string }) => s.id === reg.seller.id)).toBe(true);

    // Suspend with a reason
    await request(h.baseUrl)
      .patch(`/admin/sellers/${reg.seller.id}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ newStatus: SellerStatus.SUSPENDED, reasonNote: 'audit follow-up' })
      .expect(200);

    // Refresh tokens revoked → re-login required. Seller still can log in (SUSPENDED accepted).
    const reloggedIn = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(200);
    const susAccess = reloggedIn.body.accessToken as string;

    // Allow-suspended GET works
    const me = await request(h.baseUrl)
      .get('/seller/profile')
      .set('Authorization', `Bearer ${susAccess}`)
      .expect(200);
    expect(me.body.status).toBe(SellerStatus.SUSPENDED);

    // Write endpoint blocked by guard default
    await request(h.baseUrl)
      .patch('/seller/profile')
      .set('Authorization', `Bearer ${susAccess}`)
      .send({ companyName: 'Renamed' })
      .expect(403);

    // Suspension email was logged
    await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: {
            templateCode: 'seller.account_suspended.email',
            recipientId: reg.seller.id,
          },
        }),
      { description: 'suspension email log' },
    );

    // COMPLIANCE note created and pinned
    const note = await h.prisma.sellerNote.findFirst({
      where: { sellerId: reg.seller.id, category: 'COMPLIANCE', isPinned: true },
    });
    expect(note).toBeTruthy();
    expect(note!.content).toBe('audit follow-up');

    // Reapprove
    await request(h.baseUrl)
      .patch(`/admin/sellers/${reg.seller.id}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ newStatus: SellerStatus.APPROVED })
      .expect(200);

    const reloggedAgain = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(200);
    await request(h.baseUrl)
      .patch('/seller/profile')
      .set('Authorization', `Bearer ${reloggedAgain.body.accessToken}`)
      .send({ companyName: 'Brand Co Updated' })
      .expect(200);
  });

  it('default address: second BD_ORIGIN with isDefault=true flips the first', async () => {
    const reg = await registerSeller();

    const first = await request(h.baseUrl)
      .post('/seller/addresses')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({
        type: 'BD_ORIGIN',
        contactName: 'First Origin',
        contactPhone: '+8801712345678',
        line1: '1 First St',
        city: 'Dhaka',
        stateProvince: 'Dhaka',
        postalCode: '1212',
      })
      .expect(201);
    expect(first.body.isDefault).toBe(true);

    const second = await request(h.baseUrl)
      .post('/seller/addresses')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .send({
        type: 'BD_ORIGIN',
        contactName: 'Second Origin',
        contactPhone: '+8801712345678',
        line1: '2 Second St',
        city: 'Dhaka',
        stateProvince: 'Dhaka',
        postalCode: '1212',
        isDefault: true,
      })
      .expect(201);
    expect(second.body.isDefault).toBe(true);

    const list = await request(h.baseUrl)
      .get('/seller/addresses')
      .set('Authorization', `Bearer ${reg.accessToken}`)
      .expect(200);
    const firstReloaded = list.body.find(
      (a: { id: string }) => a.id === first.body.id,
    );
    expect(firstReloaded.isDefault).toBe(false);
  });

  it('admin onboarding override: marks step + audit captures admin actor', async () => {
    const reg = await registerSeller();

    await request(h.baseUrl)
      .post(`/admin/sellers/${reg.seller.id}/onboarding/BANK_DETAILS_ADDED/override`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ reason: 'KYC confirmed offline' })
      .expect(200);

    const progress = await request(h.baseUrl)
      .get(`/admin/sellers/${reg.seller.id}/onboarding`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .expect(200);
    const bank = progress.body.steps.find(
      (s: { stepCode: string }) => s.stepCode === 'BANK_DETAILS_ADDED',
    );
    expect(bank.completedAt).not.toBeNull();
    expect(bank.completedBy).toBe('ADMIN');

    const audit = await h.prisma.auditLog.findFirst({
      where: { action: 'staff.seller_onboarding.step_overridden' },
    });
    expect(audit).toBeTruthy();
    expect((audit!.metadata as { stepCode: string }).stepCode).toBe(
      'BANK_DETAILS_ADDED',
    );
  });
});
