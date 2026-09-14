import { Prisma } from '@skydrop/db';
import type { PnlSnapshotKey } from '../../treasury/services/pnl.service';
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

/**
 * A closed month's baseline: its snapshot, then every carry-forward in the
 * order written (ids are uuidv7, so ascending id is written order).
 */
export function buildBaseline(
  snapshot: readonly StoredSnapshotRow[],
  carryForwards: readonly StoredCarryForward[],
): Map<string, BaselineRow> {
  const out = new Map<string, BaselineRow>();
  for (const s of snapshot) {
    out.set(rowKey(s.lineKey, s.refKey), {
      lineKey: s.lineKey as PnlSnapshotKey,
      refKey: s.refKey,
      revenue: s.revenueInr ?? ZERO,
      cost: s.costInr ?? ZERO,
      lastRevenue: s.revenueInr,
      lastCost: s.costInr,
      present: true,
      label: readLabel(s.label, s.refKey),
    });
  }
  for (const c of carryForwards) {
    const k = rowKey(c.lineKey, c.refKey);
    const prev = out.get(k);
    out.set(k, {
      lineKey: c.lineKey as PnlSnapshotKey,
      refKey: c.refKey,
      revenue: (prev?.revenue ?? ZERO).add(c.revenueDeltaInr),
      cost: (prev?.cost ?? ZERO).add(c.costDeltaInr),
      lastRevenue: c.revenueAfterInr,
      lastCost: c.costAfterInr,
      present: readLabel(c.label, c.refKey).present,
      label: readLabel(c.label, c.refKey),
    });
  }
  return out;
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
