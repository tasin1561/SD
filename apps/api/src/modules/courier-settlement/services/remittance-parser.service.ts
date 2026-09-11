import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import Papa from 'papaparse';
import { isXls, readXlsWorkbook, XlsError } from '../../../common/xls/xls-reader';
import { readSheet, sheetNames, XlsxError } from '../../../common/xlsx/xlsx-reader';

/** One line of a courier's remittance file, before we know whose it is. */
export interface ParsedRemittanceRow {
  /** The courier's waybill. This is what identifies the parcel to US. */
  readonly awbNumber: string;
  /** What the courier says it is paying for this parcel. */
  readonly settledInr: string;
  /** What was collected from the customer, when the file says. */
  readonly codAmountInr: string | null;
  /** The courier's own status word, kept verbatim for the operator. */
  readonly status: string | null;
  /** The seller's own reference, if the file carries one. Never matched on. */
  readonly externalRef: string | null;
  /** 1-based line number in the file, so a complaint names a row. */
  readonly line: number;
  /**
   * Why this line must be allocated by hand, when the FILE says something
   * about it we do not know how to read. Null for an ordinary line.
   */
  readonly flag: string | null;
}

/** File-level facts, for a format that states them. */
export interface RemittanceFileSummary {
  /** The payout reference(s) the file names — the UTR(s). */
  readonly references: readonly string[];
  /** What the courier says it remitted, after its own deductions. */
  readonly remittedInr: string;
  /** COD collected across the parcels, before those deductions. */
  readonly codInr: string;
  /** What the courier kept back (freight, early-COD fee, RTO reversal). */
  readonly deductedInr: string;
}

export interface RemittanceParseResult {
  readonly rows: readonly ParsedRemittanceRow[];
  readonly summary: RemittanceFileSummary | null;
  /** Said to the operator before anything is recorded. */
  readonly warnings: readonly string[];
}

/** A sheet of the uploaded workbook by name; null for a CSV or a missing sheet. */
export type SheetLookup = (name: string) => string[][] | null;

export interface RemittanceParser {
  readonly courierCode: string;
  /** Columns that must be present, named as the courier writes them. */
  readonly requiredColumns: readonly string[];
  /** In a workbook upload, the sheet with one row per parcel. */
  readonly parcelSheet: string | null;
  parseRow(row: Record<string, string>, line: number): ParsedRemittanceRow | null;
  /** Cross-check the parcels against the file's own totals. May refuse. */
  summarise?(
    rows: readonly ParsedRemittanceRow[],
    records: readonly Record<string, string>[],
    sheet: SheetLookup,
  ): { summary: RemittanceFileSummary | null; warnings: string[] };
}

/** Decimal or null — never NaN, never a silent zero. */
function money(raw: string | undefined): Prisma.Decimal | null {
  const t = (raw ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return new Prisma.Decimal(t);
}

/** A blank cell reads as zero only where the file uses blank for "none". */
function moneyOrZero(raw: string | undefined): Prisma.Decimal | null {
  return (raw ?? '').trim() === '' ? new Prisma.Decimal(0) : money(raw);
}

/**
 * Delhivery's "remittance transactions export".
 *
 * Built against a real file rather than a guess — the header is:
 *
 *   Description, Payment Mode, Client, Pincode, Amount Payable, City,
 *   Status, COD Amount, Waybill Number, Order Number
 *
 * Two column choices worth stating, because both have a plausible wrong
 * answer sitting next to them:
 *
 *  - `Amount Payable` is the settled figure, NOT `COD Amount`. They are
 *    equal in the sample, which is exactly what would let the wrong one
 *    ship unnoticed until Delhivery starts netting its charges.
 *  - `Order Number` is the SELLER's own name for the parcel ("OV Beauty
 *    (S. SA)22") — free text, not unique, and not ours. Matching on it
 *    would attribute money by a string a customer service agent typed.
 *    The waybill is the identifier both sides agree on.
 */
@Injectable()
export class DelhiveryRemittanceParser implements RemittanceParser {
  readonly courierCode = 'delhivery';
  readonly requiredColumns = ['Waybill Number', 'Amount Payable'] as const;
  readonly parcelSheet = null;

  parseRow(row: Record<string, string>, line: number): ParsedRemittanceRow | null {
    const awb = (row['Waybill Number'] ?? '').trim();
    if (awb === '') return null;
    return {
      awbNumber: awb,
      settledInr: (row['Amount Payable'] ?? '').trim(),
      codAmountInr: (row['COD Amount'] ?? '').trim() || null,
      status: (row['Status'] ?? '').trim() || null,
      externalRef: (row['Order Number'] ?? '').trim() || null,
      line,
      flag: null,
    };
  }
}

const SR_PARCEL_SHEET = 'AWB level report';
const SR_PAYOUT_SHEET = 'CRF level report';
const SR_PAYOUT_COLUMNS = [
  'CRF ID',
  'COD Available',
  'Freight Charges from COD',
  'Early COD Charges',
  'RTO Reversal Amount',
  'Remittance Amount',
  'UTR',
  'Adjusted Amount',
  'Status',
] as const;

/**
 * Shiprocket's remittance download ("COD remittance", one file per CRF).
 *
 * Built against a real export (2026-09-11), an Excel 97-2003 workbook of
 * two sheets:
 *
 *   AWB level report — CRF ID, AWB, Delivered Date, Shipped Date,
 *     Order Id, Courier, Order Value, Channel Name, Remittance Date, UTR,
 *     total_adjusted_amt, Linked CRF Ids
 *   CRF level report — Date, CRF ID, COD Available, Freight Charges from
 *     COD, Early COD Charges, RTO Reversal Amount, Remittance Amount,
 *     Remittance Method, UTR, Adjusted Amount, Status, remarks
 *
 * ── WHAT A PARCEL IS PAID ────────────────────────────────────────────
 * Per parcel the file states only `Order Value` — the COD collected.
 * Shiprocket's deductions (freight from COD, early-COD fee, RTO
 * reversal) are stated per REMITTANCE, not per parcel, so they cannot be
 * attributed to one and are not: a parcel's line is what was collected
 * for it, and the deduction is reported beside the total. Spreading it
 * across parcels by value would invent a split Shiprocket never made.
 *
 * ── THE FILE CHECKS ITSELF ───────────────────────────────────────────
 * The parcels of each CRF must add up to that CRF's `COD Available`.
 * When they do not, the two sheets disagree about the same money and the
 * file is REFUSED — allocating from it would be allocating a guess.
 *
 * ── WHAT IT HAS NOT SEEN ─────────────────────────────────────────────
 * `total_adjusted_amt`, `Linked CRF Ids` and `Adjusted Amount` were
 * empty in the only real export. A parcel carrying either of the first
 * two is FLAGGED for allocation by hand rather than read; a remittance
 * carrying the third is reported. Their meaning is Shiprocket's to state,
 * and a wrong guess here moves a seller's money.
 *
 * `Order Id` is Shiprocket's own order number: shown, never matched. The
 * waybill is the identifier both sides agree on — and a waybill Excel
 * stored as a number is read back as its exact digits.
 */
@Injectable()
export class ShiprocketRemittanceParser implements RemittanceParser {
  readonly courierCode = 'shiprocket';
  readonly requiredColumns = ['AWB', 'Order Value', 'CRF ID'] as const;
  readonly parcelSheet = SR_PARCEL_SHEET;

  parseRow(row: Record<string, string>, line: number): ParsedRemittanceRow | null {
    const awb = (row['AWB'] ?? '').trim();
    if (awb === '') return null;
    const adjusted = (row['total_adjusted_amt'] ?? '').trim();
    const linked = (row['Linked CRF Ids'] ?? '').trim();
    let flag: string | null = null;
    if (adjusted !== '' && money(adjusted)?.isZero() !== true) {
      flag = `Shiprocket adjusted this parcel by ${adjusted} (total_adjusted_amt) — allocate it by hand`;
    } else if (linked !== '') {
      flag = `Shiprocket links this parcel to other remittance(s) ${linked} — allocate it by hand`;
    }
    const value = (row['Order Value'] ?? '').trim();
    return {
      awbNumber: awb,
      settledInr: value,
      codAmountInr: value || null,
      status: (row['Courier'] ?? '').trim() || null,
      externalRef: (row['Order Id'] ?? '').trim() || null,
      line,
      flag,
    };
  }

  summarise(
    rows: readonly ParsedRemittanceRow[],
    records: readonly Record<string, string>[],
    sheet: SheetLookup,
  ): { summary: RemittanceFileSummary | null; warnings: string[] } {
    const warnings: string[] = [];
    const payoutRows = sheet(SR_PAYOUT_SHEET);
    if (payoutRows === null) {
      return {
        summary: null,
        warnings: [
          `This file has no "${SR_PAYOUT_SHEET}" sheet, so the remitted total and UTR could ` +
            'not be checked against the parcels. Compare the total with the bank credit by hand.',
        ],
      };
    }
    const payouts = toRecords(payoutRows);
    const missing = SR_PAYOUT_COLUMNS.filter((c) => !payouts.headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_COLUMNS_MISSING',
        message:
          `The "${SR_PAYOUT_SHEET}" sheet is missing column(s): ${missing.join(', ')} — ` +
          'this does not look like a Shiprocket remittance export.',
      });
    }

    // Each parcel's value, summed per CRF. Both sheets name the CRF.
    const byCrf = new Map<string, Prisma.Decimal>();
    records.forEach((rec, i) => {
      const parsed = rows.find((r) => r.line === i + 2);
      if (parsed === undefined) return;
      const crf = (rec['CRF ID'] ?? '').trim();
      const v = money(parsed.settledInr);
      if (v === null) return; // reported per row by the matcher
      byCrf.set(crf, (byCrf.get(crf) ?? new Prisma.Decimal(0)).add(v));
    });

    let remitted = new Prisma.Decimal(0);
    let cod = new Prisma.Decimal(0);
    let deducted = new Prisma.Decimal(0);
    const references: string[] = [];
    const seen = new Set<string>();

    for (const p of payouts.records) {
      const crf = (p['CRF ID'] ?? '').trim();
      if (crf === '') continue;
      seen.add(crf);
      const available = money(p['COD Available']);
      const amount = money(p['Remittance Amount']);
      const freight = moneyOrZero(p['Freight Charges from COD']);
      const early = moneyOrZero(p['Early COD Charges']);
      const rto = moneyOrZero(p['RTO Reversal Amount']);
      if (
        available === null ||
        amount === null ||
        freight === null ||
        early === null ||
        rto === null
      ) {
        throw new BadRequestException({
          code: 'REMITTANCE_TOTALS_UNREADABLE',
          message: `Remittance ${crf}: its amounts could not be read as numbers.`,
        });
      }
      const parcels = byCrf.get(crf) ?? new Prisma.Decimal(0);
      if (!parcels.equals(available)) {
        throw new BadRequestException({
          code: 'REMITTANCE_TOTALS_DISAGREE',
          message:
            `Remittance ${crf}: its parcels add up to ₹${parcels.toFixed(2)} but the ` +
            `"${SR_PAYOUT_SHEET}" sheet says ₹${available.toFixed(2)} was collected. The ` +
            "file's two sheets disagree, so nothing was allocated from it.",
        });
      }
      const kept = freight.add(early).add(rto);
      if (!available.sub(kept).equals(amount)) {
        warnings.push(
          `Remittance ${crf}: ₹${available.toFixed(2)} collected less ₹${kept.toFixed(2)} ` +
            `deducted is not the ₹${amount.toFixed(2)} Shiprocket says it remitted. Check the ` +
            'bank credit before recording.',
        );
      }
      const adjusted = (p['Adjusted Amount'] ?? '').trim();
      if (adjusted !== '' && money(adjusted)?.isZero() !== true) {
        warnings.push(`Remittance ${crf}: Shiprocket shows an adjustment of ${adjusted}.`);
      }
      const status = (p['Status'] ?? '').trim();
      if (!/success/i.test(status)) {
        warnings.push(
          `Remittance ${crf} is marked "${status || 'no status'}" by Shiprocket, not a success.`,
        );
      }
      if (!kept.isZero()) {
        warnings.push(
          `Remittance ${crf}: Shiprocket kept back ₹${kept.toFixed(2)} (freight ₹${freight.toFixed(2)}, ` +
            `early COD ₹${early.toFixed(2)}, RTO reversal ₹${rto.toFixed(2)}). Parcel lines show what ` +
            'was collected for each; the deduction is not split per parcel.',
        );
      }
      const utr = (p['UTR'] ?? '').trim();
      if (utr !== '' && !references.includes(utr)) references.push(utr);
      remitted = remitted.add(amount);
      cod = cod.add(available);
      deducted = deducted.add(kept);
    }

    const orphans = [...byCrf.keys()].filter((c) => !seen.has(c));
    if (orphans.length > 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_TOTALS_DISAGREE',
        message:
          `Parcels name remittance(s) ${orphans.join(', ')} that the "${SR_PAYOUT_SHEET}" ` +
          "sheet does not list. The file's two sheets disagree, so nothing was allocated from it.",
      });
    }
    if (references.length > 1) {
      warnings.push(
        `This file covers ${references.length} bank credits (UTR ${references.join(', ')}). A ` +
          'payout is one credit — record each separately.',
      );
    }

    return {
      summary: {
        references,
        remittedInr: remitted.toFixed(2),
        codInr: cod.toFixed(2),
        deductedInr: deducted.toFixed(2),
      },
      warnings,
    };
  }
}

interface Table {
  readonly headers: readonly string[];
  readonly records: readonly Record<string, string>[];
}

/** The first row is the header; every later row keyed by it. */
function toRecords(rows: readonly (readonly string[])[]): Table {
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = r[i] ?? '';
    });
    return rec;
  });
  return { headers, records };
}

@Injectable()
export class RemittanceParserRegistry {
  private readonly parsers: readonly RemittanceParser[];

  constructor(delhivery: DelhiveryRemittanceParser, shiprocket: ShiprocketRemittanceParser) {
    this.parsers = [delhivery, shiprocket];
  }

  /**
   * A courier is reached through the registry, never a branch at the
   * call site (CUR-12). A third courier is a class and one array entry.
   */
  for(courierCode: string): RemittanceParser {
    const found = this.parsers.find((p) => p.courierCode === courierCode);
    if (!found) {
      throw new BadRequestException({
        code: 'REMITTANCE_FORMAT_UNKNOWN',
        message:
          `No remittance file format is known for '${courierCode}'. ` +
          'Allocate its payout by hand, or send us one of their export files ' +
          'so the columns can be read rather than guessed.',
      });
    }
    return found;
  }

  /**
   * Split a file into rows. A string is CSV text; bytes are recognised by
   * their signature — an .xls or .xlsx workbook, else CSV text. Header
   * names are matched EXACTLY as the courier writes them: a file whose
   * columns were renamed is a different file, and quietly accepting it is
   * how the wrong column becomes the amount.
   */
  parse(courierCode: string, input: string | Buffer): RemittanceParseResult {
    const parser = this.for(courierCode);
    const { table, sheet } = this.table(parser, input);

    const missing = parser.requiredColumns.filter((c) => !table.headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_COLUMNS_MISSING',
        message:
          `This does not look like a ${courierCode} remittance export — ` +
          `missing column(s): ${missing.join(', ')}.`,
      });
    }

    const rows: ParsedRemittanceRow[] = [];
    table.records.forEach((raw, i) => {
      const parsed = parser.parseRow(raw, i + 2); // +2: 1-based, past the header
      if (parsed !== null) rows.push(parsed);
    });
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_EMPTY',
        message: 'No waybills found in this file.',
      });
    }
    const checked = parser.summarise?.(rows, table.records, sheet) ?? {
      summary: null,
      warnings: [],
    };
    return { rows, summary: checked.summary, warnings: checked.warnings };
  }

  private table(
    parser: RemittanceParser,
    input: string | Buffer,
  ): { table: Table; sheet: SheetLookup } {
    const none: SheetLookup = () => null;
    if (typeof input === 'string') return { table: this.csv(input), sheet: none };

    try {
      if (isXls(input)) {
        const wb = readXlsWorkbook(input);
        return {
          table: this.pickSheet(parser, wb.sheetNames, (n) => wb.sheet(n)),
          sheet: (n) => wb.sheet(n),
        };
      }
      if (input.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        const names = sheetNames(input);
        const lookup: SheetLookup = (n) => (names.includes(n) ? readSheet(input, n) : null);
        return { table: this.pickSheet(parser, names, lookup), sheet: lookup };
      }
    } catch (err) {
      if (err instanceof XlsError || err instanceof XlsxError) {
        throw new BadRequestException({
          code: 'REMITTANCE_FILE_UNREADABLE',
          message: `This spreadsheet could not be read: ${err.message}.`,
        });
      }
      throw err;
    }
    return { table: this.csv(input.toString('utf8')), sheet: none };
  }

  /** The courier's parcel sheet, or the only sheet when it names none. */
  private pickSheet(
    parser: RemittanceParser,
    names: readonly string[],
    lookup: SheetLookup,
  ): Table {
    const name = parser.parcelSheet ?? (names.length === 1 ? names[0] : undefined);
    const rows = name === undefined ? null : lookup(name);
    if (rows === null) {
      throw new BadRequestException({
        code: 'REMITTANCE_COLUMNS_MISSING',
        message:
          `This does not look like a ${parser.courierCode} remittance export — expected a sheet ` +
          `called "${parser.parcelSheet ?? '(one sheet)'}", found: ${names.join(', ') || 'none'}.`,
      });
    }
    return toRecords(rows);
  }

  private csv(text: string): Table {
    // An Excel "CSV UTF-8" save starts with a byte-order mark, which would
    // otherwise become part of the first column's name.
    const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    return { headers: result.meta.fields ?? [], records: result.data };
  }
}
