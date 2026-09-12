import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  DelhiveryBillingPage,
  type Attempt,
  type InvoiceListFinding,
  type PageFinding,
  type RawExploration,
} from '../pages/delhivery-billing.page';
import {
  scrubSessionMaterial,
  scrubText,
  summariseFile,
  type FileSummary,
} from './delhivery-billing-probe-files';
import { ProbeBudget, type BudgetKind, type ProbeLimits } from './portal-read-only-guard';
import { PortalSessionService } from './portal-session.service';

/** Restated in courier-cost-sync's reader — the API cannot import this module. */
export const ACTION_DELHIVERY_BILLING_PROBED = 'courier.delhivery_billing.probed';
/** Private by construction: nothing in the bucket is public (SpacesService). */
export const DELHIVERY_BILLING_PROBE_PREFIX = 'courier-probes/delhivery-billing';

export const PROBE_LIMITS: ProbeLimits = { maxPages: 14, maxDownloads: 8 };
/** The whole run, every account. Past it, what was gathered is stored. */
export const PROBE_DEADLINE_MS = 10 * 60_000;
/** The session raises this key on an OTP/captcha (PortalSessionService). */
const CHALLENGE_KEY = 'portal:challenge';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BillingExplorer = (page: Page, budget: ProbeBudget) => Promise<RawExploration>;

export interface StoredArtifact {
  readonly key: string;
  readonly kind: 'screenshot' | 'page-text' | 'download';
  readonly bytes: number;
  readonly contentType: string;
  readonly uploaded: boolean;
  readonly error: string | null;
}

export interface ProbeDownloadFinding {
  readonly forRow: number | null;
  readonly control: string;
  readonly via: string;
  readonly fileName: string;
  readonly contentType: string | null;
  readonly sourceUrl: string | null;
  readonly bytes: number;
  /** Null when it was over the size cap, or the upload failed. */
  readonly key: string | null;
  readonly summary: FileSummary | null;
}

export interface ProbeAccountFindings {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: 'READ' | 'SKIPPED' | 'FAILED';
  readonly detail: string | null;
  readonly stoppedBy: BudgetKind | null;
  readonly used: { readonly pages: number; readonly downloads: number } | null;
  readonly pages: readonly (PageFinding & {
    readonly screenshotKey: string | null;
    readonly textKey: string | null;
  })[];
  readonly invoiceList: InvoiceListFinding | null;
  readonly downloads: readonly ProbeDownloadFinding[];
  readonly attempts: readonly Attempt[];
  readonly refusedClicks: readonly { readonly label: string; readonly reason: string }[];
  readonly notFound: readonly string[];
}

export interface DelhiveryBillingFindings {
  readonly runId: string;
  readonly courierCode: 'delhivery';
  readonly requestedByStaffId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly limits: ProbeLimits & { readonly deadlineMs: number };
  readonly note: string | null;
  readonly accounts: readonly ProbeAccountFindings[];
  readonly artifacts: readonly StoredArtifact[];
}

const slug = (s: string): string =>
  s
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'file';

/**
 * A one-off, operator-triggered, READ-ONLY look at Delhivery's billing.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * Shiprocket's invoices are checked against our stored wallet ledger every
 * night (`ShiprocketInvoiceCheckService`). Delhivery's are to be checked
 * the same way — but nobody here has seen where Delhivery keeps invoices,
 * what their list shows or what their itemized files look like, and a
 * checker written blind would guess at structure and read money wrong.
 * This run LOOKS: it signs in through the SAME session the nightly wallet
 * sync uses (never a second credential path — CUR-1), walks to the billing
 * area, reads the invoice list, downloads the latest invoice's files and
 * describes them.
 *
 * ── WHERE THE ANSWER GOES ────────────────────────────────────────────
 * One `audit_logs` row (`courier.delhivery_billing.probed`, entity null,
 * findings in metadata) and the raw files plus a screenshot and the text
 * of every page under `courier-probes/delhivery-billing/<runId>/` in our
 * private bucket, read back through presigned urls. Session material —
 * cookies, tokens, signed query strings — is scrubbed from everything
 * stored; the invoice data is ours and is kept as it is.
 *
 * ── WHEN IT RUNS ─────────────────────────────────────────────────────
 * Only when asked. It rides the wallet sync's own queue, whose worker runs
 * one job at a time, so it can never overlap the 02:40 sync on the same
 * login. Like the wallet sync it does not consult `portalMode`: CUR-18's
 * OFF stops the escalation automation (dispatcher, ticket sweep, canary),
 * and this is an operator's read, not that. An open sign-in challenge
 * DOES stop it — answering a challenge is a person's job.
 */
@Injectable()
export class DelhiveryBillingProbeService {
  private readonly logger = new Logger(DelhiveryBillingProbeService.name);

  /** How a signed-in page is explored. A field so a test can hand in its own. */
  explorer: BillingExplorer = (page, budget) => new DelhiveryBillingPage(page, budget).explore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
  ) {}

  async probe(
    input: { readonly runId?: string | null; readonly requestedByStaffId?: string | null },
    now: () => number = Date.now,
  ): Promise<DelhiveryBillingFindings> {
    const runId =
      input.runId !== undefined && input.runId !== null && UUID.test(input.runId)
        ? input.runId
        : randomUUID();
    const startedAt = new Date(now()).toISOString();
    const deadlineAt = now() + PROBE_DEADLINE_MS;
    const artifacts: StoredArtifact[] = [];

    // The same accounts the wallet sync signs in as.
    const accounts = await this.prisma.client.courierAccount.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        courier: { code: 'delhivery' },
        credential: { isNot: null },
      },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });
    const challenge = await this.prisma.client.systemIssue.findFirst({
      where: { dedupeKey: CHALLENGE_KEY, resolvedAt: null },
      select: { id: true },
    });

    const results: ProbeAccountFindings[] = [];
    for (const a of accounts) {
      if (challenge !== null) {
        results.push(
          this.empty(
            a,
            'SKIPPED',
            'A Delhivery sign-in challenge is open — resolve it first. Nothing was opened.',
          ),
        );
        continue;
      }
      results.push(
        await this.probeAccount(
          a,
          runId,
          new ProbeBudget(PROBE_LIMITS, deadlineAt, now),
          artifacts,
        ),
      );
    }

    const findings: DelhiveryBillingFindings = scrubSessionMaterial({
      runId,
      courierCode: 'delhivery' as const,
      requestedByStaffId: input.requestedByStaffId ?? null,
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      limits: { ...PROBE_LIMITS, deadlineMs: PROBE_DEADLINE_MS },
      note:
        accounts.length === 0
          ? 'No active Delhivery account with a stored credential — nothing to sign in as.'
          : null,
      accounts: results,
      artifacts,
    });

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: ACTION_DELHIVERY_BILLING_PROBED,
      entityType: 'courier',
      // A uuid column; the courier and run go in metadata.
      entityId: null,
      severity: 'LOW',
      metadata: { ...findings },
    });
    this.logger.log(
      {
        runId,
        accounts: results.map((r) => ({
          label: r.label,
          outcome: r.outcome,
          files: r.downloads.length,
        })),
      },
      'Delhivery billing probe done',
    );
    return findings;
  }

  private async probeAccount(
    a: { id: string; label: string },
    runId: string,
    budget: ProbeBudget,
    artifacts: StoredArtifact[],
  ): Promise<ProbeAccountFindings> {
    let page: Page;
    try {
      // The wallet sync's own sign-in: the stored session, or a login
      // through CUR-1 with an audit row, and a challenge freezes rather
      // than retries.
      page = await this.session.page(a.id);
    } catch (err) {
      return this.empty(
        a,
        'FAILED',
        `Could not open the signed-in portal: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
      );
    }
    try {
      const raw = await this.explorer(page, budget);
      const dir = `${DELHIVERY_BILLING_PROBE_PREFIX}/${runId}/${a.id.slice(0, 8)}`;

      const pages: ProbeAccountFindings['pages'][number][] = [];
      for (const [i, p] of raw.pages.entries()) {
        const n = String(i + 1).padStart(2, '0');
        const name = slug(p.finding.why);
        const screenshotKey =
          p.screenshot === null
            ? null
            : await this.store(
                `${dir}/pages/${n}-${name}.png`,
                p.screenshot,
                'image/png',
                'screenshot',
                artifacts,
              );
        const textKey =
          p.text === ''
            ? null
            : await this.store(
                `${dir}/pages/${n}-${name}.txt`,
                Buffer.from(scrubText(p.text), 'utf8'),
                'text/plain; charset=utf-8',
                'page-text',
                artifacts,
              );
        pages.push({ ...p.finding, screenshotKey, textKey });
      }

      const downloads: ProbeDownloadFinding[] = [];
      for (const [i, d] of raw.downloads.entries()) {
        const n = String(i + 1).padStart(2, '0');
        const key =
          d.body === null
            ? null
            : await this.store(
                `${dir}/files/${n}-${slug(d.fileName)}`,
                d.body,
                d.contentType ?? 'application/octet-stream',
                'download',
                artifacts,
              );
        downloads.push({
          forRow: d.forRow,
          control: d.control,
          via: d.via,
          fileName: d.fileName,
          contentType: d.contentType,
          sourceUrl: d.sourceUrl,
          bytes: d.bytes,
          key,
          summary: d.body === null ? null : summariseFile(d.fileName, d.body),
        });
      }

      return {
        courierAccountId: a.id,
        label: a.label,
        outcome: raw.error === null ? 'READ' : 'FAILED',
        detail: raw.error,
        stoppedBy: raw.stoppedBy,
        used: budget.used(),
        pages,
        invoiceList: raw.invoiceList,
        downloads,
        attempts: raw.attempts,
        refusedClicks: raw.refused,
        notFound: raw.notFound,
      };
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      this.logger.warn({ courierAccountId: a.id, err: message }, 'Delhivery billing probe failed');
      return { ...this.empty(a, 'FAILED', message), used: budget.used() };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** One upload; a failure is recorded, never thrown — the rest is still worth having. */
  private async store(
    key: string,
    body: Buffer,
    contentType: string,
    kind: StoredArtifact['kind'],
    artifacts: StoredArtifact[],
  ): Promise<string | null> {
    try {
      await this.spaces.putObject(key, body, contentType);
      artifacts.push({ key, kind, bytes: body.length, contentType, uploaded: true, error: null });
      return key;
    } catch (err) {
      artifacts.push({
        key,
        kind,
        bytes: body.length,
        contentType,
        uploaded: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
      return null;
    }
  }

  private empty(
    a: { id: string; label: string },
    outcome: 'SKIPPED' | 'FAILED',
    detail: string,
  ): ProbeAccountFindings {
    return {
      courierAccountId: a.id,
      label: a.label,
      outcome,
      detail,
      stoppedBy: null,
      used: null,
      pages: [],
      invoiceList: null,
      downloads: [],
      attempts: [],
      refusedClicks: [],
      notFound: [],
    };
  }
}
