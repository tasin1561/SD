import { OrderCsvParserService } from '../../src/modules/order-csv-import/services/order-csv-parser.service';

function buf(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

describe('OrderCsvParserService', () => {
  const svc = new OrderCsvParserService();

  it('parses headers + rows, strips BOM, drops empty lines', () => {
    const csv = '﻿SKU,Quantity,Customer Name\nA-1,2,Asha\n\nB-2,1,Ravi\n';
    const p = svc.parse(buf(csv));
    expect(p.headers).toEqual(['SKU', 'Quantity', 'Customer Name']);
    expect(p.rowCount).toBe(2);
    expect(p.rows[0]).toMatchObject({ SKU: 'A-1', Quantity: '2' });
  });

  it('auto-detects the order field mapping from aliased headers', () => {
    const d = svc.detectMapping([
      'SKU',
      'Qty',
      'Recipient Name',
      'Mobile',
      'Address 1',
      'City',
      'State',
      'Pincode',
      'Order Ref',
      'Junk',
    ]);
    expect(d.mapping).toMatchObject({
      productSku: 'SKU',
      quantity: 'Qty',
      customerName: 'Recipient Name',
      customerPhone: 'Mobile',
      addressLine1: 'Address 1',
      city: 'City',
      state: 'State',
      pinCode: 'Pincode',
      externalRef: 'Order Ref',
    });
    expect(d.missingRequired).toEqual([]);
    expect(d.unmatchedHeaders.map((u) => u.header)).toContain('Junk');
  });

  it('reports missing required fields', () => {
    const d = svc.detectMapping(['SKU', 'Qty']);
    expect(d.missingRequired).toEqual(
      expect.arrayContaining(['customerName', 'customerPhone', 'externalRef']),
    );
  });

  const fullMap = {
    productSku: 'SKU',
    quantity: 'Qty',
    customerName: 'Name',
    customerPhone: 'Phone',
    addressLine1: 'Addr',
    city: 'City',
    state: 'State',
    pinCode: 'Pin',
    externalRef: 'Ref',
    codAmount: 'COD',
  } as const;

  it('coerces a valid row', () => {
    const { row, errors } = svc.coerceRow(
      {
        SKU: 'A-1',
        Qty: '3',
        Name: 'Asha',
        Phone: '+919876543210',
        Addr: '12 MG Road',
        City: 'Bengaluru',
        State: 'Karnataka',
        Pin: '560001',
        Ref: 'EXT-1',
        COD: '999',
      },
      fullMap,
    );
    expect(errors).toEqual([]);
    expect(row).toMatchObject({
      productSku: 'A-1',
      quantity: 3,
      codAmount: 999,
      externalRef: 'EXT-1',
    });
  });

  it('rejects non-positive / non-integer quantity', () => {
    const { row, errors } = svc.coerceRow(
      {
        SKU: 'A',
        Qty: '0',
        Name: 'x',
        Phone: 'p',
        Addr: 'a',
        City: 'c',
        State: 's',
        Pin: '1',
        Ref: 'r',
      },
      fullMap,
    );
    expect(row).toBeNull();
    expect(errors.some((e) => e.field === 'quantity')).toBe(true);
  });

  it('flags every missing required field', () => {
    const { row, errors } = svc.coerceRow({ SKU: 'A', Qty: '1' }, fullMap);
    expect(row).toBeNull();
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['customerName', 'customerPhone', 'externalRef']),
    );
  });

  it('rejects a negative codAmount', () => {
    const { errors } = svc.coerceRow(
      {
        SKU: 'A',
        Qty: '1',
        Name: 'n',
        Phone: 'p',
        Addr: 'a',
        City: 'c',
        State: 's',
        Pin: '1',
        Ref: 'r',
        COD: '-5',
      },
      fullMap,
    );
    expect(errors.some((e) => e.field === 'codAmount')).toBe(true);
  });
});
