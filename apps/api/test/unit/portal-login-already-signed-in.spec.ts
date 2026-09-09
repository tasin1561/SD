import { PortalSessionService } from '../../src/modules/courier-portal/services/portal-session.service';

/**
 * The password step is allowed to not happen.
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────
 * `login()` asserted on its STEPS: it walked email → Continue →
 * password, and threw "the password step never appeared" when the field
 * did not show up. But Delhivery's session re-establishes itself
 * mid-flow — /home bounces to /v2/login (so the probe correctly decides
 * to log in), and then around the email step the app recognises the
 * stored session and drops us on /home: signed in, with no password
 * ever asked for.
 *
 * That threw fifteen nights running, and the issue it raised said their
 * login flow had moved. It had not. The tell was that the WALLET sync
 * kept working the whole time — both jobs share one persisted
 * `storageState`, so whichever runs first does the real login and the
 * second arrives to a warm session, which is exactly the case that was
 * mishandled. A sweep that fails only when it is second in line is not
 * a broken login.
 *
 * The general lesson is ATT-1's, in a different subsystem: when a step
 * does not happen, re-read the thing that would still be broken. Here
 * that is "are we authenticated", not "did a field render".
 *
 * ── WHY THE DECISION AND NOT THE FLOW ────────────────────────────────
 * Driving the whole of `login()` needs a fake that answers `goto`,
 * `waitForURL`, `getByRole`, `getByText`, `evaluate` and more, and each
 * branch added demands another stub — the test ends up pinning the mock
 * rather than the logic. The verdict is the part that was wrong, so the
 * verdict is what is named and tested.
 */
function svc(): PortalSessionService {
  // Nothing is reached: the verdict asks the page and nothing else.
  return new PortalSessionService(
    {} as never, // prisma
    {} as never, // credentials
    {} as never, // settings
    {} as never, // email
    {} as never, // audit
    {} as never, // issues
  );
}

function verdict(
  url: string,
  counts: { passwordInputs?: number; captchas?: number; otps?: number } = {},
): Promise<string> {
  const page = {
    url: () => url,
    locator: (selector: string) => ({
      count: async () => {
        if (/recaptcha|hcaptcha|sitekey/i.test(selector)) return counts.captchas ?? 0;
        if (/one-time-code|otp/i.test(selector)) return counts.otps ?? 0;
        if (/password/i.test(selector)) return counts.passwordInputs ?? 0;
        return 0;
      },
    }),
  };
  const s = svc() as unknown as {
    verdictOnMissingPassword: (p: unknown) => Promise<string>;
  };
  return s.verdictOnMissingPassword(page);
}

describe('no password was asked for — is that a failure?', () => {
  it('lands inside the app ⇒ SIGNED IN', async () => {
    // The case that was throwing every night.
    await expect(verdict('https://one.delhivery.com/home')).resolves.toBe('SIGNED_IN');
  });

  it('any other page of theirs counts too', async () => {
    // "Signed in" is not one blessed URL: the app bounces a live session
    // to wherever it likes, and pinning /home would re-break this the
    // first time they change their landing page.
    await expect(verdict('https://one.delhivery.com/finances')).resolves.toBe('SIGNED_IN');
  });

  it('still sat on their auth origin ⇒ NOT SIGNED IN', async () => {
    // No password field on the page whose whole job is to collect one.
    // That is the real "their flow moved" case and must keep shouting.
    await expect(verdict('https://ucp-auth.delhivery.com/realms/x/auth')).resolves.toBe(
      'NOT_SIGNED_IN',
    );
  });

  it('still on their login page ⇒ NOT SIGNED IN', async () => {
    await expect(verdict('https://one.delhivery.com/v2/login')).resolves.toBe('NOT_SIGNED_IN');
  });

  it('a captcha is reported as a CAPTCHA, not as a missing field', async () => {
    // Needs a person to go and answer something. Reporting it as a
    // missing password sends whoever reads it looking at our selectors.
    await expect(verdict('https://one.delhivery.com/challenge', { captchas: 1 })).resolves.toBe(
      'CAPTCHA',
    );
  });

  it('an OTP prompt is reported as an OTP', async () => {
    await expect(verdict('https://one.delhivery.com/challenge', { otps: 1 })).resolves.toBe('OTP');
  });

  it('a challenge on an app URL is NOT read as being signed in', async () => {
    // The ordering that matters: a challenge page is on their origin and
    // carries no login form, so "are we signed in" would answer yes and
    // walk on into a session that does not exist. The challenge is
    // checked FIRST.
    await expect(verdict('https://one.delhivery.com/home', { captchas: 1 })).resolves.toBe(
      'CAPTCHA',
    );
  });

  it('a password field present but never visible is still NOT signed in', async () => {
    // Their auth page carries a hidden decoy password input. Its
    // presence means we are looking at a login surface, whatever the
    // URL says.
    await expect(
      verdict('https://one.delhivery.com/somewhere', { passwordInputs: 1 }),
    ).resolves.toBe('NOT_SIGNED_IN');
  });
});
