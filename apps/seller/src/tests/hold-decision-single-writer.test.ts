import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The keep-trying / let-it-go decision has ONE implementation.
 *
 * It is offered from two places — the order the customer could not be
 * reached on, and the register at `/holds` — and both mount the same
 * `HoldDecisionDialog`. That matters because the two outcomes are not
 * symmetric: "let it go" rejects the order and gives back any held
 * stock, and a second copy of that dialog is how one of them comes to
 * describe the outcome differently from the other, or to skip the
 * confirm, or to be pointed at a different endpoint.
 *
 * So this pins the shape rather than the wording: exactly one file may
 * call the mutation hook, and it is the shared dialog.
 */

const SRC = join(__dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

describe('the hold decision has one writer', () => {
  const files = sources(SRC);

  it('found the app sources (the walker still works)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('only the shared dialog calls useDecideHoldReview', () => {
    const callers = files.filter((f) => {
      // The hook's own definition is not a caller.
      if (f.endsWith(join('lib', 'ops-hooks.ts'))) return false;
      return readFileSync(f, 'utf8').includes('useDecideHoldReview');
    });
    expect(callers.map((f) => f.slice(SRC.length + 1))).toEqual([
      join('components', 'hold-decision-dialog.tsx'),
    ]);
  });

  it('both surfaces mount that dialog', () => {
    const mounts = files
      .filter((f) => readFileSync(f, 'utf8').includes('<HoldDecisionDialog'))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(mounts).toEqual([
      join('app', '(authed)', 'holds', '_components', 'hold-reviews-index.tsx'),
      join('app', '(authed)', 'orders', '[id]', '_components', 'unreachable-customer-panel.tsx'),
    ]);
  });
});
