import { buildCatalogColumnGuide } from '../../src/modules/catalog-csv-import/catalog-csv-column-guide';
import { CSV_REQUIRED_FIELDS } from '../../src/modules/catalog-csv-import/csv-fields';
import { TEMPLATE_COLUMNS as CATALOG_TEMPLATE } from '../../src/modules/catalog-csv-import/services/csv-import.service';
import {
  UAT_CONTROLLED_ORDER_FIELDS,
  buildOrderColumnGuide,
} from '../../src/modules/order-csv-import/order-csv-column-guide';
import {
  ORDER_CSV_REQUIRED_FIELDS,
  ORDER_CSV_STORE_REQUIRED_FIELDS,
  ignoredReasonForHeader,
  lookupFieldForHeader,
} from '../../src/modules/order-csv-import/order-csv-fields';
import { TEMPLATE_COLUMNS } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { STORE_TEMPLATE_COLUMNS } from '../../src/modules/order-csv-import/services/store-order-csv-import.service';
import {
  ORDER_REQUIRED_FIELDS,
  OrderCsvParserService,
  ROW_REQUIRED_FIELDS,
} from '../../src/modules/order-csv-import/services/order-csv-parser.service';

/**
 * The upload pages list required/optional columns from these guides, and the
 * guides are derived from the importers' own sets. These tests pin that: if a
 * field becomes required (or stops being), the page changes with it, and what
 * the page calls required is what the importer actually refuses.
 */
const NONE = { orderDeliveryFee: false, orderDiscount: false, orderDeclaredValue: false };
const ALL = { orderDeliveryFee: true, orderDiscount: true, orderDeclaredValue: true };
const seller = TEMPLATE_COLUMNS;
const store = STORE_TEMPLATE_COLUMNS;

const fieldsAt = (g: ReturnType<typeof buildOrderColumnGuide>, level: string): string[] =>
  g.columns.filter((c) => c.level === level).map((c) => c.field);

describe.each([
  ['seller', seller, ORDER_CSV_REQUIRED_FIELDS],
  ['store', store, ORDER_CSV_STORE_REQUIRED_FIELDS],
] as const)('order column guide (%s)', (_n, headers, required) => {
  const g = buildOrderColumnGuide(headers, required, NONE);

  it('required columns are exactly the importer required set, split into the two grains', () => {
    expect(fieldsAt(g, 'EVERY_ROW').sort()).toEqual([...ROW_REQUIRED_FIELDS].sort());
    expect(fieldsAt(g, 'ONCE_PER_ORDER').sort()).toEqual([...ORDER_REQUIRED_FIELDS].sort());
    expect([...fieldsAt(g, 'EVERY_ROW'), ...fieldsAt(g, 'ONCE_PER_ORDER')].sort()).toEqual(
      [...required].sort(),
    );
  });

  it('Address Line2 is judged once per order (landmark), not per row', () => {
    expect(fieldsAt(g, 'ONCE_PER_ORDER')).toContain('addressLine2');
  });

  it('every template header the importer uses appears, with no duplicates', () => {
    const fields = g.columns.map((c) => c.field);
    expect(new Set(fields).size).toBe(fields.length);
    for (const [h = ''] of headers) {
      const f = lookupFieldForHeader(h);
      // A column we ship but the importer ignores (Customer Email) is not
      // advertised as a column that does anything.
      if (f === null) expect(ignoredReasonForHeader(h)).not.toBeNull();
      else expect(fields).toContain(f);
    }
  });

  it('what the guide calls once-per-order, the importer really refuses when missing', () => {
    const parser = new OrderCsvParserService();
    const full: Record<string, string> = Object.fromEntries(
      TEMPLATE_COLUMNS.map(([h, v]) => [h, v ?? '']),
    );
    const mapping = parser.detectMapping(Object.keys(full)).mapping;
    for (const f of fieldsAt(g, 'ONCE_PER_ORDER')) {
      const header = mapping[f as keyof typeof mapping];
      if (header === undefined) continue;
      const out = parser.groupRows([{ ...full, [header]: '' }], mapping);
      expect(out.groups.length === 0 || out.rowErrors.length > 0).toBe(true);
    }
  });
});

describe('order column guide: UAT-controlled columns follow the CURRENT state', () => {
  it('hidden fields are absent', () => {
    const fields = buildOrderColumnGuide(seller, ORDER_CSV_REQUIRED_FIELDS, NONE).columns.map(
      (c) => c.field,
    );
    for (const f of Object.keys(UAT_CONTROLLED_ORDER_FIELDS)) expect(fields).not.toContain(f);
  });
  it('shown fields are listed, optional and flagged', () => {
    const cols = buildOrderColumnGuide(seller, ORDER_CSV_REQUIRED_FIELDS, ALL).columns;
    for (const f of ['deliveryFee', 'discountValue', 'declaredValue']) {
      const c = cols.find((x) => x.field === f);
      expect(c).toMatchObject({ level: 'OPTIONAL', uatControlled: true });
    }
  });
  it('one switch drives only its own columns', () => {
    const cols = buildOrderColumnGuide(seller, ORDER_CSV_REQUIRED_FIELDS, {
      ...NONE,
      orderDiscount: true,
    }).columns.map((c) => c.field);
    expect(cols).toContain('discountValue');
    expect(cols).not.toContain('deliveryFee');
  });
});

describe('catalog column guide', () => {
  const g = buildCatalogColumnGuide(CATALOG_TEMPLATE);
  it('required columns are exactly CSV_REQUIRED_FIELDS, all per row', () => {
    expect(
      g.columns
        .filter((c) => c.level === 'EVERY_ROW')
        .map((c) => c.field)
        .sort(),
    ).toEqual([...CSV_REQUIRED_FIELDS].sort());
    expect(g.columns.some((c) => c.level === 'ONCE_PER_ORDER')).toBe(false);
  });
  it('lists every template column', () => {
    expect(g.columns).toHaveLength(CATALOG_TEMPLATE.length);
  });
});
