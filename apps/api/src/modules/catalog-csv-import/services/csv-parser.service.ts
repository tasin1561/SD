import { Injectable } from '@nestjs/common';
import Papa from 'papaparse';
import {
  CSV_REQUIRED_FIELDS,
  lookupFieldForHeader,
  suggestFieldForHeader,
  type CsvTargetField,
} from '../csv-fields';
import { stripCsvSeparatorHint } from '../../../common/text/csv-separator-hint';

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
}

export interface DetectedMapping {
  /** target field -> source header */
  mapping: Partial<Record<CsvTargetField, string>>;
  matchedHeaders: string[];
  unmatchedHeaders: Array<{ header: string; suggestion: CsvTargetField | null }>;
  missingRequired: CsvTargetField[];
}

export interface CoerceError {
  field?: string;
  reason: string;
}

export interface CoercedVariantRow {
  productName: string;
  productExternalRef?: string;
  variantSkuCode: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValueInr?: number;
  barcode?: string;
  attributes?: Record<string, string | number | boolean>;
  description?: string;
  /** "Black / Black". Derived from the attributes when no column states it. */
  variantLabel?: string;
  /** One picture, by URL. Fetched and stored after the row commits. */
  imageUrl?: string;
  lowStockThreshold?: number;
  gstRate?: number;
}

@Injectable()
export class CsvParserService {
  /**
   * Parse a CSV buffer. Strips a UTF-8 BOM, decodes as UTF-8, treats the
   * first row as the header, trims every header and cell, and drops fully
   * empty lines. Quoted fields (incl. embedded commas / newlines) are
   * handled by papaparse.
   */
  parse(buffer: Buffer): ParsedCsv {
    // BOM + Excel `sep=` hint line; delimiter stays unset (auto-detect) without one.
    const { text, delimiter } = stripCsvSeparatorHint(buffer.toString('utf8'));

    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      ...(delimiter !== undefined ? { delimiter } : {}),
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

  /**
   * Auto-detect which header feeds which catalog field. First header that
   * maps to a still-unassigned field wins; a header that would duplicate
   * an already-assigned field is reported as unmatched (ambiguous).
   */
  detectMapping(headers: string[]): DetectedMapping {
    const mapping: Partial<Record<CsvTargetField, string>> = {};
    const matchedHeaders: string[] = [];
    const unmatchedHeaders: Array<{ header: string; suggestion: CsvTargetField | null }> = [];

    for (const header of headers) {
      const field = lookupFieldForHeader(header);
      if (field && mapping[field] === undefined) {
        mapping[field] = header;
        matchedHeaders.push(header);
      } else {
        unmatchedHeaders.push({
          header,
          suggestion: suggestFieldForHeader(header),
        });
      }
    }

    const missingRequired = CSV_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    return { mapping, matchedHeaders, unmatchedHeaders, missingRequired };
  }

  /**
   * Turn one raw row into a typed variant row using the (possibly
   * seller-overridden) mapping. Collects per-field errors instead of
   * throwing so the caller can build a per-row error report. weightKg is
   * converted to grams (×1000) when weightGrams is not separately mapped.
   */
  coerceRow(
    raw: Record<string, string>,
    mapping: Partial<Record<CsvTargetField, string>>,
  ): { row: CoercedVariantRow | null; errors: CoerceError[] } {
    const errors: CoerceError[] = [];
    const get = (f: CsvTargetField): string | undefined => {
      const header = mapping[f];
      if (header === undefined) return undefined;
      const v = raw[header];
      if (v === undefined) return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    };
    const num = (f: CsvTargetField): number | undefined => {
      const v = get(f);
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push({ field: f, reason: `${f} is not a valid number: "${v}"` });
        return undefined;
      }
      return n;
    };

    const productName = get('productName');
    const variantSkuCode = get('variantSkuCode');
    if (!productName) errors.push({ field: 'productName', reason: 'productName is required' });
    if (!variantSkuCode)
      errors.push({ field: 'variantSkuCode', reason: 'variantSkuCode is required' });

    // Weight: prefer grams; fall back to kg×1000.
    let weightGrams: number | undefined;
    if (mapping.weightGrams !== undefined) {
      const g = num('weightGrams');
      if (g !== undefined) weightGrams = Math.round(g);
    } else if (mapping.weightKg !== undefined) {
      const kg = num('weightKg');
      if (kg !== undefined) weightGrams = Math.round(kg * 1000);
    }

    const attributes = this.parseAttributes(get('variantAttributes'), errors);

    if (errors.length > 0) return { row: null, errors };

    const row: CoercedVariantRow = {
      productName: productName as string,
      variantSkuCode: variantSkuCode as string,
    };
    const externalRef = get('productExternalRef');
    if (externalRef !== undefined) row.productExternalRef = externalRef;
    if (weightGrams !== undefined) row.weightGrams = weightGrams;
    const l = num('lengthCm');
    if (l !== undefined) row.lengthCm = l;
    const w = num('widthCm');
    if (w !== undefined) row.widthCm = w;
    const h = num('heightCm');
    if (h !== undefined) row.heightCm = h;
    const dv = num('declaredValueInr');
    if (dv !== undefined) row.declaredValueInr = dv;
    const bc = get('barcode');
    if (bc !== undefined) row.barcode = bc;
    if (attributes !== undefined) row.attributes = attributes;
    const desc = get('description');
    if (desc !== undefined) row.description = desc;
    const img = get('imageUrl');
    if (img !== undefined) row.imageUrl = img;
    const lst = num('lowStockThreshold');
    if (lst !== undefined) row.lowStockThreshold = Math.round(lst);
    const gst = num('gstRate');
    if (gst !== undefined) row.gstRate = gst;
    /*
      The variant's human name.

      Taken from the column when the file states one, and otherwise
      COMPOSED from the attributes the row already carries — "Black /
      Black" out of `{colour: Black, lens: Black}`. Deriving it is the
      point: nothing composed a label on import, so every CSV-created
      variant was unlabelled, and four SKUs of one product read as four
      identical rows in the picker and on the picking sheet. A file
      written before this existed gains labels without being edited.
    */
    const stated = get('variantLabel');
    if (stated !== undefined) {
      row.variantLabel = stated;
    } else if (attributes !== undefined) {
      const derived = Object.values(attributes)
        .map((v) => String(v).trim())
        .filter((v) => v !== '')
        .join(' / ');
      if (derived !== '') row.variantLabel = derived;
    }
    return { row, errors: [] };
  }

  private parseAttributes(
    raw: string | undefined,
    errors: CoerceError[],
  ): Record<string, string | number | boolean> | undefined {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;

    if (trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          errors.push({ field: 'variantAttributes', reason: 'attributes JSON must be an object' });
          return undefined;
        }
        const out: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            out[k] = v;
          } else {
            errors.push({
              field: 'variantAttributes',
              reason: `attribute "${k}" must be a primitive (string/number/boolean)`,
            });
          }
        }
        return out;
      } catch {
        errors.push({ field: 'variantAttributes', reason: 'attributes is not valid JSON' });
        return undefined;
      }
    }

    // "key=value;key=value" form — values stay strings (Phase 1A).
    const out: Record<string, string | number | boolean> = {};
    for (const pair of trimmed.split(';')) {
      const p = pair.trim();
      if (p === '') continue;
      const eq = p.indexOf('=');
      if (eq === -1) {
        errors.push({
          field: 'variantAttributes',
          reason: `attribute pair "${p}" is not in key=value form`,
        });
        continue;
      }
      const key = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      if (key === '') {
        errors.push({ field: 'variantAttributes', reason: 'attribute key is empty' });
        continue;
      }
      out[key] = value;
    }
    return out;
  }
}
