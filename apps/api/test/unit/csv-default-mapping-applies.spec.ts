import { CsvImportService } from '../../src/modules/catalog-csv-import/services/csv-import.service';
import { CsvParserService } from '../../src/modules/catalog-csv-import/services/csv-parser.service';

/**
 * A SAVED MAPPING MARKED "default" MUST ACTUALLY DRIVE AN IMPORT.
 *
 * `resolveMapping` applied one only when the caller passed a `mappingId`;
 * the import panel has never passed one and no screen lets a seller pick
 * one. So a mapping could be saved, marked default, listed with a chip
 * reading "default", and change nothing about any import — which is the
 * entire feature, since its only purpose is not having to rename your own
 * spreadsheet's headers.
 *
 * Three properties, and the second is the one a careless fix loses:
 *  - the default is applied when no id is named;
 *  - AUTO-DETECTION STILL RUNS and the saved map is laid OVER it, so a
 *    header we already recognise keeps working and a mapping only has to
 *    name the ones we do not;
 *  - a header the mapping names that is NOT IN THE FILE is ignored rather
 *    than mapped to a column that does not exist.
 */
function makeService(
  mappingSvc: Partial<{
    resolveColumnMap: jest.Mock;
    resolveDefaultColumnMap: jest.Mock;
    markUsed: jest.Mock;
  }>,
  csv: string,
): CsvImportService {
  return new CsvImportService(
    { csvMaxRows: 5000 } as never,
    {} as never,
    {
      headObject: () => Promise.resolve({ size: Buffer.byteLength(csv), contentType: 'text/csv' }),
      getObject: () => Promise.resolve(Buffer.from(csv, 'utf8')),
    } as never,
    new CsvParserService(),
    {} as never,
    {} as never,
    mappingSvc as never,
  );
}

const CSV = ['Item,SKU,Weight (g)', 'Jamdani saree,RSH-1,450'].join('\n');

describe('the seller default CSV mapping', () => {
  const preview = (svc: CsvImportService): ReturnType<CsvImportService['preview']> =>
    // `loadOwnedCsv` checks the key parses AND names this seller.
    svc.preview('seller-1', { spacesKey: 'sellers/seller-1/csv-imports/x.csv' } as never);

  it('is applied when the caller names no mapping, over auto-detection', async () => {
    const markUsed = jest.fn().mockResolvedValue(undefined);
    const svc = makeService(
      {
        resolveDefaultColumnMap: jest
          .fn()
          .mockResolvedValue({ id: 'map-1', columnMap: { productName: 'Item' } }),
        markUsed,
      },
      CSV,
    );

    const out = await preview(svc);

    // From the saved mapping: "Item" is in no alias list.
    expect(out.mapping.productName).toBe('Item');
    // From auto-detection, and NOT lost to the mapping being applied.
    expect(out.mapping.variantSkuCode).toBe('SKU');
    expect(out.mapping.weightGrams).toBe('Weight (g)');
    expect(out.missingRequired).toEqual([]);
    expect(markUsed).toHaveBeenCalledWith('seller-1', 'map-1');
  });

  it('leaves a mapped header that is not in the file alone', async () => {
    const svc = makeService(
      {
        resolveDefaultColumnMap: jest
          .fn()
          .mockResolvedValue({ id: 'map-1', columnMap: { barcode: 'EAN13' } }),
        markUsed: jest.fn().mockResolvedValue(undefined),
      },
      CSV,
    );

    const out = await preview(svc);

    expect(out.mapping.barcode).toBeUndefined();
  });

  it('falls back to auto-detection alone when the seller has no default', async () => {
    const markUsed = jest.fn().mockResolvedValue(undefined);
    const svc = makeService(
      { resolveDefaultColumnMap: jest.fn().mockResolvedValue(null), markUsed },
      CSV,
    );

    const out = await preview(svc);

    expect(out.mapping.productName).toBeUndefined();
    expect(out.missingRequired).toEqual(['productName']);
    expect(markUsed).not.toHaveBeenCalled();
  });
});
