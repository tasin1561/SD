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
});
