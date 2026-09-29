import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORDER_CSV_REQUIRED_FIELDS } from '../../src/modules/order-csv-import/order-csv-fields';
import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';

/**
 * What a CSV must carry has to match what create will accept.
 *
 * When they disagree the failure is expensive and confusing in one
 * direction only: a column the API requires but the importer does not
 * lets an upload preview CLEAN and then fail once per row, which reads
 * as the importer being broken rather than the file being wrong. That
 * is exactly what happened when the landmark became required —
 * `coerceRow` held a SECOND hand-written copy of the required list that
 * nobody updated.
 *
 * So: one list, derived not restated, and a test that says so.
 */

const HEADERS: Record<string, string> = {
  productSku: 'Product SKU',
  quantity: 'Quantity',
  customerName: 'Customer Name',
  customerPhone: 'Customer Phone',
  addressLine1: 'Address Line1',
  addressLine2: 'Address Line2',
  city: 'City',
  state: 'State',
  pinCode: 'Pin Code',
  externalRef: 'External Ref',
};

const MAPPING = Object.fromEntries(Object.entries(HEADERS));

function fullRow(): Record<string, string> {
  return {
    'Product SKU': 'SKU-1',
    Quantity: '2',
    'Customer Name': 'Asha Verma',
    'Customer Phone': '+919876543210',
    'Address Line1': '12 MG Road',
    'Address Line2': 'Near City Hospital',
    City: 'Bengaluru',
    State: 'Karnataka',
    'Pin Code': '560001',
    'External Ref': 'REF-1',
  };
}

describe('the CSV required-field list tracks the create DTO', () => {
  it('requires the landmark — the column whose absence 400s every row', () => {
    expect(ORDER_CSV_REQUIRED_FIELDS).toContain('addressLine2');
  });

  it('does NOT require city or state — the API stopped needing them', () => {
    // Demanding them here would refuse uploads the server would accept.
    expect(ORDER_CSV_REQUIRED_FIELDS).not.toContain('city');
    expect(ORDER_CSV_REQUIRED_FIELDS).not.toContain('state');
  });

  it('the order-level check is DERIVED from the list, not a second copy of it', () => {
    // The drift that caused this: a literal array inside coerceRow.
    //
    // The check now has TWO grains (ORD-9 widened 2026-09-29): three
    // fields every ROW must carry, and the rest judged on the assembled
    // ORDER. Only the row three are written out — the order list is the
    // full one MINUS those, so the two can never disagree about a field
    // the create DTO started or stopped needing.
    const src = readFileSync(
      join(__dirname, '../../src/modules/order-csv-import/services/order-csv-parser.service.ts'),
      'utf8',
    );
    expect(src).toMatch(/ORDER_REQUIRED_FIELDS[\s\S]{0,120}ORDER_CSV_REQUIRED_FIELDS\.filter\(/);
    expect(src).not.toMatch(/const required: OrderCsvField\[\] = \[/);
  });
});

describe('OrderCsvParserService.coerceRow', () => {
  const svc = new OrderCsvParserService();

  it('accepts a complete row', () => {
    const { row, errors } = svc.coerceRow(fullRow(), MAPPING);
    expect(errors).toEqual([]);
    expect(row?.addressLine2).toBe('Near City Hospital');
  });

  it('a one-row file is still one complete order', () => {
    const { groups, rowErrors } = svc.groupRows([fullRow()], MAPPING);
    expect(rowErrors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toEqual([{ productSku: 'SKU-1', quantity: 2 }]);
  });

  it('rejects an order with no landmark, naming it and saying why', () => {
    // The check moved from the ROW to the assembled ORDER when a CSV row
    // stopped being a whole order (ORD-9 widened). The guarantee is
    // unchanged and is what matters: a file with no landmark does not
    // import, and it says what a landmark is for — Delhivery's own
    // template leaves that column optional, so a file from one will
    // routinely arrive with it blank.
    const raw = fullRow();
    raw['Address Line2'] = '';
    const { groups, rowErrors } = svc.groupRows([raw], MAPPING);
    expect(groups).toEqual([]);
    expect(rowErrors[0]?.errors.map((e) => e.field)).toContain('addressLine2');
    expect(rowErrors[0]?.errors[0]?.reason).toMatch(/landmark/i);
  });

  it('accepts a row with no city or state', () => {
    // The seller form no longer collects them; a CSV need not either.
    const raw = fullRow();
    raw['City'] = '';
    raw['State'] = '';
    const { row, errors } = svc.coerceRow(raw, MAPPING);
    expect(errors).toEqual([]);
    expect(row?.city).toBeUndefined();
    expect(row?.state).toBeUndefined();
  });

  it('still carries a city and state when the seller does supply them', () => {
    const { row } = svc.coerceRow(fullRow(), MAPPING);
    expect(row?.city).toBe('Bengaluru');
    expect(row?.state).toBe('Karnataka');
  });

  it('reports a missing quantity exactly once', () => {
    // quantity is excluded from the derived list because it has its own
    // numeric coercion; if that exclusion were dropped it would be
    // reported twice.
    const raw = fullRow();
    raw['Quantity'] = '';
    const { errors } = svc.coerceRow(raw, MAPPING);
    expect(errors.filter((e) => e.field === 'quantity')).toHaveLength(1);
  });
});
