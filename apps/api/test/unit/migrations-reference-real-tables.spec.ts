import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A migration may only touch tables that already exist.
 *
 * `20260813200000_customers_manage_permission` shipped referencing
 * `seller_role_definitions`, which is the PRISMA MODEL name. The table is
 * `seller_roles` — the model carries an `@@map`. Nothing local caught it:
 * a data migration is plain SQL, so there is no typecheck, no lint and no
 * unit test between writing it and `migrate deploy` running it against a
 * real database. CI found it, two jobs deep, and a full cycle is an
 * expensive way to learn a table name.
 *
 * This is the cheap version of the same check. It reads every migration
 * in the order Prisma applies them, tracks what has been CREATEd so far,
 * and fails when one reads or writes something that does not exist yet.
 *
 * Deliberately conservative: it only inspects statements where the table
 * name is unambiguous, and skips anything it cannot parse confidently.
 * A gate that guesses would either block real migrations or teach people
 * to ignore it.
 */

const MIGRATIONS = join(__dirname, '../../../../packages/db/prisma/migrations');

/** Tables Postgres provides; a migration may reference them freely. */
const BUILT_IN = new Set(['pg_catalog', 'pg_stat_activity', 'information_schema']);

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort(); // Prisma applies in lexicographic order, which is timestamp order.
}

/** Strip comments and string literals so neither can look like SQL. */
function sqlOnly(raw: string): string {
  return raw
    .split('\n')
    .map((l) => {
      const at = l.indexOf('--');
      return at === -1 ? l : l.slice(0, at);
    })
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");
}

const ident = String.raw`"?([a-zA-Z_][a-zA-Z0-9_]*)"?`;

function created(sql: string): string[] {
  return [
    ...Array.from(
      sql.matchAll(
        new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ident}`, 'gi'),
      ),
      (m) => m[1] as string,
    ),
    // A view or a materialised view is equally referenceable afterwards.
    ...Array.from(
      sql.matchAll(new RegExp(String.raw`CREATE\s+(?:MATERIALIZED\s+)?VIEW\s+${ident}`, 'gi')),
      (m) => m[1] as string,
    ),
  ];
}

function referenced(sql: string): string[] {
  const out: string[] = [];
  for (const kw of ['INSERT\\s+INTO', 'UPDATE', 'DELETE\\s+FROM', 'ALTER\\s+TABLE']) {
    for (const m of sql.matchAll(new RegExp(String.raw`\b${kw}\s+(?:ONLY\s+)?${ident}`, 'gi'))) {
      out.push(m[1] as string);
    }
  }
  // FROM / JOIN also introduce aliases and subqueries; only take the
  // shape where a bare identifier directly follows the keyword.
  for (const m of sql.matchAll(new RegExp(String.raw`\b(?:FROM|JOIN)\s+${ident}`, 'gi'))) {
    out.push(m[1] as string);
  }
  return out;
}

describe('every migration references tables that exist by then', () => {
  const dirs = migrationDirs();

  it('found the migrations directory', () => {
    // Without this the loop below iterates nothing and passes vacuously.
    expect(dirs.length).toBeGreaterThan(10);
  });

  it('no migration touches a table no earlier migration created', () => {
    const exists = new Set<string>(BUILT_IN);
    const problems: string[] = [];

    for (const dir of dirs) {
      const file = join(MIGRATIONS, dir, 'migration.sql');
      let raw: string;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        continue; // a directory without a migration.sql is not ours to judge
      }
      const sql = sqlOnly(raw);

      // Everything this migration creates counts as existing for its own
      // later statements — a CREATE TABLE then INSERT INTO is normal.
      for (const t of created(sql)) exists.add(t.toLowerCase());

      for (const t of referenced(sql)) {
        const name = t.toLowerCase();
        // Aliases and CTEs read like tables; only flag names that look
        // like real tables (snake_case, plural-ish) and are unknown.
        if (exists.has(name)) continue;
        if (!name.includes('_')) continue; // `r`, `p`, `existing` — aliases
        problems.push(`${dir}: ${t}`);
      }
    }

    expect(problems).toEqual([]);
  });
});
