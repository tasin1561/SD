import type { CsvColumnGuide, CsvColumnGuideEntry } from '../../common/text/csv-column-guide';
import type { UatField } from '../uat-settings/services/uat-fields.service';
import {
  ORDER_CSV_REQUIRED_FIELDS,
  lookupFieldForHeader,
  orderCsvFieldLabel,
  type OrderCsvField,
} from './order-csv-fields';
import { ORDER_REQUIRED_FIELDS, ROW_REQUIRED_FIELDS } from './services/order-csv-parser.service';

/**
 * The columns controlled by a UAT switch (see `UatFieldsService`). Mapped
 * always, applied only while shown — so the guide lists them only while shown,
 * or it would advertise columns nobody can use.
 */
export const UAT_CONTROLLED_ORDER_FIELDS: Partial<Record<OrderCsvField, UatField>> = {
  deliveryFee: 'orderDeliveryFee',
  discountValue: 'orderDiscount',
  discountType: 'orderDiscount',
  declaredValue: 'orderDeclaredValue',
};

/**
 * Required/optional per column for an order upload.
 *
 * `required` is the importer's own list; the two grains come from the
 * parser's exported `ROW_REQUIRED_FIELDS` / `ORDER_REQUIRED_FIELDS` (ORD-9),
 * so this cannot drift from what `groupRows` actually enforces.
 */
export function buildOrderColumnGuide(
  templateHeaders: readonly string[],
  required: readonly OrderCsvField[],
  uatShown: Readonly<Record<UatField, boolean>>,
): CsvColumnGuide {
  const seen = new Set<OrderCsvField>();
  const columns: CsvColumnGuideEntry[] = [];
  const levelOf = (f: OrderCsvField): CsvColumnGuideEntry['level'] =>
    ROW_REQUIRED_FIELDS.includes(f) && required.includes(f)
      ? 'EVERY_ROW'
      : required.includes(f) && ORDER_REQUIRED_FIELDS.includes(f)
        ? 'ONCE_PER_ORDER'
        : 'OPTIONAL';
  const add = (field: OrderCsvField, header: string, inTemplate: boolean): void => {
    if (seen.has(field)) return;
    const uat = UAT_CONTROLLED_ORDER_FIELDS[field];
    if (uat !== undefined && !uatShown[uat]) return;
    seen.add(field);
    columns.push({
      field,
      header,
      level: levelOf(field),
      uatControlled: uat !== undefined,
      inTemplate,
    });
  };
  for (const h of templateHeaders) {
    const field = lookupFieldForHeader(h);
    if (field !== null) add(field, h, true);
  }
  // A required field the template somehow lacks must still be listed.
  for (const f of ORDER_CSV_REQUIRED_FIELDS) add(f, orderCsvFieldLabel(f), false);
  // Shown UAT columns are supported even though the template omits them.
  for (const f of Object.keys(UAT_CONTROLLED_ORDER_FIELDS) as OrderCsvField[]) {
    add(f, orderCsvFieldLabel(f), false);
  }
  return { columns };
}
