import { readSheet, XlsxError } from '../../../common/xlsx/xlsx-reader';

/** ONE line of their ledger, as they stated it. */
export interface LedgerTxn {
  /** Their id — the identity every later decision rests on. */
  readonly txnId: string;
  /** Absent only on a ledger-level entry that names no parcel. */
  readonly awbNumber: string | null;
  /**
   * The courier's own order id, where it keeps one apart from the waybill
   * (Shiprocket). Survives the waybill being reassigned, so it is what
   * ties a charge to its parcel when the two disagree.
   */
  readonly courierOrderRef?: string | null;
  readonly kind: 'DEBIT' | 'CREDIT';
  readonly category: 'PARCEL' | 'ADJUSTMENT';
  readonly leg: 'FORWARD' | 'RTO';
  readonly amountInr: string;
  readonly occurredAt: Date;
  /** Their word, verbatim. Only `success` is money. */
  readonly status: string;
  readonly shipmentStatus: string;
  /** Their Description blob, parsed when it is JSON. The evidence. */
  readonly detail: Record<string, unknown> | null;
}

/** What the file says about itself. The identity below is what makes a
 *  truncated or edited export detectable. */
export interface LedgerSummary {
  readonly totalDeductionsInr: string | null;
  readonly totalRefundsInr: string | null;
  readonly totalRechargesInr: string | null;
  readonly openingBalanceInr: string | null;
}

export interface ParsedLedger {
  /** EVERY successful transaction, both directions. */
  readonly txns: readonly LedgerTxn[];
  readonly summary: LedgerSummary;
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  /** Σ successful CREDITS — checked against the Summary's refunds total,
   *  as `sumInr` is against its deductions total. */
  readonly refundsInr: string;
  readonly statedRefundsInr: string | null;
  /** Net of the parsed rows: debits minus credits. */
  readonly netInr: string;
  /** Debits only — what the page's window "Total Debit" should equal. */
  readonly sumInr: string;
  readonly statedTotalInr: string | null;
  readonly periodFrom: Date | null;
  readonly periodTo: Date | null;
}

export class LedgerFormatError extends Error {}

/*
  `Deductions` and `Refunds`, NOT the `AWB …` variants beside them.

  Their export carries both, and the AWB-prefixed sheets are the same
  rows minus anything that names no parcel: on the 90-day sample
  `Refunds` had 6,307 rows and `AWB Refunds` 6,306, the missing one
  being a ₹1,290 lost-shipment credit note. Reading the narrower sheet
  silently drops exactly the ledger-level entries that must not be
  dropped, and leaves the file unable to reconcile against its own
  stated totals.
*/
const SHEET_DEBITS = 'Deductions';
const SHEET_CREDITS = 'Refunds';
const SHEET_SUMMARY = 'Summary';

/**
 * Their parcel vocabulary. Anything else in the shipment-status column
 * is a ledger-level entry rather than carriage for a box.
 *
 * Used only as a CROSS-CHECK: the real marker is `stage`/`code` in the
 * description (see `classify`). On 23,276 rows the two agreed exactly,
 * which is why both are kept — one of them noticing something the other
 * does not is a signal worth having.
 */
const PARCEL_STATUSES = new Set([
  'manifested',
  'in transit',
  'delivered',
  'rto',
  'not picked',
  'pending',
  'lost',
  'open',
  'canceled',
  'cancelled',
  'dto',
  '',
]);

/** Header labels, matched case- and space-insensitively so a cosmetic
 *  change in their export does not break the import silently. */
const COLUMNS = {
  chargedAt: 'date & time',
  amount: 'miles',
  awb: 'awb',
  txnId: 'txn id',
  type: 'type',
  status: 'status',
  shipmentStatus: 'shipment status',
  description: 'description',
} as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Which leg a row's charge belongs to, from the parcel's status on it.
 *
 * `RTO` (turned round, on its way back) and `DTO` (delivered back to
 * the origin — the same return, finished) are both the RETURN. DTO used
 * to be left on the forward leg "rather than guessed", which left a
 * parcel whose return had completed with no return-leg row at all: once
 * it was received back, the returns line counted it as UNCOVERED for
 * good, because a return is measured only once its return cost exists.
 * Matched exactly, never by substring — a wrong leg moves money between
 * two P&L lines that exist precisely to be told apart.
 */
export function legFor(shipmentStatus: string): 'RTO' | 'FORWARD' {
  const s = norm(shipmentStatus);
  return s === 'rto' || s === 'dto' ? 'RTO' : 'FORWARD';
}

/**
 * Delhivery writes `2026-09-01 09:15:42` with no zone. Their panel is
 * IST, so that is what it means — reading it as UTC would date every
 * charge five and a half hours early and put some on the wrong day.
 */
function parseIst(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (m === null) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A money string we are willing to store. Rejects anything that is not
 *  a plain number, rather than letting NaN reach a Decimal column. */
function money(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

/**
 * Read a Delhivery wallet export into "what each parcel actually cost".
 *
 * ── WHY THE LATEST DEBIT, NOT THE SUM ────────────────────────────────
 * Generating an AWB debits their wallet straight away. Every later
 * correction — a weight recheck, a zone change, an RTO — REFUNDS the
 * previous debit and charges the real figure again, and that can happen
 * weeks after delivery. So a parcel's cost is its most recent debit.
 *
 * Netting debits against refunds is not merely harder, it is WRONG on
 * any window boundary: in the file this was written against, AWB
 * 38061110512621 has two debits (86.83, then 85.65) and two refunds
 * (75.95, 86.83). The 75.95 refunds a charge raised BEFORE the window,
 * whose debit is therefore absent — netting gives ₹9.70 for a parcel
 * that cost ₹85.65.
 *
 * ── WHY THE LEG COMES FROM THE ROW ───────────────────────────────────
 * An RTO is charged IN ADDITION to the delivery, not instead of it —
 * six AWBs in that same file carry both. Their `Shipment status` column
 * is what says which leg a row is, and the two go to different columns
 * because Delhivery bills them separately and folding them would charge
 * the same carriage twice.
 *
 * ── WHAT IS DELIBERATELY NOT TRUSTED ─────────────────────────────────
 * The `Description` JSON carries an `rs` field that looks like the
 * charge and is not: on RTO rows it holds 1600, 1000, 1700 — COD values.
 * Reading it would have imported costs twenty times too high on exactly
 * the parcels that already lost money. The `Miles` column is the amount.
 */
/**
 * Which bucket a row belongs in.
 *
 * A monthly reconciliation, a lost-shipment settlement or a fraud credit
 * note is an ACCOUNT-level cost, not the price of moving one box — and
 * 36 of the 37 on the 90-day sample carried an AWB, so "has a waybill"
 * is not the test. Folding a fraud credit note into a parcel would
 * quietly make that parcel look profitable.
 *
 * Their own marker is the test: an adjustment carries `stage` or `code`
 * in the description, which no carriage row does. The status column is
 * checked too and the two agreed on every one of 23,276 rows; when they
 * ever disagree, the row is treated as an ADJUSTMENT, because a
 * misfiled adjustment is visible on its own report line while a
 * misfiled parcel cost silently moves a margin.
 */
function classify(
  shipmentStatus: string,
  detail: Record<string, unknown> | null,
): 'PARCEL' | 'ADJUSTMENT' {
  const marked = detail !== null && ('stage' in detail || 'code' in detail);
  const unknownStatus = !PARCEL_STATUSES.has(norm(shipmentStatus));
  return marked || unknownStatus ? 'ADJUSTMENT' : 'PARCEL';
}

/** Their Description column is JSON on every row that has one. A row
 *  that is not parseable keeps null rather than failing the import —
 *  the money is in the Miles column, not in here. */
function parseDetail(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  if (t === '' || !t.startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(t);
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readTxnSheet(
  file: Buffer,
  sheet: string,
  kind: 'DEBIT' | 'CREDIT',
  out: LedgerTxn[],
  counters: { read: number; skipped: number; from: Date | null; to: Date | null },
): void {
  let rows: string[][];
  try {
    rows = readSheet(file, sheet);
  } catch (err) {
    if (err instanceof XlsxError) {
      throw new LedgerFormatError(
        `This does not look like a Delhivery wallet export: ${err.message}`,
      );
    }
    throw err;
  }

  const header = rows[0];
  if (header === undefined) throw new LedgerFormatError(`The ${sheet} sheet is empty.`);
  const at = new Map<string, number>();
  header.forEach((h, i) => at.set(norm(h), i));
  for (const label of Object.values(COLUMNS)) {
    if (!at.has(label)) {
      throw new LedgerFormatError(
        `The ${sheet} sheet has no "${label}" column — it has: ${header.join(', ')}`,
      );
    }
  }
  const col = (r: string[], k: keyof typeof COLUMNS): string => r[at.get(COLUMNS[k]) ?? -1] ?? '';

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined || row.every((c) => c.trim() === '')) continue;
    const amountInr = money(col(row, 'amount'));
    const occurredAt = parseIst(col(row, 'chargedAt'));
    const txnId = col(row, 'txnId').trim();
    const status = col(row, 'status').trim();

    // The DIRECTION is taken from the row, not from which sheet it was
    // in. They agree today; if they ever stop, the file contradicts
    // itself and is refused below.
    const stated = norm(col(row, 'type'));
    const rowKind: 'DEBIT' | 'CREDIT' | null =
      stated === 'debit' ? 'DEBIT' : stated === 'credit' ? 'CREDIT' : null;

    // Only `success` is money. A failed or pending line is a row about
    // something that did not happen, and skipping it loses nothing.
    if (norm(status) !== 'success') {
      counters.skipped += 1;
      continue;
    }

    /*
      A SUCCESSFUL ROW WE CANNOT READ IS REFUSED, NEVER SKIPPED.

      It used to be counted as "skipped" and the import carried on — so a
      real charge or credit with a blank id or an unreadable date simply
      went missing, and the only trace was a number nobody reads. Money
      that moved must either be recorded or stop the import; there is no
      third option that is honest.
    */
    if (
      amountInr === null ||
      occurredAt === null ||
      txnId === '' ||
      rowKind === null ||
      rowKind !== kind
    ) {
      throw new LedgerFormatError(
        `Row ${i + 1} of the ${sheet} sheet is marked successful but ${
          amountInr === null
            ? 'has no readable amount'
            : occurredAt === null
              ? 'has no readable date'
              : txnId === ''
                ? 'has no transaction id'
                : rowKind === null
                  ? 'is neither a debit nor a credit'
                  : `is a ${rowKind.toLowerCase()} filed under ${sheet}`
        }. Skipping it would drop real money without a trace, so the file is refused — ` +
          're-download the export.',
      );
    }

    counters.read += 1;
    if (counters.from === null || occurredAt < counters.from) counters.from = occurredAt;
    if (counters.to === null || occurredAt > counters.to) counters.to = occurredAt;

    const awbRaw = col(row, 'awb').trim();
    const shipmentStatus = col(row, 'shipmentStatus').trim();
    const detail = parseDetail(col(row, 'description'));

    out.push({
      txnId,
      awbNumber: awbRaw === '' ? null : awbRaw,
      kind: rowKind,
      category: classify(shipmentStatus, detail),
      leg: legFor(shipmentStatus),
      amountInr,
      occurredAt,
      status,
      shipmentStatus,
      detail,
    });
  }
}

/**
 * EVERY successful transaction in the export, both directions.
 *
 * It used to return the latest debit per AWB, which is wrong whenever a
 * charge is reversed or re-cut — see the model comment on
 * `CourierWalletTransaction` for the measured damage. The caller nets
 * them per parcel.
 */
export function parseWalletLedger(file: Buffer): ParsedLedger {
  const txns: LedgerTxn[] = [];
  const counters = { read: 0, skipped: 0, from: null as Date | null, to: null as Date | null };

  readTxnSheet(file, SHEET_DEBITS, 'DEBIT', txns, counters);
  try {
    readTxnSheet(file, SHEET_CREDITS, 'CREDIT', txns, counters);
  } catch (err) {
    // An export with no refunds sheet is older or narrower, not broken.
    // Debits alone still import; the identity check below then cannot
    // balance and says so, which is the honest outcome.
    if (!(err instanceof LedgerFormatError)) throw err;
  }

  /*
    THE SAME TXN ID TWICE IN ONE FILE.

    Their id is the identity the import rests on, so a duplicate inside
    a single export means the file cannot be trusted to describe itself
    — and silently keeping one of the two would change a parcel's cost
    by whichever copy won. Refused outright.
  */
  const seen = new Set<string>();
  for (const t of txns) {
    if (seen.has(t.txnId)) {
      throw new LedgerFormatError(
        `Transaction ${t.txnId} appears more than once in this export — the file contradicts itself.`,
      );
    }
    seen.add(t.txnId);
  }

  let debits = 0;
  let credits = 0;
  for (const t of txns) {
    if (t.kind === 'DEBIT') debits += Number(t.amountInr);
    else credits += Number(t.amountInr);
  }

  const summary: LedgerSummary = {
    totalDeductionsInr: null,
    totalRefundsInr: null,
    totalRechargesInr: null,
    openingBalanceInr: null,
  };
  const mutable = summary as { -readonly [K in keyof LedgerSummary]: LedgerSummary[K] };
  try {
    for (const r of readSheet(file, SHEET_SUMMARY)) {
      const key = norm(r[0] ?? '');
      const val = money(r[1] ?? '');
      if (key === 'total deductions') mutable.totalDeductionsInr = val;
      else if (key === 'total refunds') mutable.totalRefundsInr = val;
      else if (key === 'total recharges') mutable.totalRechargesInr = val;
      else if (key === 'opening balance') mutable.openingBalanceInr = val;
    }
  } catch {
    // A workbook without a Summary sheet is still importable; it just
    // cannot check itself, and the caller is told so.
  }

  return {
    txns,
    summary,
    rowsRead: counters.read,
    rowsSkipped: counters.skipped,
    netInr: (debits - credits).toFixed(2),
    sumInr: debits.toFixed(2),
    statedTotalInr: summary.totalDeductionsInr,
    refundsInr: credits.toFixed(2),
    statedRefundsInr: summary.totalRefundsInr,
    periodFrom: counters.from,
    periodTo: counters.to,
  };
}
