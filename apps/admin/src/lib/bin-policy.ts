/**
 * BIN-2, client side. Stock in these bins can be counted but never
 * picked, so moving something into one silently withdraws it from sale.
 *
 * This is a DISPLAY filter — the server is the boundary (FE-2). It exists
 * so the three screens that offer a bin as a destination cannot offer one
 * that would quietly make the stock unsellable.
 *
 * ONE copy. There were three — the RTO putaway panel, the bins index and
 * the bin-ops panel each declared their own — and a cross-file test
 * guarded exactly one of them against the API's list. Adding TRANSIT
 * showed what that costs: the guarded copy failed and the other two
 * silently went on offering a bin type the allocator now refuses.
 * `bin-policy.test.ts` checks THIS file against the API's
 * NON_PICKABLE_BIN_TYPES, and that no screen re-declares its own.
 */
export const NON_PICKABLE_BIN_TYPES = new Set([
  'RTO_HOLD',
  'DAMAGED',
  'QUARANTINE',
  // Goods in the air between two of our warehouses — see
  // docs/consignment-two-leg.md. Deliberately absent from the bin
  // CREATOR's type list: the other three are places inside a building
  // and this one is the absence of one, so a hand-made transit shelf is
  // a category error. The consignment dispatch provisions it.
  'TRANSIT',
]);
