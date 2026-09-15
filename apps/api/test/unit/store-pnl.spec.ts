import { Prisma, StoreWalletEntryDirection as D } from '@skydrop/db';
import { monthWindow } from '../../src/modules/pnl-carry-forward/services/pnl-month';
import {
  STORE_PNL_LINE_KEYS,
  placeDirection,
  type StorePnlReport,
} from '../../src/modules/reseller-reports/services/store-pnl-lines';
import { serviceOver, storeTables } from './store-pnl-fixtures';

/**
 * RS-8 — the store P&L over an in-memory Prisma that APPLIES the where
 * clauses (the platform P&L's fake), so a window that leaks, a row outside
 * its line or another store's entry would show.
 */

const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

const line = (r: StorePnlReport, key: string): string =>
  r.lines.find((l) => l.key === key)?.amountInr ?? 'missing';

describe('store P&L (RS-8)', () => {
  const pnl = serviceOver(storeTables());
  const aug = monthWindow('2026-08');
  const sep = monthWindow('2026-09');

  it('places each direction on its line, read from the ledger — no fee arithmetic of its own', async () => {
    const r = await pnl.report('store-1', aug.from, aug.to);
    expect(line(r, 'order_margin')).toBe('100.00');
    expect(line(r, 'fee_shares')).toBe('0.00'); // 20 charged, 20 given back
    expect(line(r, 'cod_tax_share')).toBe('5.00');
    expect(line(r, 'prepaid_cost')).toBe('250.00');
    expect(line(r, 'prepaid_sales')).toBe('400.00'); // o2's retail, from the snapshot
    expect(line(r, 'expenses')).toBe('500.00'); // the deleted one is not counted
    expect(r.revenueInr).toBe('500.00');
    expect(r.costInr).toBe('755.00');
    expect(r.netInr).toBe('-255.00');
    // Top-ups and withdrawals are cash, not profit.
    expect(r.cash).toMatchObject({ inInr: '1000.00', outInr: '0.00' });
  });

  it('a refund comes off the line of the share it gives back, read through its link', async () => {
    const r = await pnl.report('store-1', sep.from, sep.to);
    expect(line(r, 'return_fees')).toBe('10.00'); // 15 charged, 5 given back
    expect(line(r, 'order_margin')).toBe('-100.00'); // the credit taken back
    expect(line(r, 'prepaid_sales')).toBe('-400.00');
    expect(line(r, 'prepaid_cost')).toBe('-250.00');
    expect(line(r, 'expenses')).toBe('100.00'); // dated 1 Sep (IST) — September, not August
    expect(r.cash.outInr).toBe('300.00');
  });

  it('every line’s rows add up to the line, and every row carries a stable id', async () => {
    const r = await pnl.report('store-1', aug.from, sep.to);
    for (const l of r.lines) {
      const sum = l.rows.reduce((t, row) => t.add(row.amountInr), d(0));
      expect(sum.toFixed(2)).toBe(l.amountInr);
      expect(l.count).toBe(l.rows.length);
      for (const row of l.rows) expect(row.id).toMatch(/^(e-\d{4}|x-[a-z]+)$/);
    }
  });

  it('two adjacent windows add up to the window over both, per line and net', async () => {
    const [a, b, both] = await Promise.all([
      pnl.report('store-1', aug.from, aug.to),
      pnl.report('store-1', sep.from, sep.to),
      pnl.report('store-1', aug.from, sep.to),
    ]);
    for (const key of STORE_PNL_LINE_KEYS) {
      expect(d(line(a, key)).add(line(b, key)).toFixed(2)).toBe(line(both, key));
    }
    expect(d(a.netInr).add(b.netInr).toFixed(2)).toBe(both.netInr);
  });

  it('reads only the store it is asked about', async () => {
    const r = await pnl.report('store-1', aug.from, sep.to);
    const ids = r.lines.flatMap((l) => l.rows.map((row) => row.id));
    expect(ids).not.toContain('x-other');
    expect(r.lines.flatMap((l) => l.rows).some((row) => row.ref === 'SD-9')).toBe(false);
  });

  it('places the order-money and dispute directions (RS-6 3c, RS-7)', () => {
    const at = (direction: D): ReturnType<typeof placeDirection> =>
      placeDirection(
        {
          id: 'e-0001',
          direction,
          amount: d(10),
          shareOf: null,
          linkedOrderId: null,
          linkedEntryId: null,
          createdAt: new Date('2026-09-15T00:00:00Z'),
        },
        undefined,
      );
    // Sold below the transfer price: the difference is part of the order's
    // margin, as a minus; its give-back is a plus on the same line.
    expect(at(D.TRANSFER_PRICE)).toEqual({ kind: 'line', line: 'order_margin', sign: -1 });
    expect(at(D.TRANSFER_PRICE_REFUND)).toEqual({ kind: 'line', line: 'order_margin', sign: 1 });
    // A dispute settled between store and seller is profit or loss, not cash.
    expect(at(D.DISPUTE_SETTLEMENT_IN)).toEqual({
      kind: 'line',
      line: 'dispute_settlements',
      sign: 1,
    });
    expect(at(D.DISPUTE_SETTLEMENT_OUT)).toEqual({
      kind: 'line',
      line: 'dispute_settlements',
      sign: -1,
    });
  });

  it('every store wallet direction has a place (F2)', () => {
    for (const direction of Object.values(D)) {
      const placed = placeDirection(
        {
          id: 'x',
          direction,
          amount: d(1),
          shareOf: null,
          linkedOrderId: null,
          linkedEntryId: null,
          createdAt: new Date(),
        },
        undefined,
      );
      expect(['line', 'prepaid', 'cash']).toContain(placed.kind);
    }
  });
});
