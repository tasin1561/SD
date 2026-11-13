import { NotFoundException } from '@nestjs/common';
import { AssistantFeedbackService } from '../../src/modules/assistant/services/assistant-feedback.service';
import type { CallerScope } from '../../src/modules/assistant/assistant.types';

const scope = { audience: 'SELLER', userId: 'u1' } as CallerScope;

describe('assistant feedback', () => {
  function rig(owned: { id: string; conversationId: string } | null) {
    const store = {
      findOwnedAnswer: jest.fn(async () => owned),
      upsertFeedback: jest.fn(async () => undefined),
      removeFeedback: jest.fn(async () => undefined),
    };
    return { store, svc: new AssistantFeedbackService(store as never) };
  }

  it('404s on an answer the caller does not own, and writes nothing', async () => {
    const { store, svc } = rig(null);
    await expect(svc.rate(scope, 'c', 'm', 'up', undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(store.upsertFeedback).not.toHaveBeenCalled();
  });

  it('404s when the answer belongs to another conversation', async () => {
    const { svc } = rig({ id: 'm', conversationId: 'other' });
    await expect(svc.rate(scope, 'c', 'm', 'down', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('trims and caps the comment, and stores none as null', async () => {
    const { store, svc } = rig({ id: 'm', conversationId: 'c' });
    await svc.rate(scope, 'c', 'm', 'down', `  ${'a'.repeat(900)}  `);
    expect((store.upsertFeedback.mock.calls[0] as unknown[])[3]).toHaveLength(500);
    await svc.rate(scope, 'c', 'm', 'up', '   ');
    expect((store.upsertFeedback.mock.calls[1] as unknown[])[3]).toBeNull();
  });

  it('"none" removes the rating', async () => {
    const { store, svc } = rig({ id: 'm', conversationId: 'c' });
    await svc.rate(scope, 'c', 'm', 'none', undefined);
    expect(store.removeFeedback).toHaveBeenCalled();
  });
});
