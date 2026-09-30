import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTENTION_QUEUES,
  countNeedingAttention,
  type AttentionCounts,
} from '@/app/(authed)/dashboard/_components/dashboard-view';

/** Every tile, unanswered. `exactOptionalPropertyTypes` means the shape
 *  carries all seven keys, which is the point — a missing key is a hole
 *  with a name. */
function none(): AttentionCounts {
  return {
    awaitingCall: undefined,
    awaitingSeller: undefined,
    toPick: undefined,
    manualPlacement: undefined,
    outOfStock: undefined,
    openTickets: undefined,
    pendingWithdrawals: undefined,
  };
}

/**
 * "N queues need staff attention" must count every lit tile.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────
 * The note under the attention band was a bare array of six counts in
 * the same order the seven tiles render — with `toPick` simply missing.
 * A warehouse holding twenty parcels ready for a picking sheet, and
 * nothing else wrong anywhere, therefore read
 *
 *     Operations attention queue
 *     Nothing is waiting on a person
 *
 * directly above a lit tile reading "20 to pick". Found by filming the
 * page: the note said four while five tiles were tinted.
 *
 * It is the recurring shape — a figure that is close enough most of the
 * time. It undercounted by one on every morning picking was outstanding,
 * which is most of them, and was only VISIBLE on the morning picking was
 * the only thing outstanding, which is the morning the note exists for.
 *
 * ── WHY THE TEST READS THE SOURCE ────────────────────────────────────
 * Proving the arithmetic is easy and was never the problem: the old code
 * counted its six perfectly. The failure was a tile with no entry, so
 * the test that catches the NEXT one has to compare the counted set
 * against the tiles the grid actually renders — which only the source
 * knows. Every `<AttentionCard href=` in the view is a tile; every one
 * of them needs a key here.
 */
describe('the attention-queue count', () => {
  it('counts every tile, including the one that was missing', () => {
    expect(
      countNeedingAttention({
        awaitingCall: 0,
        awaitingSeller: 0,
        toPick: 20,
        manualPlacement: 0,
        outOfStock: 0,
        openTickets: 0,
        pendingWithdrawals: 0,
      }),
    ).toBe(1);
  });

  it('the five lit on the day this was found come to five, not four', () => {
    expect(
      countNeedingAttention({
        awaitingCall: 157,
        awaitingSeller: 1,
        toPick: 20,
        manualPlacement: 0,
        outOfStock: 0,
        openTickets: 3,
        pendingWithdrawals: 1,
      }),
    ).toBe(5);
  });

  it('an absent count is not work — a tile whose query has not answered stays quiet', () => {
    expect(countNeedingAttention(none())).toBe(0);
    expect(countNeedingAttention({ ...none(), toPick: undefined, awaitingCall: 2 })).toBe(1);
  });

  it('every tile the grid renders has a count here', () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'app',
        '(authed)',
        'dashboard',
        '_components',
        'dashboard-view.tsx',
      ),
      'utf8',
    );
    // One card, one href. The count is what matters, not the names:
    // a tile added without a key here leaves the two out of step and
    // that is exactly what shipped.
    const cards = src.match(/<AttentionCard\b/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(ATTENTION_QUEUES).toHaveLength(cards.length);
  });
});
