import { readFileSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = resolve(__dirname, '../..');

/**
 * What a parcel COST has one automated source: the courier's invoice.
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────
 * `shipments.actual_courier_cost_inr` is what the courier BILLED, and
 * the P&L's delivery line reads it as measured cost. The nightly wallet
 * ledger sync writes it from Delhivery's own ledger, overwriting an
 * earlier figure when a charge is re-cut.
 *
 * A margin report was then added that asked Delhivery's rate
 * CALCULATOR what a parcel would cost and wrote THAT into the same
 * column — same field, same `actual_courier_cost_at` stamp, nothing to
 * say it was a quote. The wallet sync overwrites it, but only for AWBs
 * inside the export window the courier returns (about a week), so a
 * parcel estimated outside that window kept the guess permanently and
 * the margin was measured against it.
 *
 * ── WHY A STRUCTURAL TEST ────────────────────────────────────────────
 * Nothing about writing an estimate there FAILS. The figure is
 * plausible, the types agree, every behavioural test passes, and the
 * number is simply wrong in a way only an invoice could reveal. The
 * only way to keep the column honest is to name who may write it.
 */
const ALLOWED = [
  // The invoice. Reads the courier's own ledger and writes what they
  // actually charged.
  'wallet-import.service.ts',
  // A person typing a figure off an invoice, deliberately and audited.
  'shipment-cost.service.ts',
];

describe('the invoiced courier cost has one automated writer', () => {
  const offenders = globSync('src/modules/**/*.ts', { cwd: API }).filter((f) => {
    if (ALLOWED.some((a) => f.endsWith(a))) return false;
    const src = readFileSync(join(API, f), 'utf8');
    /*
      A WRITE, not a read.

      The column is SELECTED all over the reporting layer and appears in
      report rows that never touch the database, so matching the name
      alone flags the P&L for reading its own input. What matters is the
      field appearing inside a `shipment.update`/`create` call, so the
      scan looks at a window after each one.
    */
    return [...src.matchAll(/\.shipment\.(update|updateMany|create|upsert)\s*\(/g)].some((m) =>
      src.slice(m.index, m.index + 600).includes('actualCourierCostInr'),
    );
  });

  it('nothing else writes actual_courier_cost_inr', () => {
    expect(offenders).toEqual([]);
  });

  it('finds the allowed writers, so this is not passing on air', () => {
    // A rename that broke the glob would make the assertion above pass
    // vacuously, which is the failure mode a structural test must rule
    // out first.
    const found = globSync('src/modules/**/*.ts', { cwd: API }).filter((f) =>
      ALLOWED.some((a) => f.endsWith(a)),
    );
    expect(found).toHaveLength(ALLOWED.length);
  });
});
