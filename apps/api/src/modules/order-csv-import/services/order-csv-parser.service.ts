import { Injectable } from '@nestjs/common';
import Papa from 'papaparse';
import {
  ORDER_CSV_REQUIRED_FIELDS,
  lookupFieldForHeader,
  suggestFieldForHeader,
  type OrderCsvField,
} from '../order-csv-fields';

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
}

export interface DetectedMapping {
  mapping: Partial<Record<OrderCsvField, string>>;
  matchedHeaders: string[];
  unmatchedHeaders: Array<{ header: string; suggestion: OrderCsvField | null }>;
  missingRequired: OrderCsvField[];
}

export interface CoerceError {
  field?: string;
  reason: string;
}

export interface CoercedOrderRow {
  productSku: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  pinCode: string;
  codAmount?: number;
  externalRef: string;
}

@Injectable()
export class OrderCsvParserService {
  /** Parse a CSV buffer (BOM-stripped, UTF-8, header row, trimmed). */
  parse(buffer: Buffer): ParsedCsv {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      transform: (v) => (typeof v === 'string' ? v.trim() : v),
    });

    const headers = (result.meta.fields ?? []).map((h) => h.trim());
    const rows = (result.data ?? []).filter((r) =>
      Object.values(r).some((v) => v !== undefined && v !== ''),
    );
    return { headers, rows, rowCount: rows.length };
  }

  /** Auto-detect header → field. First header to claim a field wins;
   *  duplicates / unknowns are reported as unmatched. */
  detectMapping(headers: string[]): DetectedMapping {
    const mapping: Partial<Record<OrderCsvField, string>> = {};
    const matchedHeaders: string[] = [];
    const unmatchedHeaders: Array<{ header: string; suggestion: OrderCsvField | null }> = [];

    for (const header of headers) {
      const field = lookupFieldForHeader(header);
      if (field && mapping[field] === undefined) {
        mapping[field] = header;
        matchedHeaders.push(header);
      } else {
        unmatchedHeaders.push({ header, suggestion: suggestFieldForHeader(header) });
      }
    }
    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    return { mapping, matchedHeaders, unmatchedHeaders, missingRequired };
  }

  /** One raw row → typed order row. Collects per-field errors instead of
   *  throwing so the caller can build a per-row error report. */
  coerceRow(
    raw: Record<string, string>,
    mapping: Partial<Record<OrderCsvField, string>>,
  ): { row: CoercedOrderRow | null; errors: CoerceError[] } {
    const errors: CoerceError[] = [];
    const get = (f: OrderCsvField): string | undefined => {
      const header = mapping[f];
      if (header === undefined) return undefined;
      const v = raw[header];
      if (v === undefined) return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    };

    const required: OrderCsvField[] = [
      'productSku',
      'customerName',
      'customerPhone',
      'addressLine1',
      'city',
      'state',
      'pinCode',
      'externalRef',
    ];
    const values: Partial<Record<OrderCsvField, string>> = {};
    for (const f of required) {
      const v = get(f);
      if (v === undefined) {
        errors.push({ field: f, reason: `${f} is required` });
      } else {
        values[f] = v;
      }
    }

    let quantity: number | undefined;
    const qRaw = get('quantity');
    if (qRaw === undefined) {
      errors.push({ field: 'quantity', reason: 'quantity is required' });
    } else {
      const n = Number(qRaw);
      if (!Number.isInteger(n) || n <= 0) {
        errors.push({
          field: 'quantity',
          reason: `quantity must be a positive integer: "${qRaw}"`,
        });
      } else {
        quantity = n;
      }
    }

    let codAmount: number | undefined;
    const codRaw = get('codAmount');
    if (codRaw !== undefined) {
      const n = Number(codRaw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push({
          field: 'codAmount',
          reason: `codAmount must be a non-negative number: "${codRaw}"`,
        });
      } else {
        codAmount = n;
      }
    }

    if (errors.length > 0) return { row: null, errors };

    const row: CoercedOrderRow = {
      productSku: values.productSku as string,
      quantity: quantity as number,
      customerName: values.customerName as string,
      customerPhone: values.customerPhone as string,
      addressLine1: values.addressLine1 as string,
      city: values.city as string,
      state: values.state as string,
      pinCode: values.pinCode as string,
      externalRef: values.externalRef as string,
    };
    const email = get('customerEmail');
    if (email !== undefined) row.customerEmail = email;
    const line2 = get('addressLine2');
    if (line2 !== undefined) row.addressLine2 = line2;
    const landmark = get('landmark');
    if (landmark !== undefined) row.landmark = landmark;
    if (codAmount !== undefined) row.codAmount = codAmount;
    return { row, errors: [] };
  }
}
