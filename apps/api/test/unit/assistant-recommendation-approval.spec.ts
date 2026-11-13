/**
 * APPROVAL REQUIRES A PASSING GATE. The guard is read inside the transaction
 * that moves the live pointer, so these specs run the real `approve` with a
 * `moveLive` stand-in that executes the callback against a fake transaction.
 */
import { ConflictException } from '@nestjs/common';
import { AssistantRecommendationService } from '../../src/modules/assistant/services/assistant-recommendation.service';

interface Fx {
  svc: AssistantRecommendationService;
  moveLive: jest.Mock;
  txRunFind: jest.Mock;
  txRecUpdate: jest.Mock;
}

function fixture(green: boolean): Fx {
  const txRunFind = jest.fn(async () => (green ? { id: 'run1' } : null));
  const txRecUpdate = jest.fn(async () => ({ count: 1 }));
  const tx = {
    assistantEvalRun: { findFirst: txRunFind },
    assistantRecommendation: { updateMany: txRecUpdate },
  };
  const moveLive = jest.fn(async (input: { alsoInTx: (t: unknown) => Promise<void> }) => {
    await input.alsoInTx(tx);
  });
  const prisma = {
    client: {
      assistantRecommendation: {
        findUnique: async () => ({
          id: 'rec1',
          kind: 'KNOWLEDGE',
          status: 'NEW',
          lastEvalRunId: 'run1',
        }),
        updateMany: async () => ({ count: 1 }),
      },
      assistantEvalRun: { findUnique: async () => ({ draftVersionId: 'vD' }) },
    },
  };
  const knowledge = { liveVersionId: async () => 'vL', moveLive } as never;
  const audit = { log: async () => 'a1' } as never;
  const svc = new AssistantRecommendationService(
    prisma as never,
    {} as never,
    {} as never,
    knowledge,
    audit,
  );
  return { svc, moveLive, txRunFind, txRecUpdate };
}

describe('approval requires a passing gate', () => {
  it('goes live when the named run is green for this version against the live one', async () => {
    const f = fixture(true);
    await expect(f.svc.approve('rec1', 'staff1')).resolves.toEqual({ status: 'LIVE' });
    expect(f.moveLive).toHaveBeenCalledTimes(1);
    // The guard asked for exactly: done, passed, no regressions, this draft, this baseline.
    expect(f.txRunFind.mock.calls[0]![0]).toMatchObject({
      where: {
        id: 'run1',
        draftVersionId: 'vD',
        baselineVersionId: 'vL',
        status: 'DONE',
        passed: true,
        regressions: 0,
      },
    });
    expect(f.txRecUpdate).toHaveBeenCalledTimes(1);
  });

  it('is refused, and nothing is marked live, when no green run matches', async () => {
    const f = fixture(false);
    await expect(f.svc.approve('rec1', 'staff1')).rejects.toBeInstanceOf(ConflictException);
    expect(f.txRecUpdate).not.toHaveBeenCalled();
  });

  it('is refused when the recommendation has never been checked', async () => {
    const f = fixture(true);
    (
      f.svc as unknown as {
        prisma: { client: { assistantRecommendation: { findUnique: unknown } } };
      }
    ).prisma.client.assistantRecommendation.findUnique = async () => ({
      id: 'rec1',
      kind: 'KNOWLEDGE',
      status: 'NEW',
      lastEvalRunId: null,
    });
    await expect(f.svc.approve('rec1', 'staff1')).rejects.toMatchObject({
      response: { code: 'ASSISTANT_NO_PASSING_CHECK' },
    });
    expect(f.moveLive).not.toHaveBeenCalled();
  });
});
