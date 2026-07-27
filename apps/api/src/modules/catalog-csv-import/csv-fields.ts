/**
 * Canonical target fields for a PRODUCT_VARIANT CSV import and the
 * header aliases that auto-detect to each. Matching is case-insensitive
 * and runs/underscores/hyphens are collapsed to a single space on BOTH
 * the header and the alias (so "Product Name", "product_name",
 * "product-name" all normalize to "product name").
 */

export type CsvTargetField =
  | 'productName'
  | 'productExternalRef'
  | 'variantSkuCode'
  | 'weightGrams'
  | 'weightKg'
  | 'lengthCm'
  | 'widthCm'
  | 'heightCm'
  | 'declaredValueInr'
  | 'hsCode'
  | 'barcode'
  | 'variantAttributes'
  | 'categorySlug';

export const CSV_ALIAS_MAP: Record<CsvTargetField, string[]> = {
  productName: ['product name', 'name', 'title', 'product title'],
  productExternalRef: ['product id', 'product ref', 'external ref', 'sku family'],
  variantSkuCode: ['sku', 'sku code', 'variant sku', 'product sku'],
  weightGrams: ['weight g', 'weight grams', 'weight (g)', 'weight (grams)'],
  weightKg: ['weight kg', 'weight (kg)'], // converted ×1000 → grams
  lengthCm: ['length', 'length cm', 'length (cm)'],
  widthCm: ['width', 'width cm', 'width (cm)'],
  heightCm: ['height', 'height cm', 'height (cm)'],
  declaredValueInr: ['price', 'value', 'declared value', 'price inr'],
  hsCode: ['hs code', 'hs', 'harmonized code'],
  barcode: ['barcode', 'ean', 'upc'],
  variantAttributes: ['attributes', 'variant attributes', 'options'],
  categorySlug: ['category', 'category slug'],
};

/** Required mapped fields for a row to be importable. */
export const CSV_REQUIRED_FIELDS: CsvTargetField[] = ['productName', 'variantSkuCode'];

/** Every known catalog target field (derived from the alias map). */
export const CSV_TARGET_FIELDS = Object.keys(CSV_ALIAS_MAP) as CsvTargetField[];

const CSV_TARGET_FIELD_SET = new Set<string>(CSV_TARGET_FIELDS);

export function isCsvTargetField(value: string): value is CsvTargetField {
  return CSV_TARGET_FIELD_SET.has(value);
}

/** Normalize a header or alias for comparison. */
export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

// Reverse index: normalized alias -> target field (built once).
const ALIAS_INDEX: Map<string, CsvTargetField> = (() => {
  const idx = new Map<string, CsvTargetField>();
  for (const [field, aliases] of Object.entries(CSV_ALIAS_MAP) as [CsvTargetField, string[]][]) {
    for (const a of aliases) idx.set(normalizeHeader(a), field);
  }
  return idx;
})();

export function lookupFieldForHeader(header: string): CsvTargetField | null {
  return ALIAS_INDEX.get(normalizeHeader(header)) ?? null;
}

/**
 * Light suggestion for an unmatched header: the first field whose alias
 * shares a whole word-token with the header. No fuzzy/edit-distance —
 * just enough to make the preview helpful.
 */
export function suggestFieldForHeader(header: string): CsvTargetField | null {
  const tokens = new Set(normalizeHeader(header).split(' ').filter(Boolean));
  if (tokens.size === 0) return null;
  for (const [field, aliases] of Object.entries(CSV_ALIAS_MAP) as [CsvTargetField, string[]][]) {
    for (const alias of aliases) {
      const aliasTokens = normalizeHeader(alias).split(' ').filter(Boolean);
      if (aliasTokens.some((t) => tokens.has(t))) return field;
    }
  }
  return null;
}
