import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, SellerStoreKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import {
  isMonth,
  monthOf,
  monthWindow,
  monthsBetween,
  nextMonth,
  prevMonth,
} from '../../pnl-carry-forward/services/pnl-month';
import {
  buildStoreBaseline,
  diffStoreMonth,
  flattenReport,
  readStoreLabel,
} from './store-pnl-carry-forward';
import { STORE_PNL_LINE_KEYS, STORE_PNL_LINES, netContribution } from './store-pnl-lines';
import type { StorePnlLineKey, StorePnlReport } from './store-pnl-lines';
import { StorePnlService } from './store-pnl.service';

type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/** A carry-forward as a screen reads it. */
export interface StoreCarryView {
  readonly id: string;
  readonly originMonth: string;
  readonly landedMonth: string;
  readonly lineKey: string;
  readonly lineLabel: string;
  readonly ref: string;
  readonly subRef: string | null;
  readonly beforeInr: string | null;
  readonly afterInr: string | null;
  /** In the line's own sense. */
  readonly deltaInr: string;
  /** What it does to NET (a cost rising lowers it). */
  readonly netEffectInr: string;
  readonly reason: string;
  readonly detectedAt: string;
}

export interface StorePnlMonthSummary {
  readonly month: string;
  readonly status: 'closed' | 'open';
  readonly closedAt: string | null;
  /** The month's own figure: frozen when closed, live while open. */
  readonly netInr: string;
  /** Changes to earlier months found while this one was open. */
  readonly carriedInNetInr: string;
  /** What this month reports: its own net plus what was carried into it. */
  readonly asReportedNetInr: string;
}

export interface StorePnlMonthView extends StorePnlMonthSummary {
  readonly report: StorePnlReport;
  readonly carriedIn: readonly StoreCarryView[];
  /** Changes to THIS month found after it closed — counted in later months. */
  readonly carriedOut: readonly StoreCarryView[];
}

export interface StoreCloseResult {
  readonly month: string;
  readonly status: 'CLOSED' | 'ALREADY_CLOSED';
  readonly carriedForward: number;
}

const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

function isLineKey(s: string): s is StorePnlLineKey {
  return (STORE_PNL_LINE_KEYS as readonly string[]).includes(s);
}

/**
 * A reseller store's P&L by month, FROZEN once a month closes (RS-8 —
 * PNL-CF-1's shape, for a store).
 *
 * ── CLOSE ───────────────────────────────────────────────────────────
 * Months close in order, oldest first, once they have ended (IST). Under
 * `AdvisoryLock.STORE_PNL_PERIOD` for the store, a close FIRST carries
 * every change to the months before it into it, then freezes the month:
 * the report as computed now into `store_pnl_periods.report`, and every
 * drill-down row into `store_pnl_snapshot_rows`, keyed by the record's
 * stable id. A closed month is never reopened or re-snapshotted.
 *
 * ── DETECT ──────────────────────────────────────────────────────────
 * Recomputes every closed month and writes each record's difference from
 * what has been reported (snapshot + earlier carry-forwards) as an
 * APPEND-ONLY `store_pnl_carry_forwards` row, counted in the month open
 * now. Running it twice adds nothing.
 *
 * ── WHAT CAN CHANGE ─────────────────────────────────────────────────
 * A store's ledger rows are dated when written and never re-dated, so a
 * closed month's ledger rows do not move. What does: an expense recorded
 * later with a date in a closed month, or one deleted after the month
 * closed. The engine does not rely on that — it compares every row.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────
 * Over any span of months: Σ frozen months + Σ every carry-forward + the
 * open month's live figure = the live report over the span, per line, to
 * the paisa (`store-pnl-carry-forward.spec.ts`).
 */
@Injectable()
export class StorePnlPeriodService {
  private readonly logger = new Logger(StorePnlPeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pnl: StorePnlService,
  ) {}

  private async storeOrThrow(storeId: string, db?: Db): Promise<{ id: string; createdAt: Date }> {
    const store = await (db ?? this.prisma.client).sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER },
      select: { id: true, createdAt: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }

  /** Every month from the store's first to the current one, newest first. */
  async listMonths(storeId: string, now: Date = new Date()): Promise<StorePnlMonthSummary[]> {
    const store = await this.storeOrThrow(storeId);
    const client = this.prisma.client;
    const [periods, carries] = await Promise.all([
      client.storePnlPeriod.findMany({
        where: { storeId },
        select: { month: true, closedAt: true, report: true },
      }),
      client.storePnlCarryForward.findMany({
        where: { storeId },
        select: { landedMonth: true, lineKey: true, deltaInr: true },
      }),
    ]);
    const closed = new Map(periods.map((p) => [p.month, p]));
    const carriedIn = new Map<string, Prisma.Decimal>();
    for (const c of carries) {
      if (!isLineKey(c.lineKey)) continue;
      carriedIn.set(
        c.landedMonth,
        (carriedIn.get(c.landedMonth) ?? ZERO).add(netContribution(c.lineKey, c.deltaInr)),
      );
    }
    const out: StorePnlMonthSummary[] = [];
    for (const month of monthsBetween(monthOf(store.createdAt), monthOf(now)).reverse()) {
      const p = closed.get(month);
      const net =
        p !== undefined
          ? new Prisma.Decimal((p.report as unknown as StorePnlReport).netInr)
          : new Prisma.Decimal(
              (await this.pnl.report(storeId, monthWindow(month).from, monthWindow(month).to))
                .netInr,
            );
      const inNet = carriedIn.get(month) ?? ZERO;
      out.push({
        month,
        status: p === undefined ? 'open' : 'closed',
        closedAt: p?.closedAt.toISOString() ?? null,
        netInr: net.toFixed(2),
        carriedInNetInr: inNet.toFixed(2),
        asReportedNetInr: net.add(inNet).toFixed(2),
      });
    }
    return out;
  }

  /** One month: frozen when closed, live while open, with what was carried in and out. */
  async monthView(
    storeId: string,
    month: string,
    now: Date = new Date(),
  ): Promise<StorePnlMonthView> {
    if (!isMonth(month)) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: 'Give the month as YYYY-MM',
      });
    }
    const store = await this.storeOrThrow(storeId);
    if (month < monthOf(store.createdAt) || month > monthOf(now)) {
      throw new BadRequestException({
        code: 'STORE_PNL_MONTH_OUT_OF_RANGE',
        message: 'That month is before the store opened, or has not started yet.',
      });
    }
    const client = this.prisma.client;
    const [period, carries] = await Promise.all([
      client.storePnlPeriod.findFirst({
        where: { storeId, month },
        select: { closedAt: true, report: true },
      }),
      client.storePnlCarryForward.findMany({
        where: { storeId, OR: [{ landedMonth: month }, { originMonth: month }] },
        orderBy: { id: 'asc' },
      }),
    ]);
    const report =
      period !== null
        ? (period.report as unknown as StorePnlReport)
        : await this.pnl.report(storeId, monthWindow(month).from, monthWindow(month).to);
    const views = carries.map((c) => this.view(c));
    const carriedIn = views.filter((c) => c.landedMonth === month);
    const inNet = carriedIn.reduce((t, c) => t.add(c.netEffectInr), ZERO);
    return {
      month,
      status: period === null ? 'open' : 'closed',
      closedAt: period?.closedAt.toISOString() ?? null,
      netInr: report.netInr,
      carriedInNetInr: inNet.toFixed(2),
      asReportedNetInr: new Prisma.Decimal(report.netInr).add(inNet).toFixed(2),
      report,
      carriedIn,
      carriedOut: views.filter((c) => c.originMonth === month),
    };
  }

  private view(c: {
    id: string;
    originMonth: string;
    landedMonth: string;
    lineKey: string;
    refKey: string;
    amountBeforeInr: Prisma.Decimal | null;
    amountAfterInr: Prisma.Decimal | null;
    deltaInr: Prisma.Decimal;
    reason: string;
    label: unknown;
    detectedAt: Date;
  }): StoreCarryView {
    const label = readStoreLabel(c.label, c.refKey);
    const line = isLineKey(c.lineKey) ? c.lineKey : null;
    return {
      id: c.id,
      originMonth: c.originMonth,
      landedMonth: c.landedMonth,
      lineKey: c.lineKey,
      lineLabel: line === null ? c.lineKey : STORE_PNL_LINES[line].label,
      ref: label.ref,
      subRef: label.subRef,
      beforeInr: c.amountBeforeInr?.toFixed(2) ?? null,
      afterInr: c.amountAfterInr?.toFixed(2) ?? null,
      deltaInr: c.deltaInr.toFixed(2),
      netEffectInr: (line === null ? c.deltaInr : netContribution(line, c.deltaInr)).toFixed(2),
      reason: c.reason,
      detectedAt: c.detectedAt.toISOString(),
    };
  }

  /**
   * Close one month. Months close in order, so the month must be the one
   * after the store's latest closed month (or its first). Before freezing
   * it, every change to the months before it is carried INTO it.
   */
  async close(
    storeId: string,
    month: string,
    now: Date = new Date(),
    closedBy: ActorType = ActorType.SYSTEM,
  ): Promise<StoreCloseResult> {
    if (!isMonth(month)) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: 'Give the month as YYYY-MM',
      });
    }
    const window = monthWindow(month);
    if (window.to.getTime() > now.getTime()) {
      throw new ConflictException({
        code: 'STORE_PNL_MONTH_NOT_ENDED',
        message: `${month} has not ended yet.`,
      });
    }
    return this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.STORE_PNL_PERIOD, storeId);
      const store = await this.storeOrThrow(storeId, tx);
      const first = monthOf(store.createdAt);
      if (month < first) {
        throw new BadRequestException({
          code: 'STORE_PNL_MONTH_OUT_OF_RANGE',
          message: 'That month is before the store opened.',
        });
      }
      const existing = await tx.storePnlPeriod.findFirst({
        where: { storeId, month },
        select: { id: true },
      });
      if (existing !== null) return { month, status: 'ALREADY_CLOSED', carriedForward: 0 };
      const latest = await tx.storePnlPeriod.findFirst({
        where: { storeId },
        orderBy: { month: 'desc' },
        select: { month: true },
      });
      const expected = latest === null ? first : nextMonth(latest.month);
      if (month !== expected) {
        throw new ConflictException({
          code: 'STORE_PNL_EARLIER_MONTH_OPEN',
          message: `Months close in order — ${expected} has to close first.`,
        });
      }
      const carriedForward = await this.detectIn(tx, storeId, month);
      const report = await this.pnl.report(storeId, window.from, window.to, tx);
      const period = await tx.storePnlPeriod.create({
        data: {
          storeId,
          month,
          closedByActorType: closedBy,
          report: report as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const rows = flattenReport(report);
      if (rows.length > 0) {
        await tx.storePnlSnapshotRow.createMany({
          data: rows.map((r) => ({
            periodId: period.id,
            lineKey: r.lineKey,
            refKey: r.refKey,
            amountInr: r.amount,
            label: r.label as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return { month, status: 'CLOSED', carriedForward };
    }, TX_OPTIONS);
  }

  /** Detect changes to the store's closed months, into the month open now. */
  async detect(storeId: string): Promise<{ landedMonth: string | null; carriedForward: number }> {
    return this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.STORE_PNL_PERIOD, storeId);
      const latest = await tx.storePnlPeriod.findFirst({
        where: { storeId },
        orderBy: { month: 'desc' },
        select: { month: true },
      });
      if (latest === null) return { landedMonth: null, carriedForward: 0 };
      const landed = nextMonth(latest.month);
      return { landedMonth: landed, carriedForward: await this.detectIn(tx, storeId, landed) };
    }, TX_OPTIONS);
  }

  /** Every closed month before `landed`, diffed against its baseline; returns rows written. */
  private async detectIn(tx: Db, storeId: string, landed: string): Promise<number> {
    const closed = await tx.storePnlPeriod.findMany({
      where: { storeId, month: { lt: landed } },
      select: { id: true, month: true },
      orderBy: { month: 'asc' },
    });
    let written = 0;
    for (const p of closed) {
      const [snapshot, carries] = await Promise.all([
        tx.storePnlSnapshotRow.findMany({
          where: { periodId: p.id },
          select: { lineKey: true, refKey: true, amountInr: true, label: true },
        }),
        tx.storePnlCarryForward.findMany({
          where: { storeId, originMonth: p.month },
          select: {
            lineKey: true,
            refKey: true,
            deltaInr: true,
            amountAfterInr: true,
            label: true,
          },
          orderBy: { id: 'asc' },
        }),
      ]);
      const win = monthWindow(p.month);
      const live = flattenReport(await this.pnl.report(storeId, win.from, win.to, tx));
      const drafts = diffStoreMonth(buildStoreBaseline(snapshot, carries), live);
      if (drafts.length === 0) continue;
      await tx.storePnlCarryForward.createMany({
        data: drafts.map((d) => ({
          storeId,
          originMonth: p.month,
          landedMonth: landed,
          lineKey: d.lineKey,
          refKey: d.refKey,
          amountBeforeInr: d.before,
          amountAfterInr: d.after,
          deltaInr: d.delta,
          reason: d.reason,
          label: d.label as unknown as Prisma.InputJsonValue,
        })),
      });
      written += drafts.length;
    }
    return written;
  }

  /**
   * The scheduled close: for every reseller store, every ENDED month after
   * its latest closed one, oldest first. One store's failure never stops
   * the others; a month that failed is retried on the next run.
   */
  async autoCloseAll(
    now: Date = new Date(),
  ): Promise<{ stores: number; closed: number; failures: number }> {
    const stores = await this.prisma.client.sellerStore.findMany({
      where: { kind: SellerStoreKind.RESELLER },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    const lastEnded = prevMonth(monthOf(now));
    let closed = 0;
    let failures = 0;
    for (const s of stores) {
      try {
        const latest = await this.prisma.client.storePnlPeriod.findFirst({
          where: { storeId: s.id },
          orderBy: { month: 'desc' },
          select: { month: true },
        });
        const from = latest === null ? monthOf(s.createdAt) : nextMonth(latest.month);
        for (const month of monthsBetween(from, lastEnded)) {
          const r = await this.close(s.id, month, now);
          if (r.status === 'CLOSED') closed += 1;
        }
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { storeId: s.id, err: err instanceof Error ? err.message : String(err) },
          'Could not close a reseller store month; retried on the next run',
        );
      }
    }
    return { stores: stores.length, closed, failures };
  }

  /** The daily detection, for every store with a closed month. */
  async detectAll(): Promise<{ stores: number; carriedForward: number; failures: number }> {
    const withPeriods = await this.prisma.client.storePnlPeriod.findMany({
      distinct: ['storeId'],
      select: { storeId: true },
    });
    let carriedForward = 0;
    let failures = 0;
    for (const { storeId } of withPeriods) {
      try {
        carriedForward += (await this.detect(storeId)).carriedForward;
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { storeId, err: err instanceof Error ? err.message : String(err) },
          'Could not detect carry-forwards for a reseller store',
        );
      }
    }
    return { stores: withPeriods.length, carriedForward, failures };
  }
}
