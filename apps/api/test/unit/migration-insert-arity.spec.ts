import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An `INSERT … (columns) VALUES (…)` in a migration must give every row as
 * many values as it names columns.
 *
 * `20260914230000_reseller_store_wallet` named `created_at, updated_at` and
 * supplied neither. Postgres refused it ("INSERT has more target columns
 * than expressions") — in CI, in every e2e shard and the browser job at
 * once, because a data migration is plain SQL: no typecheck, lint or unit
 * test runs it, and there is no local database here. This is the cheap
 * version of the check, the same reasoning as
 * `migrations-reference-real-tables.spec.ts`.
 *
 * Conservative on purpose: `INSERT … SELECT` and anything inside a
 * dollar-quoted body (a DO block or a function) is skipped rather than
 * guessed at.
 */

const MIGRATIONS = join(__dirname, '../../../../packages/db/prisma/migrations');

export interface InsertArity {
  readonly table: string;
  readonly columns: number;
  /** Values per VALUES row, in order. */
  readonly rows: readonly number[];
}

/**
 * Blank out comments, string literals, quoted identifiers' contents and
 * dollar-quoted bodies, keeping every other character (and the quotes
 * themselves) where it was — so a comma or bracket inside a string can
 * never be counted.
 */
function mask(sql: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const next = sql[i + 1] ?? '';
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i++) out.push(' ');
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        // The whole body is opaque: it is skipped, not parsed.
        out.push('$');
        for (i = i + 1; i < stop; i++) out.push(' ');
        continue;
      }
    }
    if (c === "'" || c === '"') {
      out.push(c);
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) {
          out.push('  ');
          i += 2;
          continue;
        }
        if (sql[i] === c) break;
        out.push(' ');
        i++;
      }
      out.push(c);
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

/** From the `(` at `open`, the index of its matching `)` and the top-level comma count. */
function group(s: string, open: number): { close: number; commas: number } | null {
  let depth = 0;
  let commas = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { close: i, commas };
    } else if (c === ',' && depth === 1) commas++;
  }
  return null;
}

/** Every `INSERT INTO t (cols) VALUES (…), (…)` in `sql`, with its arities. */
export function insertArities(sql: string): InsertArity[] {
  const s = mask(sql);
  const found: InsertArity[] = [];
  const head =
    /\bINSERT\s+INTO\s+((?:"[^"]*"|[A-Za-z_][\w.]*)(?:\s*\.\s*(?:"[^"]*"|[A-Za-z_]\w*))?)\s*\(/gi;
  for (let m = head.exec(s); m !== null; m = head.exec(s)) {
    const cols = group(s, m.index + m[0].length - 1);
    if (!cols) continue;
    // The masked table name keeps its quotes but not its letters; read it back.
    const table = sql
      .slice(m.index, m.index + m[0].length)
      .replace(/^INSERT\s+INTO\s+/i, '')
      .replace(/\s*\($/, '');
    const rest = s.slice(cols.close + 1);
    const values = /^\s*VALUES\s*/i.exec(rest);
    if (!values) continue; // INSERT … SELECT / DEFAULT VALUES: not ours to count.
    const rows: number[] = [];
    let at = cols.close + 1 + values[0].length;
    for (;;) {
      if (s[at] !== '(') break;
      const row = group(s, at);
      if (!row) break;
      rows.push(row.commas + 1);
      at = row.close + 1;
      const sep = /^\s*,\s*/.exec(s.slice(at));
      if (!sep) break;
      at += sep[0].length;
    }
    if (rows.length > 0) found.push({ table, columns: cols.commas + 1, rows });
  }
  return found;
}

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort();
}

describe('migration INSERT arity', () => {
  describe('the scanner', () => {
    it('counts a matched insert, with commas and brackets inside strings and calls', () => {
      const sql = `INSERT INTO "system_settings" ("id", "key", "description", "created_at")
        VALUES (uuidv7(), 'a.b', 'one, two (three)', now());`;
      expect(insertArities(sql)).toEqual([{ table: '"system_settings"', columns: 4, rows: [4] }]);
    });

    it('catches the shape that failed: columns named, values missing', () => {
      const sql = `INSERT INTO "system_settings" ("id", "key", "created_at", "updated_at")
        VALUES (uuidv7(), 'k') ON CONFLICT ("key") DO NOTHING;`;
      const [one] = insertArities(sql);
      expect(one?.columns).toBe(4);
      expect(one?.rows).toEqual([2]);
    });

    it('reads every row of a multi-row VALUES', () => {
      const sql = `INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5);`;
      expect(insertArities(sql)[0]?.rows).toEqual([2, 2, 1]);
    });

    it('ignores INSERT … SELECT, comments, escaped quotes and dollar-quoted bodies', () => {
      const sql = `
        -- INSERT INTO t (a, b) VALUES (1);
        INSERT INTO t (a, b) SELECT 1, 2;
        INSERT INTO t (a) VALUES ('it''s, fine');
        DO $$ BEGIN INSERT INTO t (a, b) VALUES (1); END $$;
      `;
      expect(insertArities(sql)).toEqual([{ table: 't', columns: 1, rows: [1] }]);
    });
  });

  it('every migration gives each VALUES row as many values as it names columns', () => {
    const problems: string[] = [];
    for (const dir of migrationDirs()) {
      const file = join(MIGRATIONS, dir, 'migration.sql');
      let sql: string;
      try {
        sql = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const ins of insertArities(sql)) {
        ins.rows.forEach((n, i) => {
          if (n !== ins.columns) {
            problems.push(
              `${dir}: INSERT INTO ${ins.table} names ${ins.columns} columns, row ${i + 1} has ${n} values`,
            );
          }
        });
      }
    }
    expect(problems).toEqual([]);
  });
});
