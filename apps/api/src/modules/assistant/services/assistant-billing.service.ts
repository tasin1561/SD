import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { billedFromRealUsd, realFromBilledUsd } from '../assistant-pricing';
import {
  BILLING_TIMEZONE,
  MONTH_RE,
  daysOfMonth,
  dhakaDate,
  lastMonths,
  monthKey,
  monthStart,
  nextMonthStart,
} from '../assistant-panel-time';
import { AssistantBudgetService } from './assistant-budget.service';

export const PORTALS = ['staff', 'seller', 'store', 'associate'] as const;
export type PortalKey = (typeof PORTALS)[number];

/** Money is carried as a decimal STRING (8 dp) so nothing rounds on the way to a CSV. */
export interface UsageBucket {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: string;
}

export interface BillingRow {
  /** `YYYY-MM` or `YYYY-MM-DD` (Asia/Dhaka). */
  readonly period: string;
  readonly total: UsageBucket;
  readonly assistant: {
    readonly total: UsageBucket;
    readonly portals: Record<PortalKey, UsageBucket>;
  };
  /** The overnight monitor's own line (`assistant_monitor_usage`), zero when it is off. */
  readonly monitor: UsageBucket;
  /**
   * The public parcel helper's own line (`assistant_usage` rows of the PUBLIC
   * audience). Not a portal and not part of `assistant`: it has its own
   * switch and its own cap, and `total` is assistant + monitor + this.
   */
  readonly publicParcel: UsageBucket;
}

export interface BillingBudget {
  /** Shown caps (the real cap converted the same way as every cost). */
  readonly assistantBudgetUsd: string;
  readonly monitorBudgetUsd: string;
  readonly publicBudgetUsd: string;
  /** Share of the real cap used, 0-100+ (null when the cap is 0). */
  readonly assistantUsedPct: number | null;
  readonly monitorUsedPct: number | null;
  readonly publicUsedPct: number | null;
  /** Current month only: where the month ends at the pace so far. */
  readonly projectedCostUsd: string | null;
  readonly projectedPct: number | null;
}

interface RawRow {
  period: string;
  audience: string;
  requests: number;
  input_tokens: bigint | number | null;
  output_tokens: bigint | number | null;
  cache_read_tokens: bigint | number | null;
  cache_write_tokens: bigint | number | null;
  cost_usd: Prisma.Decimal | null;
}

const ZERO = new Prisma.Decimal(0);

export const emptyBucket = (): UsageBucket => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: '0.00000000',
});

export function addBuckets(a: UsageBucket, b: UsageBucket): UsageBucket {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: new Prisma.Decimal(a.costUsd).add(b.costUsd).toFixed(8),
  };
}

function bucketOf(r: RawRow): UsageBucket {
  return {
    requests: Number(r.requests),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cacheReadTokens: Number(r.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(r.cache_write_tokens ?? 0),
    costUsd: new Prisma.Decimal(r.cost_usd ?? ZERO).toFixed(8),
  };
}

function newRow(period: string): {
  period: string;
  portals: Record<PortalKey, UsageBucket>;
  publicParcel: UsageBucket;
} {
  return {
    period,
    publicParcel: emptyBucket(),
    portals: {
      staff: emptyBucket(),
      seller: emptyBucket(),
      store: emptyBucket(),
      associate: emptyBucket(),
    },
  };
}

/** A monitor row has no audience: it is one line, not four portals. */
export type MonitorRawRow = Omit<RawRow, 'audience'>;

/** Fold per-(period, portal) buckets into rows, adding the monitor line and totals. */
export function buildRows(
  periods: readonly string[],
  raw: RawRow[],
  monitorRaw: readonly MonitorRawRow[] = [],
): BillingRow[] {
  const byPeriod = new Map(periods.map((p) => [p, newRow(p)]));
  for (const r of raw) {
    const row = byPeriod.get(r.period);
    if (row === undefined) continue;
    if (r.audience.toLowerCase() === 'public') {
      row.publicParcel = addBuckets(row.publicParcel, bucketOf(r));
      continue;
    }
    const portal = r.audience.toLowerCase() as PortalKey;
    if (!PORTALS.includes(portal)) continue;
    row.portals[portal] = addBuckets(row.portals[portal], bucketOf(r));
  }
  return periods.map((p) => {
    const row = byPeriod.get(p) ?? newRow(p);
    const assistant = PORTALS.reduce((acc, k) => addBuckets(acc, row.portals[k]), emptyBucket());
    const monitor = monitorRaw
      .filter((r) => r.period === p)
      .reduce((acc, r) => addBuckets(acc, bucketOf({ ...r, audience: '' })), emptyBucket());
    return {
      period: p,
      total: addBuckets(addBuckets(assistant, monitor), row.publicParcel),
      assistant: { total: assistant, portals: row.portals },
      monitor,
      publicParcel: row.publicParcel,
    };
  });
}

const pct = (part: Prisma.Decimal, whole: Prisma.Decimal): number | null =>
  whole.isZero() ? null : Number(part.div(whole).mul(100).toFixed(2));

/**
 * THE billing numbers for the AI panel. Aggregation is a SQL group-by on
 * `assistant_usage` (indexed on created_at); JS only folds a few dozen
 * pre-aggregated rows. Every cost is `assistant_usage.cost_usd` AS STORED.
 * Budget percentages go through `AssistantBudgetService.monthlySpendUsd`
 * (real spend) for the live month; a past month is converted with the same
 * `realFromBilledUsd`.
 */
@Injectable()
export class AssistantBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
  ) {}

  private async grouped(from: Date, to: Date, fmt: 'YYYY-MM' | 'YYYY-MM-DD'): Promise<RawRow[]> {
    return this.prisma.client.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT to_char(created_at AT TIME ZONE ${BILLING_TIMEZONE}, ${fmt}) AS period,
             audience::text AS audience,
             count(*)::int AS requests,
             sum(input_tokens)::bigint AS input_tokens,
             sum(output_tokens)::bigint AS output_tokens,
             sum(cache_read_tokens)::bigint AS cache_read_tokens,
             sum(cache_write_tokens)::bigint AS cache_write_tokens,
             sum(cost_usd) AS cost_usd
        FROM assistant_usage
       WHERE created_at >= ${from} AND created_at < ${to}
       GROUP BY 1, 2
    `);
  }

  private async groupedMonitor(
    from: Date,
    to: Date,
    fmt: 'YYYY-MM' | 'YYYY-MM-DD',
  ): Promise<MonitorRawRow[]> {
    return this.prisma.client.$queryRaw<MonitorRawRow[]>(Prisma.sql`
      SELECT to_char(created_at AT TIME ZONE ${BILLING_TIMEZONE}, ${fmt}) AS period,
             count(*)::int AS requests,
             sum(input_tokens)::bigint AS input_tokens,
             sum(output_tokens)::bigint AS output_tokens,
             sum(cache_read_tokens)::bigint AS cache_read_tokens,
             sum(cache_write_tokens)::bigint AS cache_write_tokens,
             sum(cost_usd) AS cost_usd
        FROM assistant_monitor_usage
       WHERE created_at >= ${from} AND created_at < ${to}
       GROUP BY 1
    `);
  }

  /** Assistant + monitor over any span, as stored figures (the weekly report). */
  async rangeTotal(from: Date, to: Date): Promise<UsageBucket> {
    const [raw, monitorRaw] = await Promise.all([
      this.grouped(from, to, 'YYYY-MM'),
      this.groupedMonitor(from, to, 'YYYY-MM'),
    ]);
    const all = buildRows(
      [...new Set([...raw.map((r) => r.period), ...monitorRaw.map((r) => r.period)])],
      raw,
      monitorRaw,
    );
    return all.reduce((acc, r) => addBuckets(acc, r.total), emptyBucket());
  }

  private async budgetFor(month: string, row: BillingRow, now: Date): Promise<BillingBudget> {
    const realCap = new Prisma.Decimal(await this.budget.monthlyBudgetUsd());
    const monitorCap = new Prisma.Decimal(await this.budget.monitorMonthlyBudgetUsd());
    const publicCap = new Prisma.Decimal(await this.budget.publicMonthlyBudgetUsd());
    const current = monthKey(dhakaDate(now).y, dhakaDate(now).m) === month;
    const realSpend = current
      ? await this.budget.monthlySpendUsd(now)
      : realFromBilledUsd(new Prisma.Decimal(row.assistant.total.costUsd));
    const monitorSpend = current
      ? await this.budget.monitorMonthlySpendUsd(now)
      : realFromBilledUsd(new Prisma.Decimal(row.monitor.costUsd));
    const publicSpend = current
      ? await this.budget.publicMonthlySpendUsd(now)
      : realFromBilledUsd(new Prisma.Decimal(row.publicParcel.costUsd));
    let projected: Prisma.Decimal | null = null;
    if (current) {
      const start = monthStart(month).getTime();
      const elapsed = now.getTime() - start;
      const span = nextMonthStart(month).getTime() - start;
      if (elapsed > 0)
        projected = new Prisma.Decimal(row.assistant.total.costUsd).mul(span).div(elapsed);
    }
    return {
      assistantBudgetUsd: billedFromRealUsd(realCap).toFixed(2),
      monitorBudgetUsd: billedFromRealUsd(monitorCap).toFixed(2),
      publicBudgetUsd: billedFromRealUsd(publicCap).toFixed(2),
      assistantUsedPct: pct(realSpend, realCap),
      monitorUsedPct: pct(monitorSpend, monitorCap),
      publicUsedPct: pct(publicSpend, publicCap),
      projectedCostUsd: projected === null ? null : projected.toFixed(2),
      projectedPct: projected === null ? null : pct(realFromBilledUsd(projected), realCap),
    };
  }

  /** Month by month, newest first (default the last 12 months, empty months included). */
  async monthly(monthsBack = 12, now: Date = new Date()) {
    const n = Math.min(Math.max(Math.trunc(monthsBack) || 12, 1), 36);
    const periods = lastMonths(now, n);
    const oldest = periods[periods.length - 1] ?? periods[0] ?? monthKey(1970, 1);
    const [from, to] = [monthStart(oldest), nextMonthStart(periods[0] ?? oldest)];
    const [raw, monitorRaw] = await Promise.all([
      this.grouped(from, to, 'YYYY-MM'),
      this.groupedMonitor(from, to, 'YYYY-MM'),
    ]);
    const rows = buildRows(periods, raw, monitorRaw);
    const current = rows[0];
    return {
      timezone: BILLING_TIMEZONE,
      months: rows,
      currentBudget:
        current === undefined ? null : await this.budgetFor(current.period, current, now),
    };
  }

  /** Day by day for one month (`YYYY-MM`), every day present. */
  async daily(month: string, now: Date = new Date()) {
    if (!MONTH_RE.test(month)) {
      throw new BadRequestException({
        code: 'BAD_MONTH',
        message: 'Month must look like 2026-11.',
      });
    }
    const days = daysOfMonth(month);
    const [from, to] = [monthStart(month), nextMonthStart(month)];
    const [raw, monitorRaw] = await Promise.all([
      this.grouped(from, to, 'YYYY-MM-DD'),
      this.groupedMonitor(from, to, 'YYYY-MM-DD'),
    ]);
    const rows = buildRows(days, raw, monitorRaw);
    const monthRows = buildRows(
      [month],
      raw.map((r) => ({ ...r, period: month })),
      monitorRaw.map((r) => ({ ...r, period: month })),
    );
    const total = monthRows[0];
    return {
      timezone: BILLING_TIMEZONE,
      month,
      days: rows,
      total,
      budget: total === undefined ? null : await this.budgetFor(month, total, now),
    };
  }
}
