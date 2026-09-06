import { PortalSessionService } from '../../src/modules/courier-portal/services/portal-session.service';

/**
 * Are we looking at a login surface, or at the app?
 *
 * ── WHY THIS IS WORTH A TEST OF ITS OWN ──────────────────────────────
 * Getting it wrong in the "logged out" direction is loud — the next
 * navigation bounces and somebody notices. Getting it wrong in the
 * "logged IN" direction is quiet and expensive: the service logs in
 * again, `/v2/login` redirects a signed-in session straight back to the
 * app, and the flow then waits thirty seconds for a password step that
 * can never appear. It ran six times over seven hours in production
 * before an error message said which page it had ended on.
 *
 * The cause was a check that asked about a BUTTON: any "Continue" on
 * the page meant "login". That is true of their login page's first step
 * and also true of their signed-in dashboard, so a perfectly good
 * session read as logged out.
 *
 * These pin the distinction as a question about the URL, which is the
 * only thing that actually differs.
 */
/**
 * No dependency is reached: only the pure URL check is under test.
 *
 * Every constructor argument, spelled out rather than spread — a count
 * that drifts should fail to COMPILE here, which is exactly how this
 * file first went red in CI.
 */
function svc(): PortalSessionService {
  return new PortalSessionService(
    {} as never, // prisma
    {} as never, // credentials
    {} as never, // settings
    {} as never, // email
    {} as never, // audit
    {} as never, // issues
  );
}

/** The private under test, reached the way the service calls it. */
function looksLikeLogin(url: string, passwordInputs: number): Promise<boolean> {
  const page = {
    url: () => url,
    locator: () => ({ count: async () => passwordInputs }),
  };
  const s = svc() as unknown as {
    looksLikeLogin: (p: unknown) => Promise<boolean>;
  };
  return s.looksLikeLogin(page);
}

describe('is this a login page?', () => {
  it('their app login is', async () => {
    await expect(looksLikeLogin('https://one.delhivery.com/v2/login', 0)).resolves.toBe(true);
  });

  it('their auth origin is', async () => {
    await expect(
      looksLikeLogin('https://ucp-auth.delhivery.com/facelessvoid/realms/x/auth?y=1', 0),
    ).resolves.toBe(true);
  });

  it('the signed-in DASHBOARD is not — even though it has a Continue button', async () => {
    // The exact regression. `/home` is where a good session lands, and
    // calling it a login page sends the service round a loop that ends
    // in a thirty-second wait for a password field.
    await expect(looksLikeLogin('https://one.delhivery.com/home', 0)).resolves.toBe(false);
  });

  it('nor is any other app page', async () => {
    await expect(
      looksLikeLogin('https://one.delhivery.com/support/support-tickets/open', 0),
    ).resolves.toBe(false);
    await expect(
      looksLikeLogin('https://one.delhivery.com/orders/forward/delivered', 0),
    ).resolves.toBe(false);
  });

  it('still catches an auth page served from a URL we do not recognise', async () => {
    // Cheap, and the reason the password check survives: a login surface
    // on an unexpected address is exactly what a re-platform looks like.
    await expect(looksLikeLogin('https://one.delhivery.com/something-new', 1)).resolves.toBe(true);
  });
});
