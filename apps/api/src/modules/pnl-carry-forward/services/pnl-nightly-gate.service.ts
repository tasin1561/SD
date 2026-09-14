import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * "Every nightly job succeeded for that night" (PNL-CF-1), read off the
 * jobs' own audit rows.
 *
 * A month is closed only once the courier ledgers are in: the Delhivery
 * wallet export (02:40 IST) and Shiprocket passbook (03:50) carry charges
 * dated up to the last minute of the month, and the two invoice checks
 * (04:10, 04:30) are what would have flagged a charge the invoice and the
 * wallet disagree about. Closing before they have run would freeze a month
 * missing its last day of courier costs, and every one of them would then
 * arrive as a carry-forward.
 *
 * Each job writes ONE audit row per run with its whole summary — the same
 * rows /cost-sync reads — so they are the record, not a second one. For
 * each job the LATEST run since the month ended decides: a manual re-run
 * after a failed night counts, and so does the next night's run.
 */

export interface NightlyJobDef {
  readonly key: string;
  readonly label: string;
  readonly okAction: string;
  readonly failedAction: string;
}

/** The four, in the order they run. The action names are the jobs' own constants. */
export const NIGHTLY_JOBS: readonly NightlyJobDef[] = [
  {
    key: 'delhivery_wallet_sync',
    label: 'Delhivery wallet sync (02:40 IST)',
    okAction: 'courier.wallet_ledger.synced',
    failedAction: 'courier.wallet_ledger.sync_failed',
  },
  {
    key: 'shiprocket_wallet_sync',
    label: 'Shiprocket wallet sync (03:50 IST)',
    okAction: 'courier.shiprocket_wallet.synced',
    failedAction: 'courier.shiprocket_wallet.sync_failed',
  },
  {
    key: 'delhivery_invoice_check',
    label: 'Delhivery invoice check (04:10 IST)',
    okAction: 'courier.delhivery_invoices.checked',
    failedAction: 'courier.delhivery_invoices.check_failed',
  },
  {
    key: 'shiprocket_invoice_check',
    label: 'Shiprocket invoice check (04:30 IST)',
    okAction: 'courier.shiprocket_invoices.checked',
    failedAction: 'courier.shiprocket_invoices.check_failed',
  },
];

export type NightlyJobStatus = 'OK' | 'NOT_RUN' | 'FAILED' | 'PARTIAL' | 'SWITCHED_OFF';

export interface NightlyJobResult {
  readonly key: string;
  readonly label: string;
  readonly status: NightlyJobStatus;
  readonly ranAt: string | null;
  readonly detail: string;
}

export interface NightlyGate {
  /** Runs at or after this instant count — the end of the month being closed. */
  readonly since: string;
  readonly passed: boolean;
  readonly jobs: readonly NightlyJobResult[];
}

/**
 * Per-account outcomes that mean the account WAS read. Anything else —
 * FAILED, REFUSED, CHALLENGE, NO_LOGIN — is an account whose charges did
 * not make it in. SKIPPED is the job deciding there was nothing to do.
 */
const ACCOUNT_OK = new Set(['READ', 'CHECKED', 'SKIPPED']);

function ist(d: Date): string {
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** What one job's latest run says. Pure, so the rules can be pinned without a database. */
export function judgeNightlyRun(
  job: NightlyJobDef,
  since: Date,
  row: { action: string; metadata: unknown; createdAt: Date } | null,
): NightlyJobResult {
  const base = { key: job.key, label: job.label };
  if (row === null) {
    return {
      ...base,
      status: 'NOT_RUN',
      ranAt: null,
      detail: `No run recorded since ${ist(since)}.`,
    };
  }
  const ranAt = row.createdAt.toISOString();
  const meta =
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};
  const accounts = Array.isArray(meta['accounts'])
    ? (meta['accounts'] as Array<Record<string, unknown>>)
    : [];
  const failing = accounts.filter(
    (a) =>
      (typeof a['error'] === 'string' && a['error'] !== '') ||
      (typeof a['outcome'] === 'string' && !ACCOUNT_OK.has(a['outcome'])),
  );
  const name = (a: Record<string, unknown>): string =>
    `${typeof a['label'] === 'string' ? a['label'] : 'an account'}` +
    (typeof a['outcome'] === 'string' ? ` (${a['outcome']})` : '') +
    (typeof a['error'] === 'string' && a['error'] !== ''
      ? `: ${a['error'].slice(0, 160)}`
      : typeof a['detail'] === 'string' && a['detail'] !== ''
        ? `: ${a['detail'].slice(0, 160)}`
        : '');
  if (row.action === job.failedAction) {
    return {
      ...base,
      status: 'FAILED',
      ranAt,
      detail:
        `The last run (${ist(row.createdAt)}) failed` +
        (failing.length > 0 ? ` — ${failing.map(name).join('; ')}` : '') +
        '.',
    };
  }
  if (meta['skipped'] === 'DISABLED') {
    return {
      ...base,
      status: 'SWITCHED_OFF',
      ranAt,
      detail: `Switched off in settings: the run at ${ist(row.createdAt)} did nothing.`,
    };
  }
  if (failing.length > 0) {
    return {
      ...base,
      status: 'PARTIAL',
      ranAt,
      detail:
        `${failing.length} of ${accounts.length} account(s) were not read at ${ist(row.createdAt)}: ` +
        failing.map(name).join('; '),
    };
  }
  return {
    ...base,
    status: 'OK',
    ranAt,
    detail:
      meta['skipped'] === 'NO_ACCOUNTS'
        ? `Ran at ${ist(row.createdAt)}; no active account to read.`
        : `Succeeded at ${ist(row.createdAt)}.`,
  };
}

@Injectable()
export class PnlNightlyGateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether every nightly job's latest run since `since` succeeded. */
  async check(since: Date, now: Date = new Date()): Promise<NightlyGate> {
    const jobs: NightlyJobResult[] = [];
    for (const job of NIGHTLY_JOBS) {
      const row = await this.prisma.client.auditLog.findFirst({
        where: {
          action: { in: [job.okAction, job.failedAction] },
          createdAt: { gte: since, lte: now },
        },
        orderBy: { createdAt: 'desc' },
        select: { action: true, metadata: true, createdAt: true },
      });
      jobs.push(judgeNightlyRun(job, since, row));
    }
    return {
      since: since.toISOString(),
      passed: jobs.every((j) => j.status === 'OK'),
      jobs,
    };
  }
}
