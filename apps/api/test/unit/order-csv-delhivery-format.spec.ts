import { PaymentMode } from '@skydrop/db';
import {
  ORDER_CSV_IGNORED_HEADERS,
  ignoredReasonForHeader,
  lookupFieldForHeader,
  normalizeHeader,
  suggestFieldForHeader,
} from '../../src/modules/order-csv-import/order-csv-fields';
import {
  OrderCsvParserService,
  normalizeIndianPhone,
  parsePaymentMode,
} from '../../src/modules/order-csv-import/services/order-csv-parser.service';
import { OrderCsvImportService } from '../../src/modules/order-csv-import/services/order-csv-import.service';
import { StoreOrderCsvImportService } from '../../src/modules/order-csv-import/services/store-order-csv-import.service';

/**
 * `buildTemplate` reads nothing off its dependencies — it is a constant
 * list of columns joined with commas — so the real services are built
 * with unused stubs rather than the template being copied into this file,
 * which is the drift the round-trip below exists to catch.
 */
/** `never` is assignable to every parameter, so nothing here claims a shape. */
const UNUSED = undefined as never;
function buildSellerTemplateForTest(): string {
  return new OrderCsvImportService(UNUSED, UNUSED, UNUSED, UNUSED, UNUSED, UNUSED).buildTemplate();
}
function buildStoreTemplateForTest(): string {
  return new StoreOrderCsvImportService(
    UNUSED,
    UNUSED,
    UNUSED,
    UNUSED,
    UNUSED,
    UNUSED,
  ).buildTemplate();
}

/**
 * Delhivery One's "Bulk Upload Orders" template, verbatim — the file
 * sellers already have, and the one we promised to accept as it comes.
 * The `*` is their mandatory marker and is part of the header text.
 */
const DELHIVERY_HEADER =
  '*Sale Order Number,*Pickup Location Name,*Transport Mode,*Payment Mode,COD Amount,' +
  '*Customer Name,*Customer Phone,*Shipping Address Line1,Shipping Address Line2,' +
  '*Shipping City,*Shipping State,*Shipping Pincode,*Item Sku Code,*Item Sku Name,' +
  '*Quantity Ordered,*Unit Item Price,Package Name,Packaging Type,Length (cm),Breadth (cm),' +
  'Height (cm),Packaged Product Weight (gm),Product Weight (gm),Fragile Shipment,' +
  'Discount Type,Discount Value,Tax Class Code,Customer Email,' +
  'Billing Address same as Shipping Address,Billing Address Line1,Billing Address Line2,' +
  'Billing City,Billing State,Billing Pincode,e-Way Bill Number,Seller Name';

const HEADERS = DELHIVERY_HEADER.split(',');

/** One complete Delhivery row, as their own sample values write it. */
function delhiveryRow(over: Record<string, string> = {}): Record<string, string> {
  return {
    '*Sale Order Number': 'SO1191',
    '*Pickup Location Name': 'Bangalore WH',
    '*Transport Mode': 'Surface',
    '*Payment Mode': 'COD',
    'COD Amount': '15000',
    '*Customer Name': 'Asha Verma',
    // Ten bare digits — their sample, and what a real file carries.
    '*Customer Phone': '9999999999',
    '*Shipping Address Line1': '12 MG Road',
    'Shipping Address Line2': 'Near City Hospital',
    '*Shipping City': 'Kochi',
    '*Shipping State': 'Kerala',
    '*Shipping Pincode': '682005',
    '*Item Sku Code': 'SKU123',
    '*Item Sku Name': 'Cotton Kurta',
    '*Quantity Ordered': '2',
    '*Unit Item Price': '1500',
    'Package Name': 'Standard',
    'Packaging Type': 'Box',
    'Length (cm)': '30',
    'Breadth (cm)': '20',
    'Height (cm)': '10',
    'Packaged Product Weight (gm)': '850',
    'Product Weight (gm)': '400',
    'Fragile Shipment': 'No',
    'Discount Type': '',
    'Discount Value': '',
    'Tax Class Code': 'GST18',
    'Customer Email': 'asha@example.com',
    'Billing Address same as Shipping Address': 'Yes',
    'Billing Address Line1': '',
    'Billing Address Line2': '',
    'Billing City': '',
    'Billing State': '',
    'Billing Pincode': '',
    'e-Way Bill Number': '',
    'Seller Name': 'Someone Else Entirely',
    ...over,
  };
}

describe("Delhivery's bulk template maps onto our fields", () => {
  const svc = new OrderCsvParserService();

  it("strips their mandatory marker and their unit suffixes — they are punctuation, not the column's name", () => {
    expect(normalizeHeader('*Sale Order Number')).toBe('sale order number');
    expect(normalizeHeader('Length (cm)')).toBe('length cm');
    expect(normalizeHeader('e-Way Bill Number')).toBe('e way bill number');
  });

  it('accounts for EVERY one of the 36 columns — mapped, or ignored by name', () => {
    const unaccounted = HEADERS.filter(
      (h) => lookupFieldForHeader(h) === null && ignoredReasonForHeader(h) === null,
    );
    // A column that is neither is one nobody decided about, and it would
    // reach the seller as a shrug in the preview.
    expect(unaccounted).toEqual([]);
  });

  it('maps the columns that carry the order', () => {
    const d = svc.detectMapping(HEADERS);
    expect(d.mapping).toMatchObject({
      externalRef: '*Sale Order Number',
      paymentMode: '*Payment Mode',
      codAmount: 'COD Amount',
      customerName: '*Customer Name',
      customerPhone: '*Customer Phone',
      addressLine1: '*Shipping Address Line1',
      addressLine2: 'Shipping Address Line2',
      city: '*Shipping City',
      state: '*Shipping State',
      pinCode: '*Shipping Pincode',
      productSku: '*Item Sku Code',
      quantity: '*Quantity Ordered',
      retailUnitPrice: '*Unit Item Price',
      totalWeightGrams: 'Packaged Product Weight (gm)',
      discountType: 'Discount Type',
      discountValue: 'Discount Value',
      customerEmail: 'Customer Email',
    });
    expect(d.missingRequired).toEqual([]);
  });

  it('reports the columns it will not use as KNOWN, each with a reason', () => {
    const d = svc.detectMapping(HEADERS);
    const ignored = d.ignoredHeaders.map((i) => i.header);
    expect(ignored).toEqual(expect.arrayContaining(['*Pickup Location Name', 'Seller Name']));
    for (const entry of d.ignoredHeaders) expect(entry.reason.length).toBeGreaterThan(10);
    // ...and NONE of them is left as an unknown column with a guess
    // beside it — "Pickup Location Name (did you mean customerName?)"
    // invites exactly the wrong fix.
    expect(d.unmatchedHeaders).toEqual([]);
    expect(suggestFieldForHeader('*Pickup Location Name')).toBeNull();
  });

  it('never fails an upload on a column it has never seen', () => {
    const d = svc.detectMapping([...HEADERS, 'Our Own Internal Batch Code']);
    expect(d.missingRequired).toEqual([]);
    expect(d.unmatchedHeaders.map((u) => u.header)).toEqual(['Our Own Internal Batch Code']);
  });

  it('every ignored column we declare has a reason worth reading', () => {
    for (const [key, reason] of Object.entries(ORDER_CSV_IGNORED_HEADERS)) {
      expect(normalizeHeader(key)).toBe(key);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

describe('a Delhivery file imports without the seller changing anything', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('reads one complete row into one order', () => {
    const { groups, rowErrors } = svc.groupRows([delhiveryRow()], mapping);
    expect(rowErrors).toEqual([]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.externalRef).toBe('SO1191');
    // Ten bare digits became E.164 — every row of a real file fails
    // without this.
    expect(g?.customerPhone).toBe('+919999999999');
    expect(g?.paymentMode).toBe(PaymentMode.COD);
    expect(g?.codAmount).toBe(15000);
    expect(g?.totalWeightGrams).toBe(850);
    expect(g?.lines).toEqual([{ productSku: 'SKU123', quantity: 2, retailUnitPrice: 1500 }]);
  });

  it('takes the COD as stated even when it does not tie to the line prices', () => {
    // Delhivery's OWN sample says unit price 1500 × 2 against a COD of
    // 15000. The COD is what the courier collects; the unit price is a
    // component of how the seller got there. Refusing the mismatch would
    // refuse their own documentation.
    const { groups } = svc.groupRows([delhiveryRow()], mapping);
    expect(groups[0]?.codAmount).toBe(15000);
    expect(groups[0]?.lines[0]?.retailUnitPrice).toBe(1500);
  });
});

describe('judgement call 1 — a repeated Sale Order Number is ONE order with several lines', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('groups the rows instead of overwriting the first order with the last row', () => {
    const rows = [
      delhiveryRow(),
      delhiveryRow({
        '*Item Sku Code': 'SKU456',
        '*Item Sku Name': 'Silk Scarf',
        '*Quantity Ordered': '1',
        '*Unit Item Price': '900',
      }),
    ];
    const { groups, rowErrors } = svc.groupRows(rows, mapping);
    expect(rowErrors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rowNumbers).toEqual([2, 3]);
    expect(groups[0]?.lines.map((l) => l.productSku)).toEqual(['SKU123', 'SKU456']);
    // The order-level block is stated once, not twice.
    expect(groups[0]?.codAmount).toBe(15000);
  });

  it('lets a continuation row state nothing but the reference, the SKU and the quantity', () => {
    // Some exports repeat the customer block; others blank it after the
    // first row of an order. Demanding it per row refuses the second shape.
    const blank = Object.fromEntries(HEADERS.map((h) => [h, '']));
    const rows = [
      delhiveryRow(),
      {
        ...blank,
        '*Sale Order Number': 'SO1191',
        '*Item Sku Code': 'SKU456',
        '*Quantity Ordered': '3',
      },
    ];
    const { groups, rowErrors } = svc.groupRows(rows, mapping);
    expect(rowErrors).toEqual([]);
    expect(groups[0]?.lines).toHaveLength(2);
    expect(groups[0]?.customerName).toBe('Asha Verma');
  });

  it('refuses the WHOLE order when two of its rows contradict each other', () => {
    // Half an order placed is worse than none: the seller believes the
    // parcel holds what the file said.
    const rows = [
      delhiveryRow(),
      delhiveryRow({ '*Item Sku Code': 'SKU456', '*Customer Phone': '9888877777' }),
    ];
    const { groups, rowErrors } = svc.groupRows(rows, mapping);
    expect(groups).toEqual([]);
    expect(rowErrors.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(rowErrors.find((r) => r.rowNumber === 3)?.errors[0]?.reason).toMatch(/disagrees/);
    expect(rowErrors.find((r) => r.rowNumber === 2)?.errors[0]?.reason).toMatch(
      /another row of order/,
    );
  });

  it('keeps two different references as two separate orders', () => {
    const rows = [delhiveryRow(), delhiveryRow({ '*Sale Order Number': 'SO1192' })];
    const { groups } = svc.groupRows(rows, mapping);
    expect(groups.map((g) => g.externalRef)).toEqual(['SO1191', 'SO1192']);
  });
});

describe('judgement call 2 — a blank Shipping Address Line2 is refused BY NAME', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('names the landmark and says why, rather than "addressLine2 is required"', () => {
    // It is optional for Delhivery and required for us (ORD-5): the
    // courier address is line 1 + line 2 and nothing else reaches the
    // driver, so there is no honest fallback — the city adds nothing the
    // PIN did not already give.
    const { groups, rowErrors } = svc.groupRows(
      [delhiveryRow({ 'Shipping Address Line2': '' })],
      mapping,
    );
    expect(groups).toEqual([]);
    const reason = rowErrors[0]?.errors[0]?.reason ?? '';
    expect(reason).toMatch(/landmark/i);
    expect(reason).toMatch(/findable/i);
  });
});

describe('judgement call 3 — a mandatory Shipping State must not start failing uploads', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('carries the state through so it is still checked', () => {
    const { groups } = svc.groupRows([delhiveryRow()], mapping);
    expect(groups[0]?.state).toBe('Kerala');
  });

  it('carries a city and state that our own form no longer asks for', () => {
    const { groups } = svc.groupRows([delhiveryRow()], mapping);
    expect(groups[0]?.city).toBe('Kochi');
  });
});

describe('judgement call 4 — which figure is the collectable', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('a stated Payment Mode beats the old inference from the COD amount', () => {
    const { groups } = svc.groupRows(
      [delhiveryRow({ '*Payment Mode': 'Prepaid', 'COD Amount': '' })],
      mapping,
    );
    expect(groups[0]?.paymentMode).toBe(PaymentMode.PREPAID);
    expect(groups[0]?.codAmount).toBeUndefined();
  });

  it('refuses COD with no amount rather than quietly shipping it as prepaid', () => {
    const { groups, rowErrors } = svc.groupRows(
      [delhiveryRow({ '*Payment Mode': 'COD', 'COD Amount': '' })],
      mapping,
    );
    expect(groups).toEqual([]);
    expect(rowErrors[0]?.errors[0]?.reason).toMatch(/marked COD but states no amount/);
  });

  it('refuses Prepaid carrying a COD amount rather than dropping money silently', () => {
    const { groups, rowErrors } = svc.groupRows(
      [delhiveryRow({ '*Payment Mode': 'Prepaid', 'COD Amount': '999' })],
      mapping,
    );
    expect(groups).toEqual([]);
    expect(rowErrors[0]?.errors[0]?.reason).toMatch(/marked Prepaid but states a COD amount/);
  });

  it('records a FLAT discount as rupees', () => {
    const { groups } = svc.groupRows(
      [delhiveryRow({ 'Discount Type': 'Flat', 'Discount Value': '250' })],
      mapping,
    );
    expect(groups[0]?.discountInr).toBe(250);
  });

  it("applies a PERCENTAGE discount to the order's own goods total", () => {
    // 1500 × 2 = 3000, less 10%.
    const { groups } = svc.groupRows(
      [delhiveryRow({ 'Discount Type': 'Percentage', 'Discount Value': '10' })],
      mapping,
    );
    expect(groups[0]?.discountInr).toBe(300);
    // ...and the collectable is untouched: the COD already has it inside.
    expect(groups[0]?.codAmount).toBe(15000);
  });

  it('records no discount at all when a percentage has no priced base to apply to', () => {
    // Better nothing than a rupee figure invented from a base we do not
    // have.
    const { groups } = svc.groupRows(
      [
        delhiveryRow({
          '*Unit Item Price': '',
          'Discount Type': 'Percentage',
          'Discount Value': '10',
        }),
      ],
      mapping,
    );
    expect(groups[0]?.discountInr).toBeUndefined();
  });
});

describe('cells as a spreadsheet writes them', () => {
  const svc = new OrderCsvParserService();
  const mapping = svc.detectMapping(HEADERS).mapping;

  it('reads a thousands separator and a currency symbol as the same number', () => {
    const { groups, rowErrors } = svc.groupRows(
      [delhiveryRow({ 'COD Amount': '₹15,000' })],
      mapping,
    );
    expect(rowErrors).toEqual([]);
    expect(groups[0]?.codAmount).toBe(15000);
  });

  it('still refuses genuine rubbish by name', () => {
    const { rowErrors } = svc.groupRows([delhiveryRow({ 'COD Amount': 'about 15k' })], mapping);
    expect(rowErrors[0]?.errors[0]?.field).toBe('codAmount');
  });
});

describe('normalizeIndianPhone', () => {
  it('turns the national forms into E.164 and leaves the rest alone', () => {
    expect(normalizeIndianPhone('9999999999')).toBe('+919999999999');
    expect(normalizeIndianPhone('09876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('919876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normalizeIndianPhone('+8801711223344')).toBe('+8801711223344');
    expect(normalizeIndianPhone('0091 9876543210')).toBe('+919876543210');
    // Not a shape we recognise — passed through so the address validator
    // refuses it by name instead of this inventing a country code.
    expect(normalizeIndianPhone('12345')).toBe('12345');
    // A landline-looking ten digits starting 2 is NOT assumed Indian mobile.
    expect(normalizeIndianPhone('2212345678')).toBe('2212345678');
  });
});

describe('parsePaymentMode', () => {
  it('knows the words both sides use, and refuses the rest', () => {
    expect(parsePaymentMode('COD')).toBe(PaymentMode.COD);
    expect(parsePaymentMode('cash on delivery')).toBe(PaymentMode.COD);
    expect(parsePaymentMode('Prepaid')).toBe(PaymentMode.PREPAID);
    expect(parsePaymentMode('PRE-PAID')).toBe(PaymentMode.PREPAID);
    expect(parsePaymentMode('maybe')).toBeNull();
  });
});

/**
 * A template that disagrees with the parser is how this breaks again.
 *
 * Both importers hand the seller a file and then read it back with the
 * same machinery, so the round trip is checkable and there is no excuse
 * for shipping a template whose own example row does not import.
 */
describe('the templates we hand out import cleanly through the parser', () => {
  const parser = new OrderCsvParserService();

  function roundTrip(csv: string): ReturnType<OrderCsvParserService['groupRows']> {
    const parsed = parser.parse(Buffer.from(csv, 'utf8'));
    const detected = parser.detectMapping(parsed.headers);
    expect(detected.missingRequired).toEqual([]);
    return parser.groupRows(parsed.rows, detected.mapping);
  }

  it("the seller's template is one order of two lines, with nothing to fix", () => {
    const csv = buildSellerTemplateForTest();
    const { groups, rowErrors } = roundTrip(csv);
    expect(rowErrors).toEqual([]);
    // Two rows sharing one reference — the whole point of shipping two.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toHaveLength(2);
    expect(groups[0]?.paymentMode).toBe(PaymentMode.COD);
  });

  it("the store's template is one order of two lines, with nothing to fix", () => {
    const csv = buildStoreTemplateForTest();
    const { groups, rowErrors } = roundTrip(csv);
    expect(rowErrors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toHaveLength(2);
    // The store's retail per line, which is what that column means (RS-5).
    expect(groups[0]?.lines.map((l) => l.retailUnitPrice)).toEqual([499, 299]);
  });
});
