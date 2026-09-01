import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CredentialEnvironment, NotificationRecipientType } from '@skydrop/db';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  CourierCredentialService,
  courierActor,
} from '../../courier-shared/services/courier-credential.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';

const JOB = 'courier-portal';
const PORTAL_ORIGIN = 'https://one.delhivery.com';
/** Where the logged-in session is kept between runs. */
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';
const STATE_FILE = 'delhivery-storage-state.json';

/**
 * The credential fields the portal login needs.
 *
 * Named here so the failure can say WHICH fields are missing and what the
 * row actually carries. The production row currently has `["apiToken"]`
 * only — the REST token — so until someone adds these, every portal run
 * stops on a sentence that names the fix.
 *
 * CUR-1, not env: this authenticates US to a courier, which is exactly
 * what `courier_credentials` is for. There is no second secret path.
 */
export const PORTAL_CREDENTIAL_FIELDS = [
  'portalUsername',
  'portalPassword',
  // The company to sign in AS. Delhivery ONE asks for it between the
  // email and the password, because one login can reach several
  // companies — and each has its OWN wallet. Picking the wrong one
  // would import another company's costs against our parcels, so it is
  // a required credential field rather than a default.
  'portalCompany',
] as const;

/** Thrown when the credential exists but has no portal fields. */
export class PortalCredentialsMissingError extends Error {
  constructor(present: readonly string[]) {
    super(
      `Portal login is not provisioned. The delhivery PRODUCTION credential carries ` +
        `[${present.join(', ') || 'nothing'}] but the portal needs ` +
        `[${PORTAL_CREDENTIAL_FIELDS.join(', ')}]. Add them to courier_credentials ` +
        `(CUR-1 — encrypted, key in env); do NOT put them in the environment.`,
    );
    this.name = 'PortalCredentialsMissingError';
  }
}

/** Thrown when the npm package is present but the browser binary is not. */
export class PortalBrowserMissingError extends Error {
  constructor(cause: string) {
    super(
      `Chromium is not installed for Playwright. The npm package does NOT ship the ` +
        `browser — run: pnpm --filter @skydrop/api exec playwright install chromium ` +
        `on the host running the portal worker. (Original: ${cause})`,
    );
    this.name = 'PortalBrowserMissingError';
  }
}

/**
 * A challenge we must not try to solve. Distinct type so callers can
 * freeze the queue rather than treat it as a retryable failure.
 */
export class PortalChallengeError extends Error {
  constructor(public readonly challenge: 'OTP' | 'CAPTCHA' | 'UNKNOWN') {
    super(`Portal presented a ${challenge} challenge — a human must complete it`);
    this.name = 'PortalChallengeError';
  }
}

/**
 * Owns the logged-in browser session, and the rules about not being
 * clever with it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────
 * No user-agent spoofing, no fingerprint patching, no stealth plugin, no
 * attempt at a captcha or an OTP. Real Chromium, its own real UA, and a
 * persisted `storageState` so we log in as rarely as a person would.
 *
 * That is not only an ethics position, it is the engineering one: an
 * automation that hides is an automation whose failures are
 * indistinguishable from being detected, and a channel we cannot debug is
 * worse than a channel we do not have. If Delhivery objects to this
 * traffic, the right response is to ask them, not to disguise it.
 *
 * ── A CHALLENGE FREEZES THE QUEUE, IT DOES NOT RETRY ─────────────────
 * On OTP or captcha the session throws `PortalChallengeError`, the
 * channel is PAUSED (health, never the operator's mode), a human is
 * alerted through the M11 ledger, and nothing is attempted again. A loop
 * here would be the single most damaging thing this worker could do: it
 * would look exactly like an attack and would cost the account.
 *
 * ── CREDENTIALS COME FROM CUR-1, NOT ENV ─────────────────────────────
 * The portal login lives in `courier_credentials`, decrypted through
 * `CourierCredentialService` with `courierActor.runner()`, so the audit
 * row names the job that did it. There is no second secret path: env
 * holds only the storage-state DIRECTORY, which is a location and not a
 * secret.
 */
@Injectable()
export class PortalSessionService {
  private readonly logger = new Logger(PortalSessionService.name);
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CourierCredentialService,
    private readonly settings: CourierChannelSettingsService,
    private readonly email: EmailQueue,
    private readonly audit: AuditLogService,
  ) {}

  private statePath(): string {
    return join(STATE_DIR, STATE_FILE);
  }

  /**
   * A page with a live session, logging in only if the stored state has
   * expired.
   */
  async page(): Promise<Page> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    await page.goto(`${PORTAL_ORIGIN}/support`, { waitUntil: 'domcontentloaded' });

    if (await this.looksLikeLogin(page)) {
      // Stored state expired. Re-auth once — never in a loop.
      await this.login(page);
      await ctx.storageState({ path: this.statePath() });
    }
    return page;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context !== null) return this.context;

    // Imported lazily so this file can be compiled and unit-tested
    // anywhere; Chromium is only required in the process that actually
    // drives a browser, which is never the API.
    const { chromium } = await import('playwright');
    await mkdir(STATE_DIR, { recursive: true });

    try {
      this.browser = await chromium.launch({ headless: true });
    } catch (err) {
      // Playwright's own message for a missing binary is a wall of text
      // about executables and download commands, and it is the FIRST
      // thing anyone starting this worker will hit. Translate it once.
      const message = err instanceof Error ? err.message : String(err);
      if (
        /executable doesn't exist|Please run the following command|browserType\.launch/i.test(
          message,
        )
      ) {
        throw new PortalBrowserMissingError(message.split('\n')[0] ?? message);
      }
      throw err;
    }
    let storageState: string | undefined;
    try {
      const { access } = await import('node:fs/promises');
      await access(this.statePath());
      storageState = this.statePath();
    } catch {
      storageState = undefined; // first run
    }

    this.context = await this.browser.newContext({
      // No UA override on purpose — see the class doc.
      ...(storageState === undefined ? {} : { storageState }),
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    this.context.setDefaultTimeout(30_000);
    return this.context;
  }

  /**
   * Is this the login page? Checked by URL and by a password field
   * rather than by a copy string, because copy changes and a missed
   * login page means every subsequent selector fails confusingly.
   */
  private async looksLikeLogin(page: Page): Promise<boolean> {
    if (/login|signin|auth/i.test(page.url())) return true;
    return (await page.locator('input[type="password"]').count()) > 0;
  }

  private async login(page: Page): Promise<void> {
    const creds = await this.credentials.getCredential(
      'delhivery',
      CredentialEnvironment.PRODUCTION,
      // CUR-1 + the attribution work: the audit row names the job.
      courierActor.runner(JOB, 'portal-login'),
    );
    const username = creds['portalUsername'] ?? '';
    const password = creds['portalPassword'] ?? '';
    if (username === '' || password === '') {
      // Names what is there and what is needed, because "not provisioned"
      // on its own sends someone looking in the environment — which is
      // the one place these must never be.
      throw new PortalCredentialsMissingError(Object.keys(creds));
    }

    const company = creds['portalCompany'] ?? '';

    // ── THE REAL FLOW, WHICH IS THREE PAGES ──────────────────────────
    // Delhivery ONE does not take an email and a password together:
    //
    //   1. one.delhivery.com/v2/login — EMAIL, then Continue
    //   2. a "Hang on - one more step!" reset-password modal may appear;
    //      it is DISMISSED, never actioned (clicking Reset Password
    //      emails a link and invalidates the working password)
    //   3. the same page comes back with a COMPANY dropdown — one login
    //      can reach several, and each has its own wallet
    //   4. ucp-auth.delhivery.com — the PASSWORD, on a different origin
    //
    // Written as steps that each wait for their own evidence rather
    // than as a fixed sequence of clicks, because the modal is
    // conditional and the company step only exists for multi-company
    // logins.
    await page.goto(`${PORTAL_ORIGIN}/v2/login`, { waitUntil: 'domcontentloaded' });

    const emailBox = page
      .locator('input[type="email"], input[name="username"], input[name="email"]')
      .first();
    await emailBox.waitFor({ state: 'visible', timeout: 30_000 });
    await emailBox.fill(username);
    await page
      .getByRole('button', { name: /continue/i })
      .first()
      .click();

    await this.dismissResetPasswordModal(page);

    // The company step, when this login has one.
    const companyBox = page.locator('select, [role="combobox"]').first();
    if (
      await companyBox
        .count()
        .then((n) => n > 0)
        .catch(() => false)
    ) {
      if (company === '') {
        throw new PortalCredentialsMissingError(Object.keys(creds));
      }
      await this.chooseCompany(page, companyBox, company);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      await page.waitForLoadState('domcontentloaded');
    }

    // The password lives on the auth origin, which the Continue above
    // redirects to. Its email field arrives pre-filled.
    const passwordBox = page.locator('input[type="password"]').first();
    await passwordBox.waitFor({ state: 'visible', timeout: 30_000 });
    await passwordBox.fill(password);
    await page
      .getByRole('button', { name: /^log ?in$/i })
      .first()
      .click();
    await page.waitForLoadState('domcontentloaded');

    // A challenge AFTER credentials is the case that matters: it means
    // the password was right and something else is being asked.
    const challenge = await this.detectChallenge(page);
    if (challenge !== null) {
      await this.freezeOnChallenge(challenge, page);
      throw new PortalChallengeError(challenge);
    }

    if (await this.looksLikeLogin(page)) {
      // Still on login with no challenge: the credentials are wrong.
      // NOT retried — a second attempt with the same wrong password is
      // how an account gets locked.
      throw new Error('Portal login failed and no challenge was presented — check the credential.');
    }
  }

  /**
   * "Hang on - one more step!" — Delhivery's nag to reset a password
   * that already works.
   *
   * CLOSED, never actioned. The button in it sends a reset link, and
   * following that would invalidate the credential we are holding: an
   * automation that reset its own password every night would lock
   * itself out on the second run. Absent on most logins, so its absence
   * is not an error.
   */
  private async dismissResetPasswordModal(page: Page): Promise<void> {
    const modal = page.getByText(/one more step/i).first();
    const present = await modal
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return;

    this.logger.log('Portal showed the reset-password prompt; closing it without actioning');
    const close = page
      .getByRole('button', { name: /close/i })
      .or(page.locator('[aria-label="Close"], [aria-label="close"]'))
      .first();
    if (await close.count().then((n) => n > 0)) {
      await close.click();
    } else {
      // Some builds render the X as a bare icon with no accessible
      // name. Escape closes the same dialog.
      await page.keyboard.press('Escape');
    }
    await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }

  /**
   * Pick the company, whichever control they rendered.
   *
   * A native `<select>` takes selectOption; their custom combobox does
   * not, and needs the option clicked. Trying the cheap one first and
   * falling back keeps this working across whichever they ship.
   */
  private async chooseCompany(page: Page, control: Locator, company: string): Promise<void> {
    // `evaluate` runs in the BROWSER, but this package compiles without
    // the DOM lib, so the node is typed loosely here rather than
    // pulling `dom` into the API's global scope for one call.
    const tag = await control
      .evaluate((el: { tagName?: string }) => (el.tagName ?? '').toLowerCase())
      .catch(() => '');
    if (tag === 'select') {
      await control.selectOption({ label: company }).catch(async () => {
        await control.selectOption(company);
      });
      return;
    }
    await control.click();
    await page.getByRole('option', { name: company }).first().click();
  }

  /**
   * Look for an OTP or captcha. Detection is deliberately broad: a false
   * positive freezes the queue and asks a human, which is cheap. A false
   * negative means we keep hammering a challenge, which is not.
   */
  private async detectChallenge(page: Page): Promise<'OTP' | 'CAPTCHA' | null> {
    const captcha = await page
      .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [data-sitekey]')
      .count();
    if (captcha > 0) return 'CAPTCHA';

    const otp = await page
      .locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]')
      .count();
    if (otp > 0) return 'OTP';

    return null;
  }

  /**
   * Pause the channel and tell a human. Nothing is retried.
   *
   * The pause is `pausedUntil`, NOT `writeMode` — health must never
   * overwrite the operator's intent, so resuming restores whatever they
   * had chosen rather than a mode this code guessed.
   */
  private async freezeOnChallenge(
    challenge: 'OTP' | 'CAPTCHA' | 'UNKNOWN',
    page: Page,
  ): Promise<void> {
    let artifactPath: string | null = null;
    try {
      artifactPath = join(STATE_DIR, `challenge-${challenge}-${Date.now()}.png`);
      await page.screenshot({ path: artifactPath });
    } catch {
      artifactPath = null; // a screenshot failing must not mask the freeze
    }

    // Long enough that nobody has to remember to stop it; a human
    // resumes deliberately once they have logged in by hand.
    await this.settings.pause({
      until: new Date(Date.now() + 24 * 3_600_000),
      reason: `Portal presented a ${challenge} challenge — a human must sign in`,
    });

    await this.prisma.client.courierPortalRun.create({
      data: {
        kind: 'login',
        mode: (await this.settings.get()).portalMode,
        outcome: 'CHALLENGE',
        detail: `${challenge} challenge at ${page.url()}`,
        artifactPath,
      },
    });

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.portal.challenge_frozen',
      entityType: 'courier',
      entityId: null,
      severity: 'CRITICAL',
      metadata: { courierCode: 'delhivery', challenge, url: page.url(), artifactPath },
    });

    const to = await this.settings.alertEmailForPortal();
    if (to !== '') {
      try {
        await this.email.enqueue({
          templateCode: 'ops.courier_portal_challenge.email',
          recipient: { type: NotificationRecipientType.STAFF, email: to },
          triggerEvent: 'courier.portal.challenge_frozen',
          variables: { challenge, url: page.url() },
        });
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Could not send the portal challenge alert; the CRITICAL audit row stands',
        );
      }
    }

    this.logger.error(
      { challenge, url: page.url() },
      'Portal challenge — queue frozen, human required, nothing will be retried',
    );
  }

  /** Release the browser. Called on shutdown. */
  async close(): Promise<void> {
    try {
      if (this.context !== null) {
        await this.context.storageState({ path: this.statePath() });
        await this.context.close();
      }
      if (this.browser !== null) await this.browser.close();
    } finally {
      this.context = null;
      this.browser = null;
    }
  }
}
