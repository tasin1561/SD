import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';
import { SellerStatus, StaffRoleKey } from '@skydrop/db';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
import { FakeGateway, message } from '../helpers/assistant-fixtures';
import {
  bootTestApp,
  createTestStaff,
  defaultStoreFor,
  drainSellerIssueEscalation,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Raise-a-ticket from the chat, against Postgres.
 *
 * What is proved here, and why a unit test cannot prove it:
 *  - the model's tool call creates NO ticket (the `tickets` table stays empty);
 *  - the confirm endpoint, hit eight times at once, creates EXACTLY ONE ticket
 *    (the guarded UPDATE is a Postgres row lock, not an in-memory flag);
 *  - nobody but the proposal's owner can confirm or dismiss it;
 *  - a ticket service that refuses puts the proposal back to PENDING and
 *    leaves no ticket behind.
 */
type Auth = { Authorization: string };

describe('assistant ticket proposals (e2e)', () => {
  let h: AppHarness;
  let fake: FakeGateway;
  let staffAuth: Auth;
  let A: { auth: Auth; sellerId: string; orderNumber: string; orderId: string };
  let B: { auth: Auth; sellerId: string; orderNumber: string; orderId: string };

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

  async function makeSeller(label: string, tail: string): Promise<{ auth: Auth; id: string }> {
    const email = `tp-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `TP ${label} ${Math.random().toString(36).slice(2, 6)}`,
        contactPersonName: `Owner ${label}`,
        phone: `+88017123456${tail}`,
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

  async function seedOrder(sellerId: string, city: string) {
    const store = await defaultStoreFor(h.prisma, sellerId);
    const orderNumber = `SD-2026-92-${Math.floor(Math.random() * 900000 + 100000)}`;
    const order = await h.prisma.order.create({
      data: {
        sellerId,
        storeId: store.id,
        storeNameSnapshot: store.name,
        orderNumber,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'COD',
        codAmountInr: '500.00',
        recipientName: 'Customer',
        recipientPhoneE164: '+919812345678',
        recipientAddressLine1: '1 Road',
        recipientAddressLine2: 'Near Hospital',
        recipientCity: city,
        recipientStateProvince: 'Maharashtra',
        recipientPostalCode: '411001',
        recipientCountryCode: 'IN',
        declaredValueInr: '500.00',
      },
      select: { id: true },
    });
    return { orderNumber, orderId: order.id };
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
    A = { auth: a.auth, sellerId: a.id, ...(await seedOrder(a.id, 'Pune')) };
    B = { auth: b.auth, sellerId: b.id, ...(await seedOrder(b.id, 'Jaipur')) };
    fake = new FakeGateway([]);
  });
  afterEach(async () => {
    await drainSellerIssueEscalation(h.app);
  });

  function toolUse(input: Record<string, unknown>): Anthropic.Message {
    return message({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'propose_ticket',
          input,
        } as unknown as Anthropic.ContentBlock,
      ],
    });
  }
  const says = (text: string): Anthropic.Message =>
    message({ content: [{ type: 'text', text, citations: null } as Anthropic.ContentBlock] });

  async function conversation(auth: Auth): Promise<string> {
    const res = await request(h.baseUrl)
      .post('/seller/assistant/conversations')
      .set(auth)
      .send({})
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function sseEvents(res: request.Response): Array<Record<string, unknown>> {
    return String(res.text)
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)) as Record<string, unknown>);
  }

  /** The model proposes; returns the proposal id as the browser learns it (the SSE event). */
  async function propose(
    auth: Auth,
    conv: string,
    input: Record<string, unknown>,
  ): Promise<{ id: string; events: Array<Record<string, unknown>> }> {
    fake = new FakeGateway([toolUse(input), says('Please press the button to raise it.')]);
    const res = await request(h.baseUrl)
      .post(`/seller/assistant/conversations/${conv}/messages`)
      .set(auth)
      .send({ text: 'I want to talk to a person about my parcel' })
      .expect(200);
    const events = sseEvents(res);
    const card = events.find((e) => e['type'] === 'ticket_proposal');
    expect(card).toBeDefined();
    return { id: card!['id'] as string, events };
  }

  const GOOD = {
    subject: 'Parcel stuck for four days',
    description: 'The parcel has not moved since Monday and my customer keeps calling.',
  };
  const confirm = (auth: Auth, id: string) =>
    request(h.baseUrl).post(`/seller/assistant/ticket-proposals/${id}/confirm`).set(auth).send({});
  const dismiss = (auth: Auth, id: string) =>
    request(h.baseUrl).post(`/seller/assistant/ticket-proposals/${id}/dismiss`).set(auth).send({});

  it('the model’s tool call proposes: a card in the stream, a PENDING row, and NO ticket', async () => {
    const conv = await conversation(A.auth);
    const { id, events } = await propose(A.auth, conv, { ...GOOD, orderNumber: A.orderNumber });
    expect(events.find((e) => e['type'] === 'ticket_proposal')).toEqual({
      type: 'ticket_proposal',
      id,
      subject: GOOD.subject,
      description: GOOD.description,
      orderNumber: A.orderNumber,
    });
    expect(await h.prisma.ticket.count()).toBe(0);
    const row = await h.prisma.assistantTicketProposal.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      status: 'PENDING',
      ticketId: null,
      orderId: A.orderId,
      sellerId: A.sellerId,
      conversationId: conv,
    });
    // The transcript shows it, with its status.
    const got = await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${conv}`)
      .set(A.auth)
      .expect(200);
    expect((got.body as { proposals: Array<Record<string, unknown>> }).proposals).toEqual([
      expect.objectContaining({
        id,
        status: 'PENDING',
        orderNumber: A.orderNumber,
        ticketId: null,
      }),
    ]);
  });

  it('another seller’s order number attaches no order — the order id is never the model’s', async () => {
    const conv = await conversation(A.auth);
    const { id } = await propose(A.auth, conv, { ...GOOD, orderNumber: B.orderNumber });
    const row = await h.prisma.assistantTicketProposal.findUniqueOrThrow({ where: { id } });
    expect(row.orderId).toBeNull();
    expect(row.orderNumber).toBeNull();
    expect(await h.prisma.ticket.count()).toBe(0);
  });

  it('eight simultaneous confirms raise exactly ONE ticket; a replay raises none', async () => {
    const conv = await conversation(A.auth);
    const { id } = await propose(A.auth, conv, { ...GOOD, orderNumber: A.orderNumber });

    const results = await Promise.all(Array.from({ length: 8 }, () => confirm(A.auth, id)));
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await h.prisma.ticket.count()).toBe(1);

    const ticket = await h.prisma.ticket.findFirstOrThrow();
    expect(ticket).toMatchObject({
      sellerId: A.sellerId,
      orderId: A.orderId,
      subject: GOOD.subject,
      ticketType: 'SELLER_RAISED_ISSUE',
    });
    const row = await h.prisma.assistantTicketProposal.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'CONFIRMED', ticketId: ticket.id });
    expect(row.ticketNumber).toBe(ticket.ticketNumber);

    const replay = await confirm(A.auth, id);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: 'CONFIRMED', ticketId: ticket.id });
    expect(await h.prisma.ticket.count()).toBe(1);

    // The transcript now shows "Raised · TK-…".
    const got = await request(h.baseUrl)
      .get(`/seller/assistant/conversations/${conv}`)
      .set(A.auth)
      .expect(200);
    expect((got.body as { proposals: Array<Record<string, unknown>> }).proposals[0]).toMatchObject({
      status: 'CONFIRMED',
      ticketNumber: ticket.ticketNumber,
      ticketId: ticket.id,
    });
  });

  it('nobody but the owner can confirm or dismiss it: 404, no ticket, still PENDING', async () => {
    const conv = await conversation(A.auth);
    const { id } = await propose(A.auth, conv, { ...GOOD, orderNumber: A.orderNumber });
    expect((await confirm(B.auth, id)).status).toBe(404);
    expect((await dismiss(B.auth, id)).status).toBe(404);
    const row = await h.prisma.assistantTicketProposal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PENDING');
    expect(await h.prisma.ticket.count()).toBe(0);
    // A's own conversation list/transcript is the only place it shows.
    await request(h.baseUrl).get(`/seller/assistant/conversations/${conv}`).set(B.auth).expect(404);
  });

  it('dismiss closes it: a later confirm is a 409 and raises nothing', async () => {
    const conv = await conversation(A.auth);
    const { id } = await propose(A.auth, conv, GOOD);
    const d = await dismiss(A.auth, id);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ status: 'DISMISSED' });
    const c = await confirm(A.auth, id);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe('ASSISTANT_PROPOSAL_ALREADY_DECIDED');
    expect(await h.prisma.ticket.count()).toBe(0);
  });

  it('when the ticket service refuses, the proposal goes back to PENDING, no ticket exists, and the server’s error comes through', async () => {
    const conv = await conversation(A.auth);
    const { id } = await propose(A.auth, conv, { ...GOOD, orderNumber: A.orderNumber });
    // Make the ticket service refuse: the proposal now points at ANOTHER seller's order
    // (the ticket service re-proves ownership of the order and throws).
    await h.prisma.assistantTicketProposal.update({ where: { id }, data: { orderId: B.orderId } });
    const res = await confirm(A.auth, id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.code).toEqual(expect.any(String));
    expect(await h.prisma.ticket.count()).toBe(0);
    const row = await h.prisma.assistantTicketProposal.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'PENDING', ticketId: null });

    // ...and once fixed, the same button works, once.
    await h.prisma.assistantTicketProposal.update({ where: { id }, data: { orderId: A.orderId } });
    expect((await confirm(A.auth, id)).status).toBe(200);
    expect(await h.prisma.ticket.count()).toBe(1);
  });

  it('a conversation holds at most three waiting proposals', async () => {
    const conv = await conversation(A.auth);
    for (let i = 1; i <= 3; i++) {
      await propose(A.auth, conv, {
        subject: `Problem number ${i}`,
        description: GOOD.description,
      });
    }
    fake = new FakeGateway([
      toolUse({ subject: 'Problem number 4', description: GOOD.description }),
      says('ok'),
    ]);
    const res = await request(h.baseUrl)
      .post(`/seller/assistant/conversations/${conv}/messages`)
      .set(A.auth)
      .send({ text: 'and another' })
      .expect(200);
    expect(sseEvents(res).some((e) => e['type'] === 'ticket_proposal')).toBe(false);
    expect(await h.prisma.assistantTicketProposal.count()).toBe(3);
    expect(await h.prisma.ticket.count()).toBe(0);
  });
});
