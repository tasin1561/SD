import { AssistantToolRegistry } from '../../src/modules/assistant/services/assistant-tool-registry.service';
import { systemPromptFor } from '../../src/modules/assistant/assistant-system-prompt';
import type { AssistantStreamEvent } from '../../src/modules/assistant/assistant.types';
import { fakeDeps, scope, staffScope, storeScope } from '../helpers/assistant-fixtures';

/**
 * `propose_ticket` is the model's whole part in raising a ticket, so it is
 * pinned from every side: who is offered it, what it stores, what it tells the
 * model, and that a number that is not the caller's never produces an order.
 */
const SELLER = scope({ permissions: ['orders.view', 'tickets.create'] });
const GOOD = {
  subject: 'Parcel stuck for four days',
  description: 'The parcel has not moved since Monday and the customer keeps calling.',
};

function rig(orders: Array<{ sellerId: string; orderNumber: string }> = []) {
  const deps = fakeDeps(orders);
  const created: Array<Record<string, unknown>> = [];
  const events: AssistantStreamEvent[] = [];
  const full = {
    ...deps,
    proposals: {
      createProposal: async (_s: unknown, conversationId: string, row: Record<string, unknown>) => {
        created.push({ conversationId, ...row });
        return {
          created: true,
          proposal: {
            id: 'p1',
            conversationId,
            subject: String(row['subject']),
            description: String(row['description']),
            orderId: (row['orderId'] as string | null) ?? null,
            orderNumber: (row['orderNumber'] as string | null) ?? null,
            status: 'PENDING' as const,
            ticketId: null,
            ticketNumber: null,
            requestId: null,
            createdAt: new Date(),
            decidedAt: null,
          },
        };
      },
    },
  };
  const reg = AssistantToolRegistry.fromDeps(full as never);
  const run = (s: ReturnType<typeof scope>, input: unknown) =>
    reg.execute(s, 'propose_ticket', input, {
      conversationId: 'conv-1',
      emit: (e) => events.push(e),
    });
  return { reg, run, created, events };
}

describe('propose_ticket', () => {
  it('is offered to a seller who may raise tickets, a store and an associate with tickets.manage — never to staff', () => {
    const { reg } = rig();
    const names = (s: ReturnType<typeof scope>) => reg.toolsFor(s).map((t) => t.name);
    expect(names(SELLER)).toContain('propose_ticket');
    expect(names(scope({ permissions: ['orders.view'] }))).not.toContain('propose_ticket');
    expect(names(storeScope({ permissions: ['tickets.manage'] }))).toContain('propose_ticket');
    expect(names(storeScope({ permissions: ['orders.view'] }))).not.toContain('propose_ticket');
    expect(
      names(
        storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', permissions: ['tickets.manage'] }),
      ),
    ).toContain('propose_ticket');
    expect(
      names(staffScope({ permissions: ['tickets.create', 'tickets.manage', 'tickets.view'] })),
    ).not.toContain('propose_ticket');
  });

  it('a call from a caller who was not offered it is refused and stores nothing', async () => {
    const { run, created } = rig();
    const r = await run(scope({ permissions: ['orders.view'] }), GOOD);
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('FORBIDDEN');
    expect(created).toHaveLength(0);
  });

  it('stores a proposal, shows a card, and tells the model NOTHING was raised', async () => {
    const { run, created, events } = rig([{ sellerId: SELLER.sellerId!, orderNumber: 'SD-1' }]);
    const r = await run(SELLER, { ...GOOD, orderNumber: 'SD-1' });
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.content) as { status: string; note: string };
    expect(body.status).toBe('proposed');
    expect(body.note).toMatch(/PROPOSED ONLY/);
    expect(body.note).toMatch(/Raise this ticket/);
    expect(body.note).toMatch(/never say or imply that the ticket was raised/i);
    expect(r.content).not.toMatch(/"id"|TK-/);
    expect(created).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        orderId: 'order-SD-1',
        orderNumber: 'SD-1',
      }),
    ]);
    expect(events).toEqual([
      {
        type: 'ticket_proposal',
        id: 'p1',
        subject: GOOD.subject,
        description: GOOD.description,
        orderNumber: 'SD-1',
      },
    ]);
  });

  it('a number that is another seller’s, or does not exist, attaches NO order and is not an error', async () => {
    const { run, created } = rig([{ sellerId: 'someone-else', orderNumber: 'SD-9' }]);
    const foreign = await run(SELLER, { ...GOOD, orderNumber: 'SD-9' });
    const missing = await run(SELLER, { ...GOOD, orderNumber: 'SD-404' });
    expect(foreign.isError).toBe(false);
    expect(missing.isError).toBe(false);
    expect(foreign.content).toBe(missing.content);
    expect(created.map((c) => c['orderId'])).toEqual([null, null]);
  });

  it('a seller may propose without any order', async () => {
    const { run, created } = rig();
    expect((await run(SELLER, GOOD)).isError).toBe(false);
    expect(created[0]).toMatchObject({ orderId: null, orderNumber: null });
  });

  it('a member store must name one of ITS orders: an unknown one is NOT_FOUND and stores nothing', async () => {
    const { run, created } = rig();
    const r = await run(storeScope({ permissions: ['tickets.manage', 'orders.view'] }), {
      ...GOOD,
      orderNumber: 'SD-NOPE',
    });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('NOT_FOUND');
    expect(created).toHaveLength(0);
  });

  it('refuses a stray tenant id or an over-long subject', async () => {
    const { run, created } = rig();
    expect((await run(SELLER, { ...GOOD, sellerId: 'x' })).errorCode).toBe('INVALID_INPUT');
    expect((await run(SELLER, { ...GOOD, subject: 'x'.repeat(121) })).errorCode).toBe(
      'INVALID_INPUT',
    );
    expect((await run(SELLER, { ...GOOD, description: 'y'.repeat(2001) })).errorCode).toBe(
      'INVALID_INPUT',
    );
    expect(created).toHaveLength(0);
  });

  it('a conversation already holding the maximum waiting proposals refuses another (the model is told)', async () => {
    const deps = fakeDeps();
    const reg = AssistantToolRegistry.fromDeps({
      ...deps,
      proposals: { createProposal: async () => null },
    } as never);
    const r = await reg.execute(SELLER, 'propose_ticket', GOOD, {
      conversationId: 'c',
      emit: () => undefined,
    });
    expect(r).toMatchObject({ isError: true, errorCode: 'FAILED' });
    expect(r.content).toMatch(/already waiting/);
  });
});

describe('the system prompt about tickets', () => {
  it('tells every non-staff audience to offer a ticket only when needed and to say the button must be pressed', () => {
    for (const a of ['SELLER', 'STORE', 'ASSOCIATE'] as const) {
      const p = systemPromptFor(a);
      expect(p).toContain('propose_ticket');
      expect(p).toContain('Raise this ticket');
      expect(p).toMatch(/must press that button/);
      expect(p).toMatch(/never say or imply that a ticket has been raised/);
    }
  });
  it('does not mention it to staff, who have no such tool, and stays one frozen string per audience', () => {
    expect(systemPromptFor('STAFF')).not.toContain('propose_ticket');
    expect(systemPromptFor('SELLER')).toBe(systemPromptFor('SELLER'));
  });
});
