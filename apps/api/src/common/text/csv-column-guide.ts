/**
 * What a bulk-upload page tells a seller about the template's columns BEFORE
 * they fill anything in: which must be present and which may be left out.
 *
 * Shared wire shape for the product and order importers. The data is always
 * DERIVED from the importer's own required sets (never restated), so a field
 * that becomes required later changes the page with it.
 */
export type CsvColumnLevel =
  /** Every row of the file must carry it. */
  | 'EVERY_ROW'
  /** Judged on the assembled order: state it once, later rows of that order may blank it. */
  | 'ONCE_PER_ORDER'
  | 'OPTIONAL'
  /**
   * A column the template carries and the importer deliberately ignores.
   * It must never read as "optional": that would tell a seller it does something.
   */
  | 'NOT_USED';

export interface CsvColumnGuideEntry {
  /** The importer's internal field key; the console keys its own wording off it. */
  field: string;
  /** The header as the template prints it (or the field's human label if the template has none). */
  header: string;
  level: CsvColumnLevel;
  /** Shown/hidden by a UAT setting; only ever present when currently shown. */
  uatControlled: boolean;
  /** True when the downloadable template already carries this column. */
  inTemplate: boolean;
  /** The template's own sample cell for this column (first non-empty), '' when none. */
  sample: string;
  /** Why we ignore the column (NOT_USED only); null otherwise. Written for a person. */
  description: string | null;
}

export interface CsvColumnGuide {
  columns: CsvColumnGuideEntry[];
}
