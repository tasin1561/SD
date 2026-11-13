import {
  AssistantStoreService,
  ownedBy,
} from '../../src/modules/assistant/services/assistant-store.service';
import { AssistantChatService } from '../../src/modules/assistant/services/assistant-chat.service';
import { AssistantConversationService } from '../../src/modules/assistant/services/assistant-conversation.service';
import { scope, USER_A, USER_B, STAFF_1 } from '../helpers/assistant-fixtures';

/**
 * A minimal prisma stand-in for the conversation table that applies a
 * `where` of plain equalities the way Postgres would — so the test
 * exercises the REAL ownership predicate (`ownedBy`) rather than a fake
 * that agrees with whatever it is asked.
 */
interface Row {
  id: string;
  audience: string;
  ownerUserId: string;
  impersonatedByStaffId: string | null;
  deletedAt: Date | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  sellerId: string | null;
  storeId: string | null;
}
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(
    ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
  );
}
function fakePrisma(
  rows: Row[],
  messages: Array<{
    conversationId: string;
    role: string;
    content: unknown;
    isQuestion: boolean;
    id: string;
    createdAt: Date;
  }>,
) {
  let n = 0;
  return {
    client: {
      assistantConversation: {
        create: async ({ data }: { data: Partial<Row> }) => {
          const r: Row = {
            id: `c${++n}`,
            title: null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            sellerId: null,
            storeId: null,
            impersonatedByStaffId: null,
            ...data,
          } as Row;
          rows.push(r);
          return r;
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          rows.filter((r) => matches(r, where)),
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((r) => matches(r, where)) ?? null,
      },
      assistantAttachment: { findMany: async () => [] },
      assistantTicketProposal: { findMany: async () => [] },
      assistantMessage: {
        findMany: async ({ where }: { where: { conversationId: string } }) =>
          messages.filter((m) => m.conversationId === where.conversationId),
      },
    },
  };
}

function rig() {
  const rows: Row[] = [];
  const messages: Array<{
    conversationId: string;
    role: string;
    content: unknown;
    isQuestion: boolean;
    id: string;
    createdAt: Date;
  }> = [];
  const store = new AssistantStoreService(fakePrisma(rows, messages) as never);
  const chat = new AssistantChatService(store, {} as never, {} as never, {} as never, {} as never);
  const svc = new AssistantConversationService(store, chat);
  return { store, svc, messages };
}

describe('conversation privacy: a user can only ever read their own', () => {
  const x = scope({ userId: USER_A });
  const y = scope({ userId: USER_B });

  it('X cannot GET Y’s conversation (404), but Y can', async () => {
    const { svc, messages } = rig();
    const yConv = await svc.create(y, 'Y private');
    messages.push({
      conversationId: yConv.id,
      role: 'USER',
      content: [{ type: 'text', text: 'Y secret question' }],
      isQuestion: true,
      id: 'm1',
      createdAt: new Date(),
    });

    await expect(svc.getMine(x, yConv.id)).rejects.toMatchObject({ status: 404 });
    const own = await svc.getMine(y, yConv.id);
    expect(own.messages[0]?.text).toBe('Y secret question');
  });

  it('X’s list never contains Y’s conversations', async () => {
    const { svc } = rig();
    await svc.create(y, 'Y one');
    await svc.create(y, 'Y two');
    const xc = await svc.create(x, 'X one');
    const list = await svc.list(x);
    expect(list.map((c) => c.id)).toEqual([xc.id]);
  });

  it('the same user id in a different audience is a different person (staff id ≠ seller user id)', async () => {
    const { svc } = rig();
    const sellerConv = await svc.create(scope({ userId: USER_A }), 's');
    const asStaff = scope({ audience: 'STAFF', userId: USER_A, sellerId: null });
    await expect(svc.getMine(asStaff, sellerConv.id)).rejects.toMatchObject({ status: 404 });
  });

  it('a conversation opened inside a support session is shown only to that staff member — not to the real owner', async () => {
    const { svc } = rig();
    const asSupport = scope({ userId: USER_A, impersonatingStaffId: STAFF_1 });
    const c = await svc.create(asSupport, 'support asked this');
    // the owner, signing in normally
    await expect(svc.getMine(scope({ userId: USER_A }), c.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await svc.list(scope({ userId: USER_A }))).length).toBe(0);
    // a DIFFERENT staff member impersonating the same owner
    await expect(
      svc.getMine(scope({ userId: USER_A, impersonatingStaffId: 'someone-else' }), c.id),
    ).rejects.toMatchObject({ status: 404 });
    // the same staff member
    expect((await svc.getMine(asSupport, c.id)).conversation.id).toBe(c.id);
  });

  it('tool calls and thinking never reach the browser transcript', async () => {
    const { svc, messages } = rig();
    const c = await svc.create(x, null);
    messages.push(
      {
        conversationId: c.id,
        role: 'ASSISTANT',
        content: [
          { type: 'thinking', thinking: 'secret thoughts' },
          { type: 'tool_use', id: 't', name: 'get_my_order', input: {} },
        ],
        isQuestion: false,
        id: 'a',
        createdAt: new Date(),
      },
      {
        conversationId: c.id,
        role: 'USER',
        content: [{ type: 'tool_result', tool_use_id: 't', content: '{"customer":"Asha"}' }],
        isQuestion: false,
        id: 'b',
        createdAt: new Date(),
      },
      {
        conversationId: c.id,
        role: 'ASSISTANT',
        content: [{ type: 'text', text: 'Your order is packed.' }],
        isQuestion: false,
        id: 'c',
        createdAt: new Date(),
      },
    );
    const t = await svc.getMine(x, c.id);
    expect(JSON.stringify(t)).not.toMatch(/secret thoughts|Asha|tool_use/);
    expect(t.messages.map((m) => m.text)).toEqual(['Your order is packed.']);
  });

  it('the predicate names the person: dropping ownerUserId would be visible here', () => {
    const w = ownedBy(scope({ userId: USER_A }));
    expect(w).toMatchObject({
      audience: 'SELLER',
      ownerUserId: USER_A,
      impersonatedByStaffId: null,
      deletedAt: null,
    });
  });
});
