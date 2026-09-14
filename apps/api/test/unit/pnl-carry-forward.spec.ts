import type { HttpException } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import { PnlService, type PnlReport } from '../../src/modules/treasury/services/pnl.service';
import {
  PnlPeriodService,
  rowsDisagree,
} from '../../src/modules/pnl-carry-forward/services/pnl-period.service';
import { PnlPeriodReadService } from '../../src/modules/pnl-carry-forward/services/pnl-period-read.service';
import {
  judgeNightlyRun,
  NIGHTLY_JOBS,
  type NightlyGate,
  type PnlNightlyGateService,
} from '../../src/modules/pnl-carry-forward/services/pnl-nightly-gate.service';
import {
  buildBaseline,
  diffMonth,
  type LiveRow,
} from '../../src/modules/pnl-carry-forward/services/pnl-carry-forward-diff';
import {
  monthOf,
  monthsBetween,
  monthWindow,
  nextMonth,
  prevMonth,
} from '../../src/modules/pnl-carry-forward/services/pnl-month';
import { FakeDb, type Row, type Tables } from './pnl-fake-db';

/*
  The carry-forward P&L (PNL-CF-1), run against the in-memory database
  that EVALUATES the P&L's filters (./pnl-fake-db) — the same engine /pnl
  prints, so a frozen month is compared with exactly what that page would
  say for it.
*/

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const T = (iso: string): Date => new Date(iso);

let seq = 0;
const nextId = (p: string): string => `${p}-${String(++seq).padStart(5, '0')}`;

class World {
  readonly t: Tables = {
    platformBankAccount: [{ id: 'acct-inr', label: 'HDFC current' }],
    courier: [{ id: 'c-dlv', code: 'delhivery' }],
    courierAccount: [{ id: 'ca-dlv', courierId: 'c-dlv' }],
    seller: [{ id: 's-1', companyName: 'Menev Store' }],
    expenseCategory: [{ id: 'cat-rent', code: 'rent', name: 'Rent' }],
  };
  readonly db = new FakeDb(this.t);

  add(model: string, row: Row): Row {
    (this.t[model] ??= []).push(row);
    return row;
  }

  /** An order delivered at `at`, billed `billed`, its parcel costing `cost` (null = not yet billed). */
  delivered(o: { at: Date; billed: string; cost: string | null; number: string }): {
    orderId: string;
    shipmentId: string;
  } {
    const orderId = nextId('ord');
    const shipmentId = nextId('shp');
    this.add('order', { id: orderId, orderNumber: o.number, status: 'DELIVERED' });
    this.add('orderEvent', { id: nextId('ev'), orderId, toStatus: 'DELIVERED', createdAt: o.at });
    this.add('sellerWalletEntry', {
      id: nextId('we'),
      direction: 'ORDER_CHARGES',
      currency: 'INR',
      amount: D(o.billed),
      createdAt: o.at,
      sellerId: 's-1',
      linkedOrderId: orderId,
      linkedEntryId: null,
    });
    this.add('shipment', {
      id: shipmentId,
      shipmentNumber: `SH-${shipmentId}`,
      courierCode: 'delhivery',
      courierAccountId: null,
      awbNumber: `AWB-${shipmentId}`,
      reverseAwbNumber: null,
      courierOrderId: null,
      deletedAt: null,
      supersededAt: null,
      rtoReceivedAt: null,
      createdAt: T('2026-07-01T00:00:00.000Z'),
      actualCourierCostInr: o.cost === null ? null : D(o.cost),
      actualRtoCostInr: null,
    });
    this.add('orderShipment', { id: nextId('os'), orderId, shipmentId });
    return { orderId, shipmentId };
  }

  /** The courier bills a parcel after its month closed. */
  lateCost(shipmentId: string, cost: string): void {
    const s = this.t['shipment']?.find((r) => r['id'] === shipmentId);
    if (s !== undefined) s['actualCourierCostInr'] = D(cost);
  }

  /** A delivered order comes back to us. */
  returned(orderId: string, at: Date): void {
    const o = this.t['order']?.find((r) => r['id'] === orderId);
    if (o !== undefined) o['status'] = 'RTO_RECEIVED';
    this.add('orderEvent', { id: nextId('ev'), orderId, toStatus: 'RTO_RECEIVED', createdAt: at });
  }

  /** An operating expense dated `at`, typed in at `recordedAt`. */
  expense(amount: string, at: Date, recordedAt: Date = at): void {
    const id = nextId('be');
    this.add('bankEntry', {
      id,
      accountId: 'acct-inr',
      type: 'EXPENSE',
      signedAmount: D(`-${amount}`),
      currency: 'INR',
      ownerKind: 'CAPITAL',
      occurredAt: at,
      createdAt: recordedAt,
      remittanceId: null,
      isOpeningBalance: false,
      transferId: null,
      settlementId: null,
      inboundFreightChargeId: null,
      expenseCategoryId: 'cat-rent',
      reference: `EXP-${id}`,
    });
  }

  /** A courier account adjustment (a claim settled, a reconciliation). */
  adjustment(kind: 'DEBIT' | 'CREDIT', amount: string, at: Date): void {
    const id = nextId('tx');
    this.add('courierWalletTransaction', {
      id,
      txnId: `MTX-${id}`,
      courierAccountId: 'ca-dlv',
      awbNumber: null,
      courierOrderRef: null,
      kind,
      category: 'ADJUSTMENT',
      amountInr: D(amount),
      occurredAt: at,
      status: 'success',
      shipmentStatus: null,
      missingFromExportAt: null,
    });
  }

  periods(): Row[] {
    return this.t['pnlPeriod'] ?? [];
  }

  carryForwards(): Row[] {
    return this.t['pnlCarryForward'] ?? [];
  }

  versions(month: string): Row[] {
    const p = this.periods().find((r) => r['month'] === month);
    return (this.t['pnlSnapshotVersion'] ?? []).filter((v) => v['periodId'] === p?.['id']);
  }

  /** The month's CURRENT frozen version — what the page shows and the invariant reads. */
  frozenReport(month: string): PnlReport {
    const v = this.versions(month).find((r) => r['supersededAt'] == null);
    if (v === undefined) throw new Error(`${month} is not closed`);
    return v['report'] as PnlReport;
  }
}

const PASSED: NightlyGate = { since: '', passed: true, jobs: [] };

function services(w: World, gate: NightlyGate = PASSED) {
  const prisma = { client: w.db.client() } as unknown as PrismaService;
  const pnl = new PnlService(prisma);
  const audit = { log: jest.fn().mockResolvedValue(null) };
  const issues = {
    raise: jest.fn().mockResolvedValue(null),
    resolveByKey: jest.fn().mockResolvedValue(0),
  };
  const gateSvc = { check: jest.fn().mockResolvedValue(gate) };
  const periods = new PnlPeriodService(
    prisma,
    pnl,
    audit as unknown as AuditLogService,
    issues as unknown as SystemIssueService,
    gateSvc as unknown as PnlNightlyGateService,
  );
  return { pnl, periods, read: new PnlPeriodReadService(prisma, pnl), audit, issues, gateSvc };
}

type Totals = Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }>;

function add(
  t: Totals,
  key: string,
  revenue: Prisma.Decimal.Value,
  cost: Prisma.Decimal.Value,
): void {
  const s = t.get(key) ?? { revenue: D('0'), cost: D('0') };
  t.set(key, { revenue: s.revenue.add(revenue), cost: s.cost.add(cost) });
}

/** A report per line, operating expenses as a line of its own. */
function totalsOf(reports: readonly PnlReport[], into: Totals = new Map()): Totals {
  for (const r of reports) {
    for (const l of r.lines) add(into, l.key, l.revenueInr, l.costInr);
    add(into, 'operating_expenses', '0', r.operatingExpensesInr);
  }
  return into;
}

function carried(rows: readonly Row[], into: Totals = new Map()): Totals {
  for (const r of rows) {
    add(
      into,
      r['lineKey'] as string,
      r['revenueDeltaInr'] as Prisma.Decimal,
      r['costDeltaInr'] as Prisma.Decimal,
    );
  }
  return into;
}

function expectSameTotals(actual: Totals, expected: Totals): void {
  const keys = new Set([...actual.keys(), ...expected.keys()]);
  for (const k of keys) {
    const a = actual.get(k) ?? { revenue: D('0'), cost: D('0') };
    const e = expected.get(k) ?? { revenue: D('0'), cost: D('0') };
    expect([k, a.revenue.toFixed(2), a.cost.toFixed(2)]).toEqual([
      k,
      e.revenue.toFixed(2),
      e.cost.toFixed(2),
    ]);
  }
}

async function live(pnl: PnlService, first: string, last: string = first): Promise<PnlReport> {
  return pnl.report(monthWindow(first).from, monthWindow(last).to);
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as HttpException | null;
  expect(err).not.toBeNull();
  return (err?.getResponse() as { code?: string }).code;
}

describe('IST months', () => {
  it('a month is [1st 00:00 IST, next 1st 00:00 IST), and tiles across a year end', () => {
    expect(monthWindow('2026-08')).toEqual({
      from: T('2026-07-31T18:30:00.000Z'),
      to: T('2026-08-31T18:30:00.000Z'),
    });
    expect(monthOf(T('2026-08-31T18:29:59.999Z'))).toBe('2026-08');
    expect(monthOf(T('2026-08-31T18:30:00.000Z'))).toBe('2026-09');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2027-01')).toBe('2026-12');
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthWindow('2026-12').to).toEqual(monthWindow('2027-01').from);
  });
});

describe('the carry-forward diff', () => {
  const label = { ref: 'SD-A', subRef: null, at: '2026-07-20T06:00:00.000Z', present: true };

  it('carries the MOVEMENT, says a figure was uncovered at close, and ignores "not recorded" → ₹0', () => {
    const baseline = buildBaseline(
      [
        { lineKey: 'delivery', refKey: 'o1', revenueInr: D('200'), costInr: null, label },
        { lineKey: 'delivery', refKey: 'o2', revenueInr: D('200'), costInr: null, label },
      ],
      [],
    );
    const now: LiveRow[] = [
      { lineKey: 'delivery', refKey: 'o1', revenue: D('200'), cost: D('104.38'), label },
      { lineKey: 'delivery', refKey: 'o2', revenue: D('200'), cost: D('0'), label },
    ];
    const drafts = diffMonth(baseline, now);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.refKey).toBe('o1');
    expect(drafts[0]?.costDelta.toFixed(2)).toBe('104.38');
    expect(drafts[0]?.reason).toBe('Courier cost not recorded at close (uncovered) → ₹104.38');
  });

  it('reads the baseline as snapshot PLUS every carry-forward, so nothing is carried twice', () => {
    const baseline = buildBaseline(
      [{ lineKey: 'fx', refKey: 'b1', revenueInr: D('10'), costInr: null, label }],
      [
        {
          lineKey: 'fx',
          refKey: 'b1',
          revenueDeltaInr: D('5'),
          costDeltaInr: D('0'),
          revenueAfterInr: D('15'),
          costAfterInr: null,
          label,
        },
      ],
    );
    const now: LiveRow[] = [{ lineKey: 'fx', refKey: 'b1', revenue: D('15'), cost: null, label }];
    expect(diffMonth(baseline, now)).toEqual([]);
  });
});

describe('the nightly jobs a close waits for', () => {
  const since = T('2026-08-31T18:30:00.000Z');
  const job = NIGHTLY_JOBS[0];
  if (job === undefined) throw new Error('no nightly jobs');
  const at = T('2026-08-31T21:15:00.000Z');

  it('are the four courier jobs', () => {
    expect(NIGHTLY_JOBS.map((j) => j.okAction)).toEqual([
      'courier.wallet_ledger.synced',
      'courier.shiprocket_wallet.synced',
      'courier.delhivery_invoices.checked',
      'courier.shiprocket_invoices.checked',
    ]);
  });

  it('judge each one by its latest run since the month ended', () => {
    expect(judgeNightlyRun(job, since, null).status).toBe('NOT_RUN');
    expect(
      judgeNightlyRun(job, since, { action: job.failedAction, metadata: {}, createdAt: at }).status,
    ).toBe('FAILED');
    expect(
      judgeNightlyRun(job, since, {
        action: job.okAction,
        metadata: { skipped: 'DISABLED', accounts: [] },
        createdAt: at,
      }).status,
    ).toBe('SWITCHED_OFF');
    const partial = judgeNightlyRun(job, since, {
      action: job.okAction,
      metadata: {
        skipped: null,
        accounts: [
          { label: 'Main', error: null },
          { label: 'Second', error: 'portal timed out' },
        ],
      },
      createdAt: at,
    });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.detail).toContain('Second: portal timed out');
    expect(
      judgeNightlyRun(job, since, {
        action: job.okAction,
        metadata: { skipped: null, accounts: [{ label: 'Main', outcome: 'CHECKED' }] },
        createdAt: at,
      }).status,
    ).toBe('OK');
    expect(
      judgeNightlyRun(job, since, {
        action: job.okAction,
        metadata: { skipped: 'NO_ACCOUNTS', accounts: [] },
        createdAt: at,
      }).status,
    ).toBe('OK');
  });
});

describe('rows must add up to their line before a month can freeze', () => {
  it('names the line whose rows disagree with its figure', () => {
    const report = {
      lines: [{ key: 'fx', label: 'FX spread', revenueInr: '10.00', costInr: '0.00' }],
      operatingExpensesInr: '0.00',
    } as unknown as PnlReport;
    const label = { ref: 'x', subRef: null, at: '', present: true };
    expect(
      rowsDisagree(report, [{ lineKey: 'fx', refKey: 'a', revenue: D('10'), cost: null, label }]),
    ).toEqual([]);
    expect(
      rowsDisagree(report, [{ lineKey: 'fx', refKey: 'a', revenue: D('9'), cost: null, label }])[0],
    ).toContain('FX spread');
  });
});

describe('PnlPeriodService — close, carry forward, never reopen', () => {
  it('freezes months, carries later changes into the month then open, and adds up to the live P&L', async () => {
    const w = new World();
    const A = w.delivered({
      at: T('2026-07-20T06:00:00.000Z'),
      billed: '200',
      cost: null,
      number: 'SD-A',
    });
    w.expense('100', T('2026-07-15T06:00:00.000Z'));
    const B = w.delivered({
      at: T('2026-08-10T06:00:00.000Z'),
      billed: '200',
      cost: '90',
      number: 'SD-B',
    });
    w.expense('50', T('2026-08-12T06:00:00.000Z'));
    const s = services(w);

    // ── The backfill on first deploy (14 Sep): a dry run writes nothing ──
    const deployed = T('2026-09-14T06:00:00.000Z');
    const dry = await s.periods.backfill({
      dryRun: true,
      throughMonth: null,
      reason: null,
      staffId: 'staff-1',
      now: deployed,
    });
    expect(dry.months.map((m) => [m.month, m.action])).toEqual([
      ['2026-07', 'WOULD_CLOSE'],
      ['2026-08', 'WOULD_CLOSE'],
    ]);
    expect(w.periods()).toHaveLength(0);

    const done = await s.periods.backfill({
      dryRun: false,
      throughMonth: null,
      reason: 'Starting the carry-forward P&L',
      staffId: 'staff-1',
      now: deployed,
    });
    expect(done.months.map((m) => [m.month, m.action])).toEqual([
      ['2026-07', 'CLOSED'],
      ['2026-08', 'CLOSED'],
    ]);
    // Frozen exactly as the live engine said at the moment of closing.
    expect(w.frozenReport('2026-07').netInr).toBe((await live(s.pnl, '2026-07')).netInr);
    const augAtClose = w.frozenReport('2026-08');
    expect(augAtClose.netInr).toBe('60.00'); // 200 − 90 − 50

    // ── September: four changes to closed months ────────────────────────
    w.lateCost(A.shipmentId, '104.38'); // a July parcel's courier cost lands
    w.returned(B.orderId, T('2026-09-05T06:00:00.000Z')); // an August delivery comes back
    w.expense('75', T('2026-08-28T06:00:00.000Z'), T('2026-09-05T06:00:00.000Z')); // back-dated
    w.adjustment('CREDIT', '40', T('2026-08-20T06:00:00.000Z')); // a claim credit

    const day1 = await s.periods.detect('2026-09', T('2026-09-20T01:00:00.000Z'));
    expect(day1.rowsAdded).toBe(4);
    const cf = w.carryForwards();
    expect(cf.every((r) => r['landedMonth'] === '2026-09')).toBe(true);
    const reasonOf = (origin: string, line: string): string =>
      String(cf.find((r) => r['originMonth'] === origin && r['lineKey'] === line)?.['reason']);
    expect(reasonOf('2026-07', 'delivery')).toBe(
      'Courier cost not recorded at close (uncovered) → ₹104.38',
    );
    expect(reasonOf('2026-08', 'delivery')).toBe(
      'Order SD-B has left India delivery since the month closed — it came back to us (rto_received)',
    );
    expect(reasonOf('2026-08', 'operating_expenses')).toBe(
      'Expense dated 28 Aug 2026 recorded after the month closed',
    );
    expect(reasonOf('2026-08', 'courier_adjustments')).toBe(
      'Courier adjustment dated 20 Aug 2026 arrived after the month closed (a credit)',
    );

    // Twice in a day adds nothing.
    const again = await s.periods.detect('2026-09', T('2026-09-20T02:00:00.000Z'));
    expect(again.rowsAdded).toBe(0);
    expect(w.carryForwards()).toHaveLength(4);

    // The frozen months did not move.
    expect(w.frozenReport('2026-08')).toEqual(augAtClose);

    // ── 30 Sep: one more change, then September closes on 1 Oct 06:30 IST ─
    w.adjustment('DEBIT', '10', T('2026-07-25T06:00:00.000Z'));
    const auto = await s.periods.autoClose(T('2026-10-01T01:00:00.000Z'));
    expect(auto.closed).toEqual([{ month: '2026-09', lockState: 'FINAL' }]);
    // Carried into September while it was still open — part of its frozen view.
    expect(w.carryForwards().filter((r) => r['landedMonth'] === '2026-09')).toHaveLength(5);

    // Nothing can land in September any more.
    expect(await codeOf(s.periods.detect('2026-09', T('2026-10-02T01:00:00.000Z')))).toBe(
      'PNL_MONTH_CLOSED',
    );

    // ── October: a change after September closed lands in October ───────
    w.expense('10', T('2026-08-29T06:00:00.000Z'), T('2026-10-03T06:00:00.000Z'));
    const oct = await s.periods.detect('2026-10', T('2026-10-03T01:00:00.000Z'));
    expect(oct.byOrigin).toEqual([{ originMonth: '2026-08', rows: 1, netInr: '-10.00' }]);

    // ── What the page shows ──────────────────────────────────────────────
    const now = T('2026-10-03T02:00:00.000Z');
    const sepView = await s.read.view('2026-09', null, now);
    expect(sepView.status).toBe('CLOSED');
    expect(sepView.carriedIn.map((g) => [g.originMonth, g.count])).toEqual([
      ['2026-08', 3],
      ['2026-07', 2],
    ]);
    const augView = await s.read.view('2026-08', null, now);
    expect(augView.totals.ownNetInr).toBe('60.00');
    expect(augView.laterChanges.map((g) => [g.landedMonth, g.netInr])).toEqual([
      ['2026-10', '-10.00'],
      // B leaves delivery (−200 + 90), a ₹75 expense, a ₹40 credit.
      ['2026-09', '-145.00'],
    ]);
    const octView = await s.read.view('2026-10', null, now);
    expect(octView.status).toBe('OPEN');
    expect(octView.totals.carriedInNetInr).toBe('-10.00');

    // ── THE INVARIANT ────────────────────────────────────────────────────
    // Each closed month: frozen + everything carried forward from it = the
    // month recomputed today, per line, to the paisa.
    for (const m of ['2026-07', '2026-08', '2026-09']) {
      const left = carried(
        w.carryForwards().filter((r) => r['originMonth'] === m),
        totalsOf([w.frozenReport(m)]),
      );
      expectSameTotals(left, totalsOf([await live(s.pnl, m)]));
    }
    // And over the whole span: every frozen month + every carry-forward +
    // the open month's own figure = the live engine over all of it.
    const everything = carried(
      w.carryForwards(),
      totalsOf([
        w.frozenReport('2026-07'),
        w.frozenReport('2026-08'),
        w.frozenReport('2026-09'),
        await live(s.pnl, '2026-10'),
      ]),
    );
    expectSameTotals(everything, totalsOf([await live(s.pnl, '2026-07', '2026-10')]));
    // The carry-forwards counted IN each closed month are frozen with it:
    // what was reported for July–September on the day September closed.
    const reportedBySep = carried(
      w.carryForwards().filter((r) => (r['landedMonth'] as string) <= '2026-09'),
      totalsOf([w.frozenReport('2026-07'), w.frozenReport('2026-08'), w.frozenReport('2026-09')]),
    );
    expect(reportedBySep.get('operating_expenses')?.cost.toFixed(2)).toBe('225.00'); // 100+50+75
  });

  it('refuses a month that has not ended and a month before one already closed, and never reopens', async () => {
    const w = new World();
    w.expense('50', T('2026-08-12T06:00:00.000Z'));
    const s = services(w);
    const now = T('2026-09-14T06:00:00.000Z');
    const close = (month: string): ReturnType<PnlPeriodService['close']> =>
      s.periods.close({
        month,
        kind: 'MANUAL',
        staffId: 'staff-1',
        reason: 'closing by hand for the test',
        nightlyJobs: null,
        now,
      });

    expect(await codeOf(close('2026-09'))).toBe('PNL_MONTH_NOT_ENDED');
    const first = await close('2026-08');
    expect(first.alreadyClosed).toBe(false);
    const second = await close('2026-08');
    expect(second.alreadyClosed).toBe(true);
    expect(w.periods()).toHaveLength(1);
    expect(await codeOf(close('2026-06'))).toBe('PNL_LATER_MONTH_CLOSED');
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'treasury.pnl_period.closed',
        entityId: null,
        severity: 'HIGH',
        metadata: expect.objectContaining({ month: '2026-08' }),
      }),
      expect.anything(),
    );
  });

  it('closes ON TIME as PROVISIONAL when a nightly job failed, carries nothing out of it, and "lock permanently" puts the late data IN it', async () => {
    const w = new World();
    w.expense('50', T('2026-08-12T06:00:00.000Z'));
    const failed: NightlyGate = {
      since: '2026-09-30T18:30:00.000Z',
      passed: false,
      jobs: [
        {
          key: 'shiprocket_wallet_sync',
          label: 'Shiprocket wallet sync (03:50 IST)',
          status: 'NOT_RUN',
          ranAt: null,
          detail: 'No run recorded since 1 Oct 2026.',
        },
      ],
    };
    const s = services(w, failed);

    // Nothing has ever been closed: it closes nothing and says to run the backfill.
    const never = await s.periods.autoClose(T('2026-10-01T01:00:00.000Z'));
    expect(never.neverClosed).toBe(true);
    expect(s.issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'pnl-close:never-closed', severity: 'HIGH' }),
    );

    await s.periods.close({
      month: '2026-08',
      kind: 'BACKFILL',
      staffId: 'staff-1',
      reason: 'backfill for the test',
      nightlyJobs: null,
      now: T('2026-09-14T06:00:00.000Z'),
    });
    w.expense('30', T('2026-09-10T06:00:00.000Z'));

    // 05:40 IST on the 1st: too early, the jobs are not even asked.
    const early = await s.periods.autoClose(T('2026-10-01T00:10:00.000Z'));
    expect(early.closed).toEqual([]);
    expect(s.gateSvc.check).not.toHaveBeenCalled();

    // 06:30 IST: a job has not run — closed anyway, PROVISIONAL, and a HIGH
    // MONEY issue names the job and what to do. The retired issue is resolved.
    const auto = await s.periods.autoClose(T('2026-10-01T01:00:00.000Z'));
    expect(auto.closed).toEqual([{ month: '2026-09', lockState: 'PROVISIONAL' }]);
    const sep = w.periods().find((p) => p['month'] === '2026-09');
    expect(sep?.['lockState']).toBe('PROVISIONAL');
    expect(w.versions('2026-09').map((v) => v['kind'])).toEqual(['AUTO_PROVISIONAL']);
    expect(s.issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        dedupeKey: 'pnl-close-provisional:2026-09',
        detail: expect.stringContaining('Shiprocket wallet sync (03:50 IST)'),
      }),
    );
    expect(s.issues.resolveByKey).toHaveBeenCalledWith(
      'pnl-close:2026-09',
      expect.any(String),
      null,
    );

    // Late September data is NOT carried out of a provisional month.
    w.expense('20', T('2026-09-20T06:00:00.000Z'), T('2026-10-02T06:00:00.000Z'));
    const skipped = await s.periods.detect('2026-10', T('2026-10-03T01:00:00.000Z'));
    expect(skipped.rowsAdded).toBe(0);
    expect(skipped.provisionalSkipped).toEqual(['2026-09']);

    // Lock permanently: re-snapshotted now, the ₹20 lands IN September.
    const now = T('2026-10-03T02:00:00.000Z');
    expect(
      await codeOf(
        s.periods.lockPermanently({ month: '2026-09', staffId: 'staff-1', reason: 'short', now }),
      ),
    ).toBe('PNL_REASON_TOO_SHORT');
    const locked = await s.periods.lockPermanently({
      month: '2026-09',
      staffId: 'staff-1',
      reason: 'Shiprocket sync fixed and re-run by hand',
      now,
    });
    expect(locked).toMatchObject({
      version: 2,
      kind: 'LOCK_PERMANENTLY',
      lockState: 'FINAL',
      netBeforeInr: '-30.00',
      netInr: '-50.00',
      gatePassed: false,
    });
    expect(sep?.['lockState']).toBe('FINAL');
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'treasury.pnl_period.locked_permanently',
        entityId: null,
        severity: 'HIGH',
        metadata: expect.objectContaining({ month: '2026-09', lockedDespiteNightlyJobs: true }),
      }),
      expect.anything(),
    );
    expect(s.issues.resolveByKey).toHaveBeenCalledWith(
      'pnl-close-provisional:2026-09',
      expect.any(String),
      'staff-1',
    );
    // The provisional version is KEPT, superseded, rows and all.
    const [v1, v2] = w.versions('2026-09');
    expect(v1?.['supersededAt']).toEqual(now);
    expect(v2?.['supersededAt'] ?? null).toBeNull();
    const rowsOf = (v: Row | undefined): Row[] =>
      (w.t['pnlSnapshotRow'] ?? []).filter((r) => r['versionId'] === v?.['id']);
    expect(rowsOf(v1)).toHaveLength(1);
    expect(rowsOf(v2)).toHaveLength(2);
    expect(
      await codeOf(
        s.periods.lockPermanently({
          month: '2026-09',
          staffId: 'staff-1',
          reason: 'again, which is refused',
          now,
        }),
      ),
    ).toBe('PNL_ALREADY_FINAL');

    // FINAL now: detection resumes for it.
    w.expense('5', T('2026-09-25T06:00:00.000Z'), T('2026-10-04T06:00:00.000Z'));
    const resumed = await s.periods.detect('2026-10', T('2026-10-05T01:00:00.000Z'));
    expect(resumed.byOrigin).toEqual([{ originMonth: '2026-09', rows: 1, netInr: '-5.00' }]);
    expectSameTotals(
      carried(
        w.carryForwards().filter((r) => r['originMonth'] === '2026-09'),
        totalsOf([w.frozenReport('2026-09')]),
      ),
      totalsOf([await live(s.pnl, '2026-09')]),
    );
  });

  it('god mode re-locks a FINAL month as live − Σ carry-forwards already recorded, keeps every version, and the invariant still holds', async () => {
    const w = new World();
    const A = w.delivered({
      at: T('2026-08-10T06:00:00.000Z'),
      billed: '200',
      cost: null,
      number: 'SD-A',
    });
    w.expense('50', T('2026-08-12T06:00:00.000Z'));
    const s = services(w);
    await s.periods.close({
      month: '2026-08',
      kind: 'MANUAL',
      staffId: 'staff-1',
      reason: 'closing by hand for the test',
      nightlyJobs: null,
      now: T('2026-09-14T06:00:00.000Z'),
    });
    expect(w.frozenReport('2026-08').netInr).toBe('150.00');

    // Two changes found and carried into September…
    w.lateCost(A.shipmentId, '104.38');
    w.expense('75', T('2026-08-28T06:00:00.000Z'), T('2026-09-05T06:00:00.000Z'));
    expect((await s.periods.detect('2026-09', T('2026-09-20T01:00:00.000Z'))).rowsAdded).toBe(2);
    // …and one not yet found when god mode runs.
    w.expense('10', T('2026-08-29T06:00:00.000Z'), T('2026-09-21T00:30:00.000Z'));

    const now = T('2026-09-21T01:00:00.000Z');
    const god = (over: Partial<Parameters<PnlPeriodService['godModeRelock']>[0]>) =>
      s.periods.godModeRelock({
        month: '2026-08',
        staffId: 'staff-1',
        reason: 'The August forwarder invoice was re-issued with a corrected total',
        confirmMonth: '2026-08',
        acknowledgeRisk: true,
        now,
        ...over,
      });
    expect(await codeOf(god({ reason: 'too short' }))).toBe('PNL_GOD_MODE_REASON_TOO_SHORT');
    expect(await codeOf(god({ confirmMonth: '2026-8' }))).toBe(
      'PNL_GOD_MODE_CONFIRMATION_MISMATCH',
    );
    expect(await codeOf(god({ acknowledgeRisk: false }))).toBe(
      'PNL_GOD_MODE_RISK_NOT_ACKNOWLEDGED',
    );
    expect(await codeOf(god({ month: '2026-09', confirmMonth: '2026-09' }))).toBe(
      'PNL_MONTH_NOT_ENDED',
    );
    expect(await codeOf(god({ month: '2026-07', confirmMonth: '2026-07' }))).toBe(
      'PNL_MONTH_NOT_CLOSED',
    );

    const re = await god({});
    // live net: 200 − 104.38 − 50 − 75 − 10 = −39.38; carried so far: −179.38;
    // the new version is the difference — the undetected ₹10 absorbed.
    expect(re).toMatchObject({
      version: 2,
      kind: 'GOD_MODE',
      netBeforeInr: '150.00',
      netInr: '140.00',
      carriedOutNetInr: '-179.38',
    });
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'treasury.pnl_period.god_mode_relocked',
        entityId: null,
        severity: 'CRITICAL',
        metadata: expect.objectContaining({ month: '2026-08', version: 2 }),
      }),
      expect.anything(),
    );

    // Carry-forward rows are untouched and still count in September.
    expect(w.carryForwards()).toHaveLength(2);
    expect(w.carryForwards().every((r) => r['landedMonth'] === '2026-09')).toBe(true);
    const invariant = async (): Promise<void> => {
      // The month: frozen current version + its carry-forwards = the month live.
      expectSameTotals(
        carried(
          w.carryForwards().filter((r) => r['originMonth'] === '2026-08'),
          totalsOf([w.frozenReport('2026-08')]),
        ),
        totalsOf([await live(s.pnl, '2026-08')]),
      );
      // The span: frozen + every carry-forward + the open month = live over both.
      expectSameTotals(
        carried(
          w.carryForwards(),
          totalsOf([w.frozenReport('2026-08'), await live(s.pnl, '2026-09')]),
        ),
        totalsOf([await live(s.pnl, '2026-08', '2026-09')]),
      );
    };
    await invariant();

    // Nothing new to carry: the undetected change went into the re-lock, not a row.
    expect((await s.periods.detect('2026-09', T('2026-09-21T02:00:00.000Z'))).rowsAdded).toBe(0);

    // A change after the re-lock is carried as usual, its "before" the re-locked figure.
    w.lateCost(A.shipmentId, '120');
    await s.periods.detect('2026-09', T('2026-09-22T01:00:00.000Z'));
    const after = w.carryForwards().at(-1);
    expect(after?.['reason']).toBe('Courier cost ₹104.38 → ₹120.00');
    expect((after?.['costDeltaInr'] as Prisma.Decimal).toFixed(2)).toBe('15.62');
    await invariant();

    // Every version is kept and can be opened.
    const view = await s.read.view('2026-08', null, T('2026-09-22T02:00:00.000Z'));
    expect(
      view.versions.map((v) => [v.version, v.kind, v.current, v.netBeforeInr, v.netInr]),
    ).toEqual([
      [2, 'GOD_MODE', true, '150.00', '140.00'],
      [1, 'MANUAL', false, null, '150.00'],
    ]);
    const old = await s.read.view('2026-08', 1, T('2026-09-22T02:00:00.000Z'));
    expect(old.shownVersion).toBe(1);
    expect(old.report.netInr).toBe('150.00');
  });
});
