import Papa from 'papaparse';
import type { ParsedListRow } from './delhivery-billing-probe-files';
import { decimalToPaise, istDay, parseIstDateTime } from './shiprocket-invoice-rows';
import { paiseToInr } from './shiprocket-wallet-rows';

/**
 * Delhivery's invoices, checked against what their wallet actually took.
 *
 * Pure: no browser, no database. The page reads the invoice list, the
 * Credit / Debit Notes lists and each invoice's "Invoice Transaction list";
 * everything that decides what they MEAN, and whether they agree with OUR
 * stored ledger (`courier_wallet_transactions`), lives here.
 *
 * ── WHAT THEIR BILLING IS, SEEN 12 SEP 2026 (probe run 0b1a28e1) ──────
 * Two invoices per half-month (the 15th and the last day):
 *   Domestic (EPH…) — carriage. Itemized one line per WAYBILL: its status
 *     (Delivered / RTO / DTO), every charge head, `gross_amount` (pre-tax)
 *     and `total_amount` (with GST). A parcel is billed in the half-month
 *     its journey CLOSED, not the one it was charged in.
 *   Communication VAS (EPVASH…) — WhatsApp messages. Itemized one line
 *     per MESSAGE, at ₹1.00 / 1.50 / 2.00 + 18%. Their wallet takes it as
 *     ONE lump debit naming the invoice in `serial_number`.
 * Credit notes (CD…) are lost-shipment claims, paid into the wallet as
 * "Claim settled - CMS" credits; debit notes (DN…) are rarer.
 * The list's INVOICE AMOUNT is the tax-inclusive total.
 *
 * ── WHAT EPH26281228 (31 Aug, ₹1,35,494.28, 1,975 lines) MEASURED ────
 *   · Σ gross_amount = ₹1,14,825.66 exactly, and × 1.18 = the invoice;
 *     Σ total_amount = ₹1,35,495.10 — GST is rounded per line in the file
 *     and once on the invoice. So the file is judged on its gross, with
 *     the line totals allowed a paisa a line.
 *   · Per waybill, the line's total against the NET of EVERY stored ledger
 *     transaction naming that waybill, all time: 1,956 of 1,975 agreed
 *     within ₹0.05. Only the transactions dated inside the invoice period:
 *     1,079 — never window the ledger by the invoice.
 *   · The next 18 were each exactly ₹1.18, and were Delhivery's monthly
 *     reconciliation: an adjustment pair ("Freight adjustment debit",
 *     72.28 / 71.10) on the waybill after the invoice had billed the
 *     reconciled 72.28. So adjustment rows naming the waybill COUNT.
 *   · The last one was real: 38061110487620, billed ₹79.49 as RTO, while
 *     the wallet charged 72.28 and 79.49 and REFUNDED both when it was
 *     lost (net ₹0 — then paid a ₹1,499 claim for the goods).
 *   · A claim payout is the value of lost goods, not carriage: it is left
 *     out of a waybill's net, or every lost parcel would read as billed
 *     ₹1,499 too little.
 *
 * ── HOW IT STAYS QUIET WHEN NOTHING IS WRONG ────────────────────────
 *   · judge only what the ledger saw from the start — a waybill booked
 *     before the first stored movement is counted, not flagged;
 *   · a waybill charged and on no invoice is uninvoiced only once TWO
 *     later Domestic invoices have passed it by (609 charged 16–31 Aug
 *     were not on the 31 Aug invoice; they close later) — the rule the
 *     Shiprocket check uses for VAS;
 *   · a VAS invoice's lump, a credit note's claims and a debit note's
 *     debits are given a few days to post before their absence is news.
 *
 * It changes no cost and writes nothing on Delhivery's side.
 */

export class DelhiveryInvoiceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelhiveryInvoiceFormatError';
  }
}

/** Their menu option for the itemized file ("Invoice Transaction list"). */
/**
 * The Download menu's item that gives the itemized CSV. Their menu reads
 * "Invoice" (the PDF) and "Transaction list" (the CSV); an "Invoice
 * Transaction list" is the BOX holding both, its text the two run
 * together. This asked for the box until 13 Sep 2026, so the click landed
 * wherever the box's middle was — the CSV on 31 Aug, nothing on 15 Aug.
 */
export const DLV_ITEMIZED_OPTION = /^transaction\s+list$/i;
/** A waybill's billed and charged figures agree within this (paise). */
export const DLV_MATCH_TOLERANCE_PAISE = 5;
/** A note is matched to wallet movements posted this many days either side of it. */
export const DLV_NOTE_WINDOW_DAYS = 3;
/** A claim credit with no credit note is worth asking about after this long. */
export const DLV_CLAIM_NOTE_GRACE_DAYS = 15;
/** A VAS invoice's lump debit, or a note's movements, may post this long after it. */
export const DLV_POSTING_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const LIST_CAP = 50;
/** Subset search over a note's candidate movements stays small by construction. */
const SUBSET_CAP = 16;

export type DlvInvoiceKind = 'DOMESTIC' | 'VAS' | 'OTHER';

/** Their SERVICE TYPE, as the check treats it. */
export function invoiceKindOf(serviceType: string): DlvInvoiceKind {
  if (/domestic/i.test(serviceType)) return 'DOMESTIC';
  if (/\bvas\b|communication/i.test(serviceType)) return 'VAS';
  return 'OTHER';
}

/** "2026-08-31" (their list, read day-first) → midnight IST that day. */
export function istMidnight(yyyyMmDd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (m === null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_OFFSET_MS);
}

/** Days since the epoch, counted in IST. */
const istDayNumber = (d: Date): number => Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);

export interface DlvInvoice {
  readonly invoiceId: string;
  readonly serviceType: string;
  readonly kind: DlvInvoiceKind;
  /** Midnight IST on the invoice date. */
  readonly invoiceDate: Date;
  /** Tax-inclusive, as their list states it. */
  readonly totalPaise: number;
}

export interface DlvNote {
  readonly noteId: string;
  /** Midnight IST on the issue date. */
  readonly issuedAt: Date;
  /** Always positive: their list prints a credit note as "-₹1,350". */
  readonly amountPaise: number;
}

/** The invoice list's rows, as invoices; a row that cannot be read is named. */
export function invoicesFromList(rows: readonly ParsedListRow[]): {
  invoices: DlvInvoice[];
  unreadable: string[];
} {
  const invoices: DlvInvoice[] = [];
  const unreadable: string[] = [];
  for (const r of rows) {
    const id = r.invoiceId ?? r.key;
    const date = r.date === null ? null : istMidnight(r.date);
    const paise = r.amountInr === null ? null : decimalToPaise(r.amountInr);
    if (id === '' || date === null || paise === null) {
      unreadable.push(`${id || '(no id)'}: ${JSON.stringify(r.cells).slice(0, 160)}`);
      continue;
    }
    const serviceType = (r.serviceType ?? '').trim();
    invoices.push({
      invoiceId: id,
      serviceType,
      kind: invoiceKindOf(serviceType),
      invoiceDate: date,
      totalPaise: paise,
    });
  }
  return { invoices, unreadable };
}

/** A notes tab's rows, as notes; a row that cannot be read is named. */
export function notesFromList(rows: readonly ParsedListRow[]): {
  notes: DlvNote[];
  unreadable: string[];
} {
  const notes: DlvNote[] = [];
  const unreadable: string[] = [];
  for (const r of rows) {
    const id = r.invoiceId ?? r.key;
    const date = r.date === null ? null : istMidnight(r.date);
    const paise = r.amountInr === null ? null : decimalToPaise(r.amountInr);
    if (id === '' || date === null || paise === null) {
      unreadable.push(`${id || '(no id)'}: ${JSON.stringify(r.cells).slice(0, 160)}`);
      continue;
    }
    notes.push({ noteId: id, issuedAt: date, amountPaise: Math.abs(paise) });
  }
  return { notes, unreadable };
}

/**
 * Where a notes list begins, from its date-range control: "Last 90 Days",
 * or "13 Aug 2026 to 12 Sept 2026". Null when it cannot be told — and
 * then no claim is called note-less, because the list may simply not
 * reach back to it.
 */
export function notesCoverageFrom(label: string | null, now: Date): Date | null {
  if (label === null) return null;
  const last = /last\s+(\d+)\s*days?/i.exec(label);
  if (last !== null) return new Date(now.getTime() - Number(last[1]) * DAY_MS);
  const MONTHS = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const found: number[] = [];
  for (const x of label.matchAll(/\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})\b/g)) {
    const m = MONTHS.indexOf((x[2] ?? '').slice(0, 3).toLowerCase());
    if (m >= 0) found.push(Date.UTC(Number(x[3]), m, Number(x[1])) - IST_OFFSET_MS);
  }
  return found.length === 0 ? null : new Date(Math.min(...found));
}

// ── The itemized files ───────────────────────────────────────────────

export interface DomesticLine {
  readonly awb: string;
  /** Delivered / RTO / DTO. */
  readonly status: string;
  readonly pickupAt: Date | null;
  readonly grossPaise: number;
  readonly totalPaise: number;
}

export interface VasLine {
  readonly awb: string;
  readonly grossPaise: number;
  readonly totalPaise: number;
}

export type DlvItemized =
  | {
      readonly kind: 'DOMESTIC';
      /** The invoice id each line names (`serial_number`) — one, if the file is the invoice's. */
      readonly serials: readonly string[];
      readonly lines: readonly DomesticLine[];
      readonly grossPaise: number;
      readonly totalPaise: number;
    }
  | {
      readonly kind: 'VAS';
      readonly serials: readonly string[];
      readonly lines: readonly VasLine[];
      readonly grossPaise: number;
      readonly totalPaise: number;
    };

/**
 * `"=""38061110509316"""` in their CSV — Excel's text-forcing formula —
 * arrives as `="38061110509316"` once the CSV quoting is undone. The
 * value is what is inside.
 */
export function unwrapExcel(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  const m = /^="(.*)"$/s.exec(s);
  return (m?.[1] ?? s).trim();
}

const DOMESTIC_COLUMNS = ['waybill_num', 'serial_number', 'gross_amount', 'total_amount'];
const VAS_COLUMNS = ['message_id', 'waybill_order_id', 'serial_number', 'gross_amt', 'total_amt'];

function money(where: string, raw: string | undefined): number {
  const p = decimalToPaise(unwrapExcel(raw));
  if (p === null) {
    throw new DelhiveryInvoiceFormatError(`${where} has no readable amount ("${raw ?? ''}")`);
  }
  return p;
}

/**
 * An "Invoice Transaction list" download, recognised by its COLUMNS: a
 * Domestic one (one line per waybill) or a Communication VAS one (one line
 * per message). Refuses anything else, including the invoice PDF — a
 * checker handed the wrong file must say so, not compare it.
 */
export function parseDlvItemized(file: Buffer): DlvItemized {
  // A leading byte-order mark (U+FEFF) is dropped — by char code, so no
  // invisible character sits in this source.
  const raw = file.toString('utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (/^\s*%PDF|^\s*</.test(text)) {
    throw new DelhiveryInvoiceFormatError(
      'the download is a document, not the invoice transaction list',
    );
  }
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length > 0) {
    const e = parsed.errors[0];
    throw new DelhiveryInvoiceFormatError(
      `row ${e?.row ?? '?'} could not be read (${e?.message ?? 'unknown'})`,
    );
  }
  const fields = (parsed.meta.fields ?? []).map((f) => f.trim());
  const has = (cols: readonly string[]): boolean => cols.every((c) => fields.includes(c));
  const serials = (): string[] => [
    ...new Set(parsed.data.map((r) => unwrapExcel(r['serial_number'])).filter((s) => s !== '')),
  ];

  if (has(DOMESTIC_COLUMNS)) {
    const lines: DomesticLine[] = parsed.data.map((r, i) => {
      const awb = unwrapExcel(r['waybill_num']);
      if (awb === '') throw new DelhiveryInvoiceFormatError(`line ${i + 1} names no waybill`);
      return {
        awb,
        status: unwrapExcel(r['status']),
        pickupAt: parseIstDateTime(unwrapExcel(r['pickup_date'])),
        grossPaise: money(`line ${i + 1} (${awb}) gross_amount`, r['gross_amount']),
        totalPaise: money(`line ${i + 1} (${awb}) total_amount`, r['total_amount']),
      };
    });
    return {
      kind: 'DOMESTIC',
      serials: serials(),
      lines,
      grossPaise: lines.reduce((s, l) => s + l.grossPaise, 0),
      totalPaise: lines.reduce((s, l) => s + l.totalPaise, 0),
    };
  }
  if (has(VAS_COLUMNS)) {
    const lines: VasLine[] = parsed.data.map((r, i) => ({
      awb: unwrapExcel(r['waybill_order_id']),
      grossPaise: money(`message ${i + 1} gross_amt`, r['gross_amt']),
      totalPaise: money(`message ${i + 1} total_amt`, r['total_amt']),
    }));
    return {
      kind: 'VAS',
      serials: serials(),
      lines,
      grossPaise: lines.reduce((s, l) => s + l.grossPaise, 0),
      totalPaise: lines.reduce((s, l) => s + l.totalPaise, 0),
    };
  }
  throw new DelhiveryInvoiceFormatError(
    `not an invoice transaction list we know — columns ${fields.slice(0, 12).join(' | ')}`,
  );
}

// ── The wallet side ──────────────────────────────────────────────────

/** One stored ledger transaction, as the check needs it. */
export interface DlvLedgerTxn {
  readonly txnId: string;
  readonly awb: string | null;
  readonly kind: 'DEBIT' | 'CREDIT';
  readonly category: 'PARCEL' | 'ADJUSTMENT';
  readonly amountPaise: number;
  readonly occurredAt: Date;
  /** Their Description blob. Only read on ADJUSTMENT rows. */
  readonly detail: Record<string, unknown> | null;
}

/**
 * A lost-shipment claim payout ("Claim settled - CMS") — the VALUE of lost
 * goods paid into the wallet. Identified by what it SAYS, never by its
 * amount: an amount-based rule would one day swallow a real charge.
 */
export function isClaimSettlement(t: Pick<DlvLedgerTxn, 'category' | 'detail'>): boolean {
  if (t.category !== 'ADJUSTMENT' || t.detail === null) return false;
  return ['notes', 'remarks'].some((k) => {
    const v = t.detail?.[k];
    return typeof v === 'string' && /claim\s*settled/i.test(v);
  });
}

/** The invoice a Communication VAS lump debit names (`serial_number`), or null. */
export function vasLumpInvoice(t: Pick<DlvLedgerTxn, 'category' | 'detail'>): string | null {
  if (t.category !== 'ADJUSTMENT' || t.detail === null) return null;
  const v = t.detail['serial_number'];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ── The comparison ───────────────────────────────────────────────────

export interface DlvInvoiceRead {
  readonly invoice: DlvInvoice;
  /** Null when the invoice type has no itemized file we check, or it could not be had. */
  readonly itemized: DlvItemized | null;
  /** Why an itemized invoice could not be read, in words. */
  readonly problem: string | null;
}

export interface DlvCheckInput {
  readonly invoices: readonly DlvInvoiceRead[];
  /** Null when the tab could not be read — nothing about notes is judged then. */
  readonly creditNotes: readonly DlvNote[] | null;
  readonly debitNotes: readonly DlvNote[] | null;
  /** Where the notes lists begin; claims older than this are not called note-less. */
  readonly notesFrom: Date | null;
  readonly txns: readonly DlvLedgerTxn[];
  /** The ledger's first stored movement: nothing booked before it can be judged. */
  readonly ledgerStart: Date | null;
  readonly now: Date;
  /** Days after the invoice date a discrepancy can still be raised (our assumption). */
  readonly disputeDays: number;
}

export interface DlvWaybillDifference {
  readonly awb: string;
  readonly status: string;
  readonly billedInr: string;
  readonly walletInr: string;
}

export type DlvInvoiceStatus = 'MATCHES' | 'DIFFERS' | 'NOT_ITEMIZED' | 'UNREADABLE';

export interface DlvInvoiceCheckRow {
  readonly invoiceId: string;
  readonly serviceType: string;
  readonly kind: DlvInvoiceKind;
  /** YYYY-MM-DD, IST. */
  readonly invoiceDate: string;
  readonly totalInr: string;
  /** Σ pre-tax amounts in the itemized file. */
  readonly grossInr: string | null;
  /** Σ line totals in the itemized file (GST rounded per line). */
  readonly linesTotalInr: string | null;
  readonly lines: number;
  /** Does the itemized file add up to the invoice? Null when not itemized. */
  readonly totalsAgree: boolean | null;
  readonly status: DlvInvoiceStatus;
  /** Domestic: waybills billed differently from what the wallet netted. */
  readonly differences: readonly DlvWaybillDifference[];
  readonly differenceCount: number;
  /** Σ billed − Σ wallet across the differences: positive means billed more. */
  readonly differenceInr: string;
  /** Domestic lines for waybills booked before our ledger begins: not judged. */
  readonly beforeRecords: number;
  /** VAS: the one wallet debit naming this invoice, when there is exactly one. */
  readonly vasLumpInr: string | null;
  /** VAS: what is wrong with the lump, in words; null when nothing is. */
  readonly vasLumpProblem: string | null;
  /** The last day a discrepancy is assumed to be raisable (YYYY-MM-DD). */
  readonly disputeBy: string;
  readonly disputeOpen: boolean;
  readonly problem: string | null;
}

export interface DlvUninvoiced {
  readonly awb: string;
  readonly netInr: string;
  readonly firstChargedAt: string;
  readonly lastChargedAt: string;
}

export interface DlvNoteResult {
  readonly noteId: string;
  readonly issuedAt: string;
  readonly amountInr: string;
  /** The wallet transactions it was matched to; empty when unmatched. */
  readonly txnIds: readonly string[];
  readonly status: 'MATCHED' | 'UNMATCHED' | 'PENDING';
}

export interface DlvClaimCredit {
  readonly txnId: string;
  readonly awb: string | null;
  readonly amountInr: string;
  readonly at: string;
}

export interface DlvUnlistedLump {
  readonly txnId: string;
  /** The invoice its `serial_number` names. */
  readonly invoiceId: string;
  readonly amountInr: string;
  readonly at: string;
}

export interface DlvInvoiceCheckResult {
  readonly rows: readonly DlvInvoiceCheckRow[];
  /** Waybills the wallet charged that no Domestic invoice has billed — past two that should have. */
  readonly uninvoiced: {
    readonly count: number;
    readonly inr: string;
    readonly items: readonly DlvUninvoiced[];
    /** Charged, not yet billed, and not yet overdue. Normal. */
    readonly pendingCount: number;
    /** Charged before the ledger or the invoice list begins: counted, never flagged. */
    readonly beforeRecords: number;
  };
  /** VAS lump debits naming an invoice their list does not show. */
  readonly vasLumpsUnlisted: readonly DlvUnlistedLump[];
  readonly creditNotes: readonly DlvNoteResult[] | null;
  /** Claim payouts with no credit note, past the grace period. */
  readonly claimsWithoutNote: readonly DlvClaimCredit[];
  readonly debitNotes: readonly DlvNoteResult[] | null;
  readonly ledgerStart: string | null;
}

const signedPaise = (t: DlvLedgerTxn): number => (t.kind === 'DEBIT' ? 1 : -1) * t.amountPaise;

/**
 * Indexes of `values` summing to `target` within `tol`, fewest first; null
 * when none do. Exhaustive over at most SUBSET_CAP candidates — a note is
 * matched to the handful of movements posted around its date.
 */
export function subsetSumming(
  values: readonly number[],
  target: number,
  tol: number,
): number[] | null {
  const n = Math.min(values.length, SUBSET_CAP);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    const picked: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        sum += values[i] ?? 0;
        picked.push(i);
      }
    }
    if (Math.abs(sum - target) <= tol && (best === null || picked.length < best.length)) {
      best = picked;
    }
  }
  return best;
}

/**
 * Notes against the wallet movements they should correspond to: each note,
 * oldest first, takes the smallest set of unused candidates posted within
 * DLV_NOTE_WINDOW_DAYS of it that sums to its amount. A note with none is
 * UNMATCHED once the posting grace has passed, PENDING before.
 */
function matchNotes(
  notes: readonly DlvNote[],
  candidates: readonly DlvLedgerTxn[],
  used: Set<string>,
  now: Date,
): DlvNoteResult[] {
  return [...notes]
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime())
    .map((note) => {
      const day = istDayNumber(note.issuedAt);
      const near = candidates
        .filter(
          (t) =>
            !used.has(t.txnId) &&
            Math.abs(istDayNumber(t.occurredAt) - day) <= DLV_NOTE_WINDOW_DAYS,
        )
        .sort(
          (a, b) =>
            Math.abs(istDayNumber(a.occurredAt) - day) - Math.abs(istDayNumber(b.occurredAt) - day),
        )
        .slice(0, SUBSET_CAP);
      const hit = subsetSumming(
        near.map((t) => t.amountPaise),
        note.amountPaise,
        1,
      );
      const txnIds = hit === null ? [] : hit.map((i) => near[i]?.txnId ?? '');
      for (const id of txnIds) used.add(id);
      const settled = now.getTime() - note.issuedAt.getTime() > DLV_POSTING_GRACE_DAYS * DAY_MS;
      return {
        noteId: note.noteId,
        issuedAt: istDay(note.issuedAt),
        amountInr: paiseToInr(note.amountPaise),
        txnIds,
        status: hit !== null ? 'MATCHED' : settled ? 'UNMATCHED' : 'PENDING',
      };
    });
}

/** The comparison. See the file comment for the rules and the numbers behind them. */
export function checkDelhiveryInvoices(input: DlvCheckInput): DlvInvoiceCheckResult {
  const judgeFrom = input.ledgerStart === null ? null : input.ledgerStart.getTime() + DAY_MS;
  const judgeable = (at: number | null): boolean =>
    judgeFrom !== null && at !== null && at >= judgeFrom;

  // ── what the wallet netted, per waybill ─────────────────────────
  // Carriage AND reconciliation adjustments naming the waybill; never a
  // claim payout (the value of goods) nor a VAS lump (the account's).
  const byAwb = new Map<string, { net: number; first: number; last: number }>();
  const claims: DlvLedgerTxn[] = [];
  const lumps = new Map<string, DlvLedgerTxn[]>();
  const otherDebits: DlvLedgerTxn[] = [];
  for (const t of input.txns) {
    if (isClaimSettlement(t)) {
      if (t.kind === 'CREDIT') claims.push(t);
      continue;
    }
    const serial = vasLumpInvoice(t);
    if (serial !== null) {
      if (t.kind === 'DEBIT') lumps.set(serial, [...(lumps.get(serial) ?? []), t]);
      continue;
    }
    if (t.category === 'ADJUSTMENT' && t.kind === 'DEBIT') otherDebits.push(t);
    if (t.awb === null) continue;
    const at = t.occurredAt.getTime();
    const w = byAwb.get(t.awb) ?? { net: 0, first: at, last: at };
    w.net += signedPaise(t);
    w.first = Math.min(w.first, at);
    w.last = Math.max(w.last, at);
    byAwb.set(t.awb, w);
  }

  // ── what the Domestic invoices billed, and which billed it last ──
  const order = input.invoices
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => a.r.invoice.invoiceDate.getTime() - b.r.invoice.invoiceDate.getTime());
  const billed = new Map<
    string,
    { paise: number; lastIdx: number; pickupAt: number | null; status: string }
  >();
  const domesticDates: number[] = [];
  // A Domestic invoice we could not read may have billed any waybill charged
  // before its date; until it is read, those cannot be called uninvoiced.
  const unreadDomesticDates: number[] = [];
  for (const { r, idx } of order) {
    if (r.invoice.kind === 'DOMESTIC' && (r.itemized === null || r.problem !== null)) {
      unreadDomesticDates.push(r.invoice.invoiceDate.getTime());
    }
    if (r.itemized?.kind !== 'DOMESTIC' || r.problem !== null) continue;
    domesticDates.push(r.invoice.invoiceDate.getTime());
    for (const l of r.itemized.lines) {
      const b = billed.get(l.awb) ?? { paise: 0, lastIdx: idx, pickupAt: null, status: '' };
      b.paise += l.totalPaise;
      b.lastIdx = idx;
      b.status = l.status;
      const p = l.pickupAt?.getTime() ?? null;
      if (p !== null) b.pickupAt = b.pickupAt === null ? p : Math.min(b.pickupAt, p);
      billed.set(l.awb, b);
    }
  }

  const diffs = new Map<number, DlvWaybillDifference[]>();
  const before = new Map<number, number>();
  for (const [awb, b] of billed) {
    const led = byAwb.get(awb);
    const seen =
      b.pickupAt === null ? (led?.first ?? null) : Math.min(b.pickupAt, led?.first ?? b.pickupAt);
    if (!judgeable(seen)) {
      before.set(b.lastIdx, (before.get(b.lastIdx) ?? 0) + 1);
      continue;
    }
    const net = led?.net ?? 0;
    if (Math.abs(b.paise - net) > DLV_MATCH_TOLERANCE_PAISE) {
      const list = diffs.get(b.lastIdx) ?? [];
      list.push({
        awb,
        status: b.status,
        billedInr: paiseToInr(b.paise),
        walletInr: paiseToInr(net),
      });
      diffs.set(b.lastIdx, list);
    }
  }

  // ── charged, and on no Domestic invoice ─────────────────────────
  // Overdue once TWO Domestic invoices dated after its last movement
  // have passed it by: the first may legitimately bill the half-month
  // after it closes. Judged only when its first charge falls inside both
  // the ledger and the invoice list — a waybill charged earlier may sit
  // on an invoice the list does not reach.
  const earliestDomestic = domesticDates.length === 0 ? null : Math.min(...domesticDates);
  const uninvoiced: DlvUninvoiced[] = [];
  let uninvoicedPaise = 0;
  let pendingCount = 0;
  let beforeUninvoiced = 0;
  for (const [awb, w] of byAwb) {
    if (billed.has(awb) || w.net <= DLV_MATCH_TOLERANCE_PAISE || earliestDomestic === null) {
      continue;
    }
    if (!judgeable(w.first) || w.first < earliestDomestic) {
      beforeUninvoiced += 1;
      continue;
    }
    // An invoice dated D covers journeys closed by the end of D.
    const later = domesticDates.filter((d) => d + DAY_MS > w.last).length;
    // An unread invoice dated after its last movement may be the one that
    // billed it: on 13 Sep 2026 an unread 15 Aug invoice made 225 waybills it
    // had billed read as never invoiced, because the two READ invoices either
    // side of it had passed them by.
    const unreadMayBill = unreadDomesticDates.some((d) => d + DAY_MS > w.last);
    if (later < 2 || unreadMayBill) {
      pendingCount += 1;
      continue;
    }
    uninvoicedPaise += w.net;
    uninvoiced.push({
      awb,
      netInr: paiseToInr(w.net),
      firstChargedAt: istDay(new Date(w.first)),
      lastChargedAt: istDay(new Date(w.last)),
    });
  }
  uninvoiced.sort((a, b) => a.lastChargedAt.localeCompare(b.lastChargedAt));

  // ── one row per invoice ─────────────────────────────────────────
  const rows: DlvInvoiceCheckRow[] = input.invoices.map((r, idx) => {
    const inv = r.invoice;
    const disputeBy = new Date(inv.invoiceDate.getTime() + input.disputeDays * DAY_MS);
    const it = r.itemized;
    // The file adds up to the invoice when tax on its gross, rounded once
    // (as the invoice rounds it), lands within two paise of the total — and
    // its per-line totals, each rounded on its own, within a paisa a line.
    const totalsAgree =
      it === null
        ? null
        : Math.abs(Math.round((it.grossPaise * 118) / 100) - inv.totalPaise) <= 2 &&
          Math.abs(it.totalPaise - inv.totalPaise) <= Math.max(2, it.lines.length);
    let problem = r.problem;
    if (problem === null && it !== null) {
      const want = inv.kind === 'DOMESTIC' ? 'DOMESTIC' : inv.kind === 'VAS' ? 'VAS' : null;
      if (want !== null && it.kind !== want) {
        problem = `the file is a ${it.kind.toLowerCase()} transaction list, not a ${want.toLowerCase()} one`;
      } else if (it.serials.some((s) => s !== inv.invoiceId)) {
        // The probe's first run fetched one note's file for another; a
        // file naming a different invoice is never compared.
        problem = `the file names invoice ${it.serials.join(', ')}, not ${inv.invoiceId}`;
      }
    }

    let vasLumpInr: string | null = null;
    let vasLumpProblem: string | null = null;
    if (inv.kind === 'VAS') {
      const found = lumps.get(inv.invoiceId) ?? [];
      const old = input.now.getTime() - inv.invoiceDate.getTime() > DLV_POSTING_GRACE_DAYS * DAY_MS;
      const only = found.length === 1 ? found[0] : undefined;
      if (only !== undefined) {
        vasLumpInr = paiseToInr(only.amountPaise);
        if (Math.abs(only.amountPaise - inv.totalPaise) > DLV_MATCH_TOLERANCE_PAISE) {
          vasLumpProblem = `their wallet took ₹${vasLumpInr} for it, not the ₹${paiseToInr(inv.totalPaise)} invoiced`;
        }
      } else if (found.length > 1) {
        vasLumpProblem = `their wallet was debited ${found.length} times for it (₹${found
          .map((t) => paiseToInr(t.amountPaise))
          .join(', ₹')})`;
      } else if (old) {
        vasLumpProblem = 'no wallet debit names it — invoiced, never taken, or taken unlabelled';
      }
    }

    const list = diffs.get(idx) ?? [];
    const status: DlvInvoiceStatus =
      problem !== null
        ? 'UNREADABLE'
        : inv.kind === 'OTHER'
          ? 'NOT_ITEMIZED'
          : it === null
            ? 'UNREADABLE'
            : totalsAgree === false || list.length > 0 || vasLumpProblem !== null
              ? 'DIFFERS'
              : 'MATCHES';
    const net = list.reduce(
      (s, d) => s + (decimalToPaise(d.billedInr) ?? 0) - (decimalToPaise(d.walletInr) ?? 0),
      0,
    );
    return {
      invoiceId: inv.invoiceId,
      serviceType: inv.serviceType,
      kind: inv.kind,
      invoiceDate: istDay(inv.invoiceDate),
      totalInr: paiseToInr(inv.totalPaise),
      grossInr: it === null ? null : paiseToInr(it.grossPaise),
      linesTotalInr: it === null ? null : paiseToInr(it.totalPaise),
      lines: it === null ? 0 : it.lines.length,
      totalsAgree,
      status,
      differences: list.slice(0, LIST_CAP),
      differenceCount: list.length,
      differenceInr: paiseToInr(net),
      beforeRecords: before.get(idx) ?? 0,
      vasLumpInr,
      vasLumpProblem,
      disputeBy: istDay(disputeBy),
      disputeOpen: input.now.getTime() <= disputeBy.getTime() + DAY_MS,
      problem: problem === null && inv.kind !== 'OTHER' && it === null ? 'no file' : problem,
    };
  });

  // ── VAS lumps naming an invoice the list does not show ──────────
  const listed = new Set(input.invoices.map((r) => r.invoice.invoiceId));
  const vasDates = input.invoices
    .filter((r) => r.invoice.kind === 'VAS')
    .map((r) => r.invoice.invoiceDate.getTime());
  const vasFrom = vasDates.length === 0 ? null : Math.min(...vasDates) + 2 * DAY_MS;
  const vasLumpsUnlisted: DlvUnlistedLump[] = [];
  for (const [serial, ts] of lumps) {
    if (listed.has(serial) || vasFrom === null) continue;
    for (const t of ts) {
      // Older than the list's first VAS invoice: its invoice may simply be
      // beyond the range the list was read for.
      if (t.occurredAt.getTime() < vasFrom) continue;
      vasLumpsUnlisted.push({
        txnId: t.txnId,
        invoiceId: serial,
        amountInr: paiseToInr(t.amountPaise),
        at: istDay(t.occurredAt),
      });
    }
  }

  // ── notes ───────────────────────────────────────────────────────
  const used = new Set<string>();
  const creditNotes =
    input.creditNotes === null ? null : matchNotes(input.creditNotes, claims, used, input.now);
  const claimsWithoutNote: DlvClaimCredit[] =
    input.creditNotes === null || input.notesFrom === null
      ? []
      : claims
          .filter(
            (t) =>
              !used.has(t.txnId) &&
              input.now.getTime() - t.occurredAt.getTime() > DLV_CLAIM_NOTE_GRACE_DAYS * DAY_MS &&
              t.occurredAt.getTime() >=
                (input.notesFrom?.getTime() ?? 0) + DLV_NOTE_WINDOW_DAYS * DAY_MS,
          )
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
          .map((t) => ({
            txnId: t.txnId,
            awb: t.awb,
            amountInr: paiseToInr(t.amountPaise),
            at: istDay(t.occurredAt),
          }));
  const debitNotes =
    input.debitNotes === null ? null : matchNotes(input.debitNotes, otherDebits, used, input.now);

  return {
    rows,
    uninvoiced: {
      count: uninvoiced.length,
      inr: paiseToInr(uninvoicedPaise),
      items: uninvoiced.slice(0, LIST_CAP),
      pendingCount,
      beforeRecords: beforeUninvoiced,
    },
    vasLumpsUnlisted,
    creditNotes,
    claimsWithoutNote,
    debitNotes,
    ledgerStart: input.ledgerStart === null ? null : input.ledgerStart.toISOString(),
  };
}
