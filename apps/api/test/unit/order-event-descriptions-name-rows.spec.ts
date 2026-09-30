import { globSync, readFileSync } from 'node:fs';

import { parcelLabel } from '../../src/common/text/parcel-label';

/**
 * An order's history is read by the SELLER, and it named rows by uuid.
 *
 * `OrderWriteService.transitionStatus`'s `reason` becomes the
 * STATUS_CHANGED event's `description` verbatim, and that description is
 * what the order page's Full history prints. Seven of them interpolated
 * a uuid — "Pack completed on shipment
 * 01a022a9-e38f-79fb-8d12-f656b7b541ea" — while the parcel's own
 * `shipment_number` sat one column away in the same row, and an eighth
 * named a `call_attempts` row the same way.
 *
 * A uuid is not an identifier to a person. It cannot be read out over a
 * phone, cannot be recognised as the parcel they were just looking at on
 * the same page, and matches nothing in any search box we ship. It was
 * found by somebody filming a tutorial and reading the screen.
 *
 * ── WHY A SOURCE SCAN AND NOT ONLY BEHAVIOURAL TESTS ─────────────────
 * The eight sites are in six services across five modules, and a
 * behavioural test per site pins the site it was written for and says
 * nothing about the ninth. The defect is a SHAPE — "an id variable
 * interpolated into a sentence" — and the shape is what a scan can see.
 * Same technique as `audit-entity-id-is-a-uuid.spec.ts`, which exists
 * because the identical class of mistake kept arriving in new files.
 *
 * ── WHAT THIS DOES NOT FIX (ORD-4) ───────────────────────────────────
 * `order_events` is append-only by construction. Every description
 * already stored keeps its uuid for ever, and rewriting them is exactly
 * what an append-only table exists to prevent. This reaches new events
 * only.
 */
describe('a transition reason never names a row by its uuid', () => {
  const files = globSync('src/modules/**/*.service.ts', { cwd: process.cwd() });

  it('scans a meaningful number of services', () => {
    // Guards against the glob matching nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it('interpolates no *Id variable into a `reason:` sentence', () => {
    // `reason:` followed by a template literal. The fingerprint of the
    // defect is an interpolation whose expression is an identifier
    // ENDING in `Id` (shipmentId, attemptId, orderId…) or a bare `id` —
    // the same name-shape heuristic the audit scan uses, and for the
    // same reason: a static scan cannot see through `input.x`, but this
    // codebase's naming is strong enough to trust.
    const reasonTemplate = /\breason:\s*`([^`]*)`/g;
    const idInterpolation = /\$\{\s*(?:[A-Za-z0-9_$.]+\.)?([A-Za-z0-9_$]*(?:[Ii]d))\s*\}/;

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(reasonTemplate)) {
        const body = m[1] ?? '';
        const hit = idInterpolation.exec(body);
        if (hit === null) continue;
        // `${...Id}` reaching a sentence a person reads. A readable name
        // for the row belongs there instead — the shipment's number, the
        // order's number, the ticket's number, the call's ordinal.
        offenders.push(`${file}: reason: \`${body}\``);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('parcelLabel', () => {
  it('prefers the parcel number a person can read', () => {
    expect(
      parcelLabel({ id: '01a022a9-e38f-79fb-8d12-f656b7b541ea', shipmentNumber: 'SH-2026-000123' }),
    ).toBe('SH-2026-000123');
  });

  it('falls back to the uuid rather than printing nothing', () => {
    // A row described badly is better than a row described as nothing:
    // the sentence still identifies SOMETHING a support engineer can
    // look up. Mirrors `ticketNumber ?? ticketId`.
    const id = '01a022a9-e38f-79fb-8d12-f656b7b541ea';
    expect(parcelLabel({ id })).toBe(id);
    expect(parcelLabel({ id, shipmentNumber: null })).toBe(id);
    expect(parcelLabel({ id, shipmentNumber: '   ' })).toBe(id);
  });
});
