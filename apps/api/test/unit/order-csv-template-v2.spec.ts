import { PaymentMode } from '@skydrop/db';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { TEMPLATE_COLUMNS } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import {
  OrderCsvParserService,
  EXCEL_MANGLED_NUMBER,
  expandExcelScientificPhone,
} from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import {
  ORDER_CSV_ALIAS_MAP,
  ORDER_CSV_IGNORED_HEADERS,
  ORDER_CSV_REQUIRED_FIELDS,
  ignoredReasonForHeader,
  lookupFieldForHeader,
  normalizeHeader,
  type OrderCsvField,
} from '../../src/modules/order-csv-import/order-csv-fields';
import { buildOrderColumnGuide } from '../../src/modules/order-csv-import/order-csv-column-guide';

const UNUSED = undefined as never;
const BOM = '﻿';
const ALL_OFF = { orderDeliveryFee: false, orderDiscount: false, orderDeclaredValue: false };

/** The owner's file (2026-10-27), byte for byte after the BOM + `sep=,` prefix. */
const OWNER_TEMPLATE =
  `${BOM}sep=,\n` +
  'Order ID,Payment Mode,Pickup Location,Transport Mode,Customer Name,Customer Phone,Customer Email(Optional),Address Line1,Address Line2,City,State,Pin Code,Product SKU,Quantity,Unit Price,Advanced Amount(Optional),COD Amount,Packaging Type,Length (cm),Breadth (cm),Height (cm),Volumetric Product Weight (gm),Billing Address same as Shipping Address,Billing Address Line1,Billing Address Line2,Billing City,Billing State,Billing Pincode\n' +
  'SD-1001,COD,Skydrop,Surface,Asha Verma,9876543210,asha@example.com,12 MG Road,Near City Hospital,Bengaluru,Karnataka,560001,TSHIRT-001-RED-M,1,1500,,1500,Flyer,18,13,3,170,YES,,,,,\n' +
  'SD-1002,Prepaid,Skydrop,Surface,Rahul Nair,9812345678,rahul@example.com,44 Linking Road,Opposite Bata Showroom,Mumbai,Maharashtra,400050,CAP-001-NAVY,2,850,,,Flyer,15,10,5,110,YES,,,,,\n' +
  'SD-1003,COD,Skydrop,Surface,Priya Menon,9700112233,priya@example.com,8 Residency Road,Beside Jyothi Theatre,Kochi,Kerala,682016,TSHIRT-001-RED-M,1,1500,,2350,Flyer,18,13,3,170,YES,,,,,\n' +
  'SD-1003,COD,Skydrop,Surface,Priya Menon,9700112233,priya@example.com,8 Residency Road,Beside Jyothi Theatre,Kochi,Kerala,682016,CAP-001-NAVY,1,850,,2350,Flyer,15,10,5,110,YES,,,,,\n';

const parser = new OrderCsvParserService();
const template = new OrderCsvImportService(UNUSED, UNUSED, UNUSED, UNUSED, UNUSED, UNUSED);

describe('the owner order template (buildTemplate)', () => {
  const csv = template.buildTemplate();

  it('emits the owner file byte for byte, with ONE sep=, prefix', () => {
    expect(csv).toBe(OWNER_TEMPLATE);
    expect(csv.split('sep=,').length - 1).toBe(1);
  });

  it('keeps the (Optional) suffix spelling exactly', () => {
    const header = csv.split('\n')[1] ?? '';
    expect(header).toContain('Customer Email(Optional)');
    expect(header).toContain('Advanced Amount(Optional)');
  });

  it('round-trips through its own parser: headers exact, all four sample rows parse', () => {
    const parsed = parser.parse(Buffer.from(csv, 'utf8'));
    expect(parsed.headers.join(',')).toBe((OWNER_TEMPLATE.split('\n')[1] ?? '').trim());
    expect(parsed.rowCount).toBe(4);
    const detected = parser.detectMapping(parsed.headers);
    expect(detected.missingRequired).toEqual([]);
    expect(detected.unmatchedHeaders).toEqual([]);
    const { groups, rowErrors } = parser.groupRows(parsed.rows, detected.mapping);
    expect(rowErrors).toEqual([]);
    expect(groups.map((g) => g.externalRef)).toEqual(['SD-1001', 'SD-1002', 'SD-1003']);
  });

  it('SD-1003 is ONE order with two lines (ORD-9)', () => {
    const parsed = parser.parse(Buffer.from(csv, 'utf8'));
    const { groups } = parser.groupRows(parsed.rows, parser.detectMapping(parsed.headers).mapping);
    const g = groups.find((x) => x.externalRef === 'SD-1003');
    expect(g?.lines.map((l) => l.productSku)).toEqual(['TSHIRT-001-RED-M', 'CAP-001-NAVY']);
    expect(g?.codAmount).toBe(2350);
    expect(groups.find((x) => x.externalRef === 'SD-1002')?.paymentMode).toBe(PaymentMode.PREPAID);
  });

  it('a row whose Payment Mode and COD Amount contradict is still an error row by name (ORD-9b)', () => {
    const parsed = parser.parse(Buffer.from(csv, 'utf8'));
    const rows = parsed.rows.map((r) =>
      r['Order ID'] === 'SD-1002' ? { ...r, 'COD Amount': '999' } : r,
    );
    const { rowErrors } = parser.groupRows(rows, parser.detectMapping(parsed.headers).mapping);
    expect(
      rowErrors.find((r) =>
        r.errors.some((e) => /marked Prepaid but states a COD amount/.test(e.reason)),
      ),
    ).toBeDefined();
  });
});

describe('headers the owner template introduced', () => {
  it.each([
    ['Customer Email(Optional)', null, /we do not email/],
    ['Advanced Amount(Optional)', 'advanceAmount', null],
    ['Pickup Location', null, /warehouse and the pickup location/],
    ['Volumetric Product Weight (gm)', null, /parcel weight/],
    ['Customer Phone (Mandatory)', 'customerPhone', null],
    ['Customer Phone*', 'customerPhone', null],
  ] as const)('%s', (header, field, reason) => {
    expect(lookupFieldForHeader(header)).toBe(field);
    if (reason === null) expect(ignoredReasonForHeader(header)).toBeNull();
    else expect(ignoredReasonForHeader(header)).toMatch(reason);
  });

  it('strips a TRAILING marker only, never one mid-name', () => {
    expect(normalizeHeader('Customer Email(Optional)')).toBe('customer email');
    expect(normalizeHeader('Optional Notes')).toBe('optional notes');
    expect(normalizeHeader('Required Delivery Date')).toBe('required delivery date');
    expect(normalizeHeader('optional')).toBe('optional');
  });

  it('no real alias or ignored header ends in a marker word, so the strip is safe', () => {
    const all = [
      ...Object.values(ORDER_CSV_ALIAS_MAP).flat(),
      ...Object.keys(ORDER_CSV_IGNORED_HEADERS),
    ];
    for (const k of all) expect(k).not.toMatch(/(^|[^a-z0-9])(optional|mandatory|required)$/i);
  });
});

describe('anti-regression: everything that resolved before still resolves', () => {
  it('every alias maps to its field', () => {
    for (const [field, aliases] of Object.entries(ORDER_CSV_ALIAS_MAP) as [
      OrderCsvField,
      string[],
    ][]) {
      for (const a of aliases) {
        // `first claim wins` in the index; an alias shared between fields would show here.
        expect([a, lookupFieldForHeader(a)]).toEqual([a, field]);
      }
    }
  });
  it('every ignored header is still ignored, with its reason', () => {
    for (const [key, reason] of Object.entries(ORDER_CSV_IGNORED_HEADERS)) {
      expect(ignoredReasonForHeader(key)).toBe(reason);
      expect(lookupFieldForHeader(key)).toBeNull();
    }
  });
});

describe('a phone Excel turned into a number', () => {
  const base = {
    'Order ID': 'X1',
    'Customer Name': 'A',
    'Customer Phone': '9.19877E+11',
    'Address Line1': '1 Road',
    'Address Line2': 'Near X',
    'Pin Code': '560001',
    'Product SKU': 'S',
    Quantity: '1',
  };
  const mapping = parser.detectMapping(Object.keys(base)).mapping;

  it('is refused, naming the cause and the fix — never guessed back', () => {
    const { groups, rowErrors } = parser.groupRows([base], mapping);
    expect(groups).toEqual([]);
    const reason = rowErrors[0]?.errors[0]?.reason ?? '';
    expect(reason).toContain('9.19877E+11');
    expect(reason).toMatch(/Excel/);
    expect(reason).toMatch(/Text/);
  });

  it('a LOSSLESS scientific value imports silently as the right E.164 number', () => {
    const { groups, rowErrors } = parser.groupRows(
      [{ ...base, 'Customer Phone': '9.19876543210E+11' }],
      mapping,
    );
    expect(rowErrors).toEqual([]);
    expect(groups[0]?.customerPhone).toBe('+919876543210');
  });

  it('boundary: exactly enough mantissa digits passes, one fewer is refused', () => {
    expect(expandExcelScientificPhone('9.19876543210E+11')).toEqual({
      kind: 'lossless',
      digits: '919876543210',
    });
    expect(expandExcelScientificPhone('9.1987654321E+11').kind).toBe('lossy');
    expect(expandExcelScientificPhone('9.19877E+11').kind).toBe('lossy');
    expect(expandExcelScientificPhone('9876543210').kind).toBe('not-scientific');
  });

  it('the shipped template sample phones (ten bare digits) normalise to E.164', () => {
    const parsed = parser.parse(Buffer.from(template.buildTemplate(), 'utf8'));
    const { groups } = parser.groupRows(parsed.rows, parser.detectMapping(parsed.headers).mapping);
    expect(groups.map((g) => g.customerPhone)).toEqual([
      '+919876543210',
      '+919812345678',
      '+919700112233',
    ]);
  });

  it('only matches the scientific shape', () => {
    for (const s of ['9.19877E+11', '9E11', '1.5e-3'])
      expect(EXCEL_MANGLED_NUMBER.test(s)).toBe(true);
    for (const s of ['919876543210', '+919876543210', '98765 43210', 'E11'])
      expect(EXCEL_MANGLED_NUMBER.test(s)).toBe(false);
  });

  it('leaves a real phone alone', () => {
    const { groups, rowErrors } = parser.groupRows(
      [{ ...base, 'Customer Phone': '9876543210' }],
      mapping,
    );
    expect(rowErrors).toEqual([]);
    expect(groups[0]?.customerPhone).toBe('+919876543210');
  });
});

describe('the glossary guide: three states', () => {
  const g = buildOrderColumnGuide(TEMPLATE_COLUMNS, ORDER_CSV_REQUIRED_FIELDS, ALL_OFF);
  const byHeader = (h: string) => g.columns.find((c) => c.header === h);

  it('Yes (every row / once per order), No (optional) and Not used', () => {
    expect(byHeader('Order ID')?.level).toBe('EVERY_ROW');
    expect(byHeader('Address Line2')?.level).toBe('ONCE_PER_ORDER');
    expect(byHeader('Customer Phone')?.level).toBe('ONCE_PER_ORDER');
    expect(byHeader('COD Amount')?.level).toBe('OPTIONAL');
    expect(byHeader('Advanced Amount(Optional)')?.level).toBe('OPTIONAL');
    expect(byHeader('Pickup Location')?.level).toBe('NOT_USED');
    expect(byHeader('Billing Pincode')?.level).toBe('NOT_USED');
    expect(byHeader('Customer Email(Optional)')?.level).toBe('NOT_USED');
  });

  it('a column in the ignored map can never be "optional"', () => {
    for (const [h] of TEMPLATE_COLUMNS) {
      if (ignoredReasonForHeader(h) === null) continue;
      const c = byHeader(h);
      expect(c?.level).toBe('NOT_USED');
      expect(c?.description).toBe(ignoredReasonForHeader(h));
    }
  });

  it('SAMPLE comes from the template row itself', () => {
    expect(byHeader('Order ID')?.sample).toBe('SD-1001');
    expect(byHeader('Customer Phone')?.sample).toBe('9876543210');
    expect(byHeader('Advanced Amount(Optional)')?.sample).toBe('');
  });
});
