import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  CredentialEnvironment,
  NotificationRecipientType,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  CourierCredentialService,
  courierActor,
} from '../../courier-shared/services/courier-credential.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

const JOB = 'courier-portal';
const PORTAL_ORIGIN = 'https://one.delhivery.com';
/** Where the logged-in session is kept between runs. */
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';
/**
 * One stored session PER ACCOUNT.
 *
 * There is one Delhivery and several Delhivery accounts — each a
 * different company on their panel, each with its own login and its own
 * wallet. Sharing one state file would mean the second account's run
 * silently reused the first's session and read the wrong company's
 * money (CACC-1: the credential follows the account).
 */
function stateFileFor(courierAccountId: string | null): string {
  return courierAccountId === null
    ? 'delhivery-storage-state.json'
    : `delhivery-storage-state-${courierAccountId}.json`;
}

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
  /** One per account — see `stateFileFor`. Keyed by account id, or
   *  '' for the legacy single-account path. */
  private readonly contexts = new Map<string, BrowserContext>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CourierCredentialService,
    private readonly settings: CourierChannelSettingsService,
    private readonly email: EmailQueue,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  private statePath(courierAccountId: string | null): string {
    return join(STATE_DIR, stateFileFor(courierAccountId));
  }

  /**
   * A page with a live session, logging in only if the stored state has
   * expired.
   */
  async page(courierAccountId: string | null = null): Promise<Page> {
    const ctx = await this.ensureContext(courierAccountId);
    const page = await ctx.newPage();
    // Probe a page that REQUIRES a session.
    //
    // This used to land on `/support`, which is PUBLIC — Delhivery serve
    // the ticket form to anyone. So `looksLikeLogin` saw no password
    // field, concluded we were already signed in, and the login never
    // ran. Every later navigation then bounced to /v2/login, and the
    // symptom was a missing button on the Finances page rather than
    // anything that said "not logged in". Verified against production on
    // 2026-09-01: /support stayed, /home and /finances both redirected.
    await page.goto(`${PORTAL_ORIGIN}/home`, { waitUntil: 'domcontentloaded' });
    // Their redirect to the login page is CLIENT-SIDE: `goto` returns as
    // soon as the document loads, and the app bounces a moment later. So
    // the probe ran while the URL was still /home with no password field
    // on it, concluded we were signed in, and skipped the login
    // entirely — leaving every later navigation to bounce. The symptom
    // was a missing button on the Finances page, three steps away.
    await page.waitForTimeout(3_000);

    if (await this.looksLikeLogin(page)) {
      // Stored state expired. Re-auth once — never in a loop.
      await this.login(page, courierAccountId);
      await ctx.storageState({ path: this.statePath(courierAccountId) });
    }
    return page;
  }

  private async ensureContext(courierAccountId: string | null): Promise<BrowserContext> {
    // Cached PER ACCOUNT: a context carries the cookies that say which
    // company you are signed in as, so sharing one across accounts would
    // read the wrong company's wallet.
    const cached = this.contexts.get(courierAccountId ?? '');
    if (cached !== undefined) return cached;

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
      await access(this.statePath(courierAccountId));
      storageState = this.statePath(courierAccountId);
    } catch {
      storageState = undefined; // first run
    }

    const context = await this.browser.newContext({
      // No UA override on purpose — see the class doc.
      ...(storageState === undefined ? {} : { storageState }),
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    context.setDefaultTimeout(30_000);
    this.contexts.set(courierAccountId ?? '', context);
    return context;
  }

  /**
   * Is this the login page? Checked by URL and by a password field
   * rather than by a copy string, because copy changes and a missed
   * login page means every subsequent selector fails confusingly.
   */
  private async looksLikeLogin(page: Page): Promise<boolean> {
    if (/login|signin|auth/i.test(page.url())) return true;
    // The first step of their flow asks for an EMAIL only — there is no
    // password field on it, so looking for one alone would read the
    // login page as a logged-in one.
    if ((await page.locator('input[type="password"]').count()) > 0) return true;
    return (await page.getByRole('button', { name: /^continue$/i }).count()) > 0;
  }

  private async login(page: Page, courierAccountId: string | null): Promise<void> {
    // The ACCOUNT'S OWN login. Several Delhivery accounts means several
    // companies on their panel, each with its own credential and its own
    // wallet (CACC-1). `resolveCredential` falls back to the default
    // account when no id is supplied, which is what a single-account
    // deployment has been doing implicitly all along.
    const creds = await this.credentials.resolveCredential(
      'delhivery',
      CredentialEnvironment.PRODUCTION,
      courierAccountId,
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

    // ── THE REAL FLOW, VERIFIED AGAINST THE LIVE PAGE ────────────────
    // Every step below was checked on production on 2026-09-01; none of
    // it is inferred from their docs, which do not describe this at all.
    //
    //   1. /v2/login — EMAIL, then Continue
    //   2. a "Hang on - one more step!" modal appears (this account has
    //      never reset its password, and they nag every time). It is
    //      DISMISSED, never actioned: its button mails a reset link and
    //      would invalidate the password we hold.
    //   3. the SAME page then grows a Company control — and the email
    //      input is DISABLED with the address already in it, so it must
    //      NOT be re-filled. Trying to cost an hour: fill() times out on
    //      a disabled input and reads like a missing field.
    //   4. Company is a custom clickable DIV, not a <select>. It
    //      defaults to the FIRST company on the login, which here is
    //      "M S ENTERPRISE" — the wrong one. Choosing wrong reads
    //      another company's wallet, so this is a required credential.
    //   5. Continue hands off to ucp-auth.delhivery.com, a different
    //      origin, for the PASSWORD.
    await page.goto(`${PORTAL_ORIGIN}/v2/login`, { waitUntil: 'domcontentloaded' });

    const emailBox = page
      .locator('input[type="email"], input[name="username"], input[name="email"]')
      .first();
    await emailBox.waitFor({ state: 'visible', timeout: 30_000 });
    await emailBox.fill(username);
    await page
      .getByRole('button', { name: /^continue$/i })
      .first()
      .click();
    // Explicit settle rather than waitForLoadState: none of these steps
    // is a navigation — the page rewrites itself in place, so the load
    // state never changes and waiting on it returns instantly.
    await page.waitForTimeout(4_500);

    await this.dismissResetPasswordModal(page);

    // The company step. Present whenever the login reaches more than one
    // company; absent for a single-company login, which is why this is
    // conditional rather than assumed.
    const chose = await this.chooseCompany(page, company);
    if (chose) {
      await page
        .getByRole('button', { name: /^continue$/i })
        .first()
        .click();
      // THIS one IS a navigation — to the auth origin — and it is the
      // slowest step in the flow.
      await page.waitForURL(/ucp-auth\.delhivery\.com/, { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
    }

    // The password lives on the auth origin the Continue redirects to.
    //
    // `:visible` is load-bearing. That page carries TWO password inputs
    // and the first in DOM order is HIDDEN — a decoy, or an autofill
    // trap. Taking `.first()` grabs it and `fill()` times out against
    // something nobody can type into, which reads like a page that never
    // loaded.
    const passwordBox = page.locator('input[type="password"]:visible').first();
    await passwordBox.waitFor({ state: 'visible', timeout: 30_000 });
    await passwordBox.fill(password);
    await page
      .getByRole('button', { name: /^log ?in$/i })
      .first()
      .click();
    // Back across the OIDC redirect to the app. Landing anywhere on
    // one.delhivery.com that is not the login page is success.
    await page
      .waitForURL((u) => /one\.delhivery\.com/.test(u.href) && !/\/v2\/login/.test(u.href), {
        timeout: 60_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(3_000);

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
  private async dismissResetPasswordModal(page: Page): Promise<boolean> {
    const modal = page.getByText(/one more step/i).first();
    const present = await modal
      .waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return false;

    this.logger.log('Portal showed the reset-password prompt; closing it without actioning');

    // ── HOW THIS HAS TO BE CLOSED ────────────────────────────────────
    // Verified against the live page on 2026-09-01. The X is a BARE
    // <svg>: no wrapping button, no aria-label, no role. So
    // getByRole('button', {name: /close/i}), [aria-label="Close"] and
    // Escape all find nothing, and the only <button> in the dialog is
    // "Reset Password" — the one control that must never be clicked,
    // because it mails a reset link and invalidates the password we are
    // holding.
    //
    // A synthetic dispatchEvent on the svg or its parent does NOT close
    // it either. A REAL Playwright click on the svg does. So the svg is
    // marked from the page and clicked properly.
    // The body below runs in the BROWSER. This package compiles without
    // the DOM lib, so it is passed as source rather than pulling `dom`
    // into the API's global types for one call.
    await page.evaluate(`(() => {
      var all = Array.prototype.slice.call(document.querySelectorAll('*'));
      var candidates = all.filter(function (n) {
        return (n.textContent || '').trim().indexOf('Hang on') === 0 && n.children.length === 0;
      });
      var heading = candidates[candidates.length - 1];
      if (!heading) return;
      var container = heading;
      for (var i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        if (container.querySelector('svg')) break;
      }
      var svg = container.querySelector('svg');
      if (svg) svg.setAttribute('data-sd-portal-close', '1');
    })()`);

    const closer = page.locator('[data-sd-portal-close]').first();
    if ((await closer.count()) > 0) {
      await closer.click({ force: true, timeout: 10_000 }).catch(() => undefined);
    }
    await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
    // The Company control is rendered after the modal goes; it is not
    // there the instant the overlay disappears.
    await page.waitForTimeout(3_500);
    return true;
  }

  /**
   * Pick the company, on the control they actually render.
   *
   * Not a <select> — a clickable DIV that sits after a "Company" label
   * and opens a list. So it is found by that relationship rather than by
   * a class name, because their classes are hashed (`css-mgm1g3`) and
   * change with every build.
   *
   * Returns false when there is no company step, which is a normal
   * single-company login and not an error.
   */
  private async chooseCompany(page: Page, company: string): Promise<boolean> {
    // Marked from the page: the first pointer-cursor DIV under the
    // "Company" label's container.
    await page.evaluate(`(() => {
      var all = Array.prototype.slice.call(document.querySelectorAll('*'));
      var lbl = all.filter(function (n) {
        return (n.textContent || '').trim() === 'Company' && n.children.length === 0;
      })[0];
      if (!lbl) return;
      var p = lbl.parentElement;
      for (var i = 0; i < 4 && p; i++) {
        var cand = Array.prototype.slice.call(p.querySelectorAll('div')).filter(function (d) {
          var r = d.getBoundingClientRect();
          return getComputedStyle(d).cursor === 'pointer' && r.width > 150;
        })[0];
        if (cand) { cand.setAttribute('data-sd-company', '1'); return; }
        p = p.parentElement;
      }
    })()`);

    const control = page.locator('[data-sd-company]').first();
    if ((await control.count()) === 0) return false;

    if (company === '') {
      // A multi-company login with no company recorded would sign in as
      // whichever they default to — a different company's wallet.
      throw new Error(
        'This Delhivery login reaches more than one company, but no portalCompany is recorded. ' +
          'Add it on the account so the right wallet is read.',
      );
    }

    await control.click({ force: true });
    await page.waitForTimeout(1_500);
    // Exact first: "MS EXPORTS" and "M S ENTERPRISE" both contain "MS".
    await page
      .getByText(company, { exact: true })
      .first()
      .click({ timeout: 8_000 })
      .catch(async () => {
        await page.getByText(company, { exact: false }).first().click({ timeout: 8_000 });
      });
    await page.waitForTimeout(1_000);
    return true;
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

    // The email below goes to one address somebody may not be watching.
    // This is the same fact on the board every admin already looks at,
    // and it is the one failure here that CANNOT clear itself: the
    // portal is paused for 24 hours until a person signs in by hand.
    await this.issues.raise({
      kind: SystemIssueKind.COURIER_PORTAL_CHALLENGE,
      severity: SystemIssueSeverity.HIGH,
      title: `Delhivery portal is asking for a ${challenge} — sign in by hand`,
      detail:
        `The portal presented a ${challenge} challenge at ${page.url()}, which a browser ` +
        'cannot answer. Automatic sign-in is PAUSED for 24 hours.\n\n' +
        'While paused, courier costs stop being imported, so the P&L keeps reporting ' +
        'delivered orders as uncosted. Sign in to the Delhivery portal manually to clear the ' +
        'challenge, then resume the portal from the Delhivery page.' +
        (artifactPath === null ? '' : `\n\nScreenshot: ${artifactPath}`),
      source: 'PortalSessionService',
      dedupeKey: 'portal:challenge',
      metadata: { challenge, url: page.url(), artifactPath },
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
      // Every account's context, each saved to its OWN state file.
      for (const [key, ctx] of this.contexts) {
        await ctx.storageState({ path: this.statePath(key === '' ? null : key) });
        await ctx.close();
      }
      this.contexts.clear();
      if (this.browser !== null) await this.browser.close();
    } finally {
      this.contexts.clear();
      this.browser = null;
    }
  }
}
