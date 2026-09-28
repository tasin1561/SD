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

export const SR_PORTAL_ORIGIN = 'https://app.shiprocket.in';
export const SR_PORTAL_PROXY_SETTING = 'courier.shiprocket_portal_proxy';
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';
/** Long enough for their router to bounce a session it will not honour.
 *  Measured at well under 4s on 2026-09-28; 6 leaves room. */
const SETTLE_AFTER_LOGIN_MS = 6_000;

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
      const context = await browser.newContext({
        ...(hasState ? { storageState: statePath } : {}),
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
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
