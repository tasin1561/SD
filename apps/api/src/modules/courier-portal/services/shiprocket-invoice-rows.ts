import Papa from 'papaparse';
import { readSheet, readZipFiles, sheetNames } from '../../../common/xlsx/xlsx-reader';
import { paiseToInr, parseShiprocketDate, parseShiprocketMoney } from './shiprocket-wallet-rows';

/**
 * Shiprocket's invoices, checked against what their wallet actually took.
 *
 * Pure: no browser, no database. The page object fetches the invoice list
 * and each invoice's "itemized" download; everything that decides what
 * they MEAN, and whether they agree with our stored ledger, lives here.
 *
 * ── WHAT AN INVOICE IS, MEASURED 2026-09-11 (90 days, 12 invoices) ─────
 * The wallet is charged as things happen; the invoice is the tax document
 * issued afterwards. They are separate records of the same money, and
 * nothing on their side forces them to agree:
 *
 *   VAS — monthly, around the 3rd, for the month before: WhatsApp
 *     messages, RTO-risk scores, Delivery Boost. Itemized as a zip of one
 *     CSV per service, one line per order. A late charge can land on the
 *     NEXT month's invoice (three July orders were on August's).
 *   ShipSure — its own VAS invoice when the premium is taken, itemized as
 *     a one-line workbook.
 *   Freight — several a month, each billing the parcels whose charges
 *     FINALISED since the last (delivered, or returned), not a calendar
 *     month. Itemized as a CSV, one line per parcel.
 *   Subscription — the plan fee, netted by a matching credit. Not itemized.
 *
 * ── WHAT THE 90 DAYS SHOWED ─────────────────────────────────────────
 * Every itemized file added up to its own invoice total. Freight agreed
 * with the wallet on every parcel we could see from start to finish —
 * the apparent differences were parcels booked before our ledger begins,
 * and one order whose waybill was swapped, charged partly on each. VAS
 * did NOT: 91 WhatsApp charges (₹536.90) were taken from the wallet in
 * July and August and appear on no invoice, 36 of them in one afternoon.
 *
 * ── HOW IT COMPARES ─────────────────────────────────────────────────
 *   · per ORDER, never per waybill — a swapped waybill splits one
 *     parcel's freight across two, and the invoice bills it under the
 *     last one;
 *   · only what our ledger saw from the start — a parcel booked before
 *     the ledger's first movement has charges we never held, and its
 *     "difference" would be our gap, not theirs (counted, not flagged);
 *   · a VAS charge is only called uninvoiced once a LATER monthly invoice
 *     has also passed it by, so a month-end charge waiting for next
 *     month's invoice is not an alarm.
 *
 * ── WHY IT MATTERS, AND WHEN ────────────────────────────────────────
 * Their invoices say a discrepancy must be raised within 15 days of the
 * invoice date or it will not be settled. So every finding carries that
 * date, and the service raises the loudest alarm while it is still open.
 */

export class ShiprocketInvoiceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiprocketInvoiceFormatError';
  }
}

/** Their invoice list's columns, as their page names them. */
export const SR_INVOICE_HEADERS: readonly string[] = [
  'Invoice Id',
  'Service type',
  'Invoice Date',
  'Due Date',
  'Total Amount (₹)',
  'Status',
  'Action',
];

/** Days Shiprocket allows for raising a discrepancy, from the invoice date. */
export const SR_DISPUTE_DAYS = 15;
/** A freight charge this old with no invoice is worth a look (a stuck or lost parcel). */
export const SR_FREIGHT_STALE_DAYS = 60;
/** Invoice types that come with an itemized file we can check line by line. */
export const SR_ITEMIZED_TYPES: ReadonlySet<string> = new Set(['VAS', 'Freight']);

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const LIST_CAP = 50;

export interface SrInvoice {
  readonly invoiceId: string;
  readonly serviceType: string;
  readonly invoiceDate: Date;
  readonly totalPaise: number;
  readonly status: string;
}

const LIST_DATE = /^\d{2} [A-Z][a-z]{2}, \d{4}$/;

/** A list row only once it is fully drawn: seven cells, a date and an amount. */
export function isInvoiceRow(row: readonly string[]): boolean {
  return (
    row.length === SR_INVOICE_HEADERS.length &&
    LIST_DATE.test(row[2] ?? '') &&
    parseShiprocketMoney(row[4] ?? '') !== null
  );
}

export function parseInvoiceList(rows: readonly (readonly string[])[]): SrInvoice[] {
  return rows.map((row, i) => {
    const [invoiceId = '', serviceType = '', dateRaw = '', , totalRaw = '', status = ''] = row;
    const invoiceDate = parseShiprocketDate(dateRaw);
    const totalPaise = parseShiprocketMoney(totalRaw);
    if (!isInvoiceRow(row) || invoiceDate === null || totalPaise === null || invoiceId === '') {
      throw new ShiprocketInvoiceFormatError(
        `invoice row ${i + 1} could not be read: ${JSON.stringify(row).slice(0, 200)}`,
      );
    }
    return {
      invoiceId: invoiceId.trim(),
      serviceType: serviceType.trim(),
      invoiceDate,
      totalPaise,
      status: status.trim(),
    };
  });
}

/**
 * "224.2400", "5.9", "-47.25" → paise, exactly. A string-based parse
 * rather than `Number(x) * 100`, which turns 1.005 into 100.49999 and a
 * total that should agree to the paisa into one that does not.
 */
export function decimalToPaise(raw: string): number | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw.trim().replace(/,/g, ''));
  if (m === null) return null;
  const frac = Number(`${m[3] ?? ''}000`.slice(0, 3));
  let paise = Number(m[2]) * 100 + Math.floor(frac / 10);
  if (frac % 10 >= 5) paise += 1;
  return m[1] === '-' ? -paise : paise;
}

/** "2026-07-24 21:07:29" or "2026-07-23 16:07" — their IST clock — as UTC. */
export function parseIstDateTime(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
  if (m === null) return null;
  const utc =
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    ) - IST_OFFSET_MS;
  return Number.isNaN(utc) ? null : new Date(utc);
}

/**
 * An invoice's service names, mapped to the passbook sub-category the
 * same charge carries in their wallet. A service not listed here is
 * NAMED on the invoice's result rather than compared: matching it to
 * nothing would call every line "never charged".
 */
const VAS_SERVICES: ReadonlyArray<{ readonly item: RegExp; readonly passbook: string }> = [
  { item: /^whats\s*app/i, passbook: 'WhatsApp Communication' },
  { item: /^rto score/i, passbook: 'RTO Score Charge' },
  { item: /^delivery boost/i, passbook: 'Delivery Boost Charges' },
  { item: /^ship\s*sure/i, passbook: 'Ship Sure' },
];

/** The passbook sub-category for an invoice line's service, or null when unknown. */
export function passbookServiceFor(itemName: string): string | null {
  return VAS_SERVICES.find((s) => s.item.test(itemName.trim()))?.passbook ?? null;
}

export interface VasLine {
  /** The passbook sub-category, or the invoice's own name when it is one we do not know. */
  readonly service: string;
  readonly known: boolean;
  /** Their "Channel Order Id" — what the passbook calls the order. Empty for ShipSure. */
  readonly orderId: string;
  readonly totalPaise: number;
  readonly orderDate: Date | null;
}

export interface FreightLine {
  readonly awb: string;
  readonly orderId: string;
  readonly billedPaise: number;
  readonly assignedAt: Date | null;
  readonly status: string;
}

export interface Itemized {
  readonly vas: readonly VasLine[];
  readonly freight: readonly FreightLine[];
  /** What the download contained, for the record. */
  readonly files: readonly string[];
}

const stripQuotes = (s: string): string => s.replace(/^['"\s]+|['"\s]+$/g, '');

function csvRecords(
  name: string,
  text: string,
): { fields: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    const e = parsed.errors[0];
    throw new ShiprocketInvoiceFormatError(
      `${name}: row ${e?.row ?? '?'} could not be read (${e?.message ?? 'unknown'})`,
    );
  }
  return { fields: (parsed.meta.fields ?? []).map((f) => f.trim()), rows: parsed.data };
}

const FREIGHT_COLUMNS = ['AWB Code', 'Order ID', 'Billing Amount (Inclusive GST)'];
const VAS_COLUMNS = ['Channel Order Id', 'Item Name', 'Total'];

function freightLines(name: string, rows: Record<string, string>[]): FreightLine[] {
  return rows.map((r, i) => {
    const awb = stripQuotes(r['AWB Code'] ?? '');
    const billed = decimalToPaise(r['Billing Amount (Inclusive GST)'] ?? '');
    if (awb === '' || billed === null) {
      throw new ShiprocketInvoiceFormatError(
        `${name}: line ${i + 1} has no waybill or no billed amount`,
      );
    }
    return {
      awb,
      orderId: stripQuotes(r['Order ID'] ?? ''),
      billedPaise: billed,
      assignedAt: parseIstDateTime(r['Awb Assigned Date'] ?? ''),
      status: (r['Awb Status'] ?? '').trim(),
    };
  });
}

/**
 * One VAS line, from a CSV or a workbook row. ShipSure is ONE premium on
 * the account — the wallet row names no order — so it is keyed on the
 * account whatever order number the invoice prints beside it.
 */
function vasLine(
  where: string,
  item: string,
  orderIdRaw: string,
  totalRaw: string,
  orderDate: Date | null,
): VasLine {
  const total = decimalToPaise(totalRaw);
  if (total === null) throw new ShiprocketInvoiceFormatError(`${where} has no total`);
  const service = passbookServiceFor(item);
  return {
    service: service ?? item,
    known: service !== null,
    orderId: service === 'Ship Sure' ? '' : stripQuotes(orderIdRaw),
    totalPaise: total,
    orderDate,
  };
}

function vasLines(name: string, rows: Record<string, string>[]): VasLine[] {
  return rows.map((r, i) =>
    vasLine(
      `${name}: line ${i + 1}`,
      (r['Item Name'] ?? '').trim() || name.replace(/\.csv$/i, ''),
      r['Channel Order Id'] ?? '',
      r['Total'] ?? '',
      parseIstDateTime(r['Order_Date'] ?? r['Order Date'] ?? ''),
    ),
  );
}

/** A workbook date: their "2026-08-25 17:30" text, or an Excel day serial (IST). */
function workbookDate(raw: string): Date | null {
  if (/^\d{5}(\.\d+)?$/.test(raw.trim())) {
    return new Date(Date.UTC(1899, 11, 30) + Number(raw) * DAY_MS - IST_OFFSET_MS);
  }
  return parseIstDateTime(raw);
}

/** One CSV, recognised by its columns rather than its file name. */
function csvLines(name: string, text: string): Pick<Itemized, 'vas' | 'freight'> {
  const { fields, rows } = csvRecords(name, text);
  const has = (cols: readonly string[]): boolean => cols.every((c) => fields.includes(c));
  if (has(FREIGHT_COLUMNS)) return { vas: [], freight: freightLines(name, rows) };
  if (has(VAS_COLUMNS)) return { vas: vasLines(name, rows), freight: [] };
  throw new ShiprocketInvoiceFormatError(
    `${name}: not a format we know — columns ${fields.slice(0, 12).join(' | ')}`,
  );
}

/**
 * A VAS itemization delivered as a one-sheet workbook (ShipSure's, on
 * 25 Aug): the same columns as the CSVs — its one line's item is
 * "Shipsure Charges".
 */
function workbookLines(file: Buffer): VasLine[] {
  const sheet = sheetNames(file)[0];
  if (sheet === undefined) throw new ShiprocketInvoiceFormatError('the workbook has no sheet');
  const rows = readSheet(file, sheet).filter((r) => r.some((c) => c.trim() !== ''));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (re: RegExp): number => header.findIndex((h) => re.test(h));
  const itemCol = col(/^item name$/);
  const totalCol = col(/^total$/);
  const orderCol = col(/^channel order id$/);
  const dateCol = col(/^order[ _]date$/);
  if (itemCol < 0 || totalCol < 0) {
    throw new ShiprocketInvoiceFormatError(
      `the workbook is not a VAS itemization — columns ${header.join(' | ')}`,
    );
  }
  return rows
    .slice(1)
    .map((r, i) =>
      vasLine(
        `workbook line ${i + 1}`,
        r[itemCol] ?? '',
        orderCol < 0 ? '' : (r[orderCol] ?? ''),
        r[totalCol] ?? '',
        dateCol < 0 ? null : workbookDate(r[dateCol] ?? ''),
      ),
    );
}

/**
 * An itemized download, whatever shape it came in: a CSV (freight), a zip
 * of CSVs (monthly VAS), or a workbook (ShipSure — an .xlsx is itself a
 * zip, told apart by its content-types part). Refuses anything else.
 */
export function parseItemized(file: Buffer): Itemized {
  const isZip = file.length >= 4 && file.readUInt32LE(0) === 0x04034b50;
  if (!isZip) {
    const text = file.toString('utf8');
    if (/^\s*%PDF|^\s*</.test(text)) {
      throw new ShiprocketInvoiceFormatError('the download is a document, not an itemized file');
    }
    return { ...csvLines('itemized.csv', text), files: ['itemized.csv'] };
  }
  const files = readZipFiles(file);
  if (files.has('[Content_Types].xml')) {
    return { vas: workbookLines(file), freight: [], files: ['(workbook)'] };
  }
  const vas: VasLine[] = [];
  const freight: FreightLine[] = [];
  for (const [name, body] of files) {
    if (!/\.csv$/i.test(name)) {
      throw new ShiprocketInvoiceFormatError(`the zip holds ${name}, which is not a CSV`);
    }
    const lines = csvLines(name, body.toString('utf8'));
    vas.push(...lines.vas);
    freight.push(...lines.freight);
  }
  return { vas, freight, files: [...files.keys()] };
}

/** One wallet movement, as the check needs it. */
export interface WalletMove {
  readonly occurredAt: Date;
  /** Positive a charge, negative a credit or reversal: what it cost us. */
  readonly costPaise: number;
  readonly orderId: string | null;
  readonly awb: string | null;
  /** The passbook's "Transaction Type": 'VAS', 'Freight Charges', … */
  readonly transactionType: string;
  readonly subCategory: string;
}

export interface InvoiceRead {
  readonly invoice: SrInvoice;
  /** Null when the invoice type has no itemized file we check, or it could not be had. */
  readonly itemized: Itemized | null;
  /** Why an itemized invoice could not be read, in words. */
  readonly problem: string | null;
}

export interface CheckInput {
  readonly invoices: readonly InvoiceRead[];
  readonly moves: readonly WalletMove[];
  /** The ledger's first stored movement: nothing before it can be judged. */
  readonly ledgerStart: Date | null;
  readonly now: Date;
}

export interface InvoiceDifference {
  readonly service: string;
  readonly orderId: string;
  readonly billedInr: string;
  readonly walletInr: string;
}

export type InvoiceCheckStatus = 'MATCHES' | 'DIFFERS' | 'NOT_ITEMIZED' | 'UNREADABLE';

export interface InvoiceCheckRow {
  readonly invoiceId: string;
  readonly serviceType: string;
  /** YYYY-MM-DD, IST. */
  readonly invoiceDate: string;
  readonly totalInr: string;
  readonly itemizedInr: string | null;
  readonly lines: number;
  /** Does the itemized file add up to the invoice's own total? Null when not itemized. */
  readonly totalsAgree: boolean | null;
  readonly status: InvoiceCheckStatus;
  readonly differences: readonly InvoiceDifference[];
  readonly differenceCount: number;
  /** Σ billed − Σ wallet across the differences: positive means billed more. */
  readonly differenceInr: string;
  /** Lines for parcels or orders older than our ledger: not judged. */
  readonly beforeRecords: number;
  readonly unknownServices: readonly string[];
  /** The last day Shiprocket will look at a discrepancy (YYYY-MM-DD). */
  readonly disputeBy: string;
  readonly disputeOpen: boolean;
  readonly problem: string | null;
}

export interface UninvoicedVas {
  readonly service: string;
  readonly orderId: string;
  readonly chargedInr: string;
  readonly invoicedInr: string;
  readonly lastChargedAt: string;
}

export interface StaleFreight {
  readonly orderId: string;
  readonly awbs: readonly string[];
  readonly netInr: string;
  readonly firstChargedAt: string;
}

export interface InvoiceCheckResult {
  readonly rows: readonly InvoiceCheckRow[];
  /** VAS the wallet paid for that no invoice has billed, past the month it should have. */
  readonly vasUninvoiced: {
    readonly count: number;
    readonly inr: string;
    readonly items: readonly UninvoicedVas[];
  };
  /** Freight charged and not yet invoiced — normal until a parcel's charges finalise. */
  readonly freightUninvoiced: {
    readonly orders: number;
    readonly inr: string;
    readonly staleCount: number;
    readonly staleInr: string;
    readonly stale: readonly StaleFreight[];
  };
  readonly ledgerStart: string | null;
}

export const istDay = (d: Date): string =>
  new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Midnight IST on the first of `d`'s month, shifted by `months`. */
function istMonthStart(d: Date, months: number): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + months, 1) - IST_OFFSET_MS);
}

interface Tally {
  paise: number;
  first: number;
  lastDebit: number;
}

/** The comparison. See the file comment for the rules. */
export function checkInvoices(input: CheckInput): InvoiceCheckResult {
  const judgeFrom = input.ledgerStart === null ? null : input.ledgerStart.getTime() + DAY_MS;
  const judgeable = (d: Date | null): boolean =>
    judgeFrom !== null && d !== null && d.getTime() >= judgeFrom;

  // ── what the wallet was charged ──────────────────────────────────
  const vasCharged = new Map<string, Tally>();
  const freightCharged = new Map<string, Tally & { awbs: Set<string> }>();
  for (const m of input.moves) {
    const at = m.occurredAt.getTime();
    if (m.transactionType === 'VAS') {
      const key = `${m.subCategory}|${m.orderId ?? ''}`;
      const t = vasCharged.get(key) ?? { paise: 0, first: at, lastDebit: 0 };
      t.paise += m.costPaise;
      t.first = Math.min(t.first, at);
      if (m.costPaise > 0) t.lastDebit = Math.max(t.lastDebit, at);
      vasCharged.set(key, t);
    } else if (m.transactionType === 'Freight Charges' && m.orderId !== null) {
      const t = freightCharged.get(m.orderId) ?? {
        paise: 0,
        first: at,
        lastDebit: 0,
        awbs: new Set<string>(),
      };
      t.paise += m.costPaise;
      t.first = Math.min(t.first, at);
      if (m.costPaise > 0) t.lastDebit = Math.max(t.lastDebit, at);
      if (m.awb !== null) t.awbs.add(m.awb);
      freightCharged.set(m.orderId, t);
    }
  }

  // ── what the invoices billed, and which invoice billed it last ────
  const byDate = input.invoices
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => a.r.invoice.invoiceDate.getTime() - b.r.invoice.invoiceDate.getTime());
  interface Billed {
    paise: number;
    lastInvoice: number;
    judgeable: boolean;
  }
  const vasBilled = new Map<string, Billed>();
  const freightBilled = new Map<string, Billed>();
  /** Per service: the dates of the invoices that billed it. */
  const vasInvoiceDates = new Map<string, number[]>();
  const unknown = new Map<number, Set<string>>();

  for (const { r, idx } of byDate) {
    if (r.itemized === null) continue;
    for (const l of r.itemized.vas) {
      if (!l.known) {
        const set = unknown.get(idx) ?? new Set<string>();
        set.add(l.service);
        unknown.set(idx, set);
        continue;
      }
      const key = `${l.service}|${l.orderId}`;
      const b = vasBilled.get(key) ?? { paise: 0, lastInvoice: idx, judgeable: true };
      b.paise += l.totalPaise;
      b.lastInvoice = idx;
      // ShipSure names no order date; it is judged from its invoice date.
      if (!judgeable(l.orderDate ?? (l.orderId === '' ? r.invoice.invoiceDate : null))) {
        b.judgeable = false;
      }
      vasBilled.set(key, b);
      const dates = vasInvoiceDates.get(l.service) ?? [];
      dates.push(r.invoice.invoiceDate.getTime());
      vasInvoiceDates.set(l.service, dates);
    }
    for (const l of r.itemized.freight) {
      const key = l.orderId === '' ? `awb:${l.awb}` : l.orderId;
      const b = freightBilled.get(key) ?? { paise: 0, lastInvoice: idx, judgeable: true };
      b.paise += l.billedPaise;
      b.lastInvoice = idx;
      if (!judgeable(l.assignedAt)) b.judgeable = false;
      freightBilled.set(key, b);
    }
  }

  // ── differences, each on the invoice that billed it last ─────────
  const diffs = new Map<number, InvoiceDifference[]>();
  const before = new Map<number, number>();
  const note = (idx: number, d: InvoiceDifference): void => {
    const list = diffs.get(idx) ?? [];
    list.push(d);
    diffs.set(idx, list);
  };
  for (const [key, b] of vasBilled) {
    if (!b.judgeable) {
      before.set(b.lastInvoice, (before.get(b.lastInvoice) ?? 0) + 1);
      continue;
    }
    const charged = vasCharged.get(key)?.paise ?? 0;
    // Billed MORE than the wallet took is this invoice's problem. Billed
    // less is a charge still waiting for an invoice — judged below, by age.
    if (b.paise > charged) {
      const [service = '', orderId = ''] = key.split('|');
      note(b.lastInvoice, {
        service,
        orderId,
        billedInr: paiseToInr(b.paise),
        walletInr: paiseToInr(charged),
      });
    }
  }
  for (const [key, b] of freightBilled) {
    if (!b.judgeable) {
      before.set(b.lastInvoice, (before.get(b.lastInvoice) ?? 0) + 1);
      continue;
    }
    const charged = key.startsWith('awb:') ? 0 : (freightCharged.get(key)?.paise ?? 0);
    if (b.paise !== charged) {
      note(b.lastInvoice, {
        service: 'Freight',
        orderId: key.replace(/^awb:/, ''),
        billedInr: paiseToInr(b.paise),
        walletInr: paiseToInr(charged),
      });
    }
  }

  // ── VAS charged and never invoiced ──────────────────────────────
  // A charge is overdue once a monthly invoice issued TWO months on has
  // passed it by: the invoice of the 3rd covers last month, and a
  // month-end charge can slip to the one after.
  const uninvoiced: UninvoicedVas[] = [];
  let uninvoicedPaise = 0;
  for (const [key, t] of vasCharged) {
    const [service = '', orderId = ''] = key.split('|');
    const dates = vasInvoiceDates.get(service);
    if (dates === undefined || dates.length === 0) continue;
    const cutoff = istMonthStart(new Date(Math.max(...dates)), -1).getTime();
    const floor = istMonthStart(new Date(Math.min(...dates)), -1).getTime();
    const billed = vasBilled.get(key)?.paise ?? 0;
    const extra = t.paise - billed;
    if (extra <= 0 || t.lastDebit === 0 || t.lastDebit >= cutoff || t.first < floor) continue;
    uninvoicedPaise += extra;
    uninvoiced.push({
      service,
      orderId,
      chargedInr: paiseToInr(t.paise),
      invoicedInr: paiseToInr(billed),
      lastChargedAt: istDay(new Date(t.lastDebit)),
    });
  }
  uninvoiced.sort((a, b) => a.lastChargedAt.localeCompare(b.lastChargedAt));

  // ── freight charged and not (yet) invoiced ──────────────────────
  let freightOrders = 0;
  let freightPaise = 0;
  const stale: StaleFreight[] = [];
  let stalePaise = 0;
  const staleBefore = input.now.getTime() - SR_FREIGHT_STALE_DAYS * DAY_MS;
  for (const [orderId, t] of freightCharged) {
    if (t.paise === 0 || freightBilled.has(orderId)) continue;
    freightOrders += 1;
    freightPaise += t.paise;
    if (t.first < staleBefore && t.paise > 0) {
      stalePaise += t.paise;
      stale.push({
        orderId,
        awbs: [...t.awbs],
        netInr: paiseToInr(t.paise),
        firstChargedAt: istDay(new Date(t.first)),
      });
    }
  }
  stale.sort((a, b) => a.firstChargedAt.localeCompare(b.firstChargedAt));

  // ── one row per invoice ─────────────────────────────────────────
  const rows: InvoiceCheckRow[] = input.invoices.map((r, idx) => {
    const inv = r.invoice;
    const disputeBy = new Date(inv.invoiceDate.getTime() + SR_DISPUTE_DAYS * DAY_MS);
    const itemizedPaise =
      r.itemized === null
        ? null
        : r.itemized.vas.reduce((s, l) => s + l.totalPaise, 0) +
          r.itemized.freight.reduce((s, l) => s + l.billedPaise, 0);
    const list = diffs.get(idx) ?? [];
    const unknownServices = [...(unknown.get(idx) ?? new Set<string>())];
    const totalsAgree = itemizedPaise === null ? null : itemizedPaise === inv.totalPaise;
    const status: InvoiceCheckStatus =
      r.problem !== null
        ? 'UNREADABLE'
        : r.itemized === null
          ? 'NOT_ITEMIZED'
          : list.length > 0 || totalsAgree === false || unknownServices.length > 0
            ? 'DIFFERS'
            : 'MATCHES';
    const net = list.reduce(
      (s, d) => s + (decimalToPaise(d.billedInr) ?? 0) - (decimalToPaise(d.walletInr) ?? 0),
      0,
    );
    return {
      invoiceId: inv.invoiceId,
      serviceType: inv.serviceType,
      invoiceDate: istDay(inv.invoiceDate),
      totalInr: paiseToInr(inv.totalPaise),
      itemizedInr: itemizedPaise === null ? null : paiseToInr(itemizedPaise),
      lines: r.itemized === null ? 0 : r.itemized.vas.length + r.itemized.freight.length,
      totalsAgree,
      status,
      differences: list.slice(0, LIST_CAP),
      differenceCount: list.length,
      differenceInr: paiseToInr(net),
      beforeRecords: before.get(idx) ?? 0,
      unknownServices,
      disputeBy: istDay(disputeBy),
      disputeOpen: input.now.getTime() <= disputeBy.getTime() + DAY_MS,
      problem: r.problem,
    };
  });

  return {
    rows,
    vasUninvoiced: {
      count: uninvoiced.length,
      inr: paiseToInr(uninvoicedPaise),
      items: uninvoiced.slice(0, LIST_CAP),
    },
    freightUninvoiced: {
      orders: freightOrders,
      inr: paiseToInr(freightPaise),
      staleCount: stale.length,
      staleInr: paiseToInr(stalePaise),
      stale: stale.slice(0, LIST_CAP),
    },
    ledgerStart: input.ledgerStart === null ? null : input.ledgerStart.toISOString(),
  };
}
