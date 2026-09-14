import { Prisma } from '@skydrop/db';
import type { PnlReport, PnlSnapshotKey } from '../../treasury/services/pnl.service';
import { istDateLabel } from './pnl-month';

/**
 * The arithmetic of carry-forward (PNL-CF-1), with no database in it.
 *
 * A closed month's BASELINE for one record is what has been reported for
 * it so far: its frozen snapshot row plus every carry-forward already
 * written for it. Detection compares that with the month recomputed now,
 * and each difference is carried into the open month. Because the
 * baseline includes earlier carry-forwards, running detection twice adds
 * nothing the second time — the first run already moved the baseline.
 */

const ZERO = new Prisma.Decimal(0);

/** How the drill-down showed the record; `present` is false once it has left the month. */
export interface RowLabel {
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
  readonly present: boolean;
  /**
   * On a RE-LOCKED version's row only: the record's full figure when the
   * month was re-locked. The row itself holds that figure MINUS what had
   * already been carried forward, so the "before" of a later change is
   * read from here, not from the row.
   */
  readonly atLock?: { readonly revenue: string | null; readonly cost: string | null };
}

/** One record behind one line, as the engine answers today. Null = not counted. */
export interface LiveRow {
  readonly lineKey: PnlSnapshotKey;
  readonly refKey: string;
  readonly revenue: Prisma.Decimal | null;
  readonly cost: Prisma.Decimal | null;
  readonly label: RowLabel;
}

/** What has been reported for a record so far. */
export interface BaselineRow {
  readonly lineKey: PnlSnapshotKey;
  readonly refKey: string;
  /** Snapshot + every carry-forward, as numbers (null counts as zero). */
  readonly revenue: Prisma.Decimal;
  readonly cost: Prisma.Decimal;
  /** The state last reported, nulls kept — for saying WHY it changed. */
  readonly lastRevenue: Prisma.Decimal | null;
  readonly lastCost: Prisma.Decimal | null;
  readonly present: boolean;
  readonly label: RowLabel;
}

export interface CarryForwardDraft {
  readonly lineKey: PnlSnapshotKey;
  readonly refKey: string;
  readonly revenueDelta: Prisma.Decimal;
  readonly costDelta: Prisma.Decimal;
  readonly revenueBefore: Prisma.Decimal | null;
  readonly revenueAfter: Prisma.Decimal | null;
  readonly costBefore: Prisma.Decimal | null;
  readonly costAfter: Prisma.Decimal | null;
  readonly label: RowLabel;
  readonly reason: string;
}

/** Snapshot rows and carry-forwards, as stored. */
export interface StoredSnapshotRow {
  readonly lineKey: string;
  readonly refKey: string;
  readonly revenueInr: Prisma.Decimal | null;
  readonly costInr: Prisma.Decimal | null;
  readonly label: unknown;
}
export interface StoredCarryForward {
  readonly lineKey: string;
  readonly refKey: string;
  readonly revenueDeltaInr: Prisma.Decimal;
  readonly costDeltaInr: Prisma.Decimal;
  readonly revenueAfterInr: Prisma.Decimal | null;
  readonly costAfterInr: Prisma.Decimal | null;
  readonly label: unknown;
  /** When it was found. Needed to tell a carry-forward from before a re-lock from one after. */
  readonly detectedAt?: Date;
}

/** The line names reasons use. A Record, so a new snapshot key fails to compile until named. */
export const LINE_NAMES: Record<PnlSnapshotKey, string> = {
  inbound_freight: 'BD → India freight',
  delivery: 'India delivery',
  rto: 'Returns',
  cod_tax: 'COD tax deduction',
  cod_service_fees: 'COD handling fees',
  fx: 'FX spread',
  courier_adjustments: 'Courier account adjustments',
  courier_unmatched: 'Courier charges on no live Skydrop parcel',
  courier_cod_fees: 'Courier COD fees',
  cod_shortfall: 'COD short-payments absorbed',
  damage_refunds: 'Damage & loss refunds',
  staff_wallet_adjustments: 'Staff wallet adjustments',
  bank_reconciliation: 'Bank reconciliation differences',
  investment_income: 'Investment income',
  operating_expenses: 'Operating expenses',
};

export const rowKey = (lineKey: string, refKey: string): string => `${lineKey}|${refKey}`;

/** A stored label, read defensively: it is JSON written by an older version of this code, too. */
export function readLabel(raw: unknown, fallbackRef: string): RowLabel {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    ref: typeof o['ref'] === 'string' ? o['ref'] : fallbackRef,
    subRef: typeof o['subRef'] === 'string' ? o['subRef'] : null,
    at: typeof o['at'] === 'string' ? o['at'] : '',
    present: o['present'] !== false,
  };
}

const dec = (v: unknown): Prisma.Decimal | null =>
  typeof v === 'string' && v !== '' ? new Prisma.Decimal(v) : null;

/** A re-locked row's full figure at the lock, when the label carries one. */
export function readLockFigures(
  raw: unknown,
): { revenue: Prisma.Decimal | null; cost: Prisma.Decimal | null } | null {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const at = o['atLock'];
  if (typeof at !== 'object' || at === null) return null;
  const a = at as Record<string, unknown>;
  return { revenue: dec(a['revenue']), cost: dec(a['cost']) };
}

/**
 * A closed month's baseline: its CURRENT version's rows, then every
 * carry-forward in the order written.
 *
 * Every carry-forward counts in the numbers, whenever it was found. When
 * the current version is a RE-LOCK (`rebasedAt`), a carry-forward found
 * before it was already subtracted from that version's rows, so it adds
 * back only numerically — the state last reported for the record is the
 * one the re-lock froze (`atLock`), not what the older carry-forward said.
 */
export function buildBaseline(
  snapshot: readonly StoredSnapshotRow[],
  carryForwards: readonly StoredCarryForward[],
  rebasedAt: Date | null = null,
): Map<string, BaselineRow> {
  const out = new Map<string, BaselineRow>();
  for (const s of snapshot) {
    const lock = readLockFigures(s.label);
    const label = readLabel(s.label, s.refKey);
    out.set(rowKey(s.lineKey, s.refKey), {
      lineKey: s.lineKey as PnlSnapshotKey,
      refKey: s.refKey,
      revenue: s.revenueInr ?? ZERO,
      cost: s.costInr ?? ZERO,
      lastRevenue: lock === null ? s.revenueInr : lock.revenue,
      lastCost: lock === null ? s.costInr : lock.cost,
      present: label.present,
      label,
    });
  }
  for (const c of carryForwards) {
    const k = rowKey(c.lineKey, c.refKey);
    const prev = out.get(k);
    const beforeRelock =
      rebasedAt !== null &&
      c.detectedAt !== undefined &&
      c.detectedAt.getTime() < rebasedAt.getTime();
    const label = readLabel(c.label, c.refKey);
    out.set(k, {
      lineKey: c.lineKey as PnlSnapshotKey,
      refKey: c.refKey,
      revenue: (prev?.revenue ?? ZERO).add(c.revenueDeltaInr),
      cost: (prev?.cost ?? ZERO).add(c.costDeltaInr),
      lastRevenue: beforeRelock ? (prev?.lastRevenue ?? null) : c.revenueAfterInr,
      lastCost: beforeRelock ? (prev?.lastCost ?? null) : c.costAfterInr,
      present: beforeRelock ? (prev?.present ?? false) : label.present,
      label: beforeRelock ? (prev?.label ?? { ...label, present: false }) : label,
    });
  }
  return out;
}

/** What has already been carried forward for each record of one month. */
export interface CarriedSum {
  readonly lineKey: PnlSnapshotKey;
  readonly refKey: string;
  readonly revenue: Prisma.Decimal;
  readonly cost: Prisma.Decimal;
  readonly label: RowLabel;
}

/** Every carry-forward recorded against a month, summed per record. */
export function sumCarried(carryForwards: readonly StoredCarryForward[]): Map<string, CarriedSum> {
  const out = new Map<string, CarriedSum>();
  for (const c of carryForwards) {
    const k = rowKey(c.lineKey, c.refKey);
    const prev = out.get(k);
    out.set(k, {
      lineKey: c.lineKey as PnlSnapshotKey,
      refKey: c.refKey,
      revenue: (prev?.revenue ?? ZERO).add(c.revenueDeltaInr),
      cost: (prev?.cost ?? ZERO).add(c.costDeltaInr),
      label: readLabel(c.label, c.refKey),
    });
  }
  return out;
}

/**
 * THE RE-LOCK FORMULA, per record: new row = live − Σ carry-forwards
 * already recorded against the month.
 *
 * Carry-forward rows are append-only and stay counted in the months they
 * landed in; the re-locked month must not count them a second time. So
 * the new version holds only the part of today's figure that no later
 * month has already reported. A record that has left the month but was
 * carried forward keeps a row of minus what was carried, so the month and
 * its carry-forwards still net to the record's live figure (zero).
 */
export function rebaseRows(
  live: readonly LiveRow[],
  carried: ReadonlyMap<string, CarriedSum>,
): LiveRow[] {
  const minus = (a: Prisma.Decimal | null, c: Prisma.Decimal): Prisma.Decimal | null =>
    c.isZero() ? a : (a ?? ZERO).sub(c);
  const fig = (d: Prisma.Decimal | null): string | null => d?.toFixed(2) ?? null;
  const out: LiveRow[] = [];
  const seen = new Set<string>();
  for (const r of live) {
    const k = rowKey(r.lineKey, r.refKey);
    seen.add(k);
    const c = carried.get(k);
    out.push({
      ...r,
      revenue: c === undefined ? r.revenue : minus(r.revenue, c.revenue),
      cost: c === undefined ? r.cost : minus(r.cost, c.cost),
      label: { ...r.label, present: true, atLock: { revenue: fig(r.revenue), cost: fig(r.cost) } },
    });
  }
  for (const [k, c] of carried) {
    if (seen.has(k) || (c.revenue.isZero() && c.cost.isZero())) continue;
    out.push({
      lineKey: c.lineKey,
      refKey: c.refKey,
      revenue: c.revenue.isZero() ? null : c.revenue.negated(),
      cost: c.cost.isZero() ? null : c.cost.negated(),
      label: { ...c.label, present: false, atLock: { revenue: null, cost: null } },
    });
  }
  return out;
}

/** The carried sums, per line. */
export function carriedByLine(
  carried: ReadonlyMap<string, CarriedSum>,
): Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }> {
  const out = new Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }>();
  for (const c of carried.values()) {
    const s = out.get(c.lineKey) ?? { revenue: ZERO, cost: ZERO };
    out.set(c.lineKey, { revenue: s.revenue.add(c.revenue), cost: s.cost.add(c.cost) });
  }
  return out;
}

/**
 * The re-lock formula applied to a whole report: each line's revenue and
 * cost, operating expenses, gross and net, less what was already carried
 * forward — the figures that sit beside the rebased rows.
 */
export function subtractCarriedFromReport(
  report: PnlReport,
  byLine: ReadonlyMap<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal }>,
): PnlReport {
  const lines = report.lines.map((l) => {
    const c = byLine.get(l.key);
    if (c === undefined || (c.revenue.isZero() && c.cost.isZero())) return l;
    const revenue = new Prisma.Decimal(l.revenueInr).sub(c.revenue);
    const cost = new Prisma.Decimal(l.costInr).sub(c.cost);
    const margin = revenue.sub(cost);
    return {
      ...l,
      revenueInr: revenue.toFixed(2),
      costInr: cost.toFixed(2),
      marginInr: margin.toFixed(2),
      marginPercent: revenue.isZero() ? null : margin.div(revenue).mul(100).toFixed(1),
    };
  });
  const opexCarried = byLine.get('operating_expenses')?.cost ?? ZERO;
  const opex = new Prisma.Decimal(report.operatingExpensesInr).sub(opexCarried);
  const gross = lines.reduce((t, l) => t.add(l.marginInr), ZERO);
  const carriedNet = [...byLine.values()].reduce((t, c) => t.add(c.revenue).sub(c.cost), ZERO);
  return {
    ...report,
    lines,
    grossMarginInr: gross.toFixed(2),
    operatingExpensesInr: opex.toFixed(2),
    netInr: gross.sub(opex).toFixed(2),
    warnings: carriedNet.isZero()
      ? report.warnings
      : [
          ...report.warnings,
          `₹${carriedNet.toFixed(2)} net of this month's live figure had already been carried ` +
            'into later months, so it is left out of this version rather than counted twice.',
        ],
  };
}

/** Extra words about a record, from outside the diff (an order's status today). */
export type ReasonContext = ReadonlyMap<string, string>;

/**
 * Every record whose figure moved since it was last reported, with the
 * amount it moved by and why. Zero movement — including a figure going
 * from "not recorded" to ₹0.00 — carries nothing.
 */
export function diffMonth(
  baseline: ReadonlyMap<string, BaselineRow>,
  live: readonly LiveRow[],
  context: ReasonContext = new Map(),
): CarryForwardDraft[] {
  const liveByKey = new Map(live.map((r) => [rowKey(r.lineKey, r.refKey), r]));
  const keys = new Set([...baseline.keys(), ...liveByKey.keys()]);
  const out: CarryForwardDraft[] = [];
  for (const k of keys) {
    const base = baseline.get(k);
    const now = liveByKey.get(k);
    const lineKey = (now?.lineKey ?? base?.lineKey) as PnlSnapshotKey;
    const refKey = now?.refKey ?? base?.refKey ?? '';
    const revenueAfter = now?.revenue ?? null;
    const costAfter = now?.cost ?? null;
    const revenueDelta = (revenueAfter ?? ZERO).sub(base?.revenue ?? ZERO);
    const costDelta = (costAfter ?? ZERO).sub(base?.cost ?? ZERO);
    if (revenueDelta.isZero() && costDelta.isZero()) continue;
    const before = {
      present: base?.present ?? false,
      revenue: base?.lastRevenue ?? null,
      cost: base?.lastCost ?? null,
    };
    const after = { present: now !== undefined, revenue: revenueAfter, cost: costAfter };
    const label: RowLabel =
      now !== undefined
        ? { ...now.label, present: true }
        : { ...(base?.label ?? { ref: refKey, subRef: null, at: '' }), present: false };
    out.push({
      lineKey,
      refKey,
      revenueDelta,
      costDelta,
      revenueBefore: before.revenue,
      revenueAfter,
      costBefore: before.cost,
      costAfter,
      label,
      reason: explain(lineKey, before, after, label, context.get(k) ?? null),
    });
  }
  return out.sort((a, b) =>
    a.lineKey === b.lineKey ? a.refKey.localeCompare(b.refKey) : a.lineKey.localeCompare(b.lineKey),
  );
}

const inr = (d: Prisma.Decimal): string => `₹${d.toFixed(2)}`;

function costNoun(line: PnlSnapshotKey): string {
  switch (line) {
    case 'delivery':
    case 'rto':
    case 'courier_unmatched':
      return 'courier cost';
    case 'inbound_freight':
      return 'forwarder cost';
    case 'operating_expenses':
      return 'expense';
    default:
      return 'cost';
  }
}

function dated(label: RowLabel): string {
  return label.at === '' ? '' : ` dated ${istDateLabel(label.at)}`;
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

interface Side {
  readonly present: boolean;
  readonly revenue: Prisma.Decimal | null;
  readonly cost: Prisma.Decimal | null;
}

/** Why a record moved, in words somebody reading the P&L can check. */
export function explain(
  line: PnlSnapshotKey,
  before: Side,
  after: Side,
  label: RowLabel,
  extra: string | null,
): string {
  const tail = extra === null ? '' : ` — ${extra}`;
  if (!before.present && after.present) {
    switch (line) {
      case 'operating_expenses':
        return `Expense${dated(label)} recorded after the month closed${tail}`;
      case 'courier_adjustments':
        return (
          `Courier adjustment${dated(label)} arrived after the month closed` +
          ((after.cost ?? new Prisma.Decimal(0)).isNegative() ? ' (a credit)' : '') +
          tail
        );
      case 'courier_unmatched':
        return `Courier charge on waybill ${label.ref}${dated(label)} arrived after the month closed${tail}`;
      case 'delivery':
      case 'rto':
        return `Order ${label.ref} was not on ${LINE_NAMES[line]} when the month closed${tail}`;
      default:
        return `${LINE_NAMES[line]} entry${dated(label)} recorded after the month closed${tail}`;
    }
  }
  if (before.present && !after.present) {
    switch (line) {
      case 'delivery':
      case 'rto':
        return `Order ${label.ref} has left ${LINE_NAMES[line]} since the month closed${tail}`;
      case 'courier_adjustments':
      case 'courier_unmatched':
        return `No longer counted: the courier's export no longer carries it, or it now belongs to a live parcel${tail}`;
      default:
        return `No longer in the month: removed, or re-dated into another month, since it closed${tail}`;
    }
  }
  const parts: string[] = [];
  if (!(before.revenue ?? new Prisma.Decimal(0)).eq(after.revenue ?? new Prisma.Decimal(0))) {
    parts.push(
      before.revenue === null
        ? `revenue not counted at close → ${after.revenue === null ? 'not counted' : inr(after.revenue)}`
        : `revenue ${inr(before.revenue)} → ${after.revenue === null ? 'not counted' : inr(after.revenue)}`,
    );
  }
  if (!(before.cost ?? new Prisma.Decimal(0)).eq(after.cost ?? new Prisma.Decimal(0))) {
    const noun = costNoun(line);
    parts.push(
      before.cost === null
        ? `${noun} not recorded at close (uncovered) → ${after.cost === null ? 'not recorded' : inr(after.cost)}`
        : `${noun} ${inr(before.cost)} → ${after.cost === null ? 'not recorded' : inr(after.cost)}`,
    );
  }
  return capitalise(parts.join('; ')) + tail;
}
