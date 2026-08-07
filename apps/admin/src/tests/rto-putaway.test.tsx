import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The RTO putaway panel.
 *
 * This closes the one gap in the operation that broke a loop rather than
 * adding friction: finalising a return leaves the goods in an RTO_HOLD
 * bin, availability ignores hold bins, and there was no screen to shelve
 * them — so every good return became stock nobody could sell.
 *
 * Two properties carry weight, and both fail SILENTLY if they regress.
 * A hold bin offered as a destination looks like a successful putaway
 * and changes nothing. And a panel that renders when there is nothing in
 * hold trains operators to ignore it, which is how the one that matters
 * gets skipped.
 */

const PANEL = join(__dirname, '../app/(authed)/warehouse/rto/_components/putaway-panel.tsx');
const STATION = join(__dirname, '../app/(authed)/warehouse/rto/_components/rto-station.tsx');
const HOOKS = join(__dirname, '../lib/api-hooks.ts');
const BIN_POLICY = join(
  __dirname,
  '../../../api/src/modules/inventory-shared/bin-policy.service.ts',
);

const read = (p: string): string => readFileSync(p, 'utf8');

describe('a hold bin can never be offered as a destination', () => {
  it('filters the non-pickable types out of the choices', () => {
    const src = read(PANEL);
    expect(src).toContain('NON_PICKABLE');
    expect(src).toMatch(/\.filter\(\(b\) => !NON_PICKABLE\.has\(b\.type\)\)/);
  });

  it('its list matches the API definition exactly', () => {
    // Two copies of this set exist because the client cannot import from
    // apps/api. Same idiom as the wallet CREDIT_DIRECTIONS cross-check:
    // read both and fail if they disagree, rather than trusting a
    // comment that says they match.
    const api = read(BIN_POLICY);
    // Anchor on the `= [` that OPENS the array. Anchoring on the first
    // `]` finds the one inside the `readonly BinType[]` annotation and
    // slices away every entry — which reads as "the two agree" while
    // comparing nothing at all.
    const from = api.indexOf('= [', api.indexOf('NON_PICKABLE_BIN_TYPES'));
    const block = api.slice(from, api.indexOf(']', from));
    const apiTypes = Array.from(block.matchAll(/BinType\.([A-Z_]+)/g), (m) => m[1]).sort();

    const ui = read(PANEL);
    const uiSet = ui.slice(ui.indexOf('const NON_PICKABLE'));
    const uiTypes = Array.from(
      uiSet.slice(0, uiSet.indexOf(']')).matchAll(/'([A-Z_]+)'/g),
      (m) => m[1],
    ).sort();

    expect(apiTypes.length).toBeGreaterThan(0);
    expect(uiTypes).toEqual(apiTypes);
  });
});

describe('the panel appears exactly when there is work', () => {
  it('renders nothing when nothing is in hold', () => {
    const src = read(PANEL);
    expect(src).toMatch(/if \(rows\.length === 0\) return null;/);
  });

  it('renders nothing while still loading, rather than an empty shell', () => {
    expect(read(PANEL)).toMatch(/if \(pending\.isLoading\) return null;/);
  });

  it('is mounted on the RTO station', () => {
    // The endpoint existed for months with no caller. That is the
    // failure this asserts against.
    expect(read(STATION)).toContain('<PutawayPanel shipmentId={shipmentId} />');
  });
});

describe('the suggestion is offered, not imposed', () => {
  const src = read(PANEL);

  it('pre-selects the server suggestion', () => {
    expect(src).toContain('r.suggestedBinId');
    expect(src).toMatch(/next\[r\.shipmentItemId\] === undefined/);
  });

  it('does not overwrite a choice the operator already made', () => {
    // The `=== undefined` guard above is what makes this true; state it
    // as its own case because that is the behaviour, not the mechanism.
    expect(src).not.toMatch(
      /next\[r\.shipmentItemId\] = r\.suggestedBinId;\s*\n\s*\}\s*\n\s*\}\s*\n\s*return next;\s*\n\s*\}\);\s*\n\s*\}, \[rows, choices\]/,
    );
    expect(src).toContain('without');
  });

  it('still lets a shelf be chosen when there is no suggestion', () => {
    expect(src).toContain('no suggestion — pick a shelf');
  });
});

describe('partial shelving is allowed', () => {
  const src = read(PANEL);

  it('submits only the lines that have a shelf', () => {
    // An operator who can place three of four items should not have to
    // hold all four back.
    expect(src).toMatch(/const ready = rows\.filter/);
    expect(src).toContain('lines: ready.map');
  });

  it('says what happens to the rest', () => {
    expect(src).toContain('stay in hold');
  });
});

describe('server and cache discipline', () => {
  it('surfaces the server refusal verbatim (FE-2)', () => {
    expect(read(PANEL)).toContain('serverVerdict(err)');
  });

  it('invalidates inventory too, not just the RTO list', () => {
    // The point of the action is that stock became sellable; a stale
    // availability figure right after would contradict the toast.
    const src = read(HOOKS);
    const hook = src.slice(src.indexOf('export function useRtoPutaway('));
    expect(hook.slice(0, 900)).toContain("['admin-rto']");
    expect(hook.slice(0, 900)).toContain("['admin-inventory']");
  });
});
