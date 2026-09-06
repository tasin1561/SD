import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every fire-and-forget writer is quiesced before the harness truncates.
 *
 * ── WHY THIS IS A TEST AND NOT A CONVENTION ──────────────────────────
 * A post-commit listener writes to the database AFTER the transaction
 * that triggered it has returned. In production that is exactly the
 * contract. In the e2e harness it races the reset: the INSERT holds a
 * RowShareLock on orders or sellers while the TRUNCATE wants an
 * AccessExclusiveLock, and Postgres kills one with a `40P01` that names
 * NEITHER the test nor the cause.
 *
 * It does not fail honestly. A deadlock only fires when the two overlap,
 * so it presents as one red shard out of four, in a suite that has
 * nothing to do with the listener — and re-running makes it green.
 *
 * CLAUDE.md has prescribed the fix since M11 ("track in-flight Promises
 * in a Set, expose drainInFlight(), await it in teardown"). It has been
 * forgotten three times anyway, most recently for the seller-issue
 * escalation added the same day this file was written. When this check
 * first ran, NINE services exposed `drainInFlight()` and FIVE were
 * awaited — the four that were not are ordinary money and webhook
 * listeners, each a latent 40P01.
 *
 * So the list is derived from the thing itself: anything that exposes
 * the method must appear in the harness.
 */
const API = resolve(__dirname, '../..');

/** Every service that declares it has in-flight work to drain. */
function drainables(): string[] {
  return globSync('src/modules/**/*.ts', { cwd: API })
    .filter((f) => /\bdrainInFlight\s*\(/.test(readFileSync(join(API, f), 'utf8')))
    .map((f) => {
      const src = readFileSync(join(API, f), 'utf8');
      return /export class (\w+)/.exec(src)?.[1] ?? '';
    })
    .filter((n) => n !== '');
}

describe('the e2e reset drains every fire-and-forget writer', () => {
  const harness = readFileSync(join(API, 'test/e2e/app-harness.ts'), 'utf8');
  const names = drainables();

  it('finds the drainable services to check', () => {
    // Guards against the glob matching nothing, which would make the
    // suite below pass by testing air.
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it.each(names)('%s is referenced by the harness', (name) => {
    // Named in `resetAuthState`'s drain chain — directly or through
    // `drainAll`. A service that writes after its caller returned and is
    // never awaited is a deadlock waiting for the right interleaving.
    expect(harness).toContain(name);
  });

  it('drains BEFORE the first truncate, not after', () => {
    // Order is the whole point: draining after the chain would quiesce
    // work that has already deadlocked against it.
    const firstDrain = harness.indexOf('drainNotificationListener(app)');
    const firstTruncate = harness.indexOf('await resetPhase1bState(prisma)');
    expect(firstDrain).toBeGreaterThan(-1);
    expect(firstTruncate).toBeGreaterThan(firstDrain);
  });
});
