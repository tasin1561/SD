import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  PnlCloseKind,
  PnlLockState,
  PnlVersionKind,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  orderFate,
  PNL_SNAPSHOT_KEYS,
  PnlService,
  type PnlReport,
  type PnlSnapshotKey,
} from '../../treasury/services/pnl.service';
import {
  buildBaseline,
  carriedByLine,
  diffMonth,
  rebaseRows,
  rowKey,
  subtractCarriedFromReport,
  sumCarried,
  type BaselineRow,
  type CarryForwardDraft,
  type LiveRow,
} from './pnl-carry-forward-diff';
import {
  isMonth,
  monthName,
  monthOf,
  monthsBetween,
  monthWindow,
  nextMonth,
  prevMonth,
} from './pnl-month';
import { PnlNightlyGateService, type NightlyGate } from './pnl-nightly-gate.service';

/** Every close, re-lock and carry-forward write takes this one key (see AdvisoryLock.PNL_PERIOD). */
const LOCK_KEY = 'pnl-periods';
/** A month is closed from 06:00 IST on the 1st — after the last nightly job (04:30). */
const CLOSE_AFTER_MONTH_END_MS = 6 * 60 * 60 * 1000;
/**
 * A month's snapshot can be thousands of rows, and detection and re-lock
 * compute the month while holding the lock; the default 5s would not do.
 */
const TX_OPTIONS = { timeout: 300_000, maxWait: 30_000 } as const;
const CHUNK = 500;
const ZERO = new Prisma.Decimal(0);
const GOD_MODE_MIN_REASON = 30;
const LOCK_MIN_REASON = 10;

/** Raised when a month closes PROVISIONAL; cleared when it is locked permanently. */
export const PNL_PROVISIONAL_ISSUE_PREFIX = 'pnl-close-provisional:';
/** Raised when the scheduled close itself throws (the engine refused, the database failed). */
export const PNL_CLOSE_FAILED_ISSUE_PREFIX = 'pnl-close-failed:';
/** RETIRED 2026-09-14 — the old "waiting for the nightly jobs" issue; resolved wherever seen. */
export const PNL_CLOSE_ISSUE_PREFIX = 'pnl-close:';
export const PNL_NEVER_CLOSED_ISSUE = 'pnl-close:never-closed';

export interface CloseResult {
  readonly month: string;
  readonly alreadyClosed: boolean;
  readonly closedAt: string;
  readonly lockState: PnlLockState;
  readonly version: number;
  readonly netInr: string;
  readonly rows: number;
  /** Carry-forwards from earlier closed months written into this one just before it closed. */
  readonly carriedIn: number;
}

export interface RelockResult {
  readonly month: string;
  readonly version: number;
  readonly kind: PnlVersionKind;
  readonly lockState: PnlLockState;
  readonly netBeforeInr: string;
  readonly netInr: string;
  readonly rows: number;
  /** Net of what had already been carried into later months and was left out. */
  readonly carriedOutNetInr: string;
  readonly gatePassed: boolean;
}

export interface DetectResult {
  readonly landedMonth: string;
  readonly monthsChecked: number;
  readonly provisionalSkipped: readonly string[];
  readonly rowsAdded: number;
  readonly byOrigin: ReadonlyArray<{
    readonly originMonth: string;
    readonly rows: number;
    readonly netInr: string;
  }>;
}

export interface AutoCloseResult {
  readonly closed: ReadonlyArray<{ readonly month: string; readonly lockState: PnlLockState }>;
  readonly failed: { readonly month: string; readonly error: string } | null;
  readonly neverClosed: boolean;
}

export type BackfillAction = 'ALREADY_CLOSED' | 'WOULD_CLOSE' | 'CLOSED' | 'SKIPPED' | 'FAILED';

export interface BackfillResult {
  readonly dryRun: boolean;
  readonly throughMonth: string;
  readonly firstActivityMonth: string | null;
  readonly months: ReadonlyArray<{
    readonly month: string;
    readonly action: BackfillAction;
    readonly netInr: string | null;
    readonly complete: boolean | null;
    readonly note: string | null;
  }>;
}

const addNullable = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): Prisma.Decimal | null =>
  a === null ? b : b === null ? a : a.add(b);

/**
 * Each line's rows must add up to the figure the report prints — the
 * engine pins that for every line, and carry-forward depends on it: the
 * frozen total plus the row-by-row carry-forwards equals the month
 * recomputed only when rows and totals are the same thing. A month that
 * failed it would freeze a total its rows can never reconcile to.
 */
export function rowsDisagree(report: PnlReport, rows: readonly LiveRow[]): string[] {
  const sums = new Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }>();
  for (const r of rows) {
    const s = sums.get(r.lineKey) ?? { revenue: ZERO, cost: ZERO };
    sums.set(r.lineKey, {
      revenue: s.revenue.add(r.revenue ?? ZERO),
      cost: s.cost.add(r.cost ?? ZERO),
    });
  }
  const out: string[] = [];
  for (const line of report.lines) {
    const s = sums.get(line.key) ?? { revenue: ZERO, cost: ZERO };
    if (!s.revenue.eq(line.revenueInr) || !s.cost.eq(line.costInr)) {
      out.push(
        `${line.label}: rows add up to ₹${s.revenue.toFixed(2)} / ₹${s.cost.toFixed(2)}, ` +
          `the line says ₹${line.revenueInr} / ₹${line.costInr}`,
      );
    }
  }
  const opex = sums.get('operating_expenses')?.cost ?? ZERO;
  if (!opex.eq(report.operatingExpensesInr)) {
    out.push(
      `Operating expenses: rows add up to ₹${opex.toFixed(2)}, the report says ₹${report.operatingExpensesInr}`,
    );
  }
  return out;
}

/** Whether a month's report has anything in it. */
function hasActivity(report: PnlReport): boolean {
  const nonZero = (v: string): boolean => !new Prisma.Decimal(v).isZero();
  return (
    nonZero(report.operatingExpensesInr) ||
    report.lines.some(
      (l) =>
        nonZero(l.revenueInr) ||
        nonZero(l.costInr) ||
        // These count records, so an unpriced parcel is activity too.
        (['inbound_freight', 'delivery', 'rto'].includes(l.key) && l.coverage.total > 0),
    )
  );
}

/** How an order stands now, for the words of a carry-forward on the delivery or returns line. */
function orderNow(line: PnlSnapshotKey, status: OrderStatus): string {
  const fate = orderFate(status);
  const own = line === 'delivery' ? 'delivered' : 'returned';
  const s = status.toLowerCase();
  if (fate === own) return `still ${own}, now dated in another month (${s})`;
  switch (fate) {
    case 'delivered':
      return `it is delivered now (${s})`;
    case 'returned':
      return `it came back to us (${s})`;
    case 'called_off':
      return `it has been called off (${s})`;
    case 'open':
      return `it is open again (${s})`;
    default: {
      const unreachable: never = fate;
      return String(unreachable);
    }
  }
}

/** Which version kind a first close writes. */
function firstVersionKind(kind: PnlCloseKind, lockState: PnlLockState): PnlVersionKind {
  switch (kind) {
    case PnlCloseKind.AUTO:
      return lockState === PnlLockState.FINAL
        ? PnlVersionKind.AUTO_FINAL
        : PnlVersionKind.AUTO_PROVISIONAL;
    case PnlCloseKind.MANUAL:
      return PnlVersionKind.MANUAL;
    case PnlCloseKind.BACKFILL:
      return PnlVersionKind.BACKFILL;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * Closing P&L months, locking them, and carrying later changes forward
 * (PNL-CF-1, amended 2026-09-14).
 *
 * CLOSE freezes a finished month as VERSION 1: the whole report exactly as
 * /pnl prints it for that window, and every record behind every line, keyed
 * by the record's stable id. On the scheduled close it is FINAL when every
 * nightly job succeeded and PROVISIONAL when one did not — the month still
 * closes on time, and the failure is raised for a person.
 *
 * DETECT recomputes every FINAL month with the live engine and compares it,
 * record by record, with what has been reported for it so far (its current
 * version plus every carry-forward written against it). Each difference is
 * an append-only carry-forward counted in the month OPEN when it is found.
 * A PROVISIONAL month is skipped: its late data belongs IN it, and goes in
 * when it is locked permanently.
 *
 * RE-LOCK writes a new version and keeps every earlier one: "lock
 * permanently" (PROVISIONAL → FINAL) and god mode (a FINAL month restated).
 * The new version is the month live MINUS every carry-forward already
 * recorded against it, per record and per line — those rows stay counted
 * in the months they landed in, so nothing is counted twice and frozen
 * versions plus carry-forwards still equal the live engine to the paisa.
 */
@Injectable()
export class PnlPeriodService {
  private readonly logger = new Logger(PnlPeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pnl: PnlService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
    private readonly gate: PnlNightlyGateService,
  ) {}

  /** Every record behind every line of `month`, as the engine answers now. */
  async liveRows(month: string): Promise<LiveRow[]> {
    const { from, to } = monthWindow(month);
    const out: LiveRow[] = [];
    // One line at a time: a month's report is a handful of heavy queries,
    // and running all fifteen at once would take the connection pool
    // (SCALE-2) away from customer traffic for the length of the close.
    for (const lineKey of PNL_SNAPSHOT_KEYS) {
      const items = await this.pnl.allLineItems(lineKey, from, to);
      const byRef = new Map<string, LiveRow>();
      for (const i of items) {
        const revenue = i.revenueInr === null ? null : new Prisma.Decimal(i.revenueInr);
        const cost = i.costInr === null ? null : new Prisma.Decimal(i.costInr);
        const prev = byRef.get(i.id);
        byRef.set(
          i.id,
          prev === undefined
            ? {
                lineKey,
                refKey: i.id,
                revenue,
                cost,
                label: { ref: i.ref, subRef: i.subRef, at: i.at, present: true },
              }
            : {
                ...prev,
                revenue: addNullable(prev.revenue, revenue),
                cost: addNullable(prev.cost, cost),
              },
        );
      }
      out.push(...byRef.values());
    }
    return out;
  }

  /**
   * Close `month` as version 1. Idempotent: a month already closed is
   * returned as it is. Refused for a month that has not ended, and for a
   * month earlier than one already closed (months close in order, so a
   * carry-forward always lands after the month it came from).
   */
  async close(input: {
    readonly month: string;
    readonly kind: PnlCloseKind;
    readonly lockState?: PnlLockState;
    readonly staffId: string | null;
    readonly reason: string | null;
    readonly nightlyJobs: NightlyGate | null;
    readonly now?: Date;
  }): Promise<CloseResult> {
    const now = input.now ?? new Date();
    const lockState = input.lockState ?? PnlLockState.FINAL;
    const { month } = input;
    this.assertMonth(month);
    const { from, to } = monthWindow(month);
    this.assertEnded(month, to, now);
    const existing = await this.closedSummary(month);
    if (existing !== null) return existing;
    await this.assertNoLaterClosed(this.prisma.client, month);

    // Changes to the months before this one land HERE, while it is open.
    const carried = await this.detect(month, now);

    const report = await this.pnl.report(from, to);
    const rows = await this.liveRows(month);
    this.assertRowsTile(month, report, rows);

    let created: { closedAt: Date; netInr: Prisma.Decimal } | null = null;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        await takeAdvisoryLock(tx, AdvisoryLock.PNL_PERIOD, LOCK_KEY);
        const again = await tx.pnlPeriod.findUnique({ where: { month }, select: { id: true } });
        if (again !== null) return null;
        await this.assertNoLaterClosed(tx, month);
        const period = await tx.pnlPeriod.create({
          data: {
            month,
            periodStart: from,
            periodEnd: to,
            closedAt: now,
            closedByStaffId: input.staffId,
            closeKind: input.kind,
            lockState,
            reason: input.reason,
            grossMarginInr: report.grossMarginInr,
            operatingExpensesInr: report.operatingExpensesInr,
            netInr: report.netInr,
            complete: report.complete,
            report: report as unknown as Prisma.InputJsonValue,
            ...(input.nightlyJobs === null
              ? {}
              : { nightlyJobs: input.nightlyJobs as unknown as Prisma.InputJsonValue }),
          },
          select: { id: true, closedAt: true, netInr: true },
        });
        await this.writeVersion(tx, {
          periodId: period.id,
          version: 1,
          kind: firstVersionKind(input.kind, lockState),
          lockState,
          staffId: input.staffId,
          reason: input.reason,
          report,
          rows,
          nightlyJobs: input.nightlyJobs,
          netBefore: null,
          carriedOut: null,
          now,
        });
        await this.audit.log(
          {
            actorType: input.staffId === null ? ActorType.SYSTEM : ActorType.STAFF,
            actorId: input.staffId,
            staffUserId: input.staffId,
            action: 'treasury.pnl_period.closed',
            entityType: 'pnl_period',
            // The MONTH is the thing closed, and it is not a uuid; it goes in metadata.
            entityId: null,
            severity: 'HIGH',
            metadata: {
              month,
              periodId: period.id,
              kind: input.kind,
              lockState,
              reason: input.reason,
              netInr: report.netInr,
              complete: report.complete,
              warnings: report.warnings,
              rows: rows.length,
              carriedIn: carried.rowsAdded,
              nightlyJobs: input.nightlyJobs,
            },
          },
          tx,
        );
        return { closedAt: period.closedAt, netInr: period.netInr };
      }, TX_OPTIONS);
    } catch (err) {
      // The unique month is the last word: whoever lost the race gets the winner.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    // The retired "waiting for the nightly jobs" issue, and a failed close, are over either way.
    await this.issues.resolveByKey(
      `${PNL_CLOSE_ISSUE_PREFIX}${month}`,
      `${monthName(month)} is closed.`,
      input.staffId,
    );
    await this.issues.resolveByKey(
      `${PNL_CLOSE_FAILED_ISSUE_PREFIX}${month}`,
      `${monthName(month)} is closed.`,
      input.staffId,
    );
    if (created === null) {
      const winner = await this.closedSummary(month);
      if (winner !== null) return winner;
      throw new ConflictException({
        code: 'PNL_CLOSE_RACED',
        message: `${monthName(month)} could not be closed; try again.`,
      });
    }
    this.logger.log({ month, kind: input.kind, lockState, rows: rows.length }, 'P&L month closed');
    return {
      month,
      alreadyClosed: false,
      closedAt: created.closedAt.toISOString(),
      lockState,
      version: 1,
      netInr: created.netInr.toFixed(2),
      rows: rows.length,
      carriedIn: carried.rowsAdded,
    };
  }

  /**
   * "Lock permanently": a PROVISIONAL month becomes FINAL, re-snapshotted
   * with the live engine now — the missing data lands IN the month it
   * belongs to. Allowed whatever the nightly jobs now say: the owner
   * decides, and the audit records what the gate said.
   */
  async lockPermanently(input: {
    readonly month: string;
    readonly staffId: string;
    readonly reason: string;
    readonly now?: Date;
  }): Promise<RelockResult> {
    if (input.reason.trim().length < LOCK_MIN_REASON) {
      throw new BadRequestException({
        code: 'PNL_REASON_TOO_SHORT',
        message: `Say why this month is being locked permanently (at least ${LOCK_MIN_REASON} characters).`,
      });
    }
    return this.relock({ ...input, kind: PnlVersionKind.LOCK_PERMANENTLY });
  }

  /**
   * God mode: re-lock a month with the live engine now. On a FINAL month the
   * new version is live − Σ carry-forwards already recorded from it (see
   * `rebaseRows`); on a PROVISIONAL one it is the same as locking it
   * permanently, under the stricter guardrails and a CRITICAL audit.
   */
  async godModeRelock(input: {
    readonly month: string;
    readonly staffId: string;
    readonly reason: string;
    readonly confirmMonth: string;
    readonly acknowledgeRisk: boolean;
    readonly now?: Date;
  }): Promise<RelockResult> {
    if (input.reason.trim().length < GOD_MODE_MIN_REASON) {
      throw new BadRequestException({
        code: 'PNL_GOD_MODE_REASON_TOO_SHORT',
        message: `God mode needs a reason of at least ${GOD_MODE_MIN_REASON} characters.`,
      });
    }
    if (input.confirmMonth !== input.month) {
      throw new BadRequestException({
        code: 'PNL_GOD_MODE_CONFIRMATION_MISMATCH',
        message: `Type the month exactly as "${input.month}" to confirm.`,
      });
    }
    if (input.acknowledgeRisk !== true) {
      throw new BadRequestException({
        code: 'PNL_GOD_MODE_RISK_NOT_ACKNOWLEDGED',
        message: 'Acknowledge that this restates a locked month before re-locking it.',
      });
    }
    return this.relock({ ...input, kind: PnlVersionKind.GOD_MODE });
  }

  private async relock(input: {
    readonly month: string;
    readonly staffId: string;
    readonly reason: string;
    readonly kind: PnlVersionKind;
    readonly now?: Date;
  }): Promise<RelockResult> {
    const now = input.now ?? new Date();
    const { month } = input;
    this.assertMonth(month);
    const { from, to } = monthWindow(month);
    this.assertEnded(month, to, now);
    const gate = await this.gate.check(to, now);
    const reason = input.reason.trim();

    const result = await this.prisma.client.$transaction(async (tx) => {
      // The live month is computed UNDER the lock, so no carry-forward can
      // be written between reading the month and subtracting what was carried.
      await takeAdvisoryLock(tx, AdvisoryLock.PNL_PERIOD, LOCK_KEY);
      const period = await tx.pnlPeriod.findUnique({
        where: { month },
        select: { id: true, lockState: true },
      });
      if (period === null) {
        throw new NotFoundException({
          code: 'PNL_MONTH_NOT_CLOSED',
          message: `${monthName(month)} is not closed, so there is nothing to re-lock. Close it first.`,
        });
      }
      if (
        input.kind === PnlVersionKind.LOCK_PERMANENTLY &&
        period.lockState !== PnlLockState.PROVISIONAL
      ) {
        throw new ConflictException({
          code: 'PNL_ALREADY_FINAL',
          message: `${monthName(month)} is already locked permanently. Restating it now is god mode.`,
        });
      }
      const current = await tx.pnlSnapshotVersion.findFirst({
        where: { periodId: period.id, supersededAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, netInr: true },
      });
      if (current === null) {
        throw new ConflictException({
          code: 'PNL_VERSION_MISSING',
          message: `${monthName(month)} has no current version to replace.`,
        });
      }
      const report = await this.pnl.report(from, to);
      const live = await this.liveRows(month);
      this.assertRowsTile(month, report, live);
      const carryForwards = await tx.pnlCarryForward.findMany({
        where: { originPeriodId: period.id },
        select: {
          lineKey: true,
          refKey: true,
          revenueDeltaInr: true,
          costDeltaInr: true,
          revenueAfterInr: true,
          costAfterInr: true,
          label: true,
          detectedAt: true,
        },
      });
      const carried = sumCarried(carryForwards);
      const byLine = carriedByLine(carried);
      const rows = rebaseRows(live, carried);
      const frozen = subtractCarriedFromReport(report, byLine);
      const carriedOutNet = [...byLine.values()].reduce(
        (t, c) => t.add(c.revenue).sub(c.cost),
        ZERO,
      );
      const superseded = await tx.pnlSnapshotVersion.updateMany({
        where: { id: current.id, supersededAt: null },
        data: { supersededAt: now },
      });
      if (superseded.count === 0) {
        throw new ConflictException({
          code: 'PNL_VERSION_MOVED',
          message: `${monthName(month)} was re-locked by somebody else just now; reload it.`,
        });
      }
      const version = current.version + 1;
      await this.writeVersion(tx, {
        periodId: period.id,
        version,
        kind: input.kind,
        lockState: PnlLockState.FINAL,
        staffId: input.staffId,
        reason,
        report: frozen,
        rows,
        nightlyJobs: gate,
        netBefore: current.netInr,
        carriedOut: Object.fromEntries(
          [...byLine].map(([k, v]) => [
            k,
            { revenueInr: v.revenue.toFixed(2), costInr: v.cost.toFixed(2) },
          ]),
        ),
        now,
      });
      await tx.pnlPeriod.updateMany({
        where: { id: period.id },
        data: { lockState: PnlLockState.FINAL },
      });
      const godMode = input.kind === PnlVersionKind.GOD_MODE;
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: input.staffId,
          staffUserId: input.staffId,
          action: godMode
            ? 'treasury.pnl_period.god_mode_relocked'
            : 'treasury.pnl_period.locked_permanently',
          entityType: 'pnl_period',
          // The month is not a uuid; it goes in metadata.
          entityId: null,
          severity: godMode ? 'CRITICAL' : 'HIGH',
          metadata: {
            month,
            periodId: period.id,
            kind: input.kind,
            reason,
            fromLockState: period.lockState,
            version,
            supersededVersion: current.version,
            netBeforeInr: current.netInr.toFixed(2),
            netInr: frozen.netInr,
            carriedOutNetInr: carriedOutNet.toFixed(2),
            carryForwardsLeftOut: carryForwards.length,
            rows: rows.length,
            gatePassed: gate.passed,
            // The owner decides; say so when the jobs had not all succeeded.
            lockedDespiteNightlyJobs: !gate.passed,
            nightlyJobs: gate.jobs.map((j) => ({ key: j.key, status: j.status, detail: j.detail })),
          },
        },
        tx,
      );
      return {
        month,
        version,
        kind: input.kind,
        lockState: PnlLockState.FINAL,
        netBeforeInr: current.netInr.toFixed(2),
        netInr: frozen.netInr,
        rows: rows.length,
        carriedOutNetInr: carriedOutNet.toFixed(2),
        gatePassed: gate.passed,
      };
    }, TX_OPTIONS);
    await this.issues.resolveByKey(
      `${PNL_PROVISIONAL_ISSUE_PREFIX}${month}`,
      `${monthName(month)} was locked permanently: ${reason}`,
      input.staffId,
    );
    this.logger.log({ month, kind: input.kind, version: result.version }, 'P&L month re-locked');
    return result;
  }

  /**
   * Carry into `landedMonth` every change to every FINAL month before it.
   * `landedMonth` must be OPEN — checked under the same lock a close takes,
   * so a carry-forward can never land in a month that has closed. A
   * PROVISIONAL month is skipped: its late data stays in it. Idempotent: a
   * second run finds the baseline already moved.
   */
  async detect(landedMonth: string, now: Date = new Date()): Promise<DetectResult> {
    this.assertMonth(landedMonth);
    const periods = await this.prisma.client.pnlPeriod.findMany({
      where: { month: { lt: landedMonth } },
      orderBy: { month: 'asc' },
      select: { id: true, month: true, lockState: true },
    });
    const byOrigin: Array<{ originMonth: string; rows: number; netInr: string }> = [];
    const provisionalSkipped: string[] = [];
    for (const period of periods) {
      if (period.lockState !== PnlLockState.FINAL) {
        provisionalSkipped.push(period.month);
        continue;
      }
      const drafts = await this.prisma.client.$transaction(async (tx) => {
        await takeAdvisoryLock(tx, AdvisoryLock.PNL_PERIOD, LOCK_KEY);
        const landed = await tx.pnlPeriod.findUnique({
          where: { month: landedMonth },
          select: { id: true },
        });
        if (landed !== null) {
          throw new ConflictException({
            code: 'PNL_MONTH_CLOSED',
            message: `${monthName(landedMonth)} is closed; nothing more can be carried into it.`,
          });
        }
        const still = await tx.pnlPeriod.findUnique({
          where: { id: period.id },
          select: { lockState: true },
        });
        if (still?.lockState !== PnlLockState.FINAL) return [];
        const current = await tx.pnlSnapshotVersion.findFirst({
          where: { periodId: period.id, supersededAt: null },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, createdAt: true },
        });
        if (current === null) return [];
        // Computed UNDER the lock, so a re-lock cannot move the baseline
        // between reading the month and comparing it.
        const live = await this.liveRows(period.month);
        const [snapshot, earlier] = await Promise.all([
          tx.pnlSnapshotRow.findMany({
            where: { versionId: current.id },
            select: { lineKey: true, refKey: true, revenueInr: true, costInr: true, label: true },
          }),
          tx.pnlCarryForward.findMany({
            where: { originPeriodId: period.id },
            orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
            select: {
              lineKey: true,
              refKey: true,
              revenueDeltaInr: true,
              costDeltaInr: true,
              revenueAfterInr: true,
              costAfterInr: true,
              label: true,
              detectedAt: true,
            },
          }),
        ]);
        const baseline = buildBaseline(
          snapshot,
          earlier,
          current.version > 1 ? current.createdAt : null,
        );
        const context = await this.reasonContext(tx, baseline, live);
        const found = diffMonth(baseline, live, context);
        for (let i = 0; i < found.length; i += CHUNK) {
          await tx.pnlCarryForward.createMany({
            data: found.slice(i, i + CHUNK).map((d) => this.toRow(period, landedMonth, d, now)),
          });
        }
        return found;
      }, TX_OPTIONS);
      if (drafts.length > 0) {
        byOrigin.push({
          originMonth: period.month,
          rows: drafts.length,
          netInr: drafts.reduce((t, d) => t.add(d.revenueDelta).sub(d.costDelta), ZERO).toFixed(2),
        });
      }
    }
    const rowsAdded = byOrigin.reduce((n, o) => n + o.rows, 0);
    if (rowsAdded > 0) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'treasury.pnl_carry_forward.detected',
        entityType: 'pnl_period',
        entityId: null,
        severity: 'MEDIUM',
        metadata: { landedMonth, byOrigin, provisionalSkipped },
      });
    }
    return {
      landedMonth,
      monthsChecked: periods.length - provisionalSkipped.length,
      provisionalSkipped,
      rowsAdded,
      byOrigin,
    };
  }

  /**
   * The scheduled close (hourly; acts from 06:00 IST on the 1st). Closes
   * every ended month after the last closed one, oldest first, ON TIME:
   * FINAL when every nightly job has succeeded since the month ended,
   * PROVISIONAL (with a HIGH MONEY issue naming each job) when one has not.
   * Only a close that throws stops it, and that is retried next hour.
   */
  async autoClose(now: Date = new Date()): Promise<AutoCloseResult> {
    const last = await this.prisma.client.pnlPeriod.findFirst({
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    if (last === null) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.HIGH,
        title: 'No P&L month has ever been closed',
        detail:
          'Carry-forward needs a starting point, so the 1st-of-month close does nothing until the ' +
          'months that already exist are closed. Run the backfill — "Close earlier months" on ' +
          '/pnl/carry-forward, or POST /admin/treasury/pnl-periods/backfill-close (dry run first) — ' +
          'and the monthly close takes over from there.',
        source: 'PnlPeriodService',
        dedupeKey: PNL_NEVER_CLOSED_ISSUE,
      });
      return { closed: [], failed: null, neverClosed: true };
    }
    await this.issues.resolveByKey(PNL_NEVER_CLOSED_ISSUE, 'A P&L month has been closed.');

    const closed: Array<{ month: string; lockState: PnlLockState }> = [];
    for (const month of monthsBetween(nextMonth(last.month), prevMonth(monthOf(now)))) {
      const { to } = monthWindow(month);
      if (now.getTime() < to.getTime() + CLOSE_AFTER_MONTH_END_MS) break;
      const gate = await this.gate.check(to, now);
      const lockState = gate.passed ? PnlLockState.FINAL : PnlLockState.PROVISIONAL;
      try {
        await this.close({
          month,
          kind: PnlCloseKind.AUTO,
          lockState,
          staffId: null,
          reason: null,
          nightlyJobs: gate,
          now,
        });
        closed.push({ month, lockState });
        if (lockState === PnlLockState.PROVISIONAL) await this.raiseProvisional(month, gate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ month, err: message }, 'Scheduled P&L close failed');
        await this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: `The P&L for ${monthName(month)} could not be closed`,
          detail:
            `Closing it failed: ${message}\n\nIt is tried again every hour. Once the cause is ` +
            'fixed it closes by itself, or somebody holding "Close a P&L month" can close it on ' +
            '/pnl/carry-forward.',
          source: 'PnlPeriodService',
          dedupeKey: `${PNL_CLOSE_FAILED_ISSUE_PREFIX}${month}`,
          metadata: { month, error: message },
        });
        return { closed, failed: { month, error: message }, neverClosed: false };
      }
    }
    return { closed, failed: null, neverClosed: false };
  }

  /**
   * Close every month from the first with any P&L activity through
   * `throughMonth` (default: last month), oldest first — the months that
   * existed before carry-forward did. FINAL. Dry run by default.
   */
  async backfill(input: {
    readonly dryRun: boolean;
    readonly throughMonth: string | null;
    readonly reason: string | null;
    readonly staffId: string;
    readonly now?: Date;
  }): Promise<BackfillResult> {
    const now = input.now ?? new Date();
    const current = monthOf(now);
    const through = input.throughMonth ?? prevMonth(current);
    this.assertMonth(through);
    if (through >= current) {
      throw new BadRequestException({
        code: 'PNL_MONTH_NOT_ENDED',
        message: `${monthName(through)} has not ended yet; the backfill closes finished months only.`,
      });
    }
    const reason = input.reason?.trim() ?? '';
    if (!input.dryRun && reason.length < LOCK_MIN_REASON) {
      throw new BadRequestException({
        code: 'PNL_REASON_TOO_SHORT',
        message: 'Say why these months are being closed (at least 10 characters).',
      });
    }
    const closedMonths = (
      await this.prisma.client.pnlPeriod.findMany({ select: { month: true } })
    ).map((p) => p.month);
    const closedSet = new Set(closedMonths);
    const latestClosed = closedMonths.reduce<string | null>(
      (m, x) => (m === null || x > m ? x : m),
      null,
    );
    const first = await this.firstActivityMonth(through);
    const months: Array<BackfillResult['months'][number]> = [];
    for (const month of first === null ? [] : monthsBetween(first, through)) {
      if (closedSet.has(month)) {
        months.push({ month, action: 'ALREADY_CLOSED', netInr: null, complete: null, note: null });
        continue;
      }
      if (latestClosed !== null && month < latestClosed) {
        months.push({
          month,
          action: 'SKIPPED',
          netInr: null,
          complete: null,
          note: `${monthName(latestClosed)} is already closed, and months close in order.`,
        });
        continue;
      }
      if (input.dryRun) {
        const { from, to } = monthWindow(month);
        const report = await this.pnl.report(from, to);
        months.push({
          month,
          action: 'WOULD_CLOSE',
          netInr: report.netInr,
          complete: report.complete,
          note: report.warnings.length > 0 ? report.warnings.join(' ') : null,
        });
        continue;
      }
      try {
        const res = await this.close({
          month,
          kind: PnlCloseKind.BACKFILL,
          staffId: input.staffId,
          reason,
          nightlyJobs: null,
          now,
        });
        months.push({
          month,
          action: res.alreadyClosed ? 'ALREADY_CLOSED' : 'CLOSED',
          netInr: res.netInr,
          complete: null,
          note: res.alreadyClosed ? null : `${res.rows} record(s) frozen.`,
        });
      } catch (err) {
        months.push({
          month,
          action: 'FAILED',
          netInr: null,
          complete: null,
          note: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
    if (!input.dryRun) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        staffUserId: input.staffId,
        action: 'treasury.pnl_period.backfill',
        entityType: 'pnl_period',
        entityId: null,
        severity: 'HIGH',
        metadata: { throughMonth: through, firstActivityMonth: first, reason, months },
      });
    }
    return { dryRun: input.dryRun, throughMonth: through, firstActivityMonth: first, months };
  }

  /** The first month up to `through` whose report has anything in it; null when none has. */
  async firstActivityMonth(through: string): Promise<string | null> {
    const c = this.prisma.client;
    const mins = await Promise.all([
      c.orderEvent.aggregate({ _min: { createdAt: true } }).then((r) => r._min.createdAt),
      c.bankEntry.aggregate({ _min: { occurredAt: true } }).then((r) => r._min.occurredAt),
      c.sellerWalletEntry.aggregate({ _min: { createdAt: true } }).then((r) => r._min.createdAt),
      c.inboundFreightCharge.aggregate({ _min: { createdAt: true } }).then((r) => r._min.createdAt),
      c.investment.aggregate({ _min: { closedAt: true } }).then((r) => r._min.closedAt),
      c.courierWalletTransaction
        .aggregate({ _min: { occurredAt: true } })
        .then((r) => r._min.occurredAt),
    ]);
    const earliest = mins
      .filter((d): d is Date => d instanceof Date)
      .reduce<Date | null>((m, d) => (m === null || d < m ? d : m), null);
    if (earliest === null) return null;
    for (const month of monthsBetween(monthOf(earliest), through)) {
      const { from, to } = monthWindow(month);
      if (hasActivity(await this.pnl.report(from, to))) return month;
    }
    return null;
  }

  private async writeVersion(
    tx: Prisma.TransactionClient,
    v: {
      periodId: string;
      version: number;
      kind: PnlVersionKind;
      lockState: PnlLockState;
      staffId: string | null;
      reason: string | null;
      report: PnlReport;
      rows: readonly LiveRow[];
      nightlyJobs: NightlyGate | null;
      netBefore: Prisma.Decimal | null;
      carriedOut: Record<string, unknown> | null;
      now: Date;
    },
  ): Promise<void> {
    const created = await tx.pnlSnapshotVersion.create({
      data: {
        periodId: v.periodId,
        version: v.version,
        kind: v.kind,
        lockState: v.lockState,
        createdAt: v.now,
        createdByStaffId: v.staffId,
        reason: v.reason,
        grossMarginInr: v.report.grossMarginInr,
        operatingExpensesInr: v.report.operatingExpensesInr,
        netInr: v.report.netInr,
        netBeforeInr: v.netBefore,
        complete: v.report.complete,
        report: v.report as unknown as Prisma.InputJsonValue,
        ...(v.nightlyJobs === null
          ? {}
          : { nightlyJobs: v.nightlyJobs as unknown as Prisma.InputJsonValue }),
        ...(v.carriedOut === null
          ? {}
          : { carriedOut: v.carriedOut as unknown as Prisma.InputJsonValue }),
      },
      select: { id: true },
    });
    for (let i = 0; i < v.rows.length; i += CHUNK) {
      await tx.pnlSnapshotRow.createMany({
        data: v.rows.slice(i, i + CHUNK).map((r) => ({
          periodId: v.periodId,
          versionId: created.id,
          lineKey: r.lineKey,
          refKey: r.refKey,
          revenueInr: r.revenue,
          costInr: r.cost,
          label: r.label as unknown as Prisma.InputJsonValue,
        })),
      });
    }
  }

  private toRow(
    period: { id: string; month: string },
    landedMonth: string,
    d: CarryForwardDraft,
    now: Date,
  ): Prisma.PnlCarryForwardCreateManyInput {
    return {
      originPeriodId: period.id,
      originMonth: period.month,
      landedMonth,
      lineKey: d.lineKey,
      refKey: d.refKey,
      revenueDeltaInr: d.revenueDelta,
      costDeltaInr: d.costDelta,
      revenueBeforeInr: d.revenueBefore,
      revenueAfterInr: d.revenueAfter,
      costBeforeInr: d.costBefore,
      costAfterInr: d.costAfter,
      reason: d.reason,
      label: d.label as unknown as Prisma.InputJsonValue,
      detectedAt: now,
    };
  }

  /** Where an order that joined or left the delivery or returns line stands now. */
  private async reasonContext(
    tx: Prisma.TransactionClient,
    baseline: ReadonlyMap<string, BaselineRow>,
    live: readonly LiveRow[],
  ): Promise<Map<string, string>> {
    const fateLines = new Set<string>(['delivery', 'rto']);
    const liveKeys = new Set(live.map((r) => rowKey(r.lineKey, r.refKey)));
    const wanted = new Map<string, { lineKey: PnlSnapshotKey; orderId: string }>();
    for (const [k, b] of baseline) {
      if (fateLines.has(b.lineKey) && b.present && !liveKeys.has(k)) {
        wanted.set(k, { lineKey: b.lineKey, orderId: b.refKey });
      }
    }
    for (const r of live) {
      const k = rowKey(r.lineKey, r.refKey);
      if (fateLines.has(r.lineKey) && baseline.get(k)?.present !== true) {
        wanted.set(k, { lineKey: r.lineKey, orderId: r.refKey });
      }
    }
    const out = new Map<string, string>();
    if (wanted.size === 0) return out;
    const orders = await tx.order.findMany({
      where: { id: { in: [...new Set([...wanted.values()].map((w) => w.orderId))] } },
      select: { id: true, status: true },
    });
    const statusOf = new Map(orders.map((o) => [o.id, o.status]));
    for (const [k, w] of wanted) {
      const status = statusOf.get(w.orderId);
      if (status !== undefined) out.set(k, orderNow(w.lineKey, status));
    }
    return out;
  }

  private async raiseProvisional(month: string, gate: NightlyGate): Promise<void> {
    const failing = gate.jobs.filter((j) => j.status !== 'OK');
    await this.issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: `The P&L for ${monthName(month)} is locked PROVISIONALLY`,
      detail:
        `${monthName(month)} was closed on time, but not every nightly job had succeeded since it ` +
        'ended, so some of its courier costs may be missing:\n' +
        failing.map((j) => `• ${j.label} — ${j.detail}`).join('\n') +
        '\n\nWhat to do: fix the run and re-run it (from /cost-sync) so the missing data is in. ' +
        'Nothing is carried out of a provisional month — late data stays in it. Then open ' +
        `${monthName(month)} on /pnl/carry-forward and choose "Lock permanently": it is ` +
        're-snapshotted with everything that has arrived, and changes after that are carried ' +
        'forward as usual.',
      source: 'PnlPeriodService',
      dedupeKey: `${PNL_PROVISIONAL_ISSUE_PREFIX}${month}`,
      metadata: {
        month,
        jobs: gate.jobs.map((j) => ({ key: j.key, status: j.status, detail: j.detail })),
      },
    });
  }

  private async closedSummary(month: string): Promise<CloseResult | null> {
    const p = await this.prisma.client.pnlPeriod.findUnique({
      where: { month },
      select: { id: true, closedAt: true, lockState: true },
    });
    if (p === null) return null;
    const current = await this.prisma.client.pnlSnapshotVersion.findFirst({
      where: { periodId: p.id, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { version: true, netInr: true, _count: { select: { rows: true } } },
    });
    return {
      month,
      alreadyClosed: true,
      closedAt: p.closedAt.toISOString(),
      lockState: p.lockState,
      version: current?.version ?? 1,
      netInr: current?.netInr.toFixed(2) ?? '0.00',
      rows: current?._count.rows ?? 0,
      carriedIn: 0,
    };
  }

  private async assertNoLaterClosed(
    c: Pick<Prisma.TransactionClient, 'pnlPeriod'>,
    month: string,
  ): Promise<void> {
    const later = await c.pnlPeriod.findFirst({
      where: { month: { gt: month } },
      orderBy: { month: 'asc' },
      select: { month: true },
    });
    if (later !== null) {
      throw new ConflictException({
        code: 'PNL_LATER_MONTH_CLOSED',
        message:
          `${monthName(later.month)} is already closed, and months close in order — a change ` +
          `to ${monthName(month)} is carried into the open month instead.`,
      });
    }
  }

  private assertRowsTile(month: string, report: PnlReport, rows: readonly LiveRow[]): void {
    const problems = rowsDisagree(report, rows);
    if (problems.length > 0) {
      throw new ConflictException({
        code: 'PNL_ROWS_DISAGREE',
        message:
          `${monthName(month)} was not locked: a line's rows do not add up to its figure, so a ` +
          `frozen month could never be reconciled. ${problems.join(' · ')}`,
      });
    }
  }

  private assertEnded(month: string, to: Date, now: Date): void {
    if (to.getTime() > now.getTime()) {
      throw new BadRequestException({
        code: 'PNL_MONTH_NOT_ENDED',
        message: `${monthName(month)} has not ended yet. A month can be locked from midnight IST on the 1st of the next.`,
      });
    }
  }

  private assertMonth(month: string): void {
    if (!isMonth(month)) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: `"${month}" is not a month (YYYY-MM)`,
      });
    }
  }
}
