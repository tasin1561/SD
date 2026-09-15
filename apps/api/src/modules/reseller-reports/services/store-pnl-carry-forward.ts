import { Prisma } from '@skydrop/db';
import { istDateLabel } from '../../pnl-carry-forward/services/pnl-month';
import {
  STORE_PNL_LINES,
  STORE_PNL_LINE_KEYS,
  type StorePnlLineKey,
  type StorePnlReport,
} from './store-pnl-lines';

/**
 * The arithmetic of a STORE month's carry-forward (RS-8, PNL-CF-1's idea
 * for a reseller store), with no database in it.
 *
 * A closed month's baseline for one record is what has been reported for
 * it so far: its frozen snapshot row plus every carry-forward already
 * written for it. Detection compares that with the month recomputed now;
 * each difference is carried into the month open at the time. Because
 * the baseline includes earlier carry-forwards, running detection twice
 * adds nothing the second time.
 *
 * Simpler than the platform's (`pnl-carry-forward-diff.ts`) on purpose:
 * a store row has ONE amount in its line's own sense, and a store month is
 * never re-locked — a store's ledger does not wait on a nightly courier
 * job, so there is no provisional close to come back to.
 */

const ZERO = new Prisma.Decimal(0);

export interface StoreRowLabel {
  readonly ref: string;
  readonly subRef: string | null;
  readonly at: string;
}

export interface StoreSnapRow {
  readonly lineKey: StorePnlLineKey;
  readonly refKey: string;
  readonly amount: Prisma.Decimal;
  readonly label: StoreRowLabel;
}

export interface StoredSnapRow {
  readonly lineKey: string;
  readonly refKey: string;
  readonly amountInr: Prisma.Decimal;
  readonly label: unknown;
}

export interface StoredCarry {
  readonly lineKey: string;
  readonly refKey: string;
  readonly deltaInr: Prisma.Decimal;
  readonly amountAfterInr: Prisma.Decimal | null;
  readonly label: unknown;
}

export interface StoreBaseline {
  readonly lineKey: StorePnlLineKey;
  readonly refKey: string;
  /** Snapshot + every carry-forward. */
  readonly amount: Prisma.Decimal;
  /** The figure last reported (null once it had left the month). */
  readonly last: Prisma.Decimal | null;
  readonly present: boolean;
  readonly label: StoreRowLabel;
}

export interface StoreCarryDraft {
  readonly lineKey: StorePnlLineKey;
  readonly refKey: string;
  readonly before: Prisma.Decimal | null;
  readonly after: Prisma.Decimal | null;
  readonly delta: Prisma.Decimal;
  readonly label: StoreRowLabel;
  readonly reason: string;
}

export const storeRowKey = (lineKey: string, refKey: string): string => `${lineKey}|${refKey}`;

function isLineKey(s: string): s is StorePnlLineKey {
  return (STORE_PNL_LINE_KEYS as readonly string[]).includes(s);
}

export function readStoreLabel(raw: unknown, fallbackRef: string): StoreRowLabel {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    ref: typeof o['ref'] === 'string' ? o['ref'] : fallbackRef,
    subRef: typeof o['subRef'] === 'string' ? o['subRef'] : null,
    at: typeof o['at'] === 'string' ? o['at'] : '',
  };
}

/** Every drill-down row of a report, as the snapshot stores it. */
export function flattenReport(report: StorePnlReport): StoreSnapRow[] {
  return report.lines.flatMap((l) =>
    l.rows.map((r) => ({
      lineKey: l.key,
      refKey: r.id,
      amount: new Prisma.Decimal(r.amountInr),
      label: { ref: r.ref, subRef: r.subRef, at: r.at },
    })),
  );
}

/** A closed month's baseline: its rows, then every carry-forward in the order written. */
export function buildStoreBaseline(
  snapshot: readonly StoredSnapRow[],
  carries: readonly StoredCarry[],
): Map<string, StoreBaseline> {
  const out = new Map<string, StoreBaseline>();
  for (const s of snapshot) {
    if (!isLineKey(s.lineKey)) continue;
    out.set(storeRowKey(s.lineKey, s.refKey), {
      lineKey: s.lineKey,
      refKey: s.refKey,
      amount: s.amountInr,
      last: s.amountInr,
      present: true,
      label: readStoreLabel(s.label, s.refKey),
    });
  }
  for (const c of carries) {
    if (!isLineKey(c.lineKey)) continue;
    const k = storeRowKey(c.lineKey, c.refKey);
    const prev = out.get(k);
    out.set(k, {
      lineKey: c.lineKey,
      refKey: c.refKey,
      amount: (prev?.amount ?? ZERO).add(c.deltaInr),
      last: c.amountAfterInr,
      present: c.amountAfterInr !== null,
      label: readStoreLabel(c.label, c.refKey),
    });
  }
  return out;
}

const inr = (d: Prisma.Decimal): string => `₹${d.toFixed(2)}`;

function day(at: string): string {
  return at === '' ? '' : ` dated ${istDateLabel(at)}`;
}

/** Why a record moved, in words the store can check. */
export function explainStoreChange(
  line: StorePnlLineKey,
  before: { present: boolean; amount: Prisma.Decimal | null },
  after: { present: boolean; amount: Prisma.Decimal | null },
  label: StoreRowLabel,
): string {
  const name = STORE_PNL_LINES[line].label;
  if (!before.present && after.present) {
    return line === 'expenses'
      ? `Expense${day(label.at)} (${label.ref}) recorded after the month closed`
      : `${name}: ${label.subRef ?? 'entry'} on ${label.ref}${day(label.at)} arrived after the month closed`;
  }
  if (before.present && !after.present) {
    return line === 'expenses'
      ? `Expense${day(label.at)} (${label.ref}) removed, or re-dated out of the month, after it closed`
      : `${name}: ${label.ref} is no longer in the month since it closed`;
  }
  return `${name}: ${label.ref} ${before.amount === null ? '—' : inr(before.amount)} → ${
    after.amount === null ? '—' : inr(after.amount)
  }`;
}

/** Every record whose figure moved since it was last reported, with why. Zero movement carries nothing. */
export function diffStoreMonth(
  baseline: ReadonlyMap<string, StoreBaseline>,
  live: readonly StoreSnapRow[],
): StoreCarryDraft[] {
  const liveByKey = new Map(live.map((r) => [storeRowKey(r.lineKey, r.refKey), r]));
  const keys = new Set([...baseline.keys(), ...liveByKey.keys()]);
  const out: StoreCarryDraft[] = [];
  for (const k of keys) {
    const base = baseline.get(k);
    const now = liveByKey.get(k);
    const after = now?.amount ?? null;
    const delta = (after ?? ZERO).sub(base?.amount ?? ZERO);
    if (delta.isZero()) continue;
    const lineKey = (now?.lineKey ?? base?.lineKey) as StorePnlLineKey;
    const refKey = now?.refKey ?? base?.refKey ?? '';
    const label = now?.label ?? base?.label ?? { ref: refKey, subRef: null, at: '' };
    const before = base === undefined ? null : base.last;
    out.push({
      lineKey,
      refKey,
      before,
      after,
      delta,
      label,
      reason: explainStoreChange(
        lineKey,
        { present: base?.present ?? false, amount: before },
        { present: now !== undefined, amount: after },
        label,
      ),
    });
  }
  return out.sort((a, b) =>
    a.lineKey === b.lineKey ? a.refKey.localeCompare(b.refKey) : a.lineKey.localeCompare(b.lineKey),
  );
}
