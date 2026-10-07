import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A CREDENTIAL template must actually be classified as one.
 *
 * ── WHY THIS IS A SOURCE TEST ────────────────────────────────────────
 * `categoryForTemplate()` lives in `packages/db/prisma/seed.ts`, which
 * is a script and exports nothing. It decides, from the template's CODE,
 * which `NotificationCategory` the row is seeded with — and NOTIF-9
 * hangs everything on that category: CREDENTIAL is `[EMAIL]` and
 * `mutable: false`, while OPERATIONAL is `mutable: true` and permits
 * IN_APP.
 *
 * ── THE ACCIDENT THIS CATCHES, WHICH HAS HAPPENED ────────────────────
 * CLAUDE.md names it exactly: "a new credential template whose code does
 * not match that regex silently becomes OPERATIONAL and therefore
 * in-app-able, which is the one way this rule can be lost." It then
 * happened. `staff.impersonation_otp.email` — the six-digit second
 * factor for going inside a seller's account — matched none of
 * `invitation|invite|password_reset|password_changed|email_verification|
 * email_change|welcome`, so it seeded OPERATIONAL. Two consequences, and
 * the second is the serious one:
 *
 *   - MUTABLE. The staff member it protects could switch it off, and
 *     `assertMutable` would have recorded the mute, after which their
 *     own second factor stops arriving.
 *   - IN_APP permitted. A one-time code delivered to the console the
 *     person is already signed into is not a second factor. It is
 *     visible to anybody who already has their session, which is the
 *     precise thing the second factor exists to defend against.
 *
 * Nothing failed. The template rendered, the mail sent, the feature
 * worked — the category is only consulted when somebody tries to mute
 * it or when a fan-out resolves channels, both of which happen later and
 * elsewhere.
 *
 * ── WHY TWO VOCABULARIES AND NOT ONE ─────────────────────────────────
 * Testing the regex with the regex is circular. So this holds the
 * classifier's pattern against an INDEPENDENT list of words that signal
 * "this message carries a credential" — and drift in EITHER direction
 * fails: a code the signal list recognises and the regex does not is the
 * bug above; a code the regex calls credential that carries no signal at
 * all is the regex having grown too greedy, which would make an
 * ordinary operational message unmutable and email-only. The M10 F6
 * technique: a test may compare two things a module may not.
 */
const SEED = join(__dirname, '../../../../packages/db/prisma/seed.ts');

/** The classifier's own pattern, read out of the file it lives in. */
function credentialPattern(src: string): RegExp {
  const m = /const credential =\s*\/\((.*?)\)\/\.test\(/s.exec(src);
  if (m?.[1] === undefined) {
    throw new Error(
      'Could not find the credential regex in seed.ts. If `categoryForTemplate` was ' +
        'refactored, point this test at the new shape rather than deleting it.',
    );
  }
  return new RegExp(`(${m[1].replace(/\s+/g, '')})`);
}

/** Every `code:` in the seeded template list. */
function templateCodes(src: string): readonly string[] {
  return [...new Set([...src.matchAll(/^\s*code: '([a-z0-9_.]+)',$/gm)].map((m) => m[1]!))].sort();
}

/**
 * Words that mean "this message carries a credential or a way in".
 *
 * Maintained BY HAND and deliberately independent of the regex. Add a
 * word here when a new kind of credential message exists; the test then
 * tells you whether the classifier agrees.
 */
const CREDENTIAL_SIGNALS: readonly string[] = [
  'otp',
  'one_time',
  'verification',
  'reset',
  'invite',
  'invitation',
  'password',
  'welcome',
];

describe('credential notification templates are classified as CREDENTIAL', () => {
  const src = readFileSync(SEED, 'utf8');
  const credential = credentialPattern(src);
  const codes = templateCodes(src);

  it('found the template list and the classifier (the scan still works)', () => {
    // A regex that stops matching returns nothing, and nothing passes
    // every check below. This is the floor that makes the rest mean
    // something.
    expect(codes.length).toBeGreaterThan(50);
    expect(credential.test('seller.invitation.email')).toBe(true);
  });

  it('every template whose code signals a credential is one', () => {
    const missed = codes.filter(
      (code) => CREDENTIAL_SIGNALS.some((w) => code.includes(w)) && !credential.test(code),
    );
    // The failure message IS the instruction: each line is a template
    // that will seed OPERATIONAL — mutable, and eligible for in-app
    // delivery — while carrying something only its recipient should see.
    expect(missed).toEqual([]);
  });

  it('nothing is called a credential that carries no credential signal', () => {
    // The other direction. A regex that grew too greedy would make an
    // ordinary message unmutable and email-only, which is a worse
    // product rather than a worse secret — but it is still the
    // classifier lying about what a template is.
    const overreach = codes.filter(
      (code) => credential.test(code) && !CREDENTIAL_SIGNALS.some((w) => code.includes(w)),
    );
    expect(overreach).toEqual([]);
  });

  it('the staff impersonation code is CREDENTIAL, by name', () => {
    // Named explicitly as well as swept, because this is the one the
    // sweep was written for and a future edit to CREDENTIAL_SIGNALS
    // could take it out of scope without anybody noticing.
    expect(credential.test('staff.impersonation_otp.email')).toBe(true);
  });
});
