import { CourierWriteMode } from '@skydrop/db';
import {
  CourierChannelSettingsService,
  HUMAN_ONLY_CATEGORY_IDS,
} from '../../src/modules/courier-escalation/services/courier-channel-settings.service';
import { CourierOutboxReconcilerService } from '../../src/modules/courier-escalation/services/courier-outbox-reconciler.service';

/**
 * Mode is INTENT. Pause is HEALTH. They are different variables, and the
 * locked categories are enforced rather than documented.
 */

function make(row: Partial<Record<string, unknown>> = {}) {
  const updates: Record<string, unknown>[] = [];
  const base = {
    courierCode: 'delhivery',
    writeMode: CourierWriteMode.AUTO,
    autoCategories: [],
    pausedUntil: null,
    pauseReason: null,
    updatedByStaffId: null,
    updatedAt: new Date(),
    ...row,
  };
  const prisma = {
    client: {
      courierChannelSettings: {
        upsert: jest.fn().mockResolvedValue(base),
        update: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          updates.push(a.data);
          return Promise.resolve(base);
        }),
      },
    },
  };
  const svc = new CourierChannelSettingsService(
    prisma as never,
    {
      log: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { svc, updates };
}

describe('mode and pause are separate variables', () => {
  it('pausing does NOT touch writeMode', async () => {
    // Storing the pause by flipping to MANUAL would be cheaper and wrong
    // twice: recovery would have to guess the mode, and an operator who
    // chose MANUAL deliberately would find themselves back in AUTO
    // because a canary went green.
    const { svc, updates } = make({ writeMode: CourierWriteMode.AUTO });
    await svc.pause({ until: new Date(Date.now() + 60_000), reason: 'canary failed' });
    expect(updates[0]).toHaveProperty('pausedUntil');
    expect(updates[0]).not.toHaveProperty('writeMode');
  });

  it('resuming does NOT set a mode either — it restores what was chosen', async () => {
    const { svc, updates } = make();
    await svc.resume({ staffId: 'staff-1' });
    expect(updates[0]).toMatchObject({ pausedUntil: null, pauseReason: null });
    expect(updates[0]).not.toHaveProperty('writeMode');
  });

  it('an active pause blocks auto action even in AUTO mode', async () => {
    const { svc } = make({
      writeMode: CourierWriteMode.AUTO,
      autoCategories: ['cat-1'],
      pausedUntil: new Date(Date.now() + 60_000),
    });
    expect(await svc.mayAutoAct('cat-1')).toBe(false);
  });

  it('an EXPIRED pause does not block — health recovered, intent unchanged', async () => {
    const { svc } = make({
      writeMode: CourierWriteMode.AUTO,
      autoCategories: ['cat-1'],
      pausedUntil: new Date(Date.now() - 60_000),
    });
    expect(await svc.mayAutoAct('cat-1')).toBe(true);
  });
});

describe('mayAutoAct fails closed', () => {
  it('MANUAL never auto-acts', async () => {
    const { svc } = make({ writeMode: CourierWriteMode.MANUAL, autoCategories: ['cat-1'] });
    expect(await svc.mayAutoAct('cat-1')).toBe(false);
  });

  it('SUPERVISED never auto-acts either — it waits for a click', async () => {
    const { svc } = make({ writeMode: CourierWriteMode.SUPERVISED, autoCategories: ['cat-1'] });
    expect(await svc.mayAutoAct('cat-1')).toBe(false);
  });

  it('a null category never auto-acts', async () => {
    // An item with no category cannot be checked against the auto list,
    // so it cannot be permitted.
    const { svc } = make({ writeMode: CourierWriteMode.AUTO, autoCategories: ['cat-1'] });
    expect(await svc.mayAutoAct(null)).toBe(false);
  });

  it('a category NOT on the list never auto-acts', async () => {
    const { svc } = make({ writeMode: CourierWriteMode.AUTO, autoCategories: ['cat-1'] });
    expect(await svc.mayAutoAct('cat-2')).toBe(false);
  });
});

describe('the human-only lock', () => {
  it('an EMPTY auto list is always allowed — the shipped state', () => {
    const { svc } = make();
    expect(() => svc.assertAutoCategoriesAllowed([])).not.toThrow();
  });

  it('ANY non-empty list is refused while the taxonomy is unfetched', () => {
    // Blunter than "reject the two locked IDs" on purpose: we do not KNOW
    // the locked IDs, so we cannot tell whether a supplied string is one.
    // Accepting an unverifiable list would leave the lock existing only
    // in a comment.
    const { svc } = make();
    expect(() => svc.assertAutoCategoriesAllowed(['anything'])).toThrow(
      /TAXONOMY_NOT_FETCHED|taxonomy/i,
    );
  });

  it('the locked-ID list is empty, and that is WHY the blanket refusal exists', () => {
    // If someone populates this from the real taxonomy, the refusal
    // above must be relaxed to a per-ID check in the same change.
    expect(HUMAN_ONLY_CATEGORY_IDS).toHaveLength(0);
  });
});

describe('the reconciler leaves unknowns alone when it cannot read', () => {
  it('does not guess — both guesses are worse than waiting', async () => {
    // Assume sent: a real message is silently dropped. Assume not sent:
    // we duplicate. So it reports readBackUnavailable and stops.
    const prisma = {
      client: {
        courierOutboxItem: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // expired leases
            .mockResolvedValueOnce([
              {
                id: 'i1',
                body: 'x',
                externalRef: 'TKT1',
                escalation: { externalTicketId: 'TKT1' },
              },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      },
    };
    const svc = new CourierOutboxReconcilerService(
      prisma as never,
      { release: jest.fn(), confirmFromReadBack: jest.fn() } as never,
      { capabilities: () => ({ getThread: false }) } as never,
      { hashBody: (b: string) => b } as never,
    );
    const out = await svc.reconcile();
    expect(out.readBackUnavailable).toBe(true);
    expect(out.stillUnknown).toBe(1);
    expect(out.confirmed).toBe(0);
    expect(out.returnedToQueue).toBe(0);
  });

  it('an item with NO ticket id is decidable without reading — back to the queue', async () => {
    // "Mark sent" with an empty paste-back. Nothing was ever bound, so
    // nothing can be duplicated.
    const release = jest.fn();
    const prisma = {
      client: {
        courierOutboxItem: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              { id: 'i1', body: 'x', externalRef: null, escalation: { externalTicketId: null } },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };
    const svc = new CourierOutboxReconcilerService(
      prisma as never,
      { release, confirmFromReadBack: jest.fn() } as never,
      { capabilities: () => ({ getThread: false }) } as never,
      { hashBody: (b: string) => b } as never,
    );
    const out = await svc.reconcile();
    expect(out.returnedToQueue).toBe(1);
    expect(release).toHaveBeenCalled();
  });
});
