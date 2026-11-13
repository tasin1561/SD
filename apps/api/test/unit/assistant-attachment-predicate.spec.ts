/**
 * The ownership predicate of the REAL store, as handed to Prisma. A mock
 * has no WHERE engine, so this only shows what the clause SAYS; the e2e
 * spec proves it excludes. Both are needed: this one fails the moment
 * someone drops a column from the predicate or the link guard.
 */
import { AssistantStoreService } from '../../src/modules/assistant/services/assistant-store.service';
import { scope, STAFF_1, USER_A } from '../helpers/assistant-fixtures';

const ID = '0191a000-0000-7000-8000-000000000001';
const CONV = '0191a000-0000-7000-8000-000000000002';

function rig() {
  const calls: Array<{ op: string; args: any }> = [];
  const rec = (op: string, ret: unknown) => async (args: unknown) => {
    calls.push({ op, args });
    return ret;
  };
  const tx = {
    assistantMessage: { create: rec('message.create', { id: 'm1' }) },
    assistantAttachment: { updateMany: rec('attachment.updateMany', { count: 0 }) },
  };
  const prisma = {
    client: {
      assistantAttachment: {
        findMany: rec('attachment.findMany', []),
        count: rec('attachment.count', 0),
        create: rec('attachment.create', {}),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
  return { store: new AssistantStoreService(prisma as never), calls };
}

describe('attachment queries carry the full owner predicate', () => {
  it('findOwnedAttachments: id, conversation, unsent, audience, owner, support-session, conversation ownership', async () => {
    const { store, calls } = rig();
    await store.findOwnedAttachments(scope(), CONV, [ID], true);
    expect(calls[0]!.args.where).toMatchObject({
      id: { in: [ID] },
      conversationId: CONV,
      messageId: null,
      audience: 'SELLER',
      ownerUserId: USER_A,
      impersonatedByStaffId: null,
      conversation: {
        audience: 'SELLER',
        ownerUserId: USER_A,
        impersonatedByStaffId: null,
        deletedAt: null,
      },
    });
  });

  it('a staff member in a support session is a different owner', async () => {
    const { store, calls } = rig();
    await store.findOwnedAttachments(scope({ impersonatingStaffId: STAFF_1 }), CONV, [ID], false);
    expect(calls[0]!.args.where.impersonatedByStaffId).toBe(STAFF_1);
    expect(calls[0]!.args.where).not.toHaveProperty('messageId');
  });

  it('the link is a guarded updateMany (message_id IS NULL, same owner) and a short count rolls the question back', async () => {
    const { store, calls } = rig();
    await expect(
      store.appendQuestion(scope(), CONV, [{ type: 'text', text: 'q' }], [ID]),
    ).rejects.toMatchObject({
      status: 404,
    });
    const link = calls.find((c) => c.op === 'attachment.updateMany')!;
    expect(link.args.where).toMatchObject({
      id: { in: [ID] },
      conversationId: CONV,
      messageId: null,
      audience: 'SELLER',
      ownerUserId: USER_A,
      impersonatedByStaffId: null,
    });
    expect(link.args.data).toEqual({ messageId: 'm1' });
  });
});
