import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PnlCloseKind, type PnlLockState, type PnlVersionKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PnlService, type PnlReport } from '../../treasury/services/pnl.service';
import { LINE_NAMES, readLabel } from './pnl-carry-forward-diff';
import { isMonth, monthName, monthOf, monthsBetween, monthWindow } from './pnl-month';

const ZERO = new Prisma.Decimal(0);

export type PnlMonthStatus = 'CLOSED' | 'OPEN' | 'AWAITING_CLOSE';

export interface CarriedLine {
  readonly lineKey: string;
  readonly name: string;
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly count: number;
}

/** Carry-forwards between one origin and one landed month, by line. */
export interface CarriedGroup {
  readonly originMonth: string;
  readonly landedMonth: string;
  readonly name: string;
  readonly revenueInr: string;
  readonly costInr: string;
  readonly netInr: string;
  readonly count: number;
  readonly lines: readonly CarriedLine[];
}

export interface VersionView {
  readonly version: number;
  readonly kind: PnlVersionKind;
  readonly lockState: PnlLockState;
  readonly createdAt: string;
  readonly by: string | null;
  readonly reason: string | null;
  readonly netBeforeInr: string | null;
  readonly netInr: string;
  readonly current: boolean;
}

export interface PnlMonthView {
  readonly month: string;
  readonly name: string;
  readonly status: PnlMonthStatus;
  /** Null for a month not closed. */
  readonly lockState: PnlLockState | null;
  readonly window: { readonly from: string; readonly to: string };
  /** The version shown (the current one unless another was asked for); null when not closed. */
  readonly shownVersion: number | null;
  /** Frozen for a closed month (the shown version); live for an open one. */
  readonly report: PnlReport;
  readonly closed: {
    readonly at: string;
    readonly by: string | null;
    readonly kind: PnlCloseKind;
    readonly reason: string | null;
    readonly nightlyJobs: unknown;
  } | null;
  /** Every locked version, newest first. */
  readonly versions: readonly VersionView[];
  /** The shown version's nightly-job results and what it left out as already carried. */
  readonly shown: {
    readonly nightlyJobs: unknown;
    readonly carriedOut: unknown;
  } | null;
  /** Changes to earlier months counted in this one, by origin month then line. */
  readonly carriedIn: readonly CarriedGroup[];
  /** Closed months only: changes to it found later, by the month they were carried into. */
  readonly laterChanges: readonly CarriedGroup[];
  readonly totals: {
    readonly ownNetInr: string;
    readonly carriedInNetInr: string;
    readonly netInr: string;
  };
}

type CfSums = {
  originMonth: string;
  landedMonth: string;
  lineKey: string;
  revenueDeltaInr: Prisma.Decimal;
  costDeltaInr: Prisma.Decimal;
};

/** Group carry-forwards by (origin, landed) month, then line. */
function groupCarried(rows: readonly CfSums[], by: 'originMonth' | 'landedMonth'): CarriedGroup[] {
  const groups = new Map<
    string,
    Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal; count: number }>
  >();
  const pair = new Map<string, { originMonth: string; landedMonth: string }>();
  for (const r of rows) {
    const g = r[by];
    pair.set(g, { originMonth: r.originMonth, landedMonth: r.landedMonth });
    const lines = groups.get(g) ?? new Map();
    const s = lines.get(r.lineKey) ?? { revenue: ZERO, cost: ZERO, count: 0 };
    lines.set(r.lineKey, {
      revenue: s.revenue.add(r.revenueDeltaInr),
      cost: s.cost.add(r.costDeltaInr),
      count: s.count + 1,
    });
    groups.set(g, lines);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([g, lines]) => {
      const list: CarriedLine[] = [...lines.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([lineKey, s]) => ({
          lineKey,
          name: (LINE_NAMES as Record<string, string>)[lineKey] ?? lineKey,
          revenueInr: s.revenue.toFixed(2),
          costInr: s.cost.toFixed(2),
          netInr: s.revenue.sub(s.cost).toFixed(2),
          count: s.count,
        }));
      const revenue = list.reduce((t, l) => t.add(l.revenueInr), ZERO);
      const cost = list.reduce((t, l) => t.add(l.costInr), ZERO);
      const p = pair.get(g) ?? { originMonth: g, landedMonth: g };
      return {
        originMonth: by === 'originMonth' ? g : p.originMonth,
        landedMonth: by === 'landedMonth' ? g : p.landedMonth,
        name: monthName(g),
        revenueInr: revenue.toFixed(2),
        costInr: cost.toFixed(2),
        netInr: revenue.sub(cost).toFixed(2),
        count: list.reduce((n, l) => n + l.count, 0),
        lines: list,
      };
    });
}

const net = (groups: readonly CarriedGroup[]): Prisma.Decimal =>
  groups.reduce((t, g) => t.add(g.netInr), ZERO);

/** What the carry-forward P&L page reads (PNL-CF-1). Writes nothing. */
@Injectable()
export class PnlPeriodReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pnl: PnlService,
  ) {}

  /** Every month from the first closed one to the current one, newest first. */
  async list(now: Date = new Date()): Promise<{
    currentMonth: string;
    months: ReadonlyArray<{
      month: string;
      name: string;
      status: PnlMonthStatus;
      lockState: PnlLockState | null;
      version: number | null;
      closedAt: string | null;
      closedBy: string | null;
      closeKind: PnlCloseKind | null;
      frozenNetInr: string | null;
      carriedInNetInr: string;
      carriedInCount: number;
      laterChangesNetInr: string;
      laterChangesCount: number;
    }>;
  }> {
    const current = monthOf(now);
    const [periods, landed, origin] = await Promise.all([
      this.prisma.client.pnlPeriod.findMany({
        orderBy: { month: 'asc' },
        select: {
          id: true,
          month: true,
          closedAt: true,
          closeKind: true,
          lockState: true,
          closedByStaff: { select: { emailDisplay: true } },
        },
      }),
      this.prisma.client.pnlCarryForward.groupBy({
        by: ['landedMonth'],
        _sum: { revenueDeltaInr: true, costDeltaInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.pnlCarryForward.groupBy({
        by: ['originMonth'],
        _sum: { revenueDeltaInr: true, costDeltaInr: true },
        _count: { _all: true },
      }),
    ]);
    const currentVersions = await this.prisma.client.pnlSnapshotVersion.findMany({
      where: { supersededAt: null, periodId: { in: periods.map((p) => p.id) } },
      select: { periodId: true, version: true, netInr: true },
    });
    const versionOf = new Map(currentVersions.map((v) => [v.periodId, v]));
    const byMonth = new Map(periods.map((p) => [p.month, p]));
    const landedBy = new Map(landed.map((g) => [g.landedMonth, g]));
    const originBy = new Map(origin.map((g) => [g.originMonth, g]));
    const netOf = (g?: {
      _sum: { revenueDeltaInr: Prisma.Decimal | null; costDeltaInr: Prisma.Decimal | null };
    }): string => (g?._sum.revenueDeltaInr ?? ZERO).sub(g?._sum.costDeltaInr ?? ZERO).toFixed(2);
    const first = periods[0]?.month ?? current;
    const months = monthsBetween(first < current ? first : current, current)
      .reverse()
      .map((month) => {
        const p = byMonth.get(month);
        const v = p === undefined ? undefined : versionOf.get(p.id);
        return {
          month,
          name: monthName(month),
          status: (p !== undefined
            ? 'CLOSED'
            : month === current
              ? 'OPEN'
              : 'AWAITING_CLOSE') as PnlMonthStatus,
          lockState: p?.lockState ?? null,
          version: v?.version ?? null,
          closedAt: p?.closedAt.toISOString() ?? null,
          closedBy: p?.closedByStaff?.emailDisplay ?? null,
          closeKind: p?.closeKind ?? null,
          frozenNetInr: v?.netInr.toFixed(2) ?? null,
          carriedInNetInr: netOf(landedBy.get(month)),
          carriedInCount: landedBy.get(month)?._count._all ?? 0,
          laterChangesNetInr: netOf(originBy.get(month)),
          laterChangesCount: originBy.get(month)?._count._all ?? 0,
        };
      });
    return { currentMonth: current, months };
  }

  /**
   * One month: a closed month shows its CURRENT version (or `version`, read
   * only) with the changes found later; an open one its live figures, with
   * what earlier months carried into it.
   */
  async view(
    month: string,
    version: number | null = null,
    now: Date = new Date(),
  ): Promise<PnlMonthView> {
    this.assertMonth(month);
    const current = monthOf(now);
    if (month > current) {
      throw new BadRequestException({
        code: 'PNL_MONTH_IN_FUTURE',
        message: `${monthName(month)} has not started yet.`,
      });
    }
    const { from, to } = monthWindow(month);
    const cfSelect = {
      originMonth: true,
      landedMonth: true,
      lineKey: true,
      revenueDeltaInr: true,
      costDeltaInr: true,
    } as const;
    const [period, carriedRows, laterRows] = await Promise.all([
      this.prisma.client.pnlPeriod.findUnique({
        where: { month },
        select: {
          id: true,
          closedAt: true,
          closeKind: true,
          lockState: true,
          reason: true,
          nightlyJobs: true,
          closedByStaff: { select: { emailDisplay: true } },
        },
      }),
      this.prisma.client.pnlCarryForward.findMany({
        where: { landedMonth: month },
        select: cfSelect,
      }),
      this.prisma.client.pnlCarryForward.findMany({
        where: { originMonth: month },
        select: cfSelect,
      }),
    ]);
    const carriedIn = groupCarried(carriedRows, 'originMonth');
    const carriedInNet = net(carriedIn);
    const totals = (own: Prisma.Decimal): PnlMonthView['totals'] => ({
      ownNetInr: own.toFixed(2),
      carriedInNetInr: carriedInNet.toFixed(2),
      netInr: own.add(carriedInNet).toFixed(2),
    });

    if (period === null) {
      if (version !== null) {
        throw new NotFoundException({
          code: 'PNL_MONTH_NOT_CLOSED',
          message: `${monthName(month)} is not closed, so it has no locked versions.`,
        });
      }
      const report = await this.pnl.report(from, to);
      return {
        month,
        name: monthName(month),
        status: month === current ? 'OPEN' : 'AWAITING_CLOSE',
        lockState: null,
        window: { from: from.toISOString(), to: to.toISOString() },
        shownVersion: null,
        report,
        closed: null,
        versions: [],
        shown: null,
        carriedIn,
        laterChanges: [],
        totals: totals(new Prisma.Decimal(report.netInr)),
      };
    }

    const versions = await this.prisma.client.pnlSnapshotVersion.findMany({
      where: { periodId: period.id },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        kind: true,
        lockState: true,
        createdAt: true,
        reason: true,
        netBeforeInr: true,
        netInr: true,
        supersededAt: true,
        report: true,
        nightlyJobs: true,
        carriedOut: true,
        createdByStaff: { select: { emailDisplay: true } },
      },
    });
    const currentVersion = versions.find((v) => v.supersededAt === null) ?? versions[0];
    const shown = version === null ? currentVersion : versions.find((v) => v.version === version);
    if (shown === undefined) {
      throw new NotFoundException({
        code: 'PNL_VERSION_NOT_FOUND',
        message: `${monthName(month)} has no version ${String(version)}.`,
      });
    }
    return {
      month,
      name: monthName(month),
      status: 'CLOSED',
      lockState: period.lockState,
      window: { from: from.toISOString(), to: to.toISOString() },
      shownVersion: shown.version,
      report: shown.report as unknown as PnlReport,
      closed: {
        at: period.closedAt.toISOString(),
        by: period.closedByStaff?.emailDisplay ?? null,
        kind: period.closeKind,
        reason: period.reason,
        nightlyJobs: period.nightlyJobs,
      },
      versions: versions.map((v) => ({
        version: v.version,
        kind: v.kind,
        lockState: v.lockState,
        createdAt: v.createdAt.toISOString(),
        by: v.createdByStaff?.emailDisplay ?? null,
        reason: v.reason,
        netBeforeInr: v.netBeforeInr?.toFixed(2) ?? null,
        netInr: v.netInr.toFixed(2),
        current: v === currentVersion,
      })),
      shown: { nightlyJobs: shown.nightlyJobs, carriedOut: shown.carriedOut },
      carriedIn,
      laterChanges: groupCarried(laterRows, 'landedMonth'),
      totals: totals(shown.netInr),
    };
  }

  /** The records frozen behind one line of a closed month's version (the current one by default). */
  async frozenRows(
    month: string,
    lineKey: string,
    version: number | null = null,
    limit = 2000,
  ): Promise<{
    rows: ReadonlyArray<{
      refKey: string;
      ref: string;
      subRef: string | null;
      at: string;
      revenueInr: string | null;
      costInr: string | null;
    }>;
    truncated: boolean;
  }> {
    this.assertMonth(month);
    const period = await this.prisma.client.pnlPeriod.findUnique({
      where: { month },
      select: { id: true },
    });
    if (period === null) {
      throw new NotFoundException({
        code: 'PNL_MONTH_NOT_CLOSED',
        message: `${monthName(month)} is not closed, so nothing is frozen for it.`,
      });
    }
    const v = await this.prisma.client.pnlSnapshotVersion.findFirst({
      where:
        version === null
          ? { periodId: period.id, supersededAt: null }
          : { periodId: period.id, version },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (v === null) {
      throw new NotFoundException({
        code: 'PNL_VERSION_NOT_FOUND',
        message: `${monthName(month)} has no version ${String(version)}.`,
      });
    }
    const rows = await this.prisma.client.pnlSnapshotRow.findMany({
      where: { versionId: v.id, lineKey },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: { refKey: true, revenueInr: true, costInr: true, label: true },
    });
    return {
      rows: rows
        .slice(0, limit)
        .map((r) => {
          const l = readLabel(r.label, r.refKey);
          return {
            refKey: r.refKey,
            ref: l.ref,
            subRef: l.present
              ? l.subRef
              : `${l.subRef ?? ''} · left the month — already carried forward`.replace(/^ · /, ''),
            at: l.at,
            revenueInr: r.revenueInr?.toFixed(2) ?? null,
            costInr: r.costInr?.toFixed(2) ?? null,
          };
        })
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
      truncated: rows.length > limit,
    };
  }

  /** The carry-forwards landed in a month and/or from an origin month, each with its reason. */
  async carryForwards(
    filter: {
      landedIn?: string | undefined;
      origin?: string | undefined;
      line?: string | undefined;
    },
    limit = 2000,
  ): Promise<{
    rows: ReadonlyArray<{
      id: string;
      originMonth: string;
      landedMonth: string;
      lineKey: string;
      lineName: string;
      refKey: string;
      ref: string;
      subRef: string | null;
      at: string;
      present: boolean;
      revenueDeltaInr: string;
      costDeltaInr: string;
      netInr: string;
      revenueBeforeInr: string | null;
      revenueAfterInr: string | null;
      costBeforeInr: string | null;
      costAfterInr: string | null;
      reason: string;
      detectedAt: string;
    }>;
    truncated: boolean;
  }> {
    if (filter.landedIn === undefined && filter.origin === undefined) {
      throw new BadRequestException({
        code: 'PNL_FILTER_REQUIRED',
        message: 'Say which month the changes landed in, or which month they came from.',
      });
    }
    for (const m of [filter.landedIn, filter.origin]) if (m !== undefined) this.assertMonth(m);
    const rows = await this.prisma.client.pnlCarryForward.findMany({
      where: {
        ...(filter.landedIn === undefined ? {} : { landedMonth: filter.landedIn }),
        ...(filter.origin === undefined ? {} : { originMonth: filter.origin }),
        ...(filter.line === undefined ? {} : { lineKey: filter.line }),
      },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const s = (d: Prisma.Decimal | null): string | null => d?.toFixed(2) ?? null;
    return {
      rows: rows.slice(0, limit).map((r) => {
        const l = readLabel(r.label, r.refKey);
        return {
          id: r.id,
          originMonth: r.originMonth,
          landedMonth: r.landedMonth,
          lineKey: r.lineKey,
          lineName: (LINE_NAMES as Record<string, string>)[r.lineKey] ?? r.lineKey,
          refKey: r.refKey,
          ref: l.ref,
          subRef: l.subRef,
          at: l.at,
          present: l.present,
          revenueDeltaInr: r.revenueDeltaInr.toFixed(2),
          costDeltaInr: r.costDeltaInr.toFixed(2),
          netInr: r.revenueDeltaInr.sub(r.costDeltaInr).toFixed(2),
          revenueBeforeInr: s(r.revenueBeforeInr),
          revenueAfterInr: s(r.revenueAfterInr),
          costBeforeInr: s(r.costBeforeInr),
          costAfterInr: s(r.costAfterInr),
          reason: r.reason,
          detectedAt: r.detectedAt.toISOString(),
        };
      }),
      truncated: rows.length > limit,
    };
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
