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

/** A taxonomy row as the portal fetcher would have persisted it. */
const cat = (
  externalId: string,
  label: string,
  isHumanOnly = false,
): { externalId: string; label: string; isHumanOnly: boolean } => ({
  externalId,
  label,
  isHumanOnly,
});

function make(row: Partial<Record<string, unknown>> = {}, taxonomy: unknown[] = []) {
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
      // The taxonomy is what the human-only lock is enforced FROM as of
      // Phase 5 — empty means "never fetched", which is why the blanket
      // refusal keys on it.
      courierIssueCategory: { findMany: jest.fn().mockResolvedValue(taxonomy) },
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

describe('the human-only lock, before the taxonomy exists', () => {
  it('an EMPTY auto list is always allowed — the shipped state', async () => {
    const { svc } = make();
    await expect(svc.assertAutoCategoriesAllowed([])).resolves.toBeUndefined();
  });

  it('ANY non-empty list is refused while the taxonomy is unfetched', async () => {
    // Blunter than "reject the two locked IDs" on purpose: with no
    // taxonomy we cannot tell whether a supplied string IS one of them,
    // and accepting an unverifiable list would leave the lock existing
    // only in a comment.
    const { svc } = make({}, []);
    await expect(svc.assertAutoCategoriesAllowed(['anything'])).rejects.toThrow(/taxonomy/i);
  });

  it('the hard-coded constant is empty — superseded by the table', () => {
    // Kept only so imports do not break. The authoritative answer is a
    // query now, because the IDs are Delhivery's and a source list would
    // need editing every time they add a category.
    expect(HUMAN_ONLY_CATEGORY_IDS).toHaveLength(0);
  });
});

describe('the human-only lock, once the taxonomy IS fetched', () => {
  const taxonomy = [
    cat('cat-reattempt', 'Reattempt / Delay'),
    cat('cat-claims', 'Claims / Finance', true),
    cat('cat-vas', 'Protect VAS', true),
  ];

  it('allows a category that is known and not locked', async () => {
    // What Phase 5 unblocks: before the fetch this was refused along with
    // everything else, including the eight that were always safe.
    const { svc } = make({}, taxonomy);
    await expect(svc.assertAutoCategoriesAllowed(['cat-reattempt'])).resolves.toBeUndefined();
  });

  it('refuses Claims/Finance BY ID', async () => {
    const { svc } = make({}, taxonomy);
    await expect(svc.assertAutoCategoriesAllowed(['cat-claims'])).rejects.toThrow(/human-only/i);
  });

  it('refuses Protect VAS by id too', async () => {
    const { svc } = make({}, taxonomy);
    await expect(svc.assertAutoCategoriesAllowed(['cat-vas'])).rejects.toThrow(/human-only/i);
  });

  it('refuses an id that is not in the taxonomy at all', async () => {
    // An unknown category cannot be shown NOT to be Claims/Finance, so it
    // cannot be automated. Refusing is the only answer without a guess.
    const { svc } = make({}, taxonomy);
    await expect(svc.assertAutoCategoriesAllowed(['cat-invented'])).rejects.toThrow(
      /unknown|not in/i,
    );
  });

  it('mayAutoAct re-checks the lock at PICKUP, not only at write time', async () => {
    // A category can be flagged human-only by a re-fetch AFTER it was
    // added to the auto list. The later fact has to win.
    const { svc } = make(
      { writeMode: CourierWriteMode.AUTO, autoCategories: ['cat-claims'] },
      taxonomy,
    );
    expect(await svc.mayAutoAct('cat-claims')).toBe(false);
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
                escalation: { externalTicketId: 'TKT1', courierCode: 'delhivery' },
              },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      },
    };
    const svc = new CourierOutboxReconcilerService(
      prisma as never,
      { release: jest.fn(), confirmFromReadBack: jest.fn() } as never,
      // A registry now, because read-back availability is per courier:
      // Delhivery's MCP coming up must not make us try to read a ticket
      // that lives at Shiprocket.
      {
        for: () => ({ capabilities: () => ({ getThread: false }) }),
        known: () => ['delhivery'],
      } as never,
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
              {
                id: 'i1',
                body: 'x',
                externalRef: null,
                escalation: { externalTicketId: null, courierCode: 'delhivery' },
              },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };
    const svc = new CourierOutboxReconcilerService(
      prisma as never,
      { release, confirmFromReadBack: jest.fn() } as never,
      // A registry now, because read-back availability is per courier:
      // Delhivery's MCP coming up must not make us try to read a ticket
      // that lives at Shiprocket.
      {
        for: () => ({ capabilities: () => ({ getThread: false }) }),
        known: () => ['delhivery'],
      } as never,
      { hashBody: (b: string) => b } as never,
    );
    const out = await svc.reconcile();
    expect(out.returnedToQueue).toBe(1);
    expect(release).toHaveBeenCalled();
  });
});
