import {
  AssistantRetentionService,
  REMOVED,
} from '../../src/modules/assistant/services/assistant-retention.service';

function rig(convs: Array<{ id: string; updatedAt: Date }>, files: string[] = []) {
  const calls: string[] = [];
  const done = new Set<string>();
  const tx = {
    assistantMessage: {
      updateMany: jest.fn(async (a) => void calls.push(`msg:${JSON.stringify(a.data)}`)),
    },
    assistantToolCall: { updateMany: jest.fn(async () => void calls.push('tool')) },
    assistantAttachment: {
      updateMany: jest.fn(async (a) => void calls.push(`att:${JSON.stringify(a.data)}`)),
    },
    assistantFeedback: { updateMany: jest.fn(async () => void calls.push('fb')) },
    assistantTicketProposal: { updateMany: jest.fn(async () => void calls.push('prop')) },
    assistantMonitorResult: {
      updateMany: jest.fn(async (a) => void calls.push(`monitor:${JSON.stringify(a.data)}`)),
    },
    assistantConversation: {
      update: jest.fn(async (a) => {
        done.add(a.where.id);
        calls.push(
          `conv:${a.data.anonymisedAt instanceof Date}:${(a.data.updatedAt as Date).toISOString()}`,
        );
      }),
    },
  };
  const prisma = {
    client: {
      assistantConversation: {
        findMany: jest.fn(async () => convs.filter((c) => !done.has(c.id))),
      },
      assistantAttachment: {
        findMany: jest.fn(async () => files.map((storageKey) => ({ storageKey }))),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
  const spaces = { deleteObjects: jest.fn(async () => undefined) };
  return {
    svc: new AssistantRetentionService(prisma as never, spaces as never),
    spaces,
    calls,
    prisma,
  };
}

describe('assistant retention (180 days)', () => {
  const old = new Date('2026-01-01T00:00:00Z');

  it('replaces words, deletes bucket objects, keeps updatedAt, and is idempotent', async () => {
    const r = rig([{ id: 'c1', updatedAt: old }], ['assistant/a', 'assistant/b']);
    const first = await r.svc.run(new Date('2026-11-13T00:00:00Z'));
    expect(first).toEqual({ conversations: 1, files: 2, failed: 0 });
    expect(r.spaces.deleteObjects).toHaveBeenCalledWith(['assistant/a', 'assistant/b']);
    expect(r.calls.some((c) => c.includes(REMOVED))).toBe(true);
    expect(r.calls).toContain(`conv:true:${old.toISOString()}`);
    // The monitor's quotes and summary are words from the conversation: cleared too.
    const m = r.calls.find((c) => c.startsWith('monitor:')) ?? '';
    expect(JSON.parse(m.slice('monitor:'.length))).toMatchObject({
      safetyQuote: null,
      hallucinationQuote: null,
      correctReason: null,
      knowledgeGap: null,
      uiConfusion: null,
      summary: REMOVED,
    });
    // Second pass: the conversation is no longer selected, nothing is rewritten.
    const before = r.calls.length;
    const second = await r.svc.run(new Date('2026-11-14T00:00:00Z'));
    expect(second.conversations).toBe(0);
    expect(r.calls.length).toBe(before);
  });

  it('a failed bucket delete leaves the database untouched and is retried later', async () => {
    const r = rig([{ id: 'c1', updatedAt: old }], ['assistant/a']);
    r.spaces.deleteObjects.mockRejectedValueOnce(new Error('bucket down'));
    const res = await r.svc.run(new Date('2026-11-13T00:00:00Z'));
    expect(res).toEqual({ conversations: 0, files: 0, failed: 1 });
    expect(r.calls).toEqual([]);
    expect((await r.svc.run(new Date('2026-11-13T00:00:00Z'))).conversations).toBe(1);
  });
});
