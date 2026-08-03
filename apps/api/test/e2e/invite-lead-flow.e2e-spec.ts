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
 * Asking to be let into the beta.
 *
 * The landing page used to open a `mailto:` link — a chooser dialog on
 * desktop, and on a phone with no mail account, nothing at all. Every
 * person who did not complete that handoff was lost silently.
 *
 * This is the one open, unauthenticated WRITE in the product, so most
 * of what is asserted here is about what it refuses to become: it
 * cannot create anything that logs in, it cannot be used to tell whether
 * an address is already known, and a repeat submission cannot flood the
 * queue with copies of one person.
 */
describe('Invite leads (e2e)', () => {
  let h: AppHarness;
  let adminAuth: { Authorization: string };

  const LEAD = {
    fullName: 'Rahim Uddin',
    companyName: 'Dhaka Threads',
    email: 'rahim@dhakathreads.test',
    phone: '+880 1712 345678',
    productTypes: 'Womenswear',
    monthlyOrders: '100-500',
    message: 'We ship about 300 a month to Kolkata.',
  };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function loginAs(role: StaffRole): Promise<{ Authorization: string }> {
    const staff = await createTestStaff(h.prisma, { role });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    return { Authorization: `Bearer ${login.body.accessToken}` };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    await h.prisma.inviteLead.deleteMany({});
    adminAuth = await loginAs(StaffRole.SUPER_ADMIN);
  });

  it('records a request from an anonymous visitor', async () => {
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);

    const row = await h.prisma.inviteLead.findUniqueOrThrow({
      where: { email: LEAD.email },
    });
    expect(row.companyName).toBe('Dhaka Threads');
    expect(row.status).toBe('NEW');
    expect(row.submissionCount).toBe(1);
  });

  it('lower-cases the address, so one person is one row', async () => {
    await request(h.baseUrl)
      .post('/public/invite-leads')
      .send({ ...LEAD, email: 'Rahim@DhakaThreads.TEST' })
      .expect(200);
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);

    expect(await h.prisma.inviteLead.count()).toBe(1);
  });

  it('updates on a repeat instead of queueing them twice', async () => {
    // Somebody unsure whether the first one went through should not
    // become two entries in a list worked top to bottom.
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    await request(h.baseUrl)
      .post('/public/invite-leads')
      .send({ ...LEAD, companyName: 'Dhaka Threads Ltd' })
      .expect(200);

    const rows = await h.prisma.inviteLead.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyName).toBe('Dhaka Threads Ltd');
    // Kept, because "they asked twice" is worth knowing before you call.
    expect(rows[0]!.submissionCount).toBe(2);
  });

  it('does not reset a lead someone is already talking to', async () => {
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    const lead = await h.prisma.inviteLead.findUniqueOrThrow({ where: { email: LEAD.email } });
    await request(h.baseUrl)
      .patch(`/admin/invite-leads/${lead.id}`)
      .set(adminAuth)
      .send({ status: 'QUALIFIED' })
      .expect(200);

    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);

    const after = await h.prisma.inviteLead.findUniqueOrThrow({ where: { id: lead.id } });
    // Back to NEW would put someone mid-conversation at the top of the
    // queue as though nobody had spoken to them.
    expect(after.status).toBe('QUALIFIED');
  });

  it('swallows a honeypot submission without storing it', async () => {
    await request(h.baseUrl)
      .post('/public/invite-leads')
      .send({ ...LEAD, email: 'bot@spam.test', website: 'http://spam.example' })
      .expect(200);

    expect(await h.prisma.inviteLead.count()).toBe(0);
  });

  it('answers identically for a new and a known address', async () => {
    // Otherwise the endpoint is an address-enumeration oracle: submit,
    // read the difference, learn who has signed up.
    const first = await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    const second = await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    expect(second.body).toEqual(first.body);
  });

  it('rejects a malformed submission with the field that was wrong', async () => {
    const res = await request(h.baseUrl)
      .post('/public/invite-leads')
      .send({ ...LEAD, email: 'not-an-email' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('email');
  });

  it('stamps contactedAt the first time it leaves NEW, and never again', async () => {
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    const lead = await h.prisma.inviteLead.findUniqueOrThrow({ where: { email: LEAD.email } });

    await request(h.baseUrl)
      .patch(`/admin/invite-leads/${lead.id}`)
      .set(adminAuth)
      .send({ status: 'CONTACTED' })
      .expect(200);
    const firstStamp = (await h.prisma.inviteLead.findUniqueOrThrow({ where: { id: lead.id } }))
      .contactedAt;
    expect(firstStamp).toBeInstanceOf(Date);

    await request(h.baseUrl)
      .patch(`/admin/invite-leads/${lead.id}`)
      .set(adminAuth)
      .send({ status: 'QUALIFIED' })
      .expect(200);
    const second = await h.prisma.inviteLead.findUniqueOrThrow({ where: { id: lead.id } });
    // It answers "how long did they wait to hear from us", which a later
    // status change would erase.
    expect(second.contactedAt).toEqual(firstStamp);
  });

  it('counts every status, not just the filtered page', async () => {
    for (const n of [1, 2, 3]) {
      await request(h.baseUrl)
        .post('/public/invite-leads')
        .send({ ...LEAD, email: `lead${n}@test.test` })
        .expect(200);
    }
    const all = await h.prisma.inviteLead.findMany();
    await request(h.baseUrl)
      .patch(`/admin/invite-leads/${all[0]!.id}`)
      .set(adminAuth)
      .send({ status: 'SPAM' })
      .expect(200);

    const res = await request(h.baseUrl)
      .get('/admin/invite-leads?status=NEW')
      .set(adminAuth)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    // The tab labels have to describe the whole queue, or they describe
    // only what you are already looking at.
    expect(res.body.counts).toMatchObject({ NEW: 2, SPAM: 1 });
  });

  it('is closed to staff who do not decide who gets invited', async () => {
    const warehouse = await loginAs(StaffRole.WAREHOUSE_STAFF);
    await request(h.baseUrl).get('/admin/invite-leads').set(warehouse).expect(403);
    await request(h.baseUrl).get('/admin/invite-leads').expect(401);
  });

  it('cannot create anything that can log in', async () => {
    // The whole safety argument for an open write endpoint.
    const sellersBefore = await h.prisma.seller.count();
    const staffBefore = await h.prisma.staffUser.count();
    await request(h.baseUrl).post('/public/invite-leads').send(LEAD).expect(200);
    expect(await h.prisma.seller.count()).toBe(sellersBefore);
    expect(await h.prisma.staffUser.count()).toBe(staffBefore);
  });
});
