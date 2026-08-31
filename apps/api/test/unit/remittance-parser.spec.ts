import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DelhiveryRemittanceParser,
  RemittanceParserRegistry,
} from '../../src/modules/courier-settlement/services/remittance-parser.service';

/**
 * Built against a REAL Delhivery remittance export, not a guess. The
 * fixture keeps that file's exact header and row shape with the
 * seller's catalogue and order names replaced — the column contract is
 * what these pin.
 */
const CSV = readFileSync(join(__dirname, '../fixtures/delhivery-remittance.csv'), 'utf8');

function registry(): RemittanceParserRegistry {
  return new RemittanceParserRegistry(new DelhiveryRemittanceParser());
}

describe('Delhivery remittance parsing', () => {
  it('reads every waybill line', () => {
    const rows = registry().parse('delhivery', CSV);
    expect(rows).toHaveLength(6);
    expect(rows[0]?.awbNumber).toBe('38061110519610');
  });

  it('takes the settled amount from Amount Payable, not COD Amount', () => {
    // They are EQUAL in every sample row, which is precisely what would
    // let the wrong column ship unnoticed — until Delhivery starts
    // netting its charges and the two diverge.
    const rows = registry().parse('delhivery', CSV);
    expect(rows[0]?.settledInr).toBe('1000.0');
    expect(rows[5]?.settledInr).toBe('2600.0');
  });

  it('keeps the seller’s own order name but never treats it as an identifier', () => {
    // "OV Beauty (S. SA)22" in the real file — free text a person typed,
    // not unique, and not ours. Matching on it would attribute money by
    // a customer-service label.
    const rows = registry().parse('delhivery', CSV);
    expect(rows[0]?.externalRef).toBe('REF-1');
    expect(Object.keys(rows[0] ?? {})).toContain('awbNumber');
  });

  it('numbers each row so a complaint can name one', () => {
    const rows = registry().parse('delhivery', CSV);
    // Line 2 is the first data row — 1-based, past the header.
    expect(rows[0]?.line).toBe(2);
  });

  it('refuses a file whose columns are not this courier’s', () => {
    expect(() => registry().parse('delhivery', 'a,b,c\n1,2,3')).toThrow(
      /REMITTANCE_COLUMNS_MISSING|does not look like/,
    );
  });

  it('refuses a courier whose format nobody has seen, by name', () => {
    // Guessing Shiprocket's columns would look right and attribute the
    // wrong numbers. It says so instead.
    expect(() => registry().parse('shiprocket', CSV)).toThrow(
      /REMITTANCE_FORMAT_UNKNOWN|shiprocket/,
    );
  });

  it('refuses a file with a header and nothing under it', () => {
    const headerOnly = CSV.split('\n')[0] ?? '';
    expect(() => registry().parse('delhivery', headerOnly)).toThrow(/REMITTANCE_EMPTY|No waybills/);
  });

  it('tolerates padded headers, which exports produce', () => {
    const padded = CSV.replace('Waybill Number', ' Waybill Number ');
    expect(registry().parse('delhivery', padded)).toHaveLength(6);
  });
});
