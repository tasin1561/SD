import { Injectable } from '@nestjs/common';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { gotoPortal } from '../pages/navigate';
import {
  CourierCredentialService,
  courierActor,
} from '../../courier-shared/services/courier-credential.service';
import { PortalNetworkWatch } from './shiprocket-portal-network';
import {
  describeEgress,
  egressCountryMatches,
  probeEgress,
  type EgressReading,
} from '../../../common/net/egress-probe';

export const SR_PORTAL_ORIGIN = 'https://app.shiprocket.in';
export const SR_PORTAL_PROXY_SETTING = 'courier.shiprocket_portal_proxy';
/**
 * The control server of the VPN the proxy above goes through, asked
 * before a browser is launched — see `common/net/egress-probe.ts`.
 *
 * EMPTY means no check, and that is the honest setting for the SSH
 * tunnel, which has no such endpoint. **Set it only when the proxy IS
 * that VPN**: pointed at a VPN the browser does not use, it would assert
 * confidently about an egress nothing goes through, which is worse than
 * not asking. /cost-sync draws the proxy and this reading side by side
 * so a person can see the two agree.
 */
export const SR_PORTAL_EGRESS_CHECK_SETTING = 'courier.shiprocket_portal_egress_check_url';
/** The country that check must report. EMPTY accepts any, as long as it is up. */
export const SR_PORTAL_EGRESS_COUNTRY_SETTING = 'courier.shiprocket_portal_egress_country';
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';
/** Long enough for their router to bounce a session it will not honour.
 *  Measured at well under 4s on 2026-09-28; 6 leaves room. */
const SETTLE_AFTER_LOGIN_MS = 6_000;

/**
 * The cross-origin call their sign-in depends on, and the one their edge
 * refuses (see `desktopChromeUserAgent`). Asked as a bare CORS preflight
 * — no credentials, no login attempt — so "would a sign-in even be
 * allowed to complete from here" is answerable for free.
 */
const SR_LOGIN_USER_URL = 'https://apiv2.shiprocket.co/v1/auth/login/user?is_web=1';
/** Short: this sits in front of a login, and a hung probe is a hung night. */
const EDGE_PROBE_TIMEOUT_MS = 15_000;

export class ShiprocketPortalProxyMissingError extends Error {
  constructor() {
    super(
      `${SR_PORTAL_PROXY_SETTING} is empty. Shiprocket's panel is India-only, so the browser ` +
        'goes out through the Bangalore tunnel and NEVER directly — a login from a foreign ' +
        'address is exactly what the tunnel exists to avoid.',
    );
    this.name = 'ShiprocketPortalProxyMissingError';
  }
}

/**
 * The browser's proxy is not coming out where it should, so nothing was
 * launched.
 *
 * ── WHY IT IS ITS OWN ERROR ──────────────────────────────────────────
 * A VPN that is DOWN already fails safely — the container's firewall
 * carries no traffic while the tunnel is not up, so a browser pointed at
 * its proxy simply cannot connect. What that cannot catch is a VPN that
 * is perfectly healthy in the WRONG PLACE, and that is not
 * hypothetical: on 2026-09-28 a server-rotation misconfiguration left
 * ours connected to an Indian entry node while egressing in Atlanta, and
 * the only sign was a 403 on the panel's own document inside a browser
 * trace. Refusing here spends no sign-in on it and says which of the two
 * it was.
 */
export class ShiprocketPortalEgressError extends Error {
  constructor(
    readonly reason: string,
    readonly reading: EgressReading | null,
  ) {
    super(
      `The Shiprocket panel browser was not started: ${reason}. Nothing signs in until the ` +
        'egress is what it should be — a run from the wrong address burns a login attempt and ' +
        'teaches us nothing.',
    );
    this.name = 'ShiprocketPortalEgressError';
  }
}

export class ShiprocketPortalCredentialsMissingError extends Error {
  constructor() {
    super(
      'This Shiprocket account has no website login stored (portalUsername / portalPassword). ' +
        'Add it on /courier-accounts → Portal login.',
    );
    this.name = 'ShiprocketPortalCredentialsMissingError';
  }
}

export class ShiprocketPortalChallengeError extends Error {
  constructor(
    readonly challenge: 'OTP' | 'CAPTCHA' | 'UNKNOWN',
    readonly artifactPath: string | null,
    readonly url: string,
  ) {
    super(`Shiprocket presented a ${challenge} challenge at ${url}`);
    this.name = 'ShiprocketPortalChallengeError';
  }
}

/**
 * Their edge accepted the sign-in and the panel still would not open.
 *
 * DISTINCT FROM A CHALLENGE ON PURPOSE. A challenge is a person's job
 * and freezes everything until somebody answers it. This is Shiprocket's
 * side refusing a session whose credentials they just accepted — nothing
 * an operator types will fix it, and it needs their account manager
 * rather than a fresh login. Measured on 2026-09-28: the panel's
 * `POST apiv2.shiprocket.co/v1/auth/login` returned 200 with a valid
 * ten-day JWT, and the app bounced straight back to `/newlogin` while
 * every later call answered 401. Reported as an expired session for a
 * week, which is the one thing it was not.
 */
export class ShiprocketPortalSignInRejectedError extends Error {
  constructor(
    readonly url: string,
    /** What the browser could not load, if anything was recorded. */
    readonly networkSummary: string | null,
  ) {
    super(
      'Shiprocket accepted the sign-in and then would not open the panel — the browser was sent ' +
        `back to ${url}. This is not an expired session and not a wrong password: their own ` +
        'sign-in call succeeded. Logging in again will not help.' +
        (networkSummary === null ? '' : `\n\n${networkSummary}`),
    );
    this.name = 'ShiprocketPortalSignInRejectedError';
  }
}

/**
 * A User-Agent that does not say `HeadlessChrome`, built from the
 * browser's own version so it never goes stale.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * `apiv2.shiprocket.co/v1/auth/login/user` sits behind an AWS WAF that
 * refuses a request on EITHER of two signals, and both were true of us
 * at once — which is why two investigations each found half the answer
 * and contradicted each other. Measured 2026-09-29, as a bare CORS
 * preflight needing no credentials, repeated five times per cell:
 *
 * |                       | Chrome UA | HeadlessChrome UA |
 * |-----------------------|-----------|-------------------|
 * | NordVPN Mumbai        | **200**   | 403               |
 * | DigitalOcean (either) | 403       | 403               |
 *
 * A refusal is a CloudFront error page carrying no
 * `access-control-allow-origin`, so the browser reports the POST as
 * `net::ERR_FAILED` and their Angular app as `status: 0` — which looks
 * exactly like a network fault and is why this read as "the session is
 * not honoured" for a week. The address half is `courier.shiprocket_portal_proxy`
 * (docs/infrastructure.md §7b); this is the browser half, and the ONLY
 * token that changes the answer is `HeadlessChrome` → `Chrome`. Platform
 * and version are not read: a Linux UA passes, so this claims the
 * platform it is actually running on rather than pretending to be
 * Windows.
 *
 * Delhivery's portal is deliberately NOT changed — it signs in today,
 * and altering the browser it presents to a working site to fix a
 * different one is a change with no way to tell whether it helped.
 */
export function desktopChromeUserAgent(browserVersion: string): string {
  const major = /^(\d+)\./.exec(browserVersion)?.[1];
  // Real Chrome reduces its UA to <major>.0.0.0; matching that keeps the
  // string one a browser would actually send.
  const version = major === undefined ? browserVersion : `${major}.0.0.0`;
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

/**
 * The client hints that go with that UA.
 *
 * Chromium sends `sec-ch-ua: "HeadlessChrome";v="149"` whatever the UA
 * says, so setting only the UA leaves the same word in the same request
 * — measured as not read by this rule today, and left contradicting
 * itself it is the obvious thing a stricter rule would key on next.
 * The platform stays `Linux`, which is true and agrees with the UA.
 */
export function desktopChromeClientHints(browserVersion: string): Record<string, string> {
  const major = /^(\d+)\./.exec(browserVersion)?.[1] ?? browserVersion;
  return {
    'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
  };
}

/**
 * Did their edge refuse us, rather than their application answer?
 *
 * Pure, and NARROW ON PURPOSE. The one measured refusal is a 403 from
 * CloudFront with no `access-control-allow-origin` — an edge rule, before
 * anything of theirs has read the request. Anything else is their
 * application talking and must not stop a run: this sits in front of a
 * sign-in, and a check that fires on a signal it does not understand
 * stops the nightly reads for a reason nobody can act on. Fails open by
 * construction, like `assertNotBlocked` (SCAN-2).
 */
export function shiprocketEdgeRefusal(
  status: number,
  headers: Readonly<Record<string, string>>,
): string | null {
  const allowOrigin = (headers['access-control-allow-origin'] ?? '').trim();
  if (status !== 403 || allowOrigin !== '') return null;
  const by = (headers['server'] ?? '').trim();
  return (
    `their edge refused the call a sign-in depends on (${status}` +
    (by === '' ? '' : ` from ${by}`) +
    '), so this address is blocked rather than this password being wrong'
  );
}

/** Pure, so it can be tested without a browser: is this a login page? */
export function isShiprocketLoginUrl(url: string): boolean {
  return /^https:\/\/app\.shiprocket\.in\/(newlogin|login)(?=[/?#]|$)/.test(url);
}

/**
 * `gotoPortal`, plus the one detour that is an ANSWER rather than a
 * failure here: their Angular router bouncing a signed-out visit to the
 * login page. `gotoPortal` rethrows an interruption that lands somewhere
 * other than the target — right in general, wrong for this one place,
 * where landing on login is exactly what the caller checks for next.
 */
export async function gotoShiprocket(page: Page, url: string): Promise<void> {
  try {
    await gotoPortal(page, url);
  } catch (err) {
    // Only the interruption race — a timeout or a dead network that
    // happens to leave the page on a login url is still a failure.
    const message = err instanceof Error ? err.message : String(err);
    if (!/interrupted by another navigation/i.test(message)) throw err;
    if (!isShiprocketLoginUrl(page.url())) throw err;
  }
}

export interface ShiprocketPortalHandle {
  readonly page: Page;
  /** A new tab in the signed-in context. Use one per page read: a tab
   *  their router has redirected can stop painting for good. */
  newPage(): Promise<Page>;
  /**
   * What the browser could not load on any of this session's tabs, as
   * lines a person can read — or null when nothing of Shiprocket's
   * failed. Every page read that ends up on their login screen should
   * put this in the issue it raises: the page itself cannot tell an
   * expired session from their edge refusing it, and this can.
   */
  networkSummary(): string | null;
  close(): Promise<void>;
}

/**
 * A signed-in page on Shiprocket's seller panel.
 *
 * ── ITS OWN BROWSER, THROUGH BANGALORE, AND CLOSED AFTER EVERY RUN ───
 * Their panel is India-only. The browser is launched with the proxy in
 * `courier.shiprocket_portal_proxy` — the self-restarting SSH tunnel to
 * the Bangalore droplet — and REFUSES to start without one rather than
 * connecting directly. It is a separate browser from Delhivery's, not a
 * second context in it, because a proxy is fixed at launch; and it is
 * closed at the end of each run so a nightly job does not hold a
 * Chromium's worth of memory all day.
 *
 * ── A CHALLENGE STOPS EVERYTHING ─────────────────────────────────────
 * On an OTP or captcha it screenshots and throws; it never tries to
 * solve one and never retries. The caller raises an issue, and no run
 * starts again until a person resolves it — how many failed logins
 * Shiprocket tolerates is unknown, and finding out by locking the
 * account is the wrong way.
 *
 * The sign-in is kept in its own storage-state file per account, so a
 * normal night logs in as rarely as a person would.
 */
@Injectable()
export class ShiprocketPortalSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CourierCredentialService,
  ) {}

  async open(courierAccountId: string, runId: string): Promise<ShiprocketPortalHandle> {
    const proxy = await this.proxy();
    // BEFORE the browser: a launch through an egress that is down or in
    // the wrong country can only fail, and failing at a login page costs
    // an attempt against an account that also handles COD remittance.
    await this.assertEgress();
    // Lazily, so this compiles and unit-tests anywhere; Chromium lives
    // only in the portal worker.
    const { chromium } = await import('playwright');
    await mkdir(STATE_DIR, { recursive: true });
    const statePath = join(STATE_DIR, `shiprocket-storage-state-${courierAccountId}.json`);
    const hasState = await access(statePath).then(
      () => true,
      () => false,
    );

    const browser = await chromium.launch({ headless: true, proxy: { server: proxy } });
    try {
      // Their edge reads the UA (see `desktopChromeUserAgent`), so the
      // browser must present one before it loads anything at all.
      const version = browser.version();
      const context = await browser.newContext({
        ...(hasState ? { storageState: statePath } : {}),
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        userAgent: desktopChromeUserAgent(version),
        extraHTTPHeaders: desktopChromeClientHints(version),
      });
      context.setDefaultTimeout(30_000);
      // Attached before the first navigation: the call that explains a
      // refusal is usually the first one the app makes.
      const net = new PortalNetworkWatch();
      let page = await context.newPage();
      net.watch(page);

      // A page that REQUIRES a session. Their redirect to the login page
      // may be client-side, so wait before judging — the Delhivery
      // session learned this the slow way.
      await gotoShiprocket(page, `${SR_PORTAL_ORIGIN}/seller/homepage`);
      await page.waitForTimeout(4_000);
      if (
        isShiprocketLoginUrl(page.url()) ||
        (await page.locator('input[type="password"]').count()) > 0
      ) {
        // Sign in from a NEW tab. After their router bounces
        // /seller/homepage to /newlogin, that tab never paints again —
        // measured on 2026-09-11: 0 animation frames, still 0 after a
        // fresh goto in the same tab, while a new tab in the same context
        // painted 3 frames in 48ms. Script still runs there, so reading
        // the URL works; clicking and screenshots, which wait on a frame,
        // hang until they time out.
        await page.close().catch(() => undefined);
        page = await context.newPage();
        net.watch(page);
        await this.login(page, courierAccountId, runId, net);
        await context.storageState({ path: statePath });
      }

      return {
        page,
        newPage: async (): Promise<Page> => {
          const p = await context.newPage();
          net.watch(p);
          return p;
        },
        networkSummary: (): string | null => net.summary(),
        close: async (): Promise<void> => {
          try {
            await context.storageState({ path: statePath });
          } catch {
            // A failed save costs a login next time; not worth masking
            // whatever the run itself returned.
          }
          await browser.close();
        },
      };
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Refuse the run when the configured egress check says we are not
   * where we should be. Unconfigured (empty url) means no check — the
   * SSH tunnel has no control server to ask, and inventing a check for
   * it would put an outbound call on the critical path of every run.
   */
  private async assertEgress(): Promise<void> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: {
        key: { in: [SR_PORTAL_EGRESS_CHECK_SETTING, SR_PORTAL_EGRESS_COUNTRY_SETTING] },
      },
      select: { key: true, valueString: true },
    });
    const value = (key: string): string =>
      (rows.find((r) => r.key === key)?.valueString ?? '').trim();
    const url = value(SR_PORTAL_EGRESS_CHECK_SETTING);
    if (url === '') return;

    const result = await probeEgress(url);
    if (result.kind === 'DOWN') throw new ShiprocketPortalEgressError(result.reason, null);
    const expected = value(SR_PORTAL_EGRESS_COUNTRY_SETTING);
    if (!egressCountryMatches(result.reading, expected)) {
      throw new ShiprocketPortalEgressError(
        `the egress is ${describeEgress(result.reading)}, and it should be in ${expected}`,
        result.reading,
      );
    }
  }

  private async proxy(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: SR_PORTAL_PROXY_SETTING },
      select: { valueString: true },
    });
    const v = (row?.valueString ?? '').trim();
    if (v === '') throw new ShiprocketPortalProxyMissingError();
    return v;
  }

  private async login(
    page: Page,
    courierAccountId: string,
    runId: string,
    net: PortalNetworkWatch,
  ): Promise<void> {
    /*
      ASK THE EDGE FIRST, BEFORE THE CREDENTIAL IS EVEN DECRYPTED.

      A sign-in whose second call their WAF will refuse cannot succeed,
      and it presents as a session that would not hold (2026-09-28's
      reading) rather than as a block — so it is diagnosed wrongly and
      retried, against an account that also handles COD remittance. This
      costs one credential-free preflight and turns that into a named
      refusal nobody has to guess at.
    */
    const refusal = await this.edgeRefusal(page);
    if (refusal !== null) throw new ShiprocketPortalEgressError(refusal, null);

    // Audited decrypt (CUR-1); the password stays in this process.
    const creds = await this.credentials.getCredentialForAccount(
      courierAccountId,
      courierActor.runner('shiprocket-portal', runId),
    );
    const user = creds['portalUsername'];
    const pass = creds['portalPassword'];
    if (typeof user !== 'string' || user.trim() === '' || typeof pass !== 'string' || pass === '') {
      throw new ShiprocketPortalCredentialsMissingError();
    }

    if (!isShiprocketLoginUrl(page.url())) {
      await gotoPortal(page, `${SR_PORTAL_ORIGIN}/newlogin`);
    }
    const early = await this.detectChallenge(page);
    if (early !== null) throw await this.challenge(page, early);

    // Their login opens on a PHONE field; email is its own button.
    const byRole = page.getByRole('button', { name: /^\s*email\s*$/i }).first();
    if ((await byRole.count()) > 0) await byRole.click();
    else
      await page
        .getByText(/^\s*Email\s*$/)
        .first()
        .click();

    await page
      .getByPlaceholder(/email id/i)
      .first()
      .fill(user.trim());
    await page.locator('input[type="password"]').first().fill(pass);
    await page
      .getByRole('button', { name: /^\s*continue\s*$/i })
      .first()
      .click();

    try {
      await page.waitForURL(/\/seller\//, { timeout: 30_000 });
    } catch {
      // Did not reach the panel. Whatever stopped it, it is not something
      // to try again automatically.
      throw await this.challenge(page, (await this.detectChallenge(page)) ?? 'UNKNOWN');
    }

    /*
      A URL that matched ONCE is not a sign-in.

      `waitForURL` resolves on the first match and returns, and their app
      routes to `/seller/...` and can then bounce straight back to
      `/newlogin?routestate=seller%2Fhome`. So this method returned
      success from the login page, `open()` saved that as the session
      state, and every later read landed on login and reported an expired
      session. Measured on 2026-09-28: their own `/v1/auth/login`
      answered 200 with a valid ten-day JWT on the same run.

      Settle, then ask again. A session that holds stays off the login
      page; one that does not is Shiprocket refusing us, which is a
      different problem with a different answer (see the error).
    */
    await page.waitForTimeout(SETTLE_AFTER_LOGIN_MS);
    if (isShiprocketLoginUrl(page.url())) {
      throw new ShiprocketPortalSignInRejectedError(page.url(), net.summary());
    }
  }

  /**
   * The credential-free half of "can this run work at all": a CORS
   * preflight for the call the sign-in depends on, through the browser's
   * own context so it carries this run's proxy and User-Agent — the two
   * things the refusal is keyed on. A thrown probe returns null: a
   * transport blip must not stop a night's reads on its own, and the
   * sign-in that follows will report whatever is really wrong.
   */
  private async edgeRefusal(page: Page): Promise<string | null> {
    try {
      const res = await page.request.fetch(SR_LOGIN_USER_URL, {
        method: 'OPTIONS',
        headers: {
          origin: SR_PORTAL_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
        timeout: EDGE_PROBE_TIMEOUT_MS,
        failOnStatusCode: false,
      });
      return shiprocketEdgeRefusal(res.status(), res.headers());
    } catch {
      return null;
    }
  }

  /** Broad on purpose: a false positive asks a person; a false negative
   *  keeps hammering a challenge.
   *
   *  But only what a person would SEE. Their login page always loads an
   *  invisible reCAPTCHA — an anchor iframe and badge with
   *  `visibility: hidden` — and counting that stopped the very first run
   *  (2026-09-11) on a page asking nothing of anybody. A real challenge
   *  is a visible checkbox or the visible picture popup. If the invisible
   *  one silently refuses us, the login simply does not reach the panel,
   *  which is reported as UNKNOWN with a screenshot. */
  private async detectChallenge(page: Page): Promise<'OTP' | 'CAPTCHA' | null> {
    const captcha = await page
      .locator(
        'iframe[src*="recaptcha"]:visible, iframe[src*="hcaptcha"]:visible, .g-recaptcha:visible, [data-sitekey]:visible',
      )
      .count();
    if (captcha > 0) return 'CAPTCHA';
    const otp = await page
      .locator(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[placeholder*="otp" i]',
      )
      .count();
    return otp > 0 ? 'OTP' : null;
  }

  private async challenge(
    page: Page,
    kind: 'OTP' | 'CAPTCHA' | 'UNKNOWN',
  ): Promise<ShiprocketPortalChallengeError> {
    let artifactPath: string | null = join(
      STATE_DIR,
      `shiprocket-challenge-${kind}-${Date.now()}.png`,
    );
    try {
      // The viewport, not fullPage: the first real challenge came back
      // with no screenshot at all, and what a person needs is what the
      // login box showed.
      await page.screenshot({ path: artifactPath, fullPage: false, timeout: 15_000 });
    } catch {
      artifactPath = null;
    }
    return new ShiprocketPortalChallengeError(kind, artifactPath, page.url());
  }
}
