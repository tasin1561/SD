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

export const SR_PORTAL_ORIGIN = 'https://app.shiprocket.in';
export const SR_PORTAL_PROXY_SETTING = 'courier.shiprocket_portal_proxy';
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';

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
      const page = await context.newPage();

      // A page that REQUIRES a session. Their redirect to the login page
      // may be client-side, so wait before judging — the Delhivery
      // session learned this the slow way.
      await gotoShiprocket(page, `${SR_PORTAL_ORIGIN}/seller/homepage`);
      await page.waitForTimeout(4_000);
      if (
        isShiprocketLoginUrl(page.url()) ||
        (await page.locator('input[type="password"]').count()) > 0
      ) {
        await this.login(page, courierAccountId, runId);
        await context.storageState({ path: statePath });
      }

      return {
        page,
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

  private async login(page: Page, courierAccountId: string, runId: string): Promise<void> {
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
  }

  /** Broad on purpose: a false positive asks a person; a false negative
   *  keeps hammering a challenge. */
  private async detectChallenge(page: Page): Promise<'OTP' | 'CAPTCHA' | null> {
    const captcha = await page
      .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [data-sitekey]')
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
      await page.screenshot({ path: artifactPath, fullPage: true });
    } catch {
      artifactPath = null;
    }
    return new ShiprocketPortalChallengeError(kind, artifactPath, page.url());
  }
}
