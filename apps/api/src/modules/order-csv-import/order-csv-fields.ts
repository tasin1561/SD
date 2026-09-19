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
  | 'externalRef'
  /*
    RS-5 — what a reseller store SELLS ONE UNIT FOR: the selling price,
    not the COD total on the row.

    OPTIONAL on a store's upload since 2026-09-19 (owner). A row that
    states it uses it; a row that does not falls back to the SUGGESTED
    RETAIL the seller set for that store in its catalogue (RS-3), and is
    refused by name only when there is no suggested retail either —
    never derived from the COD amount, which is a total covering
    quantity, delivery and any advance, and never a guess.

    The PATCH half reads it the same way: a line kept on the order keeps
    the retail it was PLACED at when the row states nothing (ORD-6), and
    only a line whose SKU moved falls through to the catalogue's
    suggestion. That is the same rule `ResellerOrderRetermService`
    applies to the portal edit, deliberately — one meaning for the
    column, whichever door the row came through.

    A seller's own upload may carry the column and it is ignored there.
  */
  | 'retailUnitPrice';

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
  retailUnitPrice: ['retail price', 'retail unit price', 'selling price', 'unit price', 'price'],
};

/** A row needs all of these mapped to be importable. */
/**
 * What a CSV must carry for its rows to stand a chance at create.
 *
 * This list has to track `CreateOrderDto`, because it is the ONLY thing
 * standing between a seller and an upload that previews clean then fails
 * on every row. Two changes on 2026-08-07:
 *
 *   + addressLine2 — the landmark, now @IsNotEmpty on create. Without it
 *     here, a CSV missing the column passed preview and then 400'd once
 *     per row, which reads as the importer being broken.
 *   − city, state — optional on the API now (Delhivery resolves the
 *     locality from the PIN). Demanding them here blocked uploads the
 *     server would have accepted. They remain SUPPORTED columns, and a
 *     row that supplies a state is still validated against
 *     ops.allowed_indian_states.
 */
export const ORDER_CSV_REQUIRED_FIELDS: OrderCsvField[] = [
  'productSku',
  'quantity',
  'customerName',
  'customerPhone',
  'addressLine1',
  'addressLine2',
  'pinCode',
  'externalRef',
];

/**
 * RS-5 — what a RESELLER STORE's upload must carry.
 *
 * The same columns a seller's does. **`retailUnitPrice` is deliberately
 * NOT here** (owner, 2026-09-19): a store that prices everything at the
 * seller's suggested retail should not have to restate it on every row,
 * and demanding the column made an otherwise-valid file unmappable. A
 * row that omits it is priced from the store's catalogue (see the field
 * comment above) and refused BY NAME when the catalogue has no
 * suggestion, which is a refusal about one product rather than about
 * the whole upload.
 *
 * Kept as its own named constant rather than collapsed into
 * `ORDER_CSV_REQUIRED_FIELDS`: the store template and the store mapping
 * check both read it, and the day the two uploads differ again there is
 * one place to say so.
 */
export const ORDER_CSV_STORE_REQUIRED_FIELDS: OrderCsvField[] = [...ORDER_CSV_REQUIRED_FIELDS];

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
