import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Where has this unit been?"
 *
 * R4 built the whole per-unit ledger — a row per physical item and an
 * append-only event per scan — and the endpoint that reads one unit's
 * history had no caller on either side. It stayed harmless while STRICT
 * mode was unreachable; the moment a seller could switch a SKU to
 * per-unit tracking, the obvious follow-up question had no screen.
 *
 * It is the question somebody asks holding the item: has this been
 * dispatched, did it come back before, is it even ours.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

/**
 * Source with runs of whitespace collapsed.
 *
 * Prose in JSX is wrapped by Prettier, so a sentence fragment worth
 * asserting on is regularly split across a line break — `never received`
 * became `never\n            received` the first time this ran. Matching
 * the raw file makes a passing assertion depend on the current line
 * width, which is not what any of these tests are about.
 */
const flat = (src: string): string => src.replace(/\s+/g, ' ');

const SELLER = R('../app/(authed)/inventory/units/_components/unit-trace-panel.tsx');
const SELLER_INDEX = R('../app/(authed)/inventory/units/_components/unit-discrepancies-index.tsx');
const SELLER_HOOKS = R('../lib/ops-hooks.ts');
const ADMIN = R('../../../admin/src/app/(authed)/inventory-units/_components/unit-trace-panel.tsx');
const ADMIN_INDEX = R(
  '../../../admin/src/app/(authed)/inventory-units/_components/unit-triage-index.tsx',
);
const ADMIN_HOOKS = R('../../../admin/src/lib/ops-hooks.ts');
const SERVICE = R('../../../api/src/modules/inventory-unit/services/stock-unit-report.service.ts');

describe('both panels are mounted', () => {
  it('the seller one, on the units page', () => {
    expect(SELLER_INDEX).toContain('<UnitTracePanel />');
  });

  it('the admin one, on the triage page', () => {
    expect(ADMIN_INDEX).toContain('<UnitTracePanel />');
  });
});

describe('the path each side calls', () => {
  it('the seller path carries only the serial — the server scopes it', () => {
    // Sending a sellerId from the browser would be a tenancy decision
    // made on the wrong side of the wire.
    expect(SELLER_HOOKS).toContain('/api/seller/stock-units/trace/${encodeURIComponent(serial)}');
    expect(SELLER_HOOKS).not.toContain('/api/seller/stock-units/trace/${sellerId}');
  });

  it('the admin path carries both, because a serial is not globally unique', () => {
    expect(ADMIN_HOOKS).toContain('/api/admin/stock-units/trace/${sellerId}/');
  });

  it('the serial is URL-encoded on both sides', () => {
    // A barcode may legitimately contain a slash or a #, and an
    // unencoded one silently becomes a different path.
    expect(SELLER_HOOKS).toContain('encodeURIComponent(serial)');
    expect(ADMIN_HOOKS).toContain('encodeURIComponent(serial)');
  });
});

describe('it does not ask a question nobody put', () => {
  it('the query is disabled until there is a serial', () => {
    // An empty lookup renders "no such unit", which reads as an answer.
    expect(SELLER_HOOKS).toContain("enabled: serial !== ''");
    expect(ADMIN_HOOKS).toContain("enabled: sellerId !== '' && serial !== ''");
  });

  it('a scan submits on Enter', () => {
    // A barcode gun types the number and presses Enter; requiring a
    // click means holding the item in one hand and the mouse in the other.
    for (const src of [SELLER, ADMIN]) expect(src).toContain("e.key === 'Enter'");
  });
});

describe('what it shows', () => {
  it('renders the transition, not just where the unit ended up', () => {
    // picked → in stock means a box was cancelled, and that IS the story.
    for (const src of [SELLER, ADMIN]) {
      expect(src).toContain('e.fromStatus === null');
      expect(src).toContain('e.toStatus');
    }
  });

  it('uses the shared status badge rather than a local colour map', () => {
    for (const src of [SELLER, ADMIN]) expect(src).toContain('<StockUnitStatusBadge');
  });

  it('the server returns events oldest-first, so the table reads as a story', () => {
    const trace = SERVICE.slice(SERVICE.indexOf('async trace('));
    expect(trace.slice(0, 1400)).toContain("orderBy: { createdAt: 'asc' }");
  });

  it('a miss says which of the two things happened', () => {
    // "Not found" leaves the holder unsure whether they mistyped or are
    // holding something that was never ours. Asserted on phrases with no
    // apostrophe: JSX escapes one to &apos;, so matching the plain form
    // fails on prose that is actually there.
    expect(flat(SELLER)).toContain('we never received');
    expect(flat(ADMIN)).toContain('never received as a tracked unit');
    expect(flat(ADMIN)).toContain('another company&apos;s');
  });
});
