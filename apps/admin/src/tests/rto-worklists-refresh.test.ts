import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A worklist that still lists a carton somebody has already taken in.
 *
 * `useReceiveRto`, `useInspectRtoItem` and `useFinalizeRto` invalidated
 * NOTHING, so after receiving a return the RTO station's "At our door"
 * tab kept its row and its count, "On the bench" did not gain one, and a
 * finalised parcel stayed on the bench for ever. The next person picks
 * the same box up — and `receive` is idempotent, so it answers
 * "already received", which reads as a no-op rather than an explanation.
 *
 * The handover bench had already learnt this and says so in its own
 * comment ("somebody loading a van reads a stale count as parcels they
 * have missed"); the three RTO mutations beside it were missed.
 *
 * READ AS SOURCE on purpose. A stale list is correct React Query
 * behaviour and a correct server response, so nothing throws and no
 * behavioural test is positioned to see it; what is wrong is a MISSING
 * declaration, and the cheapest way to pin a missing declaration is to
 * look for it.
 */
const HOOKS = readFileSync(join(__dirname, '../lib/api-hooks.ts'), 'utf8');

/** One exported hook's body, from its `export function` to the next one. */
function hookBody(name: string): string {
  const at = HOOKS.indexOf(`export function ${name}(`);
  expect(at, `${name} is gone from api-hooks.ts`).toBeGreaterThan(-1);
  const next = HOOKS.indexOf('\nexport ', at + 1);
  return HOOKS.slice(at, next === -1 ? undefined : next);
}

describe('the RTO station refreshes its own worklists', () => {
  const MUTATIONS = ['useReceiveRto', 'useInspectRtoItem', 'useFinalizeRto'];

  it.each(MUTATIONS)('%s invalidates the RTO queries after it succeeds', (name) => {
    const body = hookBody(name);
    expect(body).toContain('onSuccess');
    expect(body).toContain("'warehouse-rto'");
  });

  it('receiving takes the parcel off BOTH lists it can appear on', () => {
    // It leaves "awaiting receipt" (at our door) and joins "open" (on
    // the bench) in the same act, so one invalidation is half a fix.
    const body = hookBody('useReceiveRto');
    expect(body).toContain("'awaiting-receipt'");
    expect(body).toContain("'open'");
  });

  it('finalising takes it off the bench', () => {
    expect(hookBody('useFinalizeRto')).toContain("'open'");
  });

  it('the handover bench, which already had this right, still does', () => {
    // The precedent this was read from. If it ever loses its
    // invalidation the same way, the same class of stale list is back.
    const ops = readFileSync(join(__dirname, '../lib/ops-hooks.ts'), 'utf8');
    expect(ops).toContain("['admin', 'handover-queue']");
  });
});
