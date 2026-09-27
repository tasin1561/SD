import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every login refuses an unknown address AFTER paying the argon2 cost.
 *
 * The bodies were always generic; the TIMING was not. A `login()` that
 * returns before `argon2.verify` runs is ~50 ms faster than one that
 * checks a real hash, which is measurable over HTTP and answers "does
 * this address have an account here". For a store user, whose email is
 * globally unique, it answers "is this address a reseller-store login
 * anywhere in the system".
 *
 * `PasswordService.verifyDummy` burns that cost against a hash nothing
 * can match. This spec reads the SOURCE because the regression to catch
 * is somebody deleting the line: a behavioural test can only assert the
 * call for a service that has a fake to drive it (staff and seller do —
 * see their own specs; store-auth has none), and a wall-clock assertion
 * on argon2 is precisely the test that goes flaky on a loaded runner.
 *
 * The invariant asserted: in each `login()`, the first thing that can
 * refuse the caller must be preceded by argon2 work.
 */

const SERVICES = [
  'staff-auth/staff-auth.service.ts',
  'seller-auth/seller-auth.service.ts',
  'store-auth/store-auth.service.ts',
] as const;

const MODULES = join(__dirname, '..', '..', 'src', 'modules');

/** The text of `async login(` up to the next method at class indentation. */
function loginBody(source: string, file: string): string {
  const start = source.indexOf('  async login(');
  if (start === -1) throw new Error(`${file}: no \`async login(\` found`);
  const rest = source.slice(start + 1);
  const end = rest.search(
    /\n {2}(?:\/\*\*|\/\/|(?:private |protected |public )?async |[A-Za-z]+\()/,
  );
  return end === -1 ? rest : rest.slice(0, end);
}

describe('login timing parity (no exists-oracle)', () => {
  it.each(SERVICES)('%s pays the argon2 cost before its first refusal', (file) => {
    const body = loginBody(readFileSync(join(MODULES, file), 'utf8'), file);

    const firstRefusal = body.indexOf('throw this.invalidCredentials()');
    expect(firstRefusal).toBeGreaterThan(-1);

    const firstDummy = body.indexOf('this.password.verifyDummy(');
    expect(firstDummy).toBeGreaterThan(-1);
    // BEFORE the refusal, not merely somewhere in the method.
    expect(firstDummy).toBeLessThan(firstRefusal);
  });
});
