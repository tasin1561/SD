import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { REDACTED_TOKEN, redactTokens } from '../../src/modules/email/redact-tokens';
import { bootTestApp, type AppHarness } from './app-harness';

/**
 * The one-off migration that redacted the credential links already in
 * `notification_logs` carries its own copy of `redactTokens`'s pattern,
 * transcribed into PostgreSQL's regex dialect. Two engines, one rule —
 * and the failure mode if they disagree is silent in the direction that
 * matters: Postgres matching LESS than JavaScript leaves live links in
 * the rows the migration reported as cleaned, with nothing anywhere
 * saying so.
 *
 * So the pattern is read out of the shipped migration and run through a
 * real Postgres over the same corpus the unit spec drives through the
 * TypeScript. A mocked database cannot do this: the whole question is
 * what PostgreSQL's ARE does with a negative lookahead, a bracket
 * expression that opens on `]`, and `[:space:]` — none of which
 * JavaScript's engine would answer the same way by construction.
 *
 * It also pins that the six copies of the pattern inside the migration
 * agree with each other. They are one rule written six times because
 * SQL has no constants; an edit that fixed one of them would otherwise
 * leave the other five redacting something different.
 */
const MIGRATION = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'migrations',
  '20260930000000_redact_stored_credential_links',
  'migration.sql',
);

/**
 * Every `regexp_replace(…, '<pattern>', '\1[redacted]', 'gi')` in the
 * file. Anchored on the pattern's own opening group and lazy up to the
 * replacement, so it reads the literal rather than guessing where the
 * first argument ends (one of them is `kv.value #>> '{}'`, which has
 * quotes of its own).
 */
function patternsInMigration(sql: string): string[] {
  const occurrence = /'(\(\[\?&;]token=\).*?)', '\\1\[redacted]', 'gi'\)/g;
  const found: string[] = [];
  for (const m of sql.matchAll(occurrence)) {
    const literal = m[1];
    if (literal !== undefined) found.push(literal.replaceAll("''", "'"));
  }
  return found;
}

/**
 * The shapes that actually occur, plus the ones that would break if the
 * value class drifted. The last four are the SURROUNDINGS of four real
 * production rows the migration was written against — the same markup,
 * the same punctuation after the link, the same token LENGTH and
 * alphabet — with the secrets themselves replaced. The shape is what
 * this is testing, and committing a real credential into a spec about
 * not keeping real credentials would be its own joke.
 */
const CORPUS = [
  'Go to https://x.io/reset?token=abc123 now',
  'https://x.io/a?token=abc123&lang=hi&x=1',
  'https://x.io/a?lang=hi&token=abc123',
  '<a href="https://x.io/v?token=abc123">Verify</a>',
  "<a href='https://x.io/v?token=abc123'>Verify</a>",
  'one ?token=aaa and two ?token=bbb',
  'a sentence about a token= and nothing else',
  'https://x.io/a?token=already&b=1',
  '(https://x.io/a?token=abc123)',
  '[link](https://x.io/a?token=abc123)',
  'https://x.io/a;token=abc123',
  'no token here at all',
  '',
  // Production shapes, 2026-09-30.
  '<p style="margin:0 0 16px">https://admin.skydrop.global/auth/reset-password?token=Aa0Bb1Cc2Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3O.</p>',
  '<a href="https://app.skydrop.global/auth/accept-invitation?token=Pp4Qq5Rr6Ss7Tt8Uu9Vv0Ww1Xx2Yy3Zz4Aa5Bb6Cc7D" style="display:inline-block">Accept</a>',
  'Open https://app.skydrop.global/auth/verify-email?token=Ee8Ff9Gg0Hh1Ii2Jj3Kk4Ll5Mm6Nn7Oo8Pp9Qq0Rr-S. This link expires in 30 minutes.',
  'https://app.skydrop.global/auth/accept-team-invitation?token=Tt1Uu2Vv3Ww4Xx5Yy6Zz7Aa8Bb9Cc0Dd1Ee2Ff3Gg4H\n\nThis invitation expires on 5 August.',
];

describe('Stored-credential redaction: the migration and the code agree (e2e)', () => {
  let h: AppHarness;
  let pattern: string;

  beforeAll(async () => {
    h = await bootTestApp();
    const found = patternsInMigration(readFileSync(MIGRATION, 'utf8'));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found).size).toBe(1);
    pattern = found[0] as string;
  });
  afterAll(async () => {
    await h.close();
  });

  async function inPostgres(input: string): Promise<string> {
    const rows = await h.prisma.$queryRaw<{ out: string }[]>`
      SELECT regexp_replace(${input}::text, ${pattern}::text, '\\1[redacted]', 'gi') AS out
    `;
    return rows[0]?.out ?? '';
  }

  it('produces byte-identical output to redactTokens on every shape', async () => {
    for (const input of CORPUS) {
      await expect(inPostgres(input)).resolves.toBe(redactTokens(input));
    }
  });

  it('is idempotent in Postgres, as it is in the code', async () => {
    for (const input of CORPUS) {
      const once = await inPostgres(input);
      await expect(inPostgres(once)).resolves.toBe(once);
    }
  });

  it('actually redacts — the corpus is not all no-ops', async () => {
    const redactedCount = (
      await Promise.all(CORPUS.map(async (c) => (await inPostgres(c)) !== c))
    ).filter(Boolean).length;
    expect(redactedCount).toBeGreaterThanOrEqual(12);
    await expect(inPostgres('?token=secret')).resolves.toBe(`?token=${REDACTED_TOKEN}`);
  });
});
