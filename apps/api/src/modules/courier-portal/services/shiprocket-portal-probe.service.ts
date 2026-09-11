import { Injectable, Logger } from '@nestjs/common';
import { ActorType, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  SR_PORTAL_ORIGIN,
  ShiprocketPortalChallengeError,
  ShiprocketPortalCredentialsMissingError,
  ShiprocketPortalProxyMissingError,
  ShiprocketPortalSessionService,
  gotoShiprocket,
  isShiprocketLoginUrl,
} from './shiprocket-portal-session.service';

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
}

export interface ShiprocketProbeAccount {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: 'READ' | 'SKIPPED' | 'CHALLENGE' | 'NO_LOGIN' | 'NO_PROXY' | 'FAILED';
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
      return { ...base, ...(await this.onOpenFailure(a, challengeKey, err)) };
    }

    try {
      const dir = join(STATE_DIR, 'shiprocket-probe', `${runId}-${a.id.slice(0, 8)}`);
      await mkdir(dir, { recursive: true });
      const to = shiprocketDate(new Date());
      const from = shiprocketDate(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
      const pages: ShiprocketProbePage[] = [];
      for (const tab of SR_WALLET_TABS) {
        const url = `${SR_PORTAL_ORIGIN}/seller/wallet-transactions/${tab}?from=${from}&to=${to}&current_page=1`;
        // A mid-run bounce to login is recorded as `landedOnLogin`, not thrown.
        await gotoShiprocket(handle.page, url);
        await handle.page.waitForTimeout(6_000);
        const html = await handle.page.content();
        const text = await handle.page.locator('body').innerText();
        await handle.page.screenshot({ path: join(dir, `${tab}.png`), fullPage: true });
        await writeFile(join(dir, `${tab}.html`), html);
        await writeFile(join(dir, `${tab}.txt`), text);
        pages.push({
          tab,
          url: handle.page.url(),
          landedOnLogin: isShiprocketLoginUrl(handle.page.url()),
          textBytes: text.length,
          htmlBytes: html.length,
        });
      }
      await this.issues.resolveByKey(
        `shiprocket-portal-login:${a.id}`,
        'Signed in to the Shiprocket panel on its own.',
      );
      return { ...base, outcome: 'READ', detail: null, artifactDir: dir, pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ courierAccountId: a.id, err: message }, 'Shiprocket probe failed');
      return { ...base, outcome: 'FAILED', detail: message.slice(0, 300) };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private async onOpenFailure(
    a: { id: string; label: string },
    challengeKey: string,
    err: unknown,
  ): Promise<Pick<ShiprocketProbeAccount, 'outcome' | 'detail'>> {
    if (err instanceof ShiprocketPortalChallengeError) {
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_PORTAL_CHALLENGE,
        severity: SystemIssueSeverity.HIGH,
        title: `Shiprocket panel asked ${a.label} for a ${err.challenge} — automation stopped`,
        detail:
          `Signing in to app.shiprocket.in stopped at a ${err.challenge} challenge (${err.url}). ` +
          'Nothing will try again until this issue is resolved. Sign in once by hand from a ' +
          'browser using the Bangalore tunnel, then resolve this issue.' +
          (err.artifactPath === null ? '' : ` Screenshot on the server: ${err.artifactPath}`),
        source: 'ShiprocketPortalProbeService',
        dedupeKey: challengeKey,
        metadata: { courierAccountId: a.id, challenge: err.challenge, url: err.url },
      });
      return { outcome: 'CHALLENGE', detail: err.message };
    }
    if (err instanceof ShiprocketPortalCredentialsMissingError) {
      await this.issues.raise({
        kind: SystemIssueKind.COURIER_CREDENTIAL,
        severity: SystemIssueSeverity.MEDIUM,
        title: `No Shiprocket website login stored for ${a.label}`,
        detail: err.message,
        source: 'ShiprocketPortalProbeService',
        dedupeKey: `shiprocket-portal-credential:${a.id}`,
        metadata: { courierAccountId: a.id },
      });
      return { outcome: 'NO_LOGIN', detail: err.message };
    }
    if (err instanceof ShiprocketPortalProxyMissingError) {
      return { outcome: 'NO_PROXY', detail: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    await this.issues.raise({
      kind: SystemIssueKind.COURIER_PORTAL_LOGIN,
      severity: SystemIssueSeverity.HIGH,
      title: `Could not open the Shiprocket panel for ${a.label}`,
      detail: `${message.slice(0, 400)}. The tunnel (shiprocket-egress-tunnel.service) and the login are the usual causes.`,
      source: 'ShiprocketPortalProbeService',
      dedupeKey: `shiprocket-portal-login:${a.id}`,
      metadata: { courierAccountId: a.id },
    });
    return { outcome: 'FAILED', detail: message.slice(0, 300) };
  }
}
