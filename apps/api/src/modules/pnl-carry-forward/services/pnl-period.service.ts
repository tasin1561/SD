import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  PnlCloseKind,
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
  diffMonth,
  rowKey,
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

/** Every close and every carry-forward write takes this one key (see AdvisoryLock.PNL_PERIOD). */
const LOCK_KEY = 'pnl-periods';
/** A month is closed from 06:00 IST on the 1st — after the last nightly job (04:30). */
const CLOSE_AFTER_MONTH_END_MS = 6 * 60 * 60 * 1000;
/** A month's snapshot can be thousands of rows; the default 5s would not write them. */
const TX_OPTIONS = { timeout: 120_000, maxWait: 15_000 } as const;
const CHUNK = 500;
const ZERO = new Prisma.Decimal(0);

export const PNL_CLOSE_ISSUE_PREFIX = 'pnl-close:';
export const PNL_NEVER_CLOSED_ISSUE = 'pnl-close:never-closed';

export interface CloseResult {
  readonly month: string;
  readonly alreadyClosed: boolean;
  readonly closedAt: string;
  readonly netInr: string;
  readonly rows: number;
  /** Carry-forwards from earlier closed months written into this one just before it closed. */
  readonly carriedIn: number;
}

export interface DetectResult {
  readonly landedMonth: string;
  readonly monthsChecked: number;
  readonly rowsAdded: number;
  readonly byOrigin: ReadonlyArray<{
    readonly originMonth: string;
    readonly rows: number;
    readonly netInr: string;
  }>;
}

export interface AutoCloseResult {
  readonly closed: readonly string[];
  readonly blocked: {
    readonly month: string;
    readonly gate: NightlyGate | null;
    readonly error: string | null;
  } | null;
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

/**
 * Closing P&L months and carrying later changes forward (PNL-CF-1).
 *
 * CLOSE freezes a finished month: the whole report exactly as /pnl prints
 * it for that window, and every record behind every line, keyed by the
 * record's stable id. A closed month is NEVER reopened.
 *
 * DETECT recomputes every closed month with the live engine and compares
 * it, record by record, with what has been reported for it so far (its
 * snapshot plus every carry-forward already written). Each difference is
 * an append-only carry-forward counted in the month that is OPEN when it
 * is found — so a month's figure stops moving once it closes, and nothing
 * later is lost: the frozen months plus everything carried forward plus the
 * open month's own figure is always what the live engine says for the
 * whole span.
 *
 * Just before a month closes, changes to the months before it are carried
 * INTO it — while it is still open — so its frozen view includes every
 * change found up to the moment it closed.
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
   * Close `month`. Idempotent: a month already closed is returned as it
   * was. Refused for a month that has not ended, and for a month earlier
   * than one already closed (months close in order, so a carry-forward
   * always lands after the month it came from).
   */
  async close(input: {
    readonly month: string;
    readonly kind: PnlCloseKind;
    readonly staffId: string | null;
    readonly reason: string | null;
    readonly nightlyJobs: NightlyGate | null;
    readonly now?: Date;
  }): Promise<CloseResult> {
    const now = input.now ?? new Date();
    const { month } = input;
    this.assertMonth(month);
    const { from, to } = monthWindow(month);
    if (to.getTime() > now.getTime()) {
      throw new BadRequestException({
        code: 'PNL_MONTH_NOT_ENDED',
        message: `${monthName(month)} has not ended yet. A month can be closed from midnight IST on the 1st of the next.`,
      });
    }
    const existing = await this.closedSummary(month);
    if (existing !== null) return existing;
    await this.assertNoLaterClosed(this.prisma.client, month);

    // Changes to the months before this one land HERE, while it is open.
    const carried = await this.detect(month, now);

    const report = await this.pnl.report(from, to);
    const rows = await this.liveRows(month);
    const problems = rowsDisagree(report, rows);
    if (problems.length > 0) {
      throw new ConflictException({
        code: 'PNL_ROWS_DISAGREE',
        message:
          `${monthName(month)} was not closed: a line's rows do not add up to its figure, so a ` +
          `frozen month could never be reconciled. ${problems.join(' · ')}`,
      });
    }

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
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx.pnlSnapshotRow.createMany({
            data: rows.slice(i, i + CHUNK).map((r) => ({
              periodId: period.id,
              lineKey: r.lineKey,
              refKey: r.refKey,
              revenueInr: r.revenue,
              costInr: r.cost,
              label: r.label as unknown as Prisma.InputJsonValue,
            })),
          });
        }
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
    await this.issues.resolveByKey(
      `${PNL_CLOSE_ISSUE_PREFIX}${month}`,
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
    this.logger.log({ month, kind: input.kind, rows: rows.length }, 'P&L month closed');
    return {
      month,
      alreadyClosed: false,
      closedAt: created.closedAt.toISOString(),
      netInr: created.netInr.toFixed(2),
      rows: rows.length,
      carriedIn: carried.rowsAdded,
    };
  }

  /**
   * Carry into `landedMonth` every change to every closed month before it.
   * `landedMonth` must be OPEN — checked under the same lock a close takes,
   * so a carry-forward can never land in a month that has closed.
   * Idempotent: a second run finds the baseline already moved.
   */
  async detect(landedMonth: string, now: Date = new Date()): Promise<DetectResult> {
    this.assertMonth(landedMonth);
    const periods = await this.prisma.client.pnlPeriod.findMany({
      where: { month: { lt: landedMonth } },
      orderBy: { month: 'asc' },
      select: { id: true, month: true },
    });
    const byOrigin: Array<{ originMonth: string; rows: number; netInr: string }> = [];
    for (const period of periods) {
      const live = await this.liveRows(period.month);
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
        const [snapshot, earlier] = await Promise.all([
          tx.pnlSnapshotRow.findMany({
            where: { periodId: period.id },
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
            },
          }),
        ]);
        const baseline = buildBaseline(snapshot, earlier);
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
        metadata: { landedMonth, byOrigin },
      });
    }
    return { landedMonth, monthsChecked: periods.length, rowsAdded, byOrigin };
  }

  /**
   * The scheduled close (hourly; acts from 06:00 IST on the 1st). Closes
   * every ended month after the last closed one, oldest first, each only
   * when every nightly job has succeeded since that month ended. A month it
   * cannot close raises a HIGH MONEY issue naming why, and is tried again
   * next hour; nothing after it is closed out of order.
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
      return { closed: [], blocked: null, neverClosed: true };
    }
    await this.issues.resolveByKey(PNL_NEVER_CLOSED_ISSUE, 'A P&L month has been closed.');

    const closed: string[] = [];
    for (const month of monthsBetween(nextMonth(last.month), prevMonth(monthOf(now)))) {
      const { to } = monthWindow(month);
      if (now.getTime() < to.getTime() + CLOSE_AFTER_MONTH_END_MS) break;
      const gate = await this.gate.check(to, now);
      if (!gate.passed) {
        await this.raiseNotClosed(month, gate, null);
        return { closed, blocked: { month, gate, error: null }, neverClosed: false };
      }
      try {
        await this.close({
          month,
          kind: PnlCloseKind.AUTO,
          staffId: null,
          reason: null,
          nightlyJobs: gate,
          now,
        });
        closed.push(month);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ month, err: message }, 'Scheduled P&L close failed');
        await this.raiseNotClosed(month, gate, message);
        return { closed, blocked: { month, gate, error: message }, neverClosed: false };
      }
    }
    return { closed, blocked: null, neverClosed: false };
  }

  /**
   * Close every month from the first with any P&L activity through
   * `throughMonth` (default: last month), oldest first — the months that
   * existed before carry-forward did. Dry run by default: says what it
   * would close and each month's figure, and writes nothing.
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
    if (!input.dryRun && reason.length < 10) {
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

  private async raiseNotClosed(
    month: string,
    gate: NightlyGate,
    error: string | null,
  ): Promise<void> {
    const failing = gate.jobs.filter((j) => j.status !== 'OK');
    await this.issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: `The P&L for ${monthName(month)} was not closed`,
      detail:
        (error !== null
          ? `Closing it failed: ${error}\n\n`
          : 'Not every nightly job has succeeded since the month ended, so its courier costs ' +
            'may not all be in:\n' +
            failing.map((j) => `• ${j.label} — ${j.detail}`).join('\n') +
            '\n\n') +
        'It is tried again every hour and closes by itself once every nightly job has ' +
        'succeeded (a manual re-run counts). If one cannot — switched off, or a portal that will ' +
        'not sign in — somebody holding "Close a P&L month" can close it on /pnl/carry-forward.',
      source: 'PnlPeriodService',
      dedupeKey: `${PNL_CLOSE_ISSUE_PREFIX}${month}`,
      metadata: {
        month,
        error,
        jobs: gate.jobs.map((j) => ({ key: j.key, status: j.status, detail: j.detail })),
      },
    });
  }

  private async closedSummary(month: string): Promise<CloseResult | null> {
    const p = await this.prisma.client.pnlPeriod.findUnique({
      where: { month },
      select: { closedAt: true, netInr: true, _count: { select: { rows: true } } },
    });
    if (p === null) return null;
    return {
      month,
      alreadyClosed: true,
      closedAt: p.closedAt.toISOString(),
      netInr: p.netInr.toFixed(2),
      rows: p._count.rows,
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

  private assertMonth(month: string): void {
    if (!isMonth(month)) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: `"${month}" is not a month (YYYY-MM)`,
      });
    }
  }
}
