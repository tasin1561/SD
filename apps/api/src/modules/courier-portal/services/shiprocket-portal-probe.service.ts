import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  SR_PORTAL_ORIGIN,
  ShiprocketPortalProxyMissingError,
  ShiprocketPortalSessionService,
  gotoShiprocket,
  isShiprocketLoginUrl,
} from './shiprocket-portal-session.service';
import { raiseShiprocketOpenFailure } from './shiprocket-portal-failures';

export const ACTION_SR_PORTAL_PROBED = 'courier.shiprocket_portal.probed';
const STATE_DIR = process.env['PORTAL_STATE_DIR'] ?? '/home/skydrop/portal-state';
export const SR_WALLET_TABS = ['passbook', 'ledger', 'recharge-history'] as const;
const WINDOW_DAYS = 90;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Their URL's date format — `2026-Aug-13` — as an IST calendar date. */
export function shiprocketDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${MONTHS[ist.getUTCMonth()] ?? 'Jan'}-${dd}`;
}

export interface ShiprocketProbePage {
  readonly tab: string;
  readonly url: string;
  /** True when the page bounced to their login — the session did not hold. */
  readonly landedOnLogin: boolean;
  readonly textBytes: number;
  readonly htmlBytes: number;
  /** Whether a picture was saved too — best-effort; the DOM is the record. */
  readonly screenshot: boolean;
}

export interface ShiprocketProbeAccount {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome:
    | 'READ'
    | 'SKIPPED'
    | 'CHALLENGE'
    | 'NO_LOGIN'
    | 'NO_PROXY'
    | 'REJECTED'
    | 'EGRESS'
    | 'FAILED';
  readonly detail: string | null;
  readonly artifactDir: string | null;
  readonly pages: readonly ShiprocketProbePage[];
}

/**
 * Sign in to Shiprocket's panel and SAVE what the three wallet pages show.
 *
 * ── WHY A LOOK BEFORE A READER ───────────────────────────────────────
 * The passbook, ledger and recharge readers are written against the
 * real pages, not against screenshots: a reader built blind would guess
 * at structure, and a wrong guess reads money wrong. This run signs in,
 * opens each page for the last ninety days, and stores a full-page
 * screenshot, the HTML and the visible text in the portal state
 * directory. It reads; it writes nothing anywhere else.
 *
 * ── A CHALLENGE IS FINAL UNTIL A PERSON SAYS OTHERWISE ───────────────
 * An open challenge issue for the account means no run starts. Resolving
 * that issue (after signing in by hand from a browser on the Bangalore
 * tunnel) is what re-enables it.
 */
@Injectable()
export class ShiprocketPortalProbeService {
  private readonly logger = new Logger(ShiprocketPortalProbeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: ShiprocketPortalSessionService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async probe(trigger: 'MANUAL' | 'SCHEDULE'): Promise<readonly ShiprocketProbeAccount[]> {
    const runId = `${Date.now()}`;
    const accounts = await this.prisma.client.courierAccount.findMany({
      where: {
        courier: { code: 'shiprocket' },
        isActive: true,
        deletedAt: null,
        credentialId: { not: null },
      },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });

    const results: ShiprocketProbeAccount[] = [];
    for (const a of accounts) {
      results.push(await this.probeAccount(a, runId));
    }

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: ACTION_SR_PORTAL_PROBED,
      entityType: 'courier',
      entityId: null,
      severity: 'LOW',
      metadata: { courierCode: 'shiprocket', trigger, accounts: results.map((r) => ({ ...r })) },
    });
    return results;
  }

  private async probeAccount(
    a: { id: string; label: string },
    runId: string,
  ): Promise<ShiprocketProbeAccount> {
    const challengeKey = `shiprocket-portal-challenge:${a.id}`;
    const base = { courierAccountId: a.id, label: a.label, artifactDir: null, pages: [] };

    const open = await this.prisma.client.systemIssue.findFirst({
      where: { dedupeKey: challengeKey, resolvedAt: null },
      select: { id: true },
    });
    if (open !== null) {
      return {
        ...base,
        outcome: 'SKIPPED',
        detail: 'A sign-in challenge is still open for this account — resolve it first.',
      };
    }

    let handle;
    try {
      handle = await this.session.open(a.id, runId);
    } catch (err) {
      return { ...base, ...(await this.onOpenFailure(a, err)) };
    }

    try {
      const dir = join(STATE_DIR, 'shiprocket-probe', `${runId}-${a.id.slice(0, 8)}`);
      await mkdir(dir, { recursive: true });
      const to = shiprocketDate(new Date());
      const from = shiprocketDate(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const pages: ShiprocketProbePage[] = [];
      for (const tab of SR_WALLET_TABS) {
        const url = `${SR_PORTAL_ORIGIN}/seller/wallet-transactions/${tab}?from=${from}&to=${to}&current_page=1`;
        // A fresh tab per read: a tab their router has redirected can stop
        // painting for good (see ShiprocketPortalSessionService.open).
        const page = await handle.newPage();
        try {
          // A mid-run bounce to login is recorded as `landedOnLogin`, not thrown.
          await gotoShiprocket(page, url);
          await page.waitForTimeout(6_000);
          // The DOM is the evidence, and reading it needs no painted frame,
          // so it is saved FIRST; the screenshot is best-effort after it.
          const html = await page.content();
          const text = await page.locator('body').innerText({ timeout: 15_000 });
          await writeFile(join(dir, `${tab}.html`), html);
          await writeFile(join(dir, `${tab}.txt`), text);
          const screenshot = await page
            .screenshot({ path: join(dir, `${tab}.png`), fullPage: true, timeout: 20_000 })
            .then(
              () => true,
              () => false,
            );
          pages.push({
            tab,
            url: page.url(),
            landedOnLogin: isShiprocketLoginUrl(page.url()),
            textBytes: text.length,
            htmlBytes: html.length,
            screenshot,
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
      for (const key of [
        `shiprocket-portal-login:${a.id}`,
        `shiprocket-portal-rejected:${a.id}`,
        `shiprocket-portal-egress:${a.id}`,
      ]) {
        await this.issues.resolveByKey(key, 'Signed in to the Shiprocket panel on its own.');
      }
      return { ...base, outcome: 'READ', detail: null, artifactDir: dir, pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ courierAccountId: a.id, err: message }, 'Shiprocket probe failed');
      return { ...base, outcome: 'FAILED', detail: message.slice(0, 300) };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * Shared with the wallet sync and the invoice check, so all three raise
   * the SAME issues.
   *
   * It did not used to be. This service had its own copy that predated
   * `ShiprocketPortalSignInRejectedError`, so a sign-in Shiprocket
   * accepted and then refused was filed under the generic "could not
   * open the panel" key — which tells a person to go and check the
   * password and the tunnel, both of which are fine — and its message
   * was cut at 400 characters, which lands exactly on the network
   * summary that was added to diagnose this class of failure. Two runs
   * on 2026-09-28 were diagnosed from the wrong evidence because of it.
   */
  private async onOpenFailure(
    a: { id: string; label: string },
    err: unknown,
  ): Promise<Pick<ShiprocketProbeAccount, 'outcome' | 'detail'>> {
    if (err instanceof ShiprocketPortalProxyMissingError) {
      return { outcome: 'NO_PROXY', detail: err.message };
    }
    const f = await raiseShiprocketOpenFailure(this.issues, {
      source: 'ShiprocketPortalProbeService',
      account: a,
      err,
      failureKey: `shiprocket-portal-login:${a.id}`,
    });
    // Only the unrecognised case is truncated: the named ones carry the
    // reason a person acts on, and for REJECTED that is the list of calls
    // the browser could not load.
    return {
      outcome: f.outcome,
      detail: f.outcome === 'FAILED' ? f.message.slice(0, 400) : f.message,
    };
  }
}
