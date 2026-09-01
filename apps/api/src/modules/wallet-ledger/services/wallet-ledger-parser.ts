import { readSheet, XlsxError } from '../../../common/xlsx/xlsx-reader';

/** What a courier actually charged for one parcel leg. */
export interface LedgerCharge {
  readonly awbNumber: string;
  readonly amountInr: string;
  /** The courier's own transaction id — our evidence, kept on the audit row. */
  readonly txnId: string;
  readonly chargedAt: Date;
  /** Their shipment status ON THE ROW, which is what decides the leg. */
  readonly shipmentStatus: string;
  /** True when this row is the RETURN leg rather than the delivery. */
  readonly isRto: boolean;
}

export interface ParsedLedger {
  /** The LATEST successful debit per AWB per leg. See `latestPerAwb`. */
  readonly forward: ReadonlyMap<string, LedgerCharge>;
  readonly rto: ReadonlyMap<string, LedgerCharge>;
  /** Everything parsed, for the totals check and for reporting. */
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  /** Summed debits, and what the file itself says the total should be. */
  readonly sumInr: string;
  readonly statedTotalInr: string | null;
  readonly periodFrom: Date | null;
  readonly periodTo: Date | null;
}

export class LedgerFormatError extends Error {}

const SHEET_DEBITS = 'AWB Deductions';
const SHEET_SUMMARY = 'Summary';

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
} as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
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
export function parseWalletLedger(file: Buffer): ParsedLedger {
  let rows: string[][];
  try {
    rows = readSheet(file, SHEET_DEBITS);
  } catch (err) {
    if (err instanceof XlsxError) {
      throw new LedgerFormatError(
        `This does not look like a Delhivery wallet export: ${err.message}`,
      );
    }
    throw err;
  }

  const header = rows[0];
  if (header === undefined) throw new LedgerFormatError('The deductions sheet is empty.');
  const at = new Map<string, number>();
  header.forEach((h, i) => at.set(norm(h), i));
  for (const label of Object.values(COLUMNS)) {
    if (!at.has(label)) {
      throw new LedgerFormatError(
        `The deductions sheet has no "${label}" column — it has: ${header.join(', ')}`,
      );
    }
  }
  const col = (r: string[], k: keyof typeof COLUMNS): string => r[at.get(COLUMNS[k]) ?? -1] ?? '';

  const forward = new Map<string, LedgerCharge>();
  const rto = new Map<string, LedgerCharge>();
  let sum = 0;
  let read = 0;
  let skipped = 0;
  let from: Date | null = null;
  let to: Date | null = null;

  for (const row of rows.slice(1)) {
    if (row.length === 0) continue;
    const awbNumber = col(row, 'awb').trim();
    const amountInr = money(col(row, 'amount'));
    const chargedAt = parseIst(col(row, 'chargedAt'));
    // Only successful debits are money that left. A failed or pending
    // row is not a charge, and a credit belongs to the refund sheet.
    const isDebit = norm(col(row, 'type')) === 'debit';
    const isSuccess = norm(col(row, 'status')) === 'success';

    if (awbNumber === '' || amountInr === null || chargedAt === null || !isDebit || !isSuccess) {
      skipped += 1;
      continue;
    }
    read += 1;
    sum += Number(amountInr);
    if (from === null || chargedAt < from) from = chargedAt;
    if (to === null || chargedAt > to) to = chargedAt;

    const shipmentStatus = col(row, 'shipmentStatus').trim();
    const isRto = norm(shipmentStatus) === 'rto';
    const charge: LedgerCharge = {
      awbNumber,
      amountInr,
      txnId: col(row, 'txnId').trim(),
      chargedAt,
      shipmentStatus,
      isRto,
    };
    const bucket = isRto ? rto : forward;
    const held = bucket.get(awbNumber);
    // Strictly later wins. Equal timestamps keep the FIRST seen rather
    // than flip-flopping between runs on a tie — the export is ordered
    // newest-first, so the first of a tie is the newest.
    if (held === undefined || charge.chargedAt > held.chargedAt) bucket.set(awbNumber, charge);
  }

  let stated: string | null = null;
  try {
    for (const r of readSheet(file, SHEET_SUMMARY)) {
      if (norm(r[0] ?? '') === 'total deductions') stated = money(r[1] ?? '');
    }
  } catch {
    // A workbook without a Summary sheet is still importable; it just
    // cannot check itself, and the caller is told so.
    stated = null;
  }

  return {
    forward,
    rto,
    rowsRead: read,
    rowsSkipped: skipped,
    sumInr: sum.toFixed(2),
    statedTotalInr: stated,
    periodFrom: from,
    periodTo: to,
  };
}
