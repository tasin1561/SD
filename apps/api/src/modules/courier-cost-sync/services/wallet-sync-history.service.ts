import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';

const ACTION_OK = 'courier.wallet_ledger.synced';
const ACTION_FAILED = 'courier.wallet_ledger.sync_failed';
const SETTING_ENABLED = 'courier.wallet_sync_enabled';
const SETTING_WRITE = 'courier.wallet_sync_writes_enabled';
const SETTING_WINDOW_DAYS = 'courier.wallet_sync_window_days';

/**
 * Only keys under this prefix are ever presigned here.
 *
 * Restated from `courier-portal`'s `PORTAL_FAILURE_PREFIX` — the API
 * cannot import that module (the portal worker is a separate root, and
 * `portal-worker-isolation.spec.ts` enforces it) — exactly as
 * `DELHIVERY_BILLING_PROBE_PREFIX` is restated beside it. The guard is
 * the load-bearing half: the key comes out of an audit row's JSON, and
 * presigning whatever a row happens to say would mint a link to any
 * object in the bucket.
 */
export const PORTAL_FAILURE_PREFIX = 'courier-probes/portal-failures/';

/** Enough to walk back through a bad week; bounded so a page cannot mint hundreds of links. */
const MAX_PRESIGNED_ARTIFACTS = 24;

export interface WalletSyncRunAccount {
  readonly label: string;
  readonly courierAccountId: string;
  readonly error: string | null;
  readonly fileBytes: number | null;
  readonly rowsRead: number | null;
  readonly awbsInFile: number | null;
  /** Rows whose AWB is not one of ours. Normal — the account carries
   *  other people's parcels too — and reported, never an error. */
  readonly unknownAwbs: number | null;
  readonly forwardWritten: number | null;
  readonly rtoWritten: number | null;
  readonly revised: number | null;
  readonly unchanged: number | null;
  readonly sumInr: string | null;
  readonly statedTotalInr: string | null;
  /** Their stated total vs the sum of the rows. False means their export
   *  disagrees with itself, which is worth seeing. */
  readonly totalsAgree: boolean | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly coveredDays: number | null;
  /** Whether the date filter we asked for was actually applied. */
  readonly rangeApplied: boolean | null;
  /** True when it parsed the real file and wrote nothing. */
  readonly dryRun: boolean | null;
  /**
   * The parcels this run wrote a cost against, by name.
   *
   * EMPTY on runs from before this was recorded, which is not the same
   * as "wrote nothing" — the count says what happened and the list is
   * simply missing. The panel distinguishes the two rather than showing
   * an empty list under a count of sixteen.
   */
  readonly writes: readonly WalletSyncWrite[];
  /** How many were written but not listed, past the cap. */
  readonly writesTruncated: number;
  /** Transactions we held that this run's export no longer contained. */
  readonly txnsMissing: number;
  /**
   * What was on screen when this account failed, presigned.
   *
   * Null on a success (nothing is captured on a good night) and on every
   * run from before the capture existed. A screenshot nobody can reach
   * is a screenshot nobody looks at, which is the whole point of taking
   * one.
   */
  readonly failureArtifact: WalletSyncFailureArtifact | null;
}

export interface WalletSyncFailureArtifact {
  /** Where the page was, query string already stripped by the capture. */
  readonly url: string | null;
  /** What the control the job was waiting on actually looked like. */
  readonly control: string | null;
  /** Presigned, short-lived, NEVER stored (the ORD/Spaces discipline). */
  readonly screenshotUrl: string | null;
  readonly pageTextUrl: string | null;
  /**
   * Set when the capture itself went wrong, or when a link could not be
   * minted. Shown rather than swallowed: "there should be a screenshot
   * and there is not" is a different fact from "nothing was captured".
   */
  readonly problem: string | null;
}

export interface WalletSyncWrite {
  readonly awbNumber: string;
  readonly orderNumber: string | null;
  readonly leg: string;
  readonly amountInr: string;
  readonly revised: boolean;
  /** What it was before this run; null on a first reading or an old run. */
  readonly previousInr: string | null;
}

export interface WalletSyncRun {
  readonly at: string;
  readonly ok: boolean;
  /** DISABLED / NO_ACCOUNTS — it ran and deliberately did nothing. */
  readonly skipped: string | null;
  readonly wrote: boolean;
  readonly windowDays: number | null;
  readonly accounts: readonly WalletSyncRunAccount[];
}

export interface WalletSyncPanel {
  readonly enabled: boolean;
  readonly writesEnabled: boolean;
  readonly windowDays: number;
  /** IST, from the worker's cron. Stated rather than computed loosely:
   *  "did it run last night" is the first question, and it cannot be
   *  answered without knowing when it was due. */
  readonly schedule: string;
  readonly last: WalletSyncRun | null;
  readonly history: readonly WalletSyncRun[];
  readonly cost: CostCoverage;
}

export interface CostCoverage {
  /** Dispatched parcels — the ones that can have a courier cost. */
  readonly dispatched: number;
  readonly withForwardCost: number;
  readonly returned: number;
  readonly withRtoCost: number;
  readonly forwardTotalInr: string;
  readonly rtoTotalInr: string;
}

/**
 * Did the nightly cost sync work, what did it do, and what has it done
 * before.
 *
 * ── NO NEW TABLE ─────────────────────────────────────────────────────
 * Every run already writes an audit row carrying its whole summary, so
 * a `wallet_sync_runs` table would be a second copy of a record we
 * keep anyway — and the two would eventually disagree. The audit trail
 * IS the history, which is the same call M14 made for system settings.
 *
 * The cost of that choice is honest and worth stating: the metadata is
 * JSON, so this reads a bounded number of recent rows rather than
 * aggregating over all of them. That is the right shape for the
 * question — "what happened lately" — and a report over months would
 * need the columns, not this.
 *
 * ── WHY A PANEL AT ALL ───────────────────────────────────────────────
 * A cost sync that stops working is invisible: the figures simply stop
 * moving, and nobody notices until a margin looks wrong weeks later.
 * The service already raises an issue when it FAILS. What it could not
 * tell anybody is the quieter failure — it ran, it succeeded, and it
 * matched almost nothing, or it was switched off months ago.
 */
@Injectable()
export class WalletSyncHistoryService {
  private readonly logger = new Logger(WalletSyncHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  async panel(limit = 20): Promise<WalletSyncPanel> {
    const [settings, rows, cost] = await Promise.all([
      this.prisma.client.systemSetting.findMany({
        where: { key: { in: [SETTING_ENABLED, SETTING_WRITE, SETTING_WINDOW_DAYS] } },
      }),
      this.prisma.client.auditLog.findMany({
        where: { action: { in: [ACTION_OK, ACTION_FAILED] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { action: true, createdAt: true, metadata: true },
      }),
      this.costCoverage(),
    ]);

    const byKey = new Map(settings.map((s) => [s.key, s]));
    const history = await this.withArtifactLinks(
      rows.map((r) => toRun(r.action, r.createdAt, r.metadata)),
    );

    return {
      enabled: byKey.get(SETTING_ENABLED)?.valueBoolean ?? false,
      writesEnabled: byKey.get(SETTING_WRITE)?.valueBoolean ?? false,
      windowDays: byKey.get(SETTING_WINDOW_DAYS)?.valueInt ?? 45,
      // The worker's cron, in words. Kept as a string rather than parsed
      // from the constant: a panel that computed "next run" would be
      // wrong the moment the process was not running, which is exactly
      // the case somebody opens this page to investigate.
      // 21:10 UTC. It said 21:10 IST for weeks; the cron has no tz.
      schedule: 'Every night at 02:40 IST',
      last: history[0] ?? null,
      history,
      cost,
    };
  }

  /**
   * How much of what we shipped has a real courier cost against it.
   *
   * TRE-6's rule, made visible: a missing cost is reported as uncovered,
   * never defaulted to zero. Zero would report the whole of that
   * revenue as profit.
   *
   * Forward and RTO are counted separately and the forward count
   * EXCLUDES returned parcels — Delhivery refunds the delivery
   * deduction on a return and bills an RTO fee instead, so a returned
   * parcel legitimately has no forward cost and counting it as missing
   * would make coverage look permanently broken.
   */
  /**
   * Turn each failure's stored KEYS into short-lived links.
   *
   * Presigned on read and NEVER stored — the discipline product images
   * and the billing probe already follow: a URL in a column stops
   * resolving the day the bucket's policy is right, and these are
   * private objects on purpose.
   *
   * Bounded at `MAX_PRESIGNED_ARTIFACTS` across the whole panel, newest
   * run first. The history is twenty runs and signing is local, so this
   * is not about cost — it is about a page that cannot be made to mint
   * an unbounded number of links by a run that failed on fifty accounts.
   * Past the cap the artifact is still SHOWN, with its problem saying
   * why it has no link, because silently dropping it would read as "no
   * screenshot was taken".
   *
   * A signing failure costs one link, never the page: this method exists
   * so that whether things are working can be SEEN, and it would be a
   * poor sort of irony for it to 500.
   */
  private async withArtifactLinks(
    runs: readonly WalletSyncRun[],
  ): Promise<readonly WalletSyncRun[]> {
    let budget = MAX_PRESIGNED_ARTIFACTS;
    const out: WalletSyncRun[] = [];
    for (const run of runs) {
      const accounts: WalletSyncRunAccount[] = [];
      for (const account of run.accounts) {
        const a = account.failureArtifact;
        if (a === null || (a.screenshotUrl === null && a.pageTextUrl === null)) {
          accounts.push(account);
          continue;
        }
        if (budget <= 0) {
          accounts.push({
            ...account,
            failureArtifact: {
              ...a,
              screenshotUrl: null,
              pageTextUrl: null,
              problem:
                a.problem ??
                'The capture is stored, but this page links only the most recent failures.',
            },
          });
          continue;
        }
        budget -= 1;
        accounts.push({
          ...account,
          failureArtifact: {
            ...a,
            screenshotUrl: await this.link(a.screenshotUrl),
            pageTextUrl: await this.link(a.pageTextUrl),
          },
        });
      }
      out.push({ ...run, accounts });
    }
    return out;
  }

  private async link(key: string | null): Promise<string | null> {
    if (key === null) return null;
    try {
      return await this.spaces.presignGetUrl(key);
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'Could not presign a portal failure artefact',
      );
      return null;
    }
  }

  private async costCoverage(): Promise<CostCoverage> {
    const dispatched = { awbNumber: { not: null }, deletedAt: null } as const;
    const [d, fc, r, rc, fSum, rSum] = await Promise.all([
      this.prisma.client.shipment.count({
        where: { ...dispatched, rtoReceivedAt: null },
      }),
      this.prisma.client.shipment.count({
        where: { ...dispatched, rtoReceivedAt: null, actualCourierCostInr: { not: null } },
      }),
      this.prisma.client.shipment.count({ where: { ...dispatched, rtoReceivedAt: { not: null } } }),
      this.prisma.client.shipment.count({
        where: { ...dispatched, rtoReceivedAt: { not: null }, actualRtoCostInr: { not: null } },
      }),
      this.prisma.client.shipment.aggregate({
        where: dispatched,
        _sum: { actualCourierCostInr: true },
      }),
      this.prisma.client.shipment.aggregate({
        where: dispatched,
        _sum: { actualRtoCostInr: true },
      }),
    ]);

    return {
      dispatched: d,
      withForwardCost: fc,
      returned: r,
      withRtoCost: rc,
      forwardTotalInr: (fSum._sum.actualCourierCostInr ?? 0).toString(),
      rtoTotalInr: (rSum._sum.actualRtoCostInr ?? 0).toString(),
    };
  }
}

/** The audit metadata is JSON, so nothing about its shape is guaranteed.
 *  A row that does not parse yields an empty run rather than throwing —
 *  one malformed record must not take out the page that exists to show
 *  whether things are working. */
function toRun(action: string, at: Date, raw: unknown): WalletSyncRun {
  const m = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accounts = Array.isArray(m['accounts']) ? m['accounts'] : [];
  return {
    at: at.toISOString(),
    ok: action === ACTION_OK,
    skipped: typeof m['skipped'] === 'string' ? m['skipped'] : null,
    wrote: m['wrote'] === true,
    windowDays: typeof m['windowDays'] === 'number' ? m['windowDays'] : null,
    accounts: accounts.map((a) => toAccount(a)),
  };
}

function toAccount(raw: unknown): WalletSyncRunAccount {
  const a = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const res = (
    a['result'] !== null && typeof a['result'] === 'object' ? a['result'] : {}
  ) as Record<string, unknown>;
  const num = (o: Record<string, unknown>, k: string): number | null =>
    typeof o[k] === 'number' ? (o[k] as number) : null;
  const str = (o: Record<string, unknown>, k: string): string | null =>
    typeof o[k] === 'string' ? (o[k] as string) : null;
  const bool = (o: Record<string, unknown>, k: string): boolean | null =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : null;

  return {
    label: str(a, 'label') ?? 'Unnamed account',
    courierAccountId: str(a, 'courierAccountId') ?? '',
    error: str(a, 'error'),
    fileBytes: num(a, 'fileBytes'),
    coveredDays: num(a, 'coveredDays'),
    rangeApplied: bool(a, 'rangeApplied'),
    rowsRead: num(res, 'rowsRead'),
    awbsInFile: num(res, 'awbsInFile'),
    unknownAwbs: num(res, 'unknownAwbs'),
    forwardWritten: num(res, 'forwardWritten'),
    rtoWritten: num(res, 'rtoWritten'),
    revised: num(res, 'revised'),
    unchanged: num(res, 'unchanged'),
    sumInr: str(res, 'sumInr'),
    statedTotalInr: str(res, 'statedTotalInr'),
    totalsAgree: bool(res, 'totalsAgree'),
    periodFrom: str(res, 'periodFrom'),
    periodTo: str(res, 'periodTo'),
    dryRun: bool(res, 'dryRun'),
    writes: toWrites(res['writes']),
    writesTruncated: num(res, 'writesTruncated') ?? 0,
    txnsMissing: num(res, 'txnsMissing') ?? 0,
    // Keys only at this stage; `panel()` mints the links. Kept apart so
    // the JSON parsing stays pure and testable without a bucket.
    failureArtifact: toArtifactKeys(a['artifact']),
  };
}

/**
 * The capture's own record, read back off the audit row.
 *
 * The KEYS come out here and the URLs are minted later, because
 * presigning is async and this whole parsing layer is deliberately
 * synchronous — one malformed audit row must not be able to throw on the
 * page that exists to show whether things are working.
 *
 * A key outside the portal-failure prefix is DROPPED and said so, not
 * presigned: the value came out of JSON, and a link to anything in the
 * bucket is not a link this page may mint.
 */
function toArtifactKeys(raw: unknown): WalletSyncFailureArtifact | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const key = (k: string): string | null => {
    const v = o[k];
    if (typeof v !== 'string' || v === '') return null;
    return v.startsWith(PORTAL_FAILURE_PREFIX) ? v : null;
  };
  const stored = { screenshot: key('screenshotKey'), text: key('textKey') };
  const captureProblem = typeof o['error'] === 'string' ? o['error'] : null;
  // A row that carried an artifact object but nothing readable is worth
  // reporting as an artifact with a problem, not as "no artifact": the
  // capture ran and produced nothing, which is itself a finding.
  const outOfPrefix =
    (typeof o['screenshotKey'] === 'string' && stored.screenshot === null) ||
    (typeof o['textKey'] === 'string' && stored.text === null);
  return {
    url: typeof o['url'] === 'string' ? o['url'] : null,
    control: typeof o['control'] === 'string' ? o['control'] : null,
    // Replaced with links in `panel()`; the keys ride here in the
    // meantime so the pure layer has somewhere to put them.
    screenshotUrl: stored.screenshot,
    pageTextUrl: stored.text,
    problem: outOfPrefix
      ? 'A stored file is not under the portal-failure prefix and was not linked.'
      : captureProblem,
  };
}

function toWrites(raw: unknown): WalletSyncWrite[] {
  if (!Array.isArray(raw)) return [];
  const out: WalletSyncWrite[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    if (typeof w['awbNumber'] !== 'string') continue;
    out.push({
      awbNumber: w['awbNumber'],
      orderNumber: typeof w['orderNumber'] === 'string' ? w['orderNumber'] : null,
      leg: typeof w['leg'] === 'string' ? w['leg'] : 'forward',
      amountInr: typeof w['amountInr'] === 'string' ? w['amountInr'] : '0',
      revised: w['revised'] === true,
      previousInr: typeof w['previousInr'] === 'string' ? w['previousInr'] : null,
    });
  }
  return out;
}
