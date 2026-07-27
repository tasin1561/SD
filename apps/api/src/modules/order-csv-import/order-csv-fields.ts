/**
 * Canonical target fields for an ORDER CSV import and the header aliases
 * that auto-detect to each. One CSV row = one order with a single line
 * item (productSku × quantity); multi-line orders are out of Phase 1A's
 * CSV scope. `externalRef` is the per-seller idempotency key (ORD-9) and
 * is REQUIRED for CSV — it maps onto `orders.sellerOrderRef`.
 *
 * Matching mirrors the Module-4 catalog importer: case-insensitive,
 * runs/underscores/hyphens collapsed to one space on both sides.
 */

export type OrderCsvField =
  | 'productSku'
  | 'quantity'
  | 'customerName'
  | 'customerPhone'
  | 'customerEmail'
  | 'addressLine1'
  | 'addressLine2'
  | 'landmark'
  | 'city'
  | 'state'
  | 'pinCode'
  | 'codAmount'
  | 'externalRef';

export const ORDER_CSV_ALIAS_MAP: Record<OrderCsvField, string[]> = {
  productSku: ['product sku', 'sku', 'sku code', 'variant sku'],
  quantity: ['quantity', 'qty', 'units'],
  customerName: ['customer name', 'recipient name', 'name'],
  customerPhone: ['customer phone', 'recipient phone', 'phone', 'mobile'],
  customerEmail: ['customer email', 'recipient email', 'email'],
  addressLine1: ['address line1', 'address line 1', 'address 1', 'address1', 'address', 'addr1'],
  addressLine2: ['address line2', 'address line 2', 'address 2', 'address2', 'addr2'],
  landmark: ['landmark'],
  city: ['city', 'town'],
  state: ['state', 'state province', 'province'],
  pinCode: ['pin code', 'pincode', 'pin', 'postal code', 'postcode', 'zip'],
  codAmount: ['cod amount', 'cod', 'cod amount inr', 'amount to collect'],
  externalRef: ['external ref', 'order ref', 'order id', 'reference', 'ref'],
};

/** A row needs all of these mapped to be importable. */
export const ORDER_CSV_REQUIRED_FIELDS: OrderCsvField[] = [
  'productSku',
  'quantity',
  'customerName',
  'customerPhone',
  'addressLine1',
  'city',
  'state',
  'pinCode',
  'externalRef',
];

export const ORDER_CSV_TARGET_FIELDS = Object.keys(ORDER_CSV_ALIAS_MAP) as OrderCsvField[];

export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

const ALIAS_INDEX: Map<string, OrderCsvField> = (() => {
  const idx = new Map<string, OrderCsvField>();
  for (const [field, aliases] of Object.entries(ORDER_CSV_ALIAS_MAP) as [
    OrderCsvField,
    string[],
  ][]) {
    for (const a of aliases) idx.set(normalizeHeader(a), field);
  }
  return idx;
})();

export function lookupFieldForHeader(header: string): OrderCsvField | null {
  return ALIAS_INDEX.get(normalizeHeader(header)) ?? null;
}

/** Light single-token suggestion for an unmatched header (no fuzzy). */
export function suggestFieldForHeader(header: string): OrderCsvField | null {
  const tokens = new Set(normalizeHeader(header).split(' ').filter(Boolean));
  if (tokens.size === 0) return null;
  for (const [field, aliases] of Object.entries(ORDER_CSV_ALIAS_MAP) as [
    OrderCsvField,
    string[],
  ][]) {
    for (const alias of aliases) {
      const aliasTokens = normalizeHeader(alias).split(' ').filter(Boolean);
      if (aliasTokens.some((t) => tokens.has(t))) return field;
    }
  }
  return null;
}
