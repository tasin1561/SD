import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { WalletLedgerFetcherService } from './wallet-ledger-fetcher.service';
import {
  WalletImportService,
  type WalletImportResult,
} from '../../wallet-ledger/services/wallet-import.service';
import {
  CourierWalletReconcileService,
  type WalletExportSum,
} from './courier-wallet-reconcile.service';
import type { WalletWindow } from '../pages/wallet-date-range';
import { raiseLedgerFindings } from './ledger-findings';

const SETTING_ENABLED = 'courier.wallet_sync_enabled';
const SETTING_WRITE = 'courier.wallet_sync_writes_enabled';
const SETTING_WINDOW_DAYS = 'courier.wallet_sync_window_days';

/**
 * `PortalSessionService.freezeOnChallenge` raises this when the portal
 * asks for an OTP or a captcha. Estate-wide rather than per account,
 * because the pause it sets is.
 */
const SESSION_CHALLENGE_KEY = 'portal:challenge';

/**
 * ── ONE DIAGNOSIS, ONE KEY ────────────────────────────────
 *
 * These two were ONE key, and the two branches that raise them disagree
 * about everything: kind, title and severity. So whichever failed first
 * owned the row's identity and every later night overwrote its detail
 * and its severity underneath it — which on 29 September 2026 left a
 * HIGH "Delhivery is asking … to prove it is human" sitting over a
 * MEDIUM selector timeout for six days, telling nobody after night one
 * (NOTIF-16 notifies on HIGH, and only when the issue is new) and
 * sending whoever read it to clear a challenge that did not exist.
 *
 * Shiprocket's side already worked this way — a key per diagnosis,
 * `shiprocket-portal-{challenge,rejected,egress,login}` — for exactly
 * this reason.
 */
const challengeKeyFor = (courierAccountId: string): string =>
  `wallet-sync-challenge:${courierAccountId}`;
const failureKeyFor = (courierAccountId: string): string => `wallet-sync:${courierAccountId}`;

/** Days of slack before a short export counts as short. */
const COVERAGE_SLACK_DAYS = 3;
/** Below this, a short span means a quiet week rather than a short window. */
const MIN_ROWS_TO_JUDGE_COVERAGE = 50;

/**
 * How many days a file spans, from its earliest charge to its latest.
 *
 * ISO strings rather than Dates because that is what the importer
 * reports, and re-parsing them here keeps the comparison next to the
 * thing being compared.
 */
function spanDays(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * What happened to one account. Several Delhivery accounts means several.
 *
 * `outcome` speaks `PnlNightlyGateService`'s vocabulary on purpose: it
 * reads this very metadata off the `courier.wallet_ledger.synced` audit
 * row to decide whether a month may close FINAL, and only READ /
 * CHECKED / SKIPPED count as "the account was read". So CHALLENGE keeps
 * the month PROVISIONAL, which is right — nothing was imported.
 */
export type WalletSyncOutcome = 'READ' | 'CHALLENGE' | 'FAILED';

export interface WalletSyncAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly outcome: WalletSyncOutcome;
  readonly fileBytes: number | null;
  readonly result: WalletImportResult | null;
  readonly error: string | null;
  /** Whether their date picker took the window we asked for. */
  readonly rangeApplied: boolean | null;
  /** Which window the export covers — the balance line must match it. */
  readonly exportWindow: WalletWindow | null;
  /** How many days the file we got back actually spans. */
  readonly coveredDays: number | null;
}

export interface WalletSyncSummary {
  readonly ranAt: string;
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  /** False while the sync only reports. See the class comment. */
  readonly wrote: boolean;
  readonly windowDays: number;
  readonly accounts: readonly WalletSyncAccountResult[];
}

/**
 * Fetching the wallet ledger by itself, nightly.
 *
 * ── WHY A BROWSER ────────────────────────────────────────────────────
 * Delhivery has no billing API. Their documented surface offers a cost
 * CALCULATOR — "what does a parcel of this shape cost" — which can
 * never answer "what was this one billed", and cannot see a revision.
 * The wallet ledger is the only record of what actually left, and it
 * exists only in their panel.
 *
 * ── A ROLLING WINDOW, NOT YESTERDAY ──────────────────────────────────
 * A charge is re-cut weeks after the parcel moved. Fetching only the
 * last day would import each parcel's FIRST figure and never see the
 * correction, which is the exact error the whole importer exists to
 * avoid. So it re-fetches a wide window every night and re-states it.
 * That is cheap because the importer overwrites rather than skips.
 *
 * ── SHADOW BY DEFAULT, AND THE TWO SWITCHES ARE SEPARATE ─────────────
 * `wallet_sync_enabled` runs it; `wallet_sync_writes_enabled` lets it
 * touch the cost columns. Two switches rather than one so the fetch and
 * the parse can be proven against real files for a week while writing
 * nothing — the same shape the portal work already uses, and the reason
 * a login or a page change shows up as a report rather than as wrong
 * money in the P&L.
 */
@Injectable()
export class WalletSyncService {
  private readonly logger = new Logger(WalletSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: WalletLedgerFetcherService,
    private readonly importer: WalletImportService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
    private readonly walletReconcile: CourierWalletReconcileService,
  ) {}

  async sync(now: Date = new Date()): Promise<WalletSyncSummary> {
    const [enabled, writes, windowDays] = await Promise.all([
      this.flag(SETTING_ENABLED, false),
      this.flag(SETTING_WRITE, false),
      this.int(SETTING_WINDOW_DAYS, 45),
    ]);

    const base = {
      ranAt: now.toISOString(),
      wrote: writes,
      windowDays,
      accounts: [] as WalletSyncAccountResult[],
    };
    if (!enabled) return { ...base, skipped: 'DISABLED' as const, wrote: false };

    // EVERY active Delhivery account, because each is a different
    // company on their panel with its own wallet. One login cannot see
    // another's money.
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
    if (accounts.length === 0) return { ...base, skipped: 'NO_ACCOUNTS' as const };

    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const results: WalletSyncAccountResult[] = [];

    /*
      ── DO NOT KNOCK ON A DOOR THAT IS ALREADY ANSWERING A CHALLENGE ──

      An open OTP or captcha cannot be solved by a browser, so a sign-in
      attempted against it fails by construction — and CLAUDE.md is
      explicit that hammering a courier portal is how an account gets
      locked. This had no pre-check at all: it only classified the error
      AFTERWARDS, with `/otp|captcha|challenge/i` over the message, so a
      standing challenge meant a fresh browser session against an
      impossible login every single night.

      `ShiprocketWalletSyncService` already does this and the shape is
      copied from it rather than invented again: read the open issue,
      skip the account, say why. Both keys are consulted — the session's
      own estate-wide one, and this job's per-account one — because
      either means a person has to sign in by hand before anything here
      can work.

      Read ONCE for the whole run: it is the same two-row question for
      every account, and the loop below can run for several minutes.
    */
    const challenges = await this.openChallengeKeys(accounts.map((a) => a.id));

    for (const account of accounts) {
      const blockedBy = challenges.get(account.id);
      if (blockedBy !== undefined) {
        this.logger.warn(
          { courierAccountId: account.id, label: account.label, dedupeKey: blockedBy },
          'Skipping the Delhivery wallet sync: a sign-in challenge is still open',
        );
        results.push({
          courierAccountId: account.id,
          label: account.label,
          outcome: 'CHALLENGE',
          fileBytes: null,
          result: null,
          error: null,
          rangeApplied: null,
          exportWindow: null,
          coveredDays: null,
        });
        continue;
      }
      try {
        const {
          bytes: file,
          rangeApplied,
          window: exportWindow,
        } = await this.fetcher.fetch(account.id, from, now);
        // dryRun is the inverse of the write switch: in SHADOW it parses
        // the real file and reports exactly what it WOULD change.
        const result = await this.importer.importDelhiveryWallet(file, null, {
          dryRun: !writes,
          // Scoped, so one account's ledger cannot claim another's
          // parcels and "not ours" keeps meaning something.
          courierAccountId: account.id,
        });
        const coveredDays = spanDays(result.periodFrom, result.periodTo);
        results.push({
          courierAccountId: account.id,
          label: account.label,
          outcome: 'READ',
          fileBytes: file.length,
          result,
          error: null,
          rangeApplied,
          exportWindow,
          coveredDays,
        });
        await this.reportCoverage(account, windowDays, coveredDays, rangeApplied, result);

        // Changed, vanished, and below-zero parcels — the same three findings
        // every courier's ledger import can produce, said the same way.
        await raiseLedgerFindings(this.issues, {
          courierName: 'Delhivery',
          source: 'WalletSyncService',
          account,
          result,
        });
        // It worked, so clear its own alarms — BOTH of them. An issue
        // raised under one key and cleared under another is how a HIGH
        // row saying "sign in by hand" survives the night the sign-in
        // started working again (the lesson
        // `clearShiprocketOpenFailures` was extracted for).
        for (const key of [failureKeyFor(account.id), challengeKeyFor(account.id)]) {
          await this.issues.resolveByKey(key, 'The sync completed on its own.');
        }
      } catch (err) {
        // One account's portal being down must not stop the others —
        // the same per-item failure isolation as the AWB and manifest
        // sagas. Its costs are simply re-read tomorrow.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { err: message, courierAccountId: account.id, label: account.label },
          'Wallet ledger sync failed for one account; continuing with the rest',
        );
        const challenge = /otp|captcha|challenge/i.test(message);
        results.push({
          courierAccountId: account.id,
          label: account.label,
          outcome: challenge ? 'CHALLENGE' : 'FAILED',
          fileBytes: null,
          result: null,
          error: message,
          rangeApplied: null,
          exportWindow: null,
          coveredDays: null,
        });

        /*
          Say so where somebody will see it. A cost sync that stops
          working is invisible otherwise: the figures simply stop moving,
          and nobody notices until a margin looks wrong weeks later.

          TWO KEYS, one per diagnosis — see `challengeKeyFor`. "A person
          must go and sign in" and "the page or the login has changed"
          need different actions and different urgencies, and a shared
          key made each night's row contradict its own title.
        */
        if (challenge) {
          await this.issues.raise({
            kind: SystemIssueKind.COURIER_PORTAL_CHALLENGE,
            // Nothing will run again until a person answers it.
            severity: SystemIssueSeverity.HIGH,
            title: `Delhivery is asking ${account.label} to prove it is human`,
            detail:
              'The portal presented an OTP or captcha, so the nightly cost sync cannot log in. ' +
              'Sign in by hand once to clear it, then resolve this issue — until it is open, ' +
              'this sync will not try again for this account. Meanwhile no courier costs are ' +
              'being recorded for it and the P&L will report its margin as uncovered.',
            source: 'WalletSyncService',
            dedupeKey: challengeKeyFor(account.id),
            metadata: { courierAccountId: account.id, label: account.label, error: message },
          });
        } else {
          await this.issues.raise({
            kind: SystemIssueKind.COURIER_COST_SYNC,
            // A one-off overnight failure is not urgent — the window is
            // rolling and tomorrow re-reads it.
            severity: SystemIssueSeverity.MEDIUM,
            title: `Could not read what Delhivery charged ${account.label}`,
            detail:
              `The nightly wallet sync failed: ${message}\n\n` +
              'Costs for this account are not updating. It retries tonight; if this keeps ' +
              'recurring the portal has probably changed and the login needs looking at. ' +
              'Meanwhile the ledger can be uploaded by hand on the Delhivery page.',
            source: 'WalletSyncService',
            // The ACCOUNT, not the moment — a key carrying a timestamp
            // would open a fresh row every night.
            dedupeKey: failureKeyFor(account.id),
            metadata: { courierAccountId: account.id, label: account.label, error: message },
          });
        }
      }
    }

    const summary: WalletSyncSummary = { ...base, skipped: null, accounts: results };
    const failed = results.filter((r) => r.error !== null).length;
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action:
        failed === results.length
          ? 'courier.wallet_ledger.sync_failed'
          : 'courier.wallet_ledger.synced',
      entityType: 'courier',
      // A UUID column. The code goes in metadata (see the importer).
      entityId: null,
      severity: failed > 0 ? 'HIGH' : writes ? 'MEDIUM' : 'LOW',
      metadata: { courierCode: 'delhivery', ...summary, accounts: results.map((r) => ({ ...r })) },
    });
    this.logger.log({ accounts: results.length, failed, wrote: writes }, 'Wallet ledger sync done');

    /*
      AND THE OTHER HALF OF THE WALLET.

      The ledger above says what the courier CHARGED us. This says what
      we PUT IN, and whether every rupee of it left one of our own bank
      accounts — the prepaid float is our capital sitting on somebody
      else's system, and until now nothing checked either direction.

      Run here rather than on its own cron because it needs the same
      signed-in session that has just been used, and a second nightly
      login against a courier's portal is load for nothing. Its failures
      are its own — it raises them itself — so they never fail the
      ledger import that has already succeeded.
    */
    try {
      // What each account's export summed to, so the reconcile can hold
      // it against the figure their own page states for the same
      // window. Two independent readings of one ledger: if the file is
      // short, its sum falls below theirs. The WINDOW travels with the
      // sum, so the reconcile compares only readings of the same range.
      const exportSums = new Map<string, WalletExportSum>();
      for (const r of results) {
        if (r.result !== null) {
          exportSums.set(r.courierAccountId, {
            sumInr: r.result.sumInr,
            window: r.exportWindow ?? 'UNKNOWN',
          });
        }
      }
      const recon = await this.walletReconcile.reconcile('delhivery', exportSums);
      this.logger.log(recon, 'Courier wallet reconciliation done');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Courier wallet reconciliation could not run',
      );
    }
    return summary;
  }

  /**
   * Did we get the window we asked for?
   *
   * `wallet_sync_window_days` is not a preference — it is the whole
   * reason this re-reads a wide range every night instead of fetching
   * yesterday. Delhivery re-cuts a charge weeks after the parcel moved,
   * so an export that only ever covers the last few days imports each
   * parcel's FIRST figure and never sees the correction: precisely the
   * error the importer exists to avoid, arriving silently, as costs
   * that look settled and are not.
   *
   * Nothing was comparing the two. The setting said 45 days and every
   * file that came back covered about 7, because their date picker is
   * driven best-effort and the export falls back to the page default —
   * a failure the page object anticipated in a comment and then
   * discarded the evidence for.
   *
   * Checked against the FILE rather than against the picker, so it
   * fires whichever way the window was lost: a picker we could not
   * drive, a picker we drove that they ignored, or a cap they applied
   * server-side. `rangeApplied` only says which of those it was.
   *
   * Guarded on row count because the span is the earliest and latest
   * CHARGE in the file, not a stated export range: on an account with a
   * handful of rows a short span means a quiet week, not a short
   * window, and an alarm that fires on quiet is one people learn to
   * ignore.
   */
  /**
   * Which accounts are behind an unanswered sign-in challenge, and under
   * which key.
   *
   * ONE query for the whole run, and it asks for the two keys by name
   * rather than by prefix: a prefix would also match
   * `wallet-sync:<id>` — the ordinary "the page changed" failure — and
   * skipping the account for THAT would mean a transient portal error
   * silenced the sync permanently, with nothing to clear it because the
   * only thing that clears it is a successful run.
   *
   * Returns a map so the caller can say which key it is waiting on; an
   * operator reading the log needs to know whether to clear the
   * estate-wide row or this account's.
   *
   * FAILS OPEN. If this read throws, the sync proceeds and the session
   * reports whatever is really wrong — the alternative is a database
   * blip costing a night's costs for every account.
   */
  private async openChallengeKeys(
    courierAccountIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const perAccount = new Map(courierAccountIds.map((id) => [challengeKeyFor(id), id]));
    try {
      const open = await this.prisma.client.systemIssue.findMany({
        where: {
          resolvedAt: null,
          dedupeKey: { in: [SESSION_CHALLENGE_KEY, ...perAccount.keys()] },
        },
        select: { dedupeKey: true },
      });
      const blocked = new Map<string, string>();
      for (const row of open) {
        if (row.dedupeKey === SESSION_CHALLENGE_KEY) {
          // The session's pause is estate-wide, so this stops every
          // account rather than the one that met it.
          for (const id of courierAccountIds) blocked.set(id, row.dedupeKey);
          continue;
        }
        const id = perAccount.get(row.dedupeKey);
        if (id !== undefined) blocked.set(id, row.dedupeKey);
      }
      return blocked;
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not read open portal challenges; running the sync anyway',
      );
      return new Map();
    }
  }

  private async reportCoverage(
    account: { id: string; label: string },
    windowDays: number,
    coveredDays: number | null,
    rangeApplied: boolean,
    result: WalletImportResult,
  ): Promise<void> {
    const key = `wallet-sync-window:${account.id}`;
    const enoughRows = result.rowsRead >= MIN_ROWS_TO_JUDGE_COVERAGE;
    const short =
      coveredDays !== null && enoughRows && coveredDays + COVERAGE_SLACK_DAYS < windowDays;

    if (!short) {
      await this.issues.resolveByKey(key, 'The export covered the window we asked for.');
      return;
    }

    await this.issues.raise({
      kind: SystemIssueKind.COURIER_COST_SYNC,
      // Not urgent — today's costs ARE being recorded. What is lost is
      // the revision to an older one, which shows up as a margin that
      // is quietly wrong rather than as anything stopping.
      severity: SystemIssueSeverity.MEDIUM,
      title: `Only ${coveredDays} days of ledger came back for ${account.label}, not ${windowDays}`,
      detail:
        `The nightly sync asks for ${windowDays} days so a charge re-cut weeks later gets ` +
        `re-read. The export that came back spans ${coveredDays} days ` +
        `(${result.periodFrom ?? '?'} to ${result.periodTo ?? '?'}), so a revision older than ` +
        `that will never be picked up and those parcels keep the first figure they were given.\n\n` +
        (rangeApplied
          ? 'Their date picker accepted the range, so the cap is theirs — the export may have a ' +
            'maximum span. Exporting a longer range by hand from the Finances page and uploading ' +
            'it on the Delhivery page is the way to catch up.'
          : 'Their date picker could not be driven, so the export fell back to whatever range ' +
            'the page defaults to. The picker has probably changed shape and needs looking at.'),
      source: 'WalletSyncService',
      dedupeKey: key,
      metadata: {
        courierAccountId: account.id,
        label: account.label,
        windowDays,
        coveredDays,
        rangeApplied,
        periodFrom: result.periodFrom,
        periodTo: result.periodTo,
        rowsRead: result.rowsRead,
      },
    });
  }

  private async flag(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? fallback;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }
}
