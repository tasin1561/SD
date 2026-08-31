import { BadRequestException, Injectable } from '@nestjs/common';
import Papa from 'papaparse';

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
}

export interface RemittanceParser {
  readonly courierCode: string;
  /** Columns that must be present, named as the courier writes them. */
  readonly requiredColumns: readonly string[];
  parseRow(row: Record<string, string>, line: number): ParsedRemittanceRow | null;
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
    };
  }
}

/**
 * Shiprocket's remittance export.
 *
 * DELIBERATELY NOT IMPLEMENTED. Guessing a column mapping for a file
 * nobody has seen is how money gets attributed to the wrong parcels
 * quietly — the shape would look right and the numbers would be wrong.
 * It refuses by name until somebody supplies a real export.
 */
@Injectable()
export class RemittanceParserRegistry {
  private readonly parsers: readonly RemittanceParser[];

  constructor(delhivery: DelhiveryRemittanceParser) {
    this.parsers = [delhivery];
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
   * Split a file into rows. Header names are matched EXACTLY as the
   * courier writes them: a file whose columns were renamed is a
   * different file, and quietly accepting it is how the wrong column
   * becomes the amount.
   */
  parse(courierCode: string, csvText: string): readonly ParsedRemittanceRow[] {
    const parser = this.for(courierCode);
    const result = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    const headers = result.meta.fields ?? [];
    const missing = parser.requiredColumns.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_COLUMNS_MISSING',
        message:
          `This does not look like a ${courierCode} remittance export — ` +
          `missing column(s): ${missing.join(', ')}.`,
      });
    }

    const rows: ParsedRemittanceRow[] = [];
    result.data.forEach((raw, i) => {
      const parsed = parser.parseRow(raw, i + 2); // +2: 1-based, past the header
      if (parsed !== null) rows.push(parsed);
    });
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'REMITTANCE_EMPTY',
        message: 'No waybills found in this file.',
      });
    }
    return rows;
  }
}
