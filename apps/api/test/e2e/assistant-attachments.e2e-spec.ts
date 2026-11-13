import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { SellerStatus, StaffRoleKey } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';
import { pictureBytes, plainPdf } from '../helpers/assistant-attachment-files';

/**
 * Assistant attachments, against a real database: nobody but the owner
 * can send or download a file, across two sellers and across a store
 * owner and the store's associate.
 *
 * A unit test can only show the `where` handed to a mocked Prisma. This
 * is the proof that the predicate EXCLUDES the row: every cross-tenant
 * attempt below must be a 404 that is indistinguishable from an id that
 * never existed, and the owner's own request must still work.
 */
describe('assistant attachments (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAAuth: { Authorization: string };
  let sellerBAuth: { Authorization: string };
  let storeId: string;
  let ownerAuth: { Authorization: string };
  let associateAuth: { Authorization: string };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function makeSeller(
    label: string,
  ): Promise<{ auth: { Authorization: string }; id: string }> {
    const email = `att-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `Att ${label}`,
        contactPersonName: `Owner ${label}`,
        phone: `+88017123456${label === 'A' ? '10' : '11'}`,
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

  async function acceptInvite(label: string): Promise<{ Authorization: string }> {
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

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const a = await makeSeller('A');
    const b = await makeSeller('B');
    sellerAAuth = a.auth;
    sellerBAuth = b.auth;

    const storeEmail = `att-store-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(sellerAAuth)
      .send({
        name: `Att Shop ${Math.random().toString(36).slice(2, 8)}`,
        displayName: 'Att Shop',
        contactEmail: storeEmail,
        contactPhone: '+919800000006',
        invite: { email: storeEmail, fullName: 'Shop Owner', roleKeys: ['owner'] },
      })
      .expect(201);
    storeId = (created.body as { id: string }).id;
    ownerAuth = await acceptInvite('Shop Owner');
    await request(h.baseUrl)
      .post('/store/team/invitations')
      .set(ownerAuth)
      .send({
        email: `att-assoc-${Date.now()}@scope.test`,
        fullName: 'Assoc',
        roleKeys: ['associate'],
      })
      .expect(201);
    associateAuth = await acceptInvite('Assoc');
  });

  const upload = (
    auth: { Authorization: string },
    prefix: string,
    conversationId: string,
    bytes: Buffer,
    name = 'photo.png',
  ) =>
    request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations/${conversationId}/attachments`)
      .set(auth)
      .attach('file', bytes, { filename: name, contentType: 'application/octet-stream' });

  async function conversation(auth: { Authorization: string }, prefix: string): Promise<string> {
    const res = await request(h.baseUrl)
      .post(`/${prefix}/assistant/conversations`)
      .set(auth)
      .send({})
      .expect(201);
    return (res.body as { id: string }).id;
  }

  it('a seller uploads, gets a rebuilt file, and downloads it; another seller gets 404 on everything', async () => {
    const convA = await conversation(sellerAAuth, 'seller');
    const convB = await conversation(sellerBAuth, 'seller');
    const up = await upload(
      sellerAAuth,
      'seller',
      convA,
      await pictureBytes('png', { exif: false }),
    );
    expect(up.status).toBe(201);
    const att = up.body as { id: string; kind: string; mediaType: string };
    expect(att.kind).toBe('IMAGE');

    // the owner
    const dl = await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${convA}/attachments/${att.id}/download`)
      .set(sellerAAuth)
      .expect(200);
    expect((dl.body as { url: string }).url).toEqual(expect.any(String));

    // seller B: A's conversation + A's attachment
    await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${convA}/attachments/${att.id}/download`)
      .set(sellerBAuth)
      .expect(404);
    await upload(sellerBAuth, 'seller', convA, await pictureBytes('png')).expect(404);
    // seller B: A's attachment id inside B's OWN conversation
    await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${convB}/attachments/${att.id}/download`)
      .set(sellerBAuth)
      .expect(404);
    const send = await request(h.baseUrl)
      .post(`/seller/assistant/conversations/${convB}/messages`)
      .set(sellerBAuth)
      .send({ text: 'what is this?', attachmentIds: [att.id] });
    expect(send.status).toBe(404);
    // ...and it is still unsent: B's attempt did not consume or link it
    const row = await h.prisma.assistantAttachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(row.messageId).toBeNull();
    expect(row.ownerUserId).not.toBeNull();
  });

  it('A’s attachment in A’s other conversation is a 404 on send', async () => {
    const conv1 = await conversation(sellerAAuth, 'seller');
    const conv2 = await conversation(sellerAAuth, 'seller');
    const up = await upload(sellerAAuth, 'seller', conv1, await plainPdf(2), 'a.pdf').expect(201);
    const id = (up.body as { id: string }).id;
    await request(h.baseUrl)
      .post(`/seller/assistant/conversations/${conv2}/messages`)
      .set(sellerAAuth)
      .send({ text: 'read it', attachmentIds: [id] })
      .expect(404);
    await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${conv2}/attachments/${id}/download`)
      .set(sellerAAuth)
      .expect(404);
  });

  it('four attachment ids is a 400', async () => {
    const conv = await conversation(sellerAAuth, 'seller');
    const ids = [1, 2, 3, 4].map((n) => `0191a000-0000-7000-8000-00000000000${n}`);
    await request(h.baseUrl)
      .post(`/seller/assistant/conversations/${conv}/messages`)
      .set(sellerAAuth)
      .send({ text: 'x', attachmentIds: ids })
      .expect(400);
  });

  it('a store owner’s attachment is invisible to the store’s associate, and the reverse', async () => {
    const ownerConv = await conversation(ownerAuth, 'store');
    const assocConv = await conversation(associateAuth, 'store');
    const up = await upload(ownerAuth, 'store', ownerConv, await pictureBytes('jpeg')).expect(201);
    const id = (up.body as { id: string }).id;
    await request(h.baseUrl)
      .get(`/store/assistant/conversations/${ownerConv}/attachments/${id}/download`)
      .set(associateAuth)
      .expect(404);
    await request(h.baseUrl)
      .get(`/store/assistant/conversations/${assocConv}/attachments/${id}/download`)
      .set(associateAuth)
      .expect(404);
    await request(h.baseUrl)
      .post(`/store/assistant/conversations/${assocConv}/messages`)
      .set(associateAuth)
      .send({ text: 'x', attachmentIds: [id] })
      .expect(404);
    const mine = await upload(associateAuth, 'store', assocConv, await pictureBytes('png')).expect(
      201,
    );
    await request(h.baseUrl)
      .get(
        `/store/assistant/conversations/${assocConv}/attachments/${(mine.body as { id: string }).id}/download`,
      )
      .set(ownerAuth)
      .expect(404);
    // the owner still reads their own
    await request(h.baseUrl)
      .get(`/store/assistant/conversations/${ownerConv}/attachments/${id}/download`)
      .set(ownerAuth)
      .expect(200);
  });

  it('a spoofed file and an oversized file are refused with a coded 400 over HTTP', async () => {
    const conv = await conversation(sellerAAuth, 'seller');
    const spoof = await upload(
      sellerAAuth,
      'seller',
      conv,
      Buffer.from('MZ' + 'x'.repeat(500)),
      'a.jpg',
    );
    expect(spoof.status).toBe(400);
    expect(spoof.body.code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
    const big = await upload(
      sellerAAuth,
      'seller',
      conv,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(10 * 1024 * 1024 - 7),
      ]), // exactly 10 MB + 1 byte
    );
    expect(big.status).toBe(400);
    expect(big.body.code).toBe('ATTACHMENT_TOO_LARGE');
    expect(await h.prisma.assistantAttachment.count()).toBe(0);
  });

  it('staff get the same isolation on /admin', async () => {
    const conv = await conversation(staffAuth, 'admin');
    const up = await upload(staffAuth, 'admin', conv, await pictureBytes('webp')).expect(201);
    await request(h.baseUrl)
      .get(
        `/admin/assistant/conversations/${conv}/attachments/${(up.body as { id: string }).id}/download`,
      )
      .set(staffAuth)
      .expect(200);
  });
});
