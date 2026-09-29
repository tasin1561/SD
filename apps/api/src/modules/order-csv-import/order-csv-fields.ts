/**
 * Canonical target fields for an ORDER CSV import and the header aliases
 * that auto-detect to each. `externalRef` is the per-seller idempotency
 * key (ORD-9) and is REQUIRED for CSV — it maps onto
 * `orders.sellerOrderRef`.
 *
 * Matching is case-insensitive and collapses every run of punctuation or
 * whitespace to one space on both sides, so `*Sale Order Number`,
 * `Sale_Order_Number` and `sale order number` are one header. Delhivery's
 * `*` mandatory marker is punctuation they print, not part of the name.
 *
 * ── ONE ROW IS ONE LINE, NOT ONE ORDER (2026-09-29) ──────────────────
 * Rows sharing an `externalRef` are ONE order with several lines —
 * Delhivery's bulk template expresses a two-item order by repeating
 * `*Sale Order Number`, and that is the format sellers already have.
 * Before grouping, the second row of such an order found the first by
 * its reference and PATCHED it (ORD-9), so a two-item order silently
 * became a one-item order carrying only the LAST row's SKU. Grouping is
 * not a Phase-2 feature: `CreateOrderDto.items` has always taken 1–200
 * lines and the portal form places multi-line orders every day; only the
 * importer was narrower than the system behind it. See
 * `OrderCsvParserService.groupRows`.
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
    Delhivery's `*Payment Mode` (Prepaid | COD).

    Before this the importer INFERRED the mode from whether a COD amount
    was present, which is wrong in both directions on a file that states
    it: a row marked COD with an empty amount column became a PREPAID
    order for a parcel the courier will still try to collect on, and a
    row marked Prepaid carrying a stray amount became a COD. A stated
    mode is AUTHORITATIVE; the inference survives only as the fallback
    for a file with no such column (our own template had none).
  */
  | 'paymentMode'
  /*
    The three figures the collectable was BUILT FROM — recorded for
    readback, never re-applied and never used to derive the COD.
    `OrderService.create` says so in its own words at the write.

    `advanceAmount` is Delhivery's `Amount Paid` (a partial COD payment
    already taken), `discountValue`/`discountType` their discount pair.
  */
  | 'advanceAmount'
  | 'discountValue'
  | 'discountType'
  /*
    Delhivery's `Packaged Product Weight (gm)` — the weight of the PACKED
    parcel, which includes packaging and is therefore better information
    than our Σ(catalogue unit weight × qty) default. Their `Product
    Weight (gm)` is the per-unit figure and is deliberately IGNORED: that
    is the catalogue's to state (MUST #13), and a CSV restating it per
    order is a second source of truth for it.
  */
  | 'totalWeightGrams'
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

    ON A SELLER'S OWN UPLOAD it is no longer dropped (2026-09-29):
    Delhivery's `*Unit Item Price` is mandatory, so every file carries
    it, and it lands on the line's `unitPriceInr` — a figure the order
    model has always had, persisted as-is and read by no money path.
    Throwing away a number the seller stated was the worse option.
  */
  | 'retailUnitPrice';

export const ORDER_CSV_ALIAS_MAP: Record<OrderCsvField, string[]> = {
  productSku: ['product sku', 'sku', 'sku code', 'variant sku', 'item sku code'],
  quantity: ['quantity', 'qty', 'units', 'quantity ordered'],
  customerName: ['customer name', 'recipient name', 'name'],
  customerPhone: ['customer phone', 'recipient phone', 'phone', 'mobile'],
  customerEmail: ['customer email', 'recipient email', 'email'],
  addressLine1: [
    'address line1',
    'address line 1',
    'address 1',
    'address1',
    'address',
    'addr1',
    'shipping address line1',
    'shipping address line 1',
  ],
  addressLine2: [
    'address line2',
    'address line 2',
    'address 2',
    'address2',
    'addr2',
    'shipping address line2',
    'shipping address line 2',
  ],
  landmark: ['landmark'],
  city: ['city', 'town', 'shipping city'],
  state: ['state', 'state province', 'province', 'shipping state'],
  pinCode: [
    'pin code',
    'pincode',
    'pin',
    'postal code',
    'postcode',
    'zip',
    'shipping pincode',
    'shipping pin code',
  ],
  codAmount: ['cod amount', 'cod', 'cod amount inr', 'amount to collect'],
  externalRef: [
    'external ref',
    'order ref',
    'order id',
    'reference',
    'ref',
    'sale order number',
    'order number',
  ],
  paymentMode: ['payment mode', 'payment type', 'payment method'],
  advanceAmount: ['advance amount', 'amount paid', 'advance', 'paid amount'],
  discountValue: ['discount value', 'discount', 'discount amount'],
  discountType: ['discount type'],
  totalWeightGrams: [
    'packaged product weight gm',
    'packaged product weight g',
    'packaged weight g',
    'packaged weight gm',
    'total weight g',
    'total weight gm',
    'weight g',
    'weight gm',
  ],
  retailUnitPrice: [
    'retail price',
    'retail unit price',
    'selling price',
    'unit price',
    'price',
    'unit item price',
    'item price',
  ],
};

/**
 * Columns we RECOGNISE and deliberately do not use, each with the reason.
 *
 * An unknown column has never failed an upload and must not start —
 * a seller pasting a template they downloaded from their courier cannot
 * delete columns that template requires. But "unknown" and "known and
 * not for us" are different facts, and the preview said the same shrug
 * about both: `*Pickup Location Name` came back as an unmatched header
 * with a guessed suggestion beside it, which invites somebody to map it
 * onto something it is not.
 *
 * The key is the NORMALISED header (see `normalizeHeader`); the value is
 * shown to the seller verbatim.
 */
export const ORDER_CSV_IGNORED_HEADERS: Record<string, string> = {
  'pickup location name': 'we choose the warehouse and the pickup location ourselves, per parcel',
  'transport mode': 'we choose the courier and the service level, per your courier settings',
  'item sku name':
    'the product name comes from your catalogue, snapshotted when the order is placed',
  'package name': 'packaging is ours',
  'packaging type': 'packaging is ours',
  'length cm': 'parcel dimensions come from the product in your catalogue',
  'breadth cm': 'parcel dimensions come from the product in your catalogue',
  'width cm': 'parcel dimensions come from the product in your catalogue',
  'height cm': 'parcel dimensions come from the product in your catalogue',
  'product weight gm': 'the per-unit weight comes from the product in your catalogue',
  'product weight g': 'the per-unit weight comes from the product in your catalogue',
  'fragile shipment': 'we do not carry a fragile flag',
  'tax class code': 'tax on the goods comes from your catalogue and our GST settings',
  'billing address same as shipping address': 'we hold one delivery address per order',
  'billing address line1': 'we hold one delivery address per order',
  'billing address line2': 'we hold one delivery address per order',
  'billing city': 'we hold one delivery address per order',
  'billing state': 'we hold one delivery address per order',
  'billing pincode': 'we hold one delivery address per order',
  'e way bill number': 'we raise the e-waybill with the courier when the parcel needs one',
  'seller name': 'the seller is your own account; a reseller order shows the store that sold it',
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
 *
 * `paymentMode` is deliberately NOT here: our own template has never had
 * the column and the inference from the COD amount still covers a file
 * without one.
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

/**
 * Case-insensitive, punctuation-insensitive header key.
 *
 * Every run of anything that is not a letter or a digit becomes one
 * space. That is what lets `*Shipping Pincode`, `Shipping_Pincode` and
 * `shipping pincode` be the same column, and it is why Delhivery's `*`
 * mandatory marker and the `(cm)` / `(gm)` unit suffixes need no aliases
 * of their own.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
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

/** The reason we ignore this column, or null when we simply do not know it. */
export function ignoredReasonForHeader(header: string): string | null {
  return ORDER_CSV_IGNORED_HEADERS[normalizeHeader(header)] ?? null;
}

/** Light single-token suggestion for an unmatched header (no fuzzy). */
export function suggestFieldForHeader(header: string): OrderCsvField | null {
  // A column we know and do not want must never be offered as a
  // near-miss for one we do — "Pickup Location Name (did you mean
  // customerName?)" invites exactly the wrong fix.
  if (ignoredReasonForHeader(header) !== null) return null;
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
