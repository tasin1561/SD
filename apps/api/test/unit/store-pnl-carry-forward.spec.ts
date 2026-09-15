import { Prisma, StoreExpenseCategory } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { monthWindow } from '../../src/modules/pnl-carry-forward/services/pnl-month';
import {
  STORE_PNL_LINE_KEYS,
  netContribution,
  type StorePnlLineKey,
  type StorePnlReport,
} from '../../src/modules/reseller-reports/services/store-pnl-lines';
import { StorePnlPeriodService } from '../../src/modules/reseller-reports/services/store-pnl-period.service';
import { StorePnlService } from '../../src/modules/reseller-reports/services/store-pnl.service';
import type { Tables } from './pnl-fake-db';
import { DefaultsDb, storeTables } from './store-pnl-fixtures';

/**
 * RS-8 — a store month is FROZEN once it closes and never reopened; a later
 * change is carried into the month open when it was found. The invariant:
 * over any span, Σ frozen months + Σ carry-forwards + the open month's live
 * figure = the live report over the span, per line, to the paisa.
 */

const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

function setup(): { tables: Tables; pnl: StorePnlService; periods: StorePnlPeriodService } {
  const tables = storeTables();
  const prisma = { client: new DefaultsDb(tables).client() } as unknown as PrismaService;
  const pnl = new StorePnlService(prisma);
  return { tables, pnl, periods: new StorePnlPeriodService(prisma, pnl) };
}

/** Σ closed months (frozen lines) + Σ every carry-forward + the open months' live lines. */
function reported(
  tables: Tables,
  openLive: readonly StorePnlReport[],
): Map<StorePnlLineKey, Prisma.Decimal> {
  const out = new Map<StorePnlLineKey, Prisma.Decimal>(STORE_PNL_LINE_KEYS.map((k) => [k, d(0)]));
  const add = (k: StorePnlLineKey, v: Prisma.Decimal.Value): void => {
    out.set(k, (out.get(k) ?? d(0)).add(v));
  };
  for (const p of (tables['storePnlPeriod'] ?? []).filter((x) => x['storeId'] === 'store-1')) {
    for (const l of (p['report'] as StorePnlReport).lines) add(l.key, l.amountInr);
  }
  for (const c of (tables['storePnlCarryForward'] ?? []).filter(
    (x) => x['storeId'] === 'store-1',
  )) {
    add(c['lineKey'] as StorePnlLineKey, c['deltaInr'] as Prisma.Decimal);
  }
  for (const r of openLive) for (const l of r.lines) add(l.key, l.amountInr);
  return out;
}

async function expectInvariant(
  tables: Tables,
  pnl: StorePnlService,
  openMonths: readonly string[],
): Promise<void> {
  const open = await Promise.all(
    openMonths.map((m) => pnl.report('store-1', monthWindow(m).from, monthWindow(m).to)),
  );
  const got = reported(tables, open);
  const live = await pnl.report(
    'store-1',
    monthWindow('2026-07').from,
    monthWindow(openMonths[openMonths.length - 1] ?? '2026-12').to,
  );
  for (const l of live.lines) expect((got.get(l.key) ?? d(0)).toFixed(2)).toBe(l.amountInr);
}

describe('store P&L carry-forward (RS-8)', () => {
  it('closes ended months in order, freezes every row, and refuses what it must', async () => {
    const { tables, periods } = setup();
    const now = new Date('2026-10-02T06:00:00+05:30');
    await expect(periods.close('store-1', '2026-10', now)).rejects.toMatchObject({
      response: { code: 'STORE_PNL_MONTH_NOT_ENDED' },
    });
    await expect(periods.close('store-1', '2026-08', now)).rejects.toMatchObject({
      response: { code: 'STORE_PNL_EARLIER_MONTH_OPEN' },
    });
    const r = await periods.autoCloseAll(now);
    expect(r.closed).toBe(3 * 2); // Jul, Aug, Sep — for both stores
    expect((await periods.close('store-1', '2026-08', now)).status).toBe('ALREADY_CLOSED');
    const aug = (tables['storePnlPeriod'] ?? []).find(
      (p) => p['storeId'] === 'store-1' && p['month'] === '2026-08',
    );
    const rows = (tables['storePnlSnapshotRow'] ?? []).filter((s) => s['periodId'] === aug?.['id']);
    const frozen = aug?.['report'] as StorePnlReport;
    expect(rows.length).toBe(frozen.lines.reduce((t, l) => t + l.rows.length, 0));
  });

  it('carries a back-dated expense and a removed one into the open month, once, and says why', async () => {
    const { tables, pnl, periods } = setup();
    await periods.autoCloseAll(new Date('2026-10-02T06:00:00+05:30'));

    // After August closed: an expense dated in August is recorded late,
    // and the August ad spend is removed.
    tables['storeExpense']?.push({
      id: 'x-late',
      storeId: 'store-1',
      category: StoreExpenseCategory.SOFTWARE,
      amountInr: d(60),
      expenseDate: new Date('2026-08-20T00:00:00.000Z'),
      description: 'Shop plan',
      deletedAt: null,
    });
    const ad = tables['storeExpense']?.find((x) => x['id'] === 'x-ad');
    if (ad !== undefined) ad['deletedAt'] = new Date('2026-10-03T00:00:00.000Z');

    const first = await periods.detect('store-1');
    expect(first).toEqual({ landedMonth: '2026-10', carriedForward: 2 });
    const carries = tables['storePnlCarryForward'] ?? [];
    expect(carries.map((c) => c['reason'])).toEqual([
      expect.stringContaining('removed'),
      expect.stringContaining('recorded after the month closed'),
    ]);
    // Running it again adds nothing: the baseline already includes the first run.
    expect((await periods.detect('store-1')).carriedForward).toBe(0);

    const august = await periods.monthView('store-1', '2026-08', new Date('2026-10-05T00:00:00Z'));
    expect(august.status).toBe('closed');
    expect(august.carriedOut).toHaveLength(2);
    // A lower expense RAISES net; the higher one lowers it.
    expect(august.carriedOut.map((c) => c.netEffectInr).sort()).toEqual(['-60.00', '500.00']);
    const october = await periods.monthView('store-1', '2026-10', new Date('2026-10-05T00:00:00Z'));
    expect(october.status).toBe('open');
    expect(october.carriedInNetInr).toBe('440.00');

    await expectInvariant(tables, pnl, ['2026-10']);
  });

  it('a change found just before a month closes is carried INTO it; the invariant holds after', async () => {
    const { tables, pnl, periods } = setup();
    await periods.autoCloseAll(new Date('2026-10-02T06:00:00+05:30'));
    const sep = tables['storeExpense']?.find((x) => x['id'] === 'x-sep');
    if (sep !== undefined) sep['deletedAt'] = new Date('2026-10-20T00:00:00.000Z');

    await periods.autoCloseAll(new Date('2026-11-01T07:00:00+05:30'));
    const carries = tables['storePnlCarryForward'] ?? [];
    expect(carries).toHaveLength(1);
    expect(carries[0]).toMatchObject({ originMonth: '2026-09', landedMonth: '2026-10' });
    expect(netContribution('expenses', carries[0]?.['deltaInr'] as Prisma.Decimal).toFixed(2)).toBe(
      '100.00',
    );
    await expectInvariant(tables, pnl, ['2026-11']);

    const months = await periods.listMonths('store-1', new Date('2026-11-05T00:00:00Z'));
    expect(months.map((m) => `${m.month}:${m.status}`)).toEqual([
      '2026-11:open',
      '2026-10:closed',
      '2026-09:closed',
      '2026-08:closed',
      '2026-07:closed',
    ]);
    // What each month reports, added up, is the live figure over the span.
    const live = await pnl.report(
      'store-1',
      monthWindow('2026-07').from,
      monthWindow('2026-11').to,
    );
    expect(months.reduce((t, m) => t.add(m.asReportedNetInr), d(0)).toFixed(2)).toBe(live.netInr);
  });
});
