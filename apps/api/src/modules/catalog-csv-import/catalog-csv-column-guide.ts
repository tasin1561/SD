import type { CsvColumnGuide, CsvColumnGuideEntry } from '../../common/text/csv-column-guide';
import { CSV_REQUIRED_FIELDS, lookupFieldForHeader } from './csv-fields';

/**
 * Required/optional per column for a product upload. One row is one variant,
 * so "required" is always per row; derived from `CSV_REQUIRED_FIELDS`, the
 * same list the importer's mapping check reads.
 */
export function buildCatalogColumnGuide(
  templateColumns: ReadonlyArray<readonly string[]>,
): CsvColumnGuide {
  const columns: CsvColumnGuideEntry[] = [];
  for (const [header = '', ...samples] of templateColumns) {
    const field = lookupFieldForHeader(header);
    if (field === null) continue;
    columns.push({
      field,
      header,
      level: CSV_REQUIRED_FIELDS.includes(field) ? 'EVERY_ROW' : 'OPTIONAL',
      uatControlled: false,
      inTemplate: true,
      sample: samples.find((v) => v !== '') ?? '',
      description: null,
    });
  }
  return { columns };
}
