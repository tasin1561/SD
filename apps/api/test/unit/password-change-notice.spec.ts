import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every path that changes a password must tell the owner.
 *
 * A password change the account holder did not make is
 * indistinguishable from a takeover until somebody tells them — and both
 * reset flows revoke every session in the same transaction, so at that
 * moment whoever set the password holds the only working credential.
 * The notice is the one thing standing between that and a silent,
 * permanent loss of the account.
 *
 * Checked STRUCTURALLY rather than behaviourally, for the same reason as
 * the worker-role gate: a path that forgets works perfectly in every
 * functional test — the password changes, the response is 200, the user
 * signs in fine. The only symptom is an email nobody notices is missing.
 *
 * If a new password-change path is added (an in-app "change password",
 * an admin-initiated reset), add it here and to the list it asserts on.
 */

const API = resolve(__dirname, '../..');

/** Every service that writes a password hash, and what it must send. */
const PATHS: ReadonlyArray<{ file: string; method: string; template: string }> = [
  {
    file: 'src/modules/staff-auth/staff-auth.service.ts',
    method: 'confirmPasswordReset',
    template: 'staff.password_changed.email',
  },
  {
    file: 'src/modules/seller-auth/seller-auth.service.ts',
    method: 'confirmPasswordReset',
    template: 'seller.password_changed.email',
  },
];

/** The body of one method, from its signature to the next one. */
function methodBody(src: string, method: string): string {
  const start = src.indexOf(`async ${method}(`);
  if (start === -1) return '';
  const rest = src.slice(start + 1);
  const nextIdx = rest.search(/\n {2}(?:async |private |public |\/\*\*)/);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

describe('a password change always notifies its owner', () => {
  it.each(PATHS)('$method in $file enqueues $template', ({ file, method, template }) => {
    const src = readFileSync(resolve(API, file), 'utf8');
    const body = methodBody(src, method);

    expect(body).not.toBe('');
    // In THIS method, not merely somewhere in the file — a notice
    // attached to the wrong method is worse than none, because it fires
    // on an unrelated action and trains people to ignore it. That is not
    // hypothetical: this exact block first landed inside
    // confirmEmailVerification, where verifying an address would have
    // announced a password change that never happened.
    expect(body).toContain(template);
  });

  it.each(PATHS)('$template exists in the seed', ({ template }) => {
    const seed = readFileSync(resolve(API, '../../packages/db/prisma/seed.ts'), 'utf8');
    // An enqueue naming a template nobody seeded fails at send time, in
    // a worker, where the only trace is a log line.
    expect(seed).toContain(`code: '${template}'`);
  });

  it.each(PATHS)('$method still revokes every session', ({ file, method }) => {
    // The notice tells them to sign in again; that is only true because
    // the reset kills existing sessions. If one stopped happening the
    // other would be a lie.
    const body = methodBody(readFileSync(resolve(API, file), 'utf8'), method);
    expect(body).toMatch(/RefreshToken\.updateMany/);
    expect(body).toContain('revokedAt');
  });
});
