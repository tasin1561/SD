import { Injectable } from '@nestjs/common';
import { PaymentMode } from '@skydrop/db';
import Papa from 'papaparse';
import {
  ORDER_CSV_REQUIRED_FIELDS,
  ignoredReasonForHeader,
  lookupFieldForHeader,
  orderCsvFieldLabel,
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
  /** Columns we know and deliberately do not use, each with the reason. */
  ignoredHeaders: Array<{ header: string; reason: string }>;
  missingRequired: OrderCsvField[];
}

export interface CoerceError {
  field?: string;
  reason: string;
}

/** One SKU × quantity. Several of these make one order (see `groupRows`). */
export interface CoercedOrderLine {
  productSku: string;
  quantity: number;
  /**
   * `*Unit Item Price` / `Retail Price`. On a reseller store's order this
   * is the RETAIL (RS-5); on a seller's own it lands on the line's
   * `unitPriceInr`, which the order model has always carried.
   */
  retailUnitPrice?: number;
}

/**
 * What ONE ROW states.
 *
 * Every order-level field is optional here because a multi-line order may
 * repeat the customer block on each of its rows or state it once and
 * leave the continuation rows blank — both shapes are in the wild, and
 * only the assembled ORDER has to be complete. `groupRows` is where
 * completeness is judged.
 */
export interface CoercedOrderRow extends CoercedOrderLine {
  externalRef: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  addressLine1?: string;
  /** The landmark — required on the assembled order. See ORD-5. */
  addressLine2?: string;
  landmark?: string;
  /** Optional: Delhivery resolves the locality from the PIN. */
  city?: string;
  state?: string;
  pinCode?: string;
  codAmount?: number;
  /** Stated `*Payment Mode`. Absent ⇒ inferred from the COD amount. */
  paymentMode?: PaymentMode;
  advanceAmount?: number;
  /** Raw `Discount Value` + `Discount Type`; resolved to rupees per group. */
  discountValue?: number;
  discountType?: string;
  totalWeightGrams?: number;
}

/** One order: its lines, plus the order-level block they agreed on. */
export interface CoercedOrderGroup {
  externalRef: string;
  /** 1-based file row numbers (header counted), in file order. */
  rowNumbers: number[];
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  addressLine1: string;
  addressLine2: string;
  landmark?: string;
  city?: string;
  state?: string;
  pinCode: string;
  codAmount?: number;
  paymentMode?: PaymentMode;
  advanceAmount?: number;
  /** Resolved to rupees — a percentage is applied to the group's own goods total. */
  discountInr?: number;
  totalWeightGrams?: number;
  lines: CoercedOrderLine[];
}

export interface GroupedCsv {
  groups: CoercedOrderGroup[];
  /** Every row that will not be imported, with why. */
  rowErrors: Array<{
    rowNumber: number;
    raw: Record<string, string>;
    errors: CoerceError[];
  }>;
}

/**
 * Required PER ROW. A continuation row of a multi-line order may state
 * nothing but these three, and must still be readable.
 */
const ROW_REQUIRED_FIELDS: OrderCsvField[] = ['productSku', 'quantity', 'externalRef'];

/**
 * Required on the ASSEMBLED ORDER. These are the columns
 * `ORDER_CSV_REQUIRED_FIELDS` demands be mapped, minus the per-row three
 * — derived from it rather than restated, because a second hand-written
 * copy of this list is exactly how `coerceRow` and the column check drifted
 * apart before (see `order-csv-required-fields.spec.ts`).
 */
const ORDER_REQUIRED_FIELDS: OrderCsvField[] = ORDER_CSV_REQUIRED_FIELDS.filter(
  (f) => !ROW_REQUIRED_FIELDS.includes(f),
);

/** `CreateOrderDto.items` takes 1–200 lines; so does one CSV order. */
const MAX_LINES_PER_ORDER = 200;

/** Order-level fields whose value must AGREE across a group's rows. */
const GROUPED_FIELDS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'addressLine1',
  'addressLine2',
  'landmark',
  'city',
  'state',
  'pinCode',
  'codAmount',
  'paymentMode',
  'advanceAmount',
  'discountValue',
  'discountType',
  'totalWeightGrams',
] as const;

type GroupedField = (typeof GROUPED_FIELDS)[number];

/**
 * A money cell as a spreadsheet writes it.
 *
 * `Number("15,000")` is NaN, and a thousands separator or a currency
 * symbol is a rendering of the same number, not a different one — so a
 * file exported from Excel would have failed every COD row on nothing.
 * Returns null when what is left is not a plain amount, so the caller
 * still refuses genuine rubbish by name.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[₹$]/g, '')
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Round to the paisa without the usual float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * An Indian mobile as another system writes it → E.164.
 *
 * Delhivery's own sample is `9999999999`: ten bare digits. Our API
 * demands E.164 at its boundary and should keep doing so (it is the rule
 * every other caller obeys), but a CSV is a file exported from somewhere
 * else, and the import boundary is exactly where a known national format
 * becomes the canonical one. Without this, EVERY row of a real Delhivery
 * file fails on the phone column.
 *
 * Anything not recognised is returned unchanged, so the address
 * validator still refuses it by name rather than this quietly inventing a
 * country code for it.
 */
export function normalizeIndianPhone(raw: string): string {
  const s = raw.replace(/[\s()\-.]/g, '');
  if (s.startsWith('+')) return s;
  if (/^00\d{7,}$/.test(s)) return `+${s.slice(2)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  return raw.trim();
}

/** `*Payment Mode` → our enum. Null when the word is not one we know. */
export function parsePaymentMode(raw: string): PaymentMode | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'cod' || s === 'cashondelivery' || s === 'cashondeliverycod') return PaymentMode.COD;
  if (s === 'prepaid' || s === 'paid' || s === 'online' || s === 'ppd') return PaymentMode.PREPAID;
  return null;
}

function isPercentageDiscount(discountType: string | undefined): boolean {
  if (discountType === undefined) return false;
  return /^(percentage|percent|pct|%)$/i.test(discountType.trim());
}

/** A group being assembled, row by row. */
interface PendingGroup {
  ref: string;
  rowNumbers: number[];
  raws: Record<string, string>[];
  lines: CoercedOrderLine[];
  order: Partial<Record<GroupedField, string | number | PaymentMode>>;
  /** Keyed by the row that broke it, so the report names the right one. */
  failures: Map<number, CoerceError[]>;
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

  /**
   * Auto-detect header → field. First header to claim a field wins.
   *
   * A header we do not know is never a failure — a seller pasting a
   * template they downloaded from their courier cannot delete the columns
   * that template requires. A header we DO know and deliberately do not
   * use is reported separately, with the reason, so nobody maps
   * `Pickup Location Name` onto something it is not.
   */
  detectMapping(headers: string[]): DetectedMapping {
    const mapping: Partial<Record<OrderCsvField, string>> = {};
    const matchedHeaders: string[] = [];
    const unmatchedHeaders: Array<{ header: string; suggestion: OrderCsvField | null }> = [];
    const ignoredHeaders: Array<{ header: string; reason: string }> = [];

    for (const header of headers) {
      const field = lookupFieldForHeader(header);
      if (field && mapping[field] === undefined) {
        mapping[field] = header;
        matchedHeaders.push(header);
        continue;
      }
      const reason = ignoredReasonForHeader(header);
      if (reason !== null) {
        ignoredHeaders.push({ header, reason });
      } else {
        unmatchedHeaders.push({ header, suggestion: suggestFieldForHeader(header) });
      }
    }
    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    return { mapping, matchedHeaders, unmatchedHeaders, ignoredHeaders, missingRequired };
  }

  /** One raw row → what that row states. Collects per-field errors instead
   *  of throwing so the caller can build a per-row error report. */
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

    // Only the three a CONTINUATION row of a multi-line order must carry.
    // The rest are judged on the assembled order in `groupRows` — a file
    // that states the customer block once and blanks it on the following
    // rows of the same order is a shape in the wild, and demanding it
    // per row would refuse every such file.
    // `quantity` is excluded because it gets its own numeric coercion
    // below and would otherwise be reported missing twice.
    const values: Partial<Record<OrderCsvField, string>> = {};
    for (const f of ROW_REQUIRED_FIELDS) {
      if (f === 'quantity') continue;
      const v = get(f);
      if (v === undefined) {
        errors.push({ field: f, reason: `${orderCsvFieldLabel(f)} is required` });
      } else {
        values[f] = v;
      }
    }

    let quantity: number | undefined;
    const qRaw = get('quantity');
    if (qRaw === undefined) {
      errors.push({ field: 'quantity', reason: 'quantity is required' });
    } else {
      const n = Number(qRaw.replace(/,/g, ''));
      if (!Number.isInteger(n) || n <= 0) {
        errors.push({
          field: 'quantity',
          reason: `quantity must be a positive integer: "${qRaw}"`,
        });
      } else {
        quantity = n;
      }
    }

    const money = (f: OrderCsvField): number | undefined => {
      const rawValue = get(f);
      if (rawValue === undefined) return undefined;
      const n = parseAmount(rawValue);
      if (n === null || n < 0 || round2(n) !== n) {
        errors.push({
          field: f,
          reason: `${f} must be a non-negative amount with at most 2 decimals: "${rawValue}"`,
        });
        return undefined;
      }
      return n;
    };
    const codAmount = money('codAmount');
    const advanceAmount = money('advanceAmount');
    const retailUnitPrice = money('retailUnitPrice');
    const discountValue = money('discountValue');

    let totalWeightGrams: number | undefined;
    const weightRaw = get('totalWeightGrams');
    if (weightRaw !== undefined) {
      const n = parseAmount(weightRaw);
      if (n === null || n < 0) {
        errors.push({
          field: 'totalWeightGrams',
          reason: `totalWeightGrams must be a non-negative number of grams: "${weightRaw}"`,
        });
      } else {
        totalWeightGrams = Math.round(n);
      }
    }

    let paymentMode: PaymentMode | undefined;
    const modeRaw = get('paymentMode');
    if (modeRaw !== undefined) {
      const parsed = parsePaymentMode(modeRaw);
      if (parsed === null) {
        errors.push({
          field: 'paymentMode',
          reason: `paymentMode must be "COD" or "Prepaid": "${modeRaw}"`,
        });
      } else {
        paymentMode = parsed;
      }
    }

    if (errors.length > 0) return { row: null, errors };

    const row: CoercedOrderRow = {
      productSku: values.productSku as string,
      quantity: quantity as number,
      externalRef: values.externalRef as string,
    };
    const set = <K extends keyof CoercedOrderRow>(key: K, v: CoercedOrderRow[K]): void => {
      if (v !== undefined) row[key] = v;
    };
    set('customerName', get('customerName'));
    set(
      'customerPhone',
      get('customerPhone') === undefined
        ? undefined
        : normalizeIndianPhone(get('customerPhone') as string),
    );
    set('customerEmail', get('customerEmail'));
    set('addressLine1', get('addressLine1'));
    set('addressLine2', get('addressLine2'));
    set('landmark', get('landmark'));
    // Optional, but honoured when a seller does supply them — a row that
    // carries a state is still checked against ops.allowed_indian_states.
    set('city', get('city'));
    set('state', get('state'));
    set('pinCode', get('pinCode'));
    set('codAmount', codAmount);
    set('paymentMode', paymentMode);
    set('advanceAmount', advanceAmount);
    set('discountValue', discountValue);
    set('discountType', get('discountType'));
    set('totalWeightGrams', totalWeightGrams);
    set('retailUnitPrice', retailUnitPrice);
    return { row, errors: [] };
  }

  /**
   * Rows → ORDERS (ORD-9, widened 2026-09-29).
   *
   * Rows sharing an `externalRef` are ONE order with several lines, which
   * is how Delhivery's bulk template expresses a multi-item order.
   * Grouping was not a Phase-2 feature waiting to be built: `create`
   * has always taken 1–200 lines. What existed before was WORSE than
   * unsupported — the second row found the first by its reference and
   * PATCHED it, so a two-item order silently became a one-item order
   * carrying the LAST row's SKU.
   *
   * ── AN INCONSISTENT ORDER IS REFUSED WHOLE ──────────────────────────
   * Order-level columns are expected to agree across a group (a file that
   * repeats the customer block repeats it identically; one that states it
   * once leaves the rest blank — first stated wins, and blanks never
   * overwrite). A row stating a DIFFERENT non-empty value is a file that
   * contradicts itself about one order, and there is no honest way to
   * pick a winner. When any row of a group fails — for that, or for its
   * own coercion — EVERY row of the group is refused, because importing
   * the readable ones would place an order the seller believes has more
   * lines than it does.
   */
  groupRows(
    rows: Array<Record<string, string>>,
    mapping: Partial<Record<OrderCsvField, string>>,
  ): GroupedCsv {
    const byRef = new Map<string, PendingGroup>();
    const rowErrors: GroupedCsv['rowErrors'] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      if (!raw) continue;
      const rowNumber = i + 2; // 1 header + 1-based

      const { row, errors } = this.coerceRow(raw, mapping);
      if (row === null) {
        // Unreadable, and we do not know which order it belonged to
        // unless it managed to state a reference.
        const ref = this.refOf(raw, mapping);
        if (ref === null) {
          rowErrors.push({ rowNumber, raw, errors });
          continue;
        }
        const g = this.pendingFor(byRef, ref);
        g.rowNumbers.push(rowNumber);
        g.raws.push(raw);
        g.failures.set(rowNumber, errors);
        continue;
      }

      const g = this.pendingFor(byRef, row.externalRef);
      g.rowNumbers.push(rowNumber);
      g.raws.push(raw);

      const conflicts: CoerceError[] = [];
      for (const field of GROUPED_FIELDS) {
        const v = row[field];
        if (v === undefined) continue; // a blank never overwrites
        const held = g.order[field];
        if (held === undefined) {
          g.order[field] = v;
        } else if (held !== v) {
          conflicts.push({
            field,
            reason: `${field} disagrees with an earlier row of order "${row.externalRef}": "${String(held)}" vs "${String(v)}"`,
          });
        }
      }
      if (conflicts.length > 0) {
        g.failures.set(rowNumber, conflicts);
        continue;
      }

      const line: CoercedOrderLine = { productSku: row.productSku, quantity: row.quantity };
      if (row.retailUnitPrice !== undefined) line.retailUnitPrice = row.retailUnitPrice;
      g.lines.push(line);
    }

    const groups: CoercedOrderGroup[] = [];
    for (const g of byRef.values()) {
      const problems = new Map(g.failures);

      // Completeness is judged HERE, on the assembled order.
      const missing: CoerceError[] = [];
      for (const f of ORDER_REQUIRED_FIELDS) {
        if (g.order[f as GroupedField] === undefined) {
          missing.push({
            field: f,
            reason:
              f === 'addressLine2'
                ? // ORD-5: line 2 is the landmark, and the courier address is
                  // line 1 + line 2 — nothing else reaches the driver. Say what
                  // it is, not just that a column is empty.
                  `${orderCsvFieldLabel(f as OrderCsvField)} is required — it is the landmark, and it is the part of the address that makes a delivery findable. Delhivery's template leaves it optional; ours does not.`
                : `${orderCsvFieldLabel(f as OrderCsvField)} is required`,
          });
        }
      }
      if (missing.length > 0) {
        const first = g.rowNumbers[0] ?? 0;
        problems.set(first, [...(problems.get(first) ?? []), ...missing]);
      }

      if (g.lines.length > MAX_LINES_PER_ORDER) {
        const first = g.rowNumbers[0] ?? 0;
        problems.set(first, [
          ...(problems.get(first) ?? []),
          {
            field: 'externalRef',
            reason: `order "${g.ref}" has ${g.lines.length} lines; the limit is ${MAX_LINES_PER_ORDER}`,
          },
        ]);
      }

      const mode = g.order.paymentMode as PaymentMode | undefined;
      const cod = g.order.codAmount as number | undefined;
      if (mode === PaymentMode.COD && (cod === undefined || cod <= 0)) {
        const first = g.rowNumbers[0] ?? 0;
        problems.set(first, [
          ...(problems.get(first) ?? []),
          {
            field: 'codAmount',
            reason: `order "${g.ref}" is marked COD but states no amount to collect`,
          },
        ]);
      }
      if (mode === PaymentMode.PREPAID && cod !== undefined && cod > 0) {
        // Silently dropping it would send a parcel the seller expects to
        // be paid for and collect nothing.
        const first = g.rowNumbers[0] ?? 0;
        problems.set(first, [
          ...(problems.get(first) ?? []),
          {
            field: 'paymentMode',
            reason: `order "${g.ref}" is marked Prepaid but states a COD amount of ${cod} — say which one is true`,
          },
        ]);
      }

      if (problems.size > 0) {
        for (let i = 0; i < g.rowNumbers.length; i++) {
          const rowNumber = g.rowNumbers[i] ?? 0;
          const raw = g.raws[i] ?? {};
          const own = problems.get(rowNumber);
          rowErrors.push({
            rowNumber,
            raw,
            errors:
              own !== undefined && own.length > 0
                ? own
                : [
                    {
                      field: 'externalRef',
                      reason: `not imported: another row of order "${g.ref}" could not be read, and half an order is worse than none`,
                    },
                  ],
          });
        }
        continue;
      }

      groups.push(this.assemble(g.ref, g.rowNumbers, g.order, g.lines));
    }

    rowErrors.sort((a, b) => a.rowNumber - b.rowNumber);
    return { groups, rowErrors };
  }

  // ── internal ──────────────────────────────────────────────────────

  private refOf(
    raw: Record<string, string>,
    mapping: Partial<Record<OrderCsvField, string>>,
  ): string | null {
    const header = mapping.externalRef;
    if (header === undefined) return null;
    const v = raw[header];
    const t = v === undefined ? '' : v.trim();
    return t === '' ? null : t;
  }

  private pendingFor(byRef: Map<string, PendingGroup>, ref: string): PendingGroup {
    const existing = byRef.get(ref);
    if (existing !== undefined) return existing;
    const created: PendingGroup = {
      ref,
      rowNumbers: [],
      raws: [],
      lines: [],
      order: {},
      failures: new Map(),
    };
    byRef.set(ref, created);
    return created;
  }

  private assemble(
    ref: string,
    rowNumbers: number[],
    order: Partial<Record<GroupedField, string | number | PaymentMode>>,
    lines: CoercedOrderLine[],
  ): CoercedOrderGroup {
    const str = (f: GroupedField): string | undefined => {
      const v = order[f];
      return typeof v === 'string' ? v : undefined;
    };
    const num = (f: GroupedField): number | undefined => {
      const v = order[f];
      return typeof v === 'number' ? v : undefined;
    };

    const group: CoercedOrderGroup = {
      externalRef: ref,
      rowNumbers,
      customerName: str('customerName') ?? '',
      customerPhone: str('customerPhone') ?? '',
      addressLine1: str('addressLine1') ?? '',
      addressLine2: str('addressLine2') ?? '',
      pinCode: str('pinCode') ?? '',
      lines,
    };
    const set = <K extends keyof CoercedOrderGroup>(key: K, v: CoercedOrderGroup[K]): void => {
      if (v !== undefined) group[key] = v;
    };
    set('customerEmail', str('customerEmail'));
    set('landmark', str('landmark'));
    set('city', str('city'));
    set('state', str('state'));
    set('codAmount', num('codAmount'));
    set('advanceAmount', num('advanceAmount'));
    set('totalWeightGrams', num('totalWeightGrams'));
    const mode = order.paymentMode;
    if (mode === PaymentMode.COD || mode === PaymentMode.PREPAID) group.paymentMode = mode;

    /*
      `Discount Value` → rupees.

      Delhivery's discount is a VALUE plus a TYPE. A flat one is already
      rupees; a percentage needs a base, and the only base the file gives
      is the goods total of this order — Σ(unit item price × qty) — so
      that is what it is applied to, and a group that states no unit price
      records no discount rather than a figure invented from a base we do
      not have.

      This never moves the COLLECTABLE: `codAmount` is authoritative and
      already has the discount inside it. `OrderService.create` keeps
      advance / delivery fee / discount as "the figures the collectable
      was built from" and re-applies none of them, which is exactly the
      readback this is for.
    */
    const discountValue = num('discountValue');
    if (discountValue !== undefined && discountValue > 0) {
      if (!isPercentageDiscount(str('discountType'))) {
        group.discountInr = discountValue;
      } else {
        const priced = lines.every((l) => l.retailUnitPrice !== undefined);
        if (priced) {
          const base = lines.reduce((s, l) => s + (l.retailUnitPrice ?? 0) * l.quantity, 0);
          group.discountInr = round2((base * discountValue) / 100);
        }
      }
    }
    return group;
  }
}
