import { CsvParserService } from '../../src/modules/catalog-csv-import/services/csv-parser.service';

function buf(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

describe('CsvParserService.parse — edge cases', () => {
  const svc = new CsvParserService();

  it('strips a UTF-8 BOM from the first header', () => {
    const csv = '﻿Name,SKU\nWidget,W-1\n';
    const out = svc.parse(buf(csv));
    expect(out.headers).toEqual(['Name', 'SKU']);
    expect(out.rows[0]).toEqual({ Name: 'Widget', SKU: 'W-1' });
  });

  it('handles quoted commas and quoted newlines', () => {
    const csv = 'Name,SKU,Notes\n"Widget, deluxe",W-1,"line1\nline2"\n';
    const out = svc.parse(buf(csv));
    expect(out.rowCount).toBe(1);
    expect(out.rows[0]!.Name).toBe('Widget, deluxe');
    expect(out.rows[0]!.Notes).toBe('line1\nline2');
  });

  it('trims leading/trailing whitespace in headers and cells', () => {
    const csv = '  Name  ,  SKU  \n  Widget  ,  W-1  \n';
    const out = svc.parse(buf(csv));
    expect(out.headers).toEqual(['Name', 'SKU']);
    expect(out.rows[0]).toEqual({ Name: 'Widget', SKU: 'W-1' });
  });

  it('decodes UTF-8 multibyte content', () => {
    const csv = 'Name,SKU\nকলম,PEN-১\n';
    const out = svc.parse(buf(csv));
    expect(out.rows[0]!.Name).toBe('কলম');
    expect(out.rows[0]!.SKU).toBe('PEN-১');
  });

  it('drops fully empty lines', () => {
    const csv = 'Name,SKU\nWidget,W-1\n\n\nGadget,G-1\n';
    const out = svc.parse(buf(csv));
    expect(out.rowCount).toBe(2);
  });
});

describe('CsvParserService.detectMapping — alias resolution', () => {
  const svc = new CsvParserService();

  it.each([
    ['Product Name'],
    ['product_name'],
    ['product-name'],
    ['Name'],
    ['title'],
    ['Product Title'],
  ])('resolves "%s" to productName', (header) => {
    const d = svc.detectMapping([header, 'SKU']);
    expect(d.mapping.productName).toBe(header);
  });

  it('maps a realistic varied header set', () => {
    const d = svc.detectMapping([
      'Product Name',
      'SKU Code',
      'Product ID',
      'Weight (kg)',
      'Price INR',
      'HS',
      'Category Slug',
      'Mystery Column',
    ]);
    expect(d.mapping.productName).toBe('Product Name');
    expect(d.mapping.variantSkuCode).toBe('SKU Code');
    expect(d.mapping.productExternalRef).toBe('Product ID');
    expect(d.mapping.weightKg).toBe('Weight (kg)');
    expect(d.mapping.declaredValueInr).toBe('Price INR');
    expect(d.mapping.hsCode).toBe('HS');
    expect(d.mapping.categorySlug).toBe('Category Slug');
    expect(d.unmatchedHeaders.map((u) => u.header)).toEqual(['Mystery Column']);
    expect(d.missingRequired).toEqual([]);
  });

  it('reports missing required fields when no name/sku header present', () => {
    const d = svc.detectMapping(['Colour', 'Notes']);
    expect(d.missingRequired).toEqual(['productName', 'variantSkuCode']);
  });

  it('a second header for an already-assigned field is unmatched (ambiguous)', () => {
    const d = svc.detectMapping(['Name', 'Title', 'SKU']);
    expect(d.mapping.productName).toBe('Name');
    expect(d.unmatchedHeaders.map((u) => u.header)).toContain('Title');
  });
});

describe('CsvParserService.coerceRow', () => {
  const svc = new CsvParserService();
  const mapping = {
    productName: 'Name',
    variantSkuCode: 'SKU',
    weightKg: 'Weight (kg)',
    declaredValueInr: 'Price',
    variantAttributes: 'Attributes',
  } as const;

  it('converts weight kg → grams ×1000', () => {
    const { row } = svc.coerceRow(
      { Name: 'W', SKU: 'S1', 'Weight (kg)': '1.25', Price: '499', Attributes: '' },
      mapping,
    );
    expect(row?.weightGrams).toBe(1250);
    expect(row?.declaredValueInr).toBe(499);
  });

  it('parses key=value;key=value attributes', () => {
    const { row } = svc.coerceRow(
      { Name: 'W', SKU: 'S1', 'Weight (kg)': '', Price: '', Attributes: 'color=Red;size=M' },
      mapping,
    );
    expect(row?.attributes).toEqual({ color: 'Red', size: 'M' });
  });

  it('parses JSON attributes', () => {
    const { row } = svc.coerceRow(
      { Name: 'W', SKU: 'S1', 'Weight (kg)': '', Price: '', Attributes: '{"color":"Red","qty":3}' },
      mapping,
    );
    expect(row?.attributes).toEqual({ color: 'Red', qty: 3 });
  });

  it('collects errors for missing required + bad number', () => {
    const { row, errors } = svc.coerceRow(
      { Name: '', SKU: 'S1', 'Weight (kg)': 'heavy', Price: '', Attributes: '' },
      mapping,
    );
    expect(row).toBeNull();
    expect(errors.some((e) => e.field === 'productName')).toBe(true);
    expect(errors.some((e) => e.field === 'weightKg')).toBe(true);
  });
});
