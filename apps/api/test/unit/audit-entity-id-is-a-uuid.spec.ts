import { globSync } from 'node:fs';
import { readFileSync } from 'node:fs';

/**
 * `audit_logs.entity_id` is a UUID column.
 *
 * Ten courier services passed a courier CODE — `entityId: 'delhivery'`
 * — so Postgres rejected every one of those inserts. Silently, because
 * AuditLogService swallows its own failures by design: an audit write
 * must never take down the operation it is describing.
 *
 * The result was a whole class of courier audit that had never once
 * landed in production, including the CUR-10 record of a live courier
 * write being attempted. It surfaced during the first real Delhivery
 * write, where the missing row was exactly what we needed to read.
 *
 * A literal string is the fingerprint: a real id is a variable. When an
 * audit is about a COURIER rather than a row, entityId is null and the
 * code goes in metadata, where it is queryable and honest.
 *
 * ── AND A VARIABLE CAN BE A CODE TOO (2026-09-09) ────────────────────
 * The literal check is necessary and was not sufficient. Three call
 * sites passed `input.courierCode` and a pickup-location `name` — not
 * literals, so invisible to the scan above, and lost to the same P2023.
 * One of them was the record of the Delhivery portal channel being
 * switched off, found by reading the process log after making the
 * change and noticing the audit had not been written.
 *
 * So the second scan below flags an expression whose NAME says it is not
 * an id: anything ending in `Code`, or a bare `name`. Deliberately a
 * name-shape heuristic rather than a type check — a lint rule cannot
 * see through `input.x`, and the naming convention here is strong
 * enough to be worth trusting. `AuditLogService` now also diverts a
 * non-UUID into `metadata.entityRef` rather than losing the row, so
 * this is the early warning and that is the backstop.
 */
describe('audit entityId is never a literal string', () => {
  const files = globSync('src/modules/**/*.service.ts', { cwd: process.cwd() });

  it('scans a meaningful number of services', () => {
    // Guards against the glob matching nothing and the suite passing
    // vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s', (rel) => {
    const src = readFileSync(rel, 'utf8');
    const offenders = [...src.matchAll(/entityId:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it.each(files)('%s — and not a code-shaped variable either', (rel) => {
    const src = readFileSync(rel, 'utf8');
    const offenders = [...src.matchAll(/entityId:\s*([A-Za-z_$][\w.$]*)\s*,/g)]
      .map((m) => m[1] ?? '')
      // The last segment is what names the value: `input.courierCode`
      // is a code, `link.orderId` is an id.
      .filter((expr) => {
        const leaf = expr.split('.').pop() ?? '';
        return /Code$/.test(leaf) || leaf === 'name' || /Name$/.test(leaf);
      });
    expect(offenders).toEqual([]);
  });
});
