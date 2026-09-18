# Reseller stores — design (RS-1 … RS-12)

Owner decisions, 14 Sep 2026. This file is the spec every phase builds
against; when code and this doc disagree, fix one of them in the same
change.

## The idea

A **seller** owns stock physically in our Indian warehouse. A **reseller
store** is a separate business that sells that seller's stock to Indian
customers under its OWN name. The seller sets the store's buying price, the
retail range, which products it may sell, how stock is shared, who pays
which Skydrop fee, and when each side is paid. The store has its own
portal (`reseller.skydrop.online`), team, wallet, P&L, expenses and
withdrawals.

Today's `SellerStore` (a sales channel inside one seller account) stays
exactly as it is. A store now has a **kind**:

| Kind | What it is | Wallet | Login |
|---|---|---|---|
| `CHANNEL` | the seller's own sales channel (every existing store) | none — the seller's | seller users (optionally store-scoped, as today) |
| `RESELLER` | a separate business reselling ONE seller's stock | its own | store users on reseller.skydrop.online |

## Decisions (owner)

1. A reseller store resells exactly ONE seller. Never a marketplace.
2. A store is brought in by the SELLER (invite) or by a Skydrop ADMIN
   (created for a seller, then the seller must APPROVE or REJECT).
   **AMENDED 2026-09-16: a contact email, a contact phone and an
   invitation for the first user are all REQUIRED to open one.** A store
   nobody can sign in to and nobody can ring is not onboarded — it is a
   row that looks open and can do nothing. The seller's own store is
   invited as it is created; an admin-created one is invited by the
   seller at APPROVAL, which is what opens it.
3. Portal: `reseller.skydrop.online` — a third frontend (`apps/reseller`).
4. The customer sees the STORE's name.
5. Stock per store per product: SHARED pool or SET-ASIDE quantity, plus a
   hidden percentage.
6. The store wallet is managed by the SELLER or by SKYDROP, chosen per store
   by the seller.
7. **Our bank book knows only the seller.** Every rupee held for a seller
   and all of their reseller stores is the SELLER's in `bank_entries`. A
   store wallet is a ledger between the seller and that store; there is no
   store owner kind in the bank book.
8. No tax invoices for reseller orders.
9. A seller-managed store's payout is RECORDED only — the seller pays the
   store off-platform.
10. "Credit N days after order confirmation" is enabled by Skydrop per
    seller; off by default.
11. Prepaid orders are in the first release: the store must hold the
    balance to pay the seller before a prepaid order is accepted.
12. Everything in the brainstorm for seller, store and Skydrop is in scope
    (scorecards, forecasts, terms, credit, catalogue overlay, integrations,
    analysis, fraud flags, disputes, customer ownership).

## RS-1 The store record and its life

- `seller_stores.kind` (`CHANNEL` default | `RESELLER`). A reseller store
  adds: `status` (`PENDING_SELLER_APPROVAL` → `ACTIVE` ↔ `PAUSED` →
  `CLOSED`; `REJECTED`), `origin` (`SELLER` | `ADMIN`),
  `walletManagedBy` (`SELLER` | `SKYDROP`), display name, logo key,
  contact.
- ADMIN-created stores start `PENDING_SELLER_APPROVAL`; nothing can be
  ordered until the seller approves. REJECTED is terminal.
- PAUSED blocks NEW orders; in-flight orders finish. **Amended 2026-09-15
  (owner): only a PAUSED store can be CLOSED, and only once its business is
  done** — every parcel delivered or back in our warehouse, no credit still
  to run (WAITING / DUE), and the wallet at ₹0. After that its team has no
  access. "Done" is not "terminal": DELIVERED has a customer-return edge, so
  the old terminality rule refused every store that had ever delivered a
  parcel (`order/services/store-close-rule.ts`).
- All transitions audited (HIGH for approve/reject/close).

## RS-2 Store identity, team, permissions

- A third identity kind: `IdentityKind = 'staff' | 'seller' | 'store'`
  (FE-5 — the packages are parameterised, not forked). `store_users`,
  `/auth/store/*`, refresh cookie `__Host-storeRefresh`, same hybrid `/me`
  (FE-4), same throttles, invitation + password-reset + email-verify flows
  (CREDENTIAL notifications, NOTIF-9).
- Store roles OWNER / ADMIN / OPS / FINANCE / VIEWER with a permission
  surface pinned by a spec, FAILING CLOSED on writes (RBAC-1 shape).
- A store user sees ONLY their store: never the seller's cost price, other
  stores, or seller-only screens. Every store query is scoped in the WHERE
  clause by the token's store id (tenant-isolation e2e extended).
- New SELLER permissions: `stores.manage` (create/invite/approve/pause/
  close), `stores.pricing` (assignments, prices, stock modes, fee split,
  timing), `stores.wallet` (top up / record payouts for seller-managed
  stores). New STAFF permissions: `reseller.stores.view`,
  `reseller.stores.manage`, `reseller.credit_after_confirmation.enable`.

## RS-3 Catalogue, prices, stock

- `reseller_price_lists` (seller default) + per-store overrides; per
  (store, variant): enabled, transfer price, min retail, max retail,
  suggested retail, optional store overlay (title, description, images).
- A store sees only enabled variants.
- Stock per (store, variant): `SHARED` or `SET_ASIDE(qty)`, and
  `hiddenPercent` 0–90.
  - Shared view: `floor((realAvailable − Σ other stores' unused set-asides) × (1 − hidden%))`.
  - Set-aside view: `floor(min(unusedSetAside, realAvailable) × (1 − hidden%))`.
  - INV-3 stays the authority: confirmation checks REAL availability and
    the store's set-aside; hiding can never cause overselling.
  - Σ set-asides may never exceed on-hand; when stock falls below them the
    seller is alerted and set-asides shrink newest-first.

## RS-4 Terms: fee split and credit timing (snapshotted per order)

- Per store, the seller sets for EACH Skydrop fee — delivery fee
  (ORDER_CHARGES), return fee (RTO_FEE), customer return fee, COD fee,
  COD tax (GST_WITHHOLDING), Instant Pay fee — the percentage the STORE
  pays; the seller pays the rest. Inbound freight is the seller's alone.
  Each share rounded to the paisa, remainder to the seller; the two shares
  sum to the fee exactly. Skydrop's total per order is unchanged.
- Per store, a credit trigger for EACH party: `ON_PAYOUT(+N)`,
  `AFTER_DELIVERY(N)`, `INSTANT` (at delivery, Instant Pay fee applies),
  `AFTER_CONFIRMATION(N)` (only when Skydrop enabled it for the seller;
  money fronted before collection — counted in the Instant Pay advance
  float, WAL-9, and reversed on any non-delivery).
- Terms are VERSIONED; the store must accept the current version before
  it can order. The transfer price, retail, fee split and both timings are
  SNAPSHOTTED onto the order at create; later edits never re-price.

## RS-5 Store orders

- A reseller store places orders on its portal, by CSV, or by API key /
  webhook (existing seller integration machinery, store-scoped). The order
  belongs to the SELLER (stock, warehouse, CUR/WMS rules unchanged) and
  carries `resellerStoreId` plus the RS-4 snapshot.
- Retail must be within [min, max]; refused otherwise.
- Customers belong to the STORE that sold to them (ORD-7 generalised).
- **COD**: money is split at each party's credit trigger (RS-6).
- **Prepaid**: the store collected payment itself. At create the store
  wallet must cover `transfer price + store's fee shares`
  (`STORE_BALANCE_INSUFFICIENT` otherwise); at confirmation that amount is
  debited from the store wallet under the WALLET lock and credited to the
  seller per the seller's trigger; a cancel before dispatch refunds it.

## RS-6 Money

- Two wallets per reseller order: the SELLER's (existing) and the
  STORE's (new; same `applyEntry` discipline, WAL-1/WAL-7, own directions
  registered in `CREDIT_DIRECTIONS` and `isWalletCredit`).
- COD order, per party at its trigger:
  store += retail − COD tax share − transfer price − store fee shares;
  seller += transfer price − seller fee shares. Reversal on RTO/loss
  follows WAL-6/WAL-8 per party.
- **Bank book (decision 7):** a store's money is the seller's cash. The
  TRE-8 invariant becomes: cash held for a seller = max(0, seller wallet +
  Σ that seller's reseller store wallets). A store's negative balance is
  the seller's exposure. `settlement-bank-invariant.spec` gains reseller
  scenarios.
- Wallet management:
  - SELLER-managed: top-up = the seller moves money from their wallet to
    the store wallet; payout = the seller records paying the store
    off-platform (store −X, seller +X). No bank entry either way.
  - SKYDROP-managed: the store tops up to our bank (claim → accepted by a
    human, WAL-2) and withdraws through us (remittance); cash posted as
    the seller's.
- Negative store balance limit: set by the seller (their risk); Skydrop
  may cap it.

## RS-7 Returns, damage, disputes

- Return fee split per RS-4. Goods returned are the seller's stock (WMS-8e
  unchanged). Lost/damaged in our hands: the seller is compensated at the
  transfer price through a ticket. Store ↔ seller disputes are tickets,
  Skydrop referees.

## RS-8 Reports

- Store P&L (retail − transfer price − fee shares − return fees − own
  expenses), expenses, liabilities, withdrawals, carry-forward months.
- Seller P&L gains transfer revenue by store.
- A seller sees a store's scorecard and balance, never its expenses/P&L.
- Skydrop's own P&L is unchanged (only our fees).

## RS-9 Analysis

- Seller: store scorecard (delivery, return, confirmation, cancel rates,
  margin, units), auto-pause over a return-rate limit, stock forecast
  (days of stock, reorder alert), stores ranked by profit.
- Store: profit per product, return rate by pincode, confirmation rate,
  cash-flow forecast, return on ad spend.
- Skydrop: fraud flags, disputes, float and advances per seller and store.

## RS-10 The customer sees the store

Call-centre script, shipping label ("sold by"), public tracking page,
customer emails carry the store's name and logo. No tax invoices.
(As built — including why emails carry the name but not the logo — is
"RS-10 as built" at the end of this file.)

## RS-11 Phases

1. Stores as businesses: kind, reseller record + life, onboarding both
   ways, `apps/reseller` + store identity, team and roles, seller and
   admin screens.
2. Catalogue, prices, stock modes, hidden %.
3. Terms (fee split, timings), store orders (COD + prepaid), store wallet
   both modes, bank invariant, returns and disputes.
4. Reports and analysis.
5. The customer sees the store.

## RS-12 Infrastructure

`apps/reseller` on port 3005, pm2 `skydrop-reseller`, Caddy
`reseller.skydrop.online` (Cloudflare-proxied like the others), security
headers + nonce CSP + responsive + CSP Playwright projects, deploy.sh
build/restart lines. The DNS record is an owner action. apps/marketing's
LOCAL dev/start port moved 3005 → 3006 so 3005 is the reseller portal's
everywhere (production marketing is a static export under Caddy, no port).

## Phase 1 as built (2026-09-14)

**Schema** (`20260914200000_reseller_stores_phase1`). `seller_stores.kind`
CHANNEL (default) | RESELLER; every existing row becomes CHANNEL with the
reseller columns NULL. Reseller columns: `status`, `origin`,
`wallet_managed_by`, `display_name`, `logo_key`/`logo_mime_type`,
`contact_email`/`contact_phone`, `status_changed_at`; the CHECK
`seller_stores_reseller_fields_ck` makes a CHANNEL row carry none of
status/origin/wallet manager and a RESELLER row carry all three and never
be `is_default`. New tables: `reseller_store_events` (append-only history,
written in the transition's own tx), `store_users` (email unique across the
platform), `store_role_definitions` + `store_role_permissions` (five fixed
roles provisioned per store), `store_user_invitations` (hashed token, one
LIVE invitation per email by partial unique on `lower(email)`),
`store_refresh_tokens`, `store_password_reset_tokens`,
`store_email_verification_tokens`. `actor_type` += `store`,
`notification_recipient_type` += `store_user`.

**RS-1 lifecycle.** `ResellerStoreService` is the only writer of a
reseller store's status; the rules are the pure `reseller-store-lifecycle.ts`.
Seller-created → ACTIVE; admin-created → PENDING_SELLER_APPROVAL and the
seller is told in-app (`SELLER_PERMISSION stores.manage`) and by email
(`seller.reseller_store_pending.email`, OPERATIONAL), post-commit and never
throwing. Approve / reject / pause / resume / close / wallet-manager are
guarded `updateMany` on the status READ (`RESELLER_STORE_CHANGED` on a race)
with an event row in the same tx; approve, reject and close audit HIGH.
Close (from PAUSED only) is refused while an order's parcel is neither
delivered nor back in our warehouse, or a credit is still to run
(`STORE_HAS_ORDERS_IN_FLIGHT` / `STORE_HAS_CREDITS_TO_RUN`, checked INSIDE
the tx after the move, via `OrderReadService.storeCloseBlockers`); phase 3's order
create must lock the store row FOR SHARE to close the remaining window.
REJECTED / CLOSED revoke every store refresh token and live invitation.
CHANNEL stores behave exactly as before: every `SellerStoreService` query
carries `kind: CHANNEL`, and `resolveForOrder` refuses a reseller store
(`STORE_IS_RESELLER`) until phase 3.

**RS-2 identity.** `IdentityKind` gains `'store'`. `/auth/store/*`: login
(5/15 min per email+IP), refresh, logout, logout-all, me (hybrid FE-4),
password-reset request/confirm, email-verification request/confirm,
invitations preview/accept. Audience `skydrop-store`; cookie
`__Host-storeRefresh`. `StoreJwtGuard` fails CLOSED: bearer only, re-reads
user, role and store on every request, refuses a store that is not
RESELLER + ACTIVE/PAUSED under an APPROVED seller (`STORE_NOT_ACTIVE`,
audited), and an endpoint with neither `@StoreSelfService` nor
`@RequireStorePermissions` (`ENDPOINT_NOT_AUTHORIZED`). Every store query
takes the store id from the token. Store permissions: `store.profile.view`,
`store.profile.manage`, `team.view`, `team.manage`; roles owner (implicit
all), admin, ops, finance, viewer. Pinned by `store-permission-surface.spec.ts`
and the store cases in `tenant-isolation.e2e-spec.ts`.

**Permissions.** Seller: `stores.manage` (the screens), `stores.pricing`
and `stores.wallet` RESERVED (registered, no endpoint yet — the surface
specs exempt reserved keys by name and fail if one gains an endpoint
without dropping the flag). Staff: `reseller.stores.view`,
`reseller.stores.manage`, `reseller.credit_after_confirmation.enable`
(dangerous, reserved).

**Screens.** apps/reseller: login, forgot/reset, verify email, accept
invitation, dashboard, team, store settings (logo via presigned Spaces PUT,
1 MB), my account. apps/seller `/reseller-stores` (+ detail: decide,
pause/resume/close, wallet manager, team, history). apps/admin
`/reseller-stores` (list across sellers, create for a seller, read-only
detail with history).

## Phase 2 as built (2026-09-14) — RS-3 catalogue, prices, stock

**Schema** (`20260914210000_reseller_catalogue`). Enum `reseller_stock_mode`
(SHARED | SET_ASIDE). Four NEW tables, nothing existing rewritten:

- `reseller_price_list_items` — the seller's DEFAULT reseller price per
  variant: `transfer_price_inr` (NOT NULL), `min_/max_/suggested_retail_inr`
  (nullable), all `Decimal(12,2)`. UNIQUE `(seller_id, variant_id)`. FK
  sellers CASCADE, product_variants RESTRICT.
- `reseller_store_variants` — ONE store's terms for ONE variant, UNIQUE
  `(store_id, variant_id)`: `enabled` (default FALSE), the price OVERRIDE
  (same four columns, all NULL = use the default), `stock_mode`,
  `set_aside_qty`, `set_aside_at`, `hidden_percent`, `overlay_title`,
  `overlay_description`. `seller_id` is denormalised (the Σ-set-aside read
  and the lock key need no join). FK seller_stores CASCADE, sellers
  CASCADE, product_variants RESTRICT.
- `reseller_store_variant_images` — overlay pictures: a Spaces KEY under
  `stores/<storeId>/catalogue/<variantId>/`, soft-deleted, ≤ 5 live per
  (store, variant), ≤ 2 MB, JPEG/PNG/WebP. Presigned PUT to upload,
  presigned GET to read; no URL is stored.
- `reseller_set_aside_shrinks` — APPEND-ONLY history of every sweep cut
  (`from_qty`, `to_qty`, the `on_hand` read, `total_before`).

CHECKs: a default row has transfer > 0 and retail ≥ 0 with
min ≤ suggested ≤ max where set; an override is a WHOLE row or nothing
(no retail figure without a transfer price) under the same rules;
SHARED ⇔ `set_aside_qty` NULL, SET_ASIDE ⇔ NOT NULL and ≥ 0;
`0 ≤ hidden_percent ≤ 90`; a shrink has `0 ≤ to_qty < from_qty`.

**Grants in the migration.** Every existing reseller store's admin / ops /
finance / viewer role gains `catalogue.view` (new stores get it from
`provisionDefaultStoreRoles`; the owner holds it implicitly). Every
seller's system `admin` role that already held `stores.manage` gains
`stores.pricing` (no longer reserved). Both `INSERT … WHERE NOT EXISTS`.

### Prices

- **Effective price per (store, variant) = the store's override row if it
  has one, else the seller's default row — decided per ROW, never per
  field.** A per-field merge would let a later change to the default
  combine with half an override into a range nobody saw. The seller's
  screen pre-fills an override from the default.
- Rules (`reseller-price-rules.ts`, pure, in whole paise): every figure
  ≥ 0 with ≤ 2 decimals (`INVALID_AMOUNT`); transfer price present and
  > 0 (`TRANSFER_PRICE_REQUIRED`); min ≤ max (`RETAIL_RANGE_INVERTED`);
  suggestion inside whichever bounds are set (`SUGGESTED_OUTSIDE_RANGE`).
  Retail is NOT required to exceed the transfer price — the seller's call.
- A variant is RESELLABLE when it is the seller's, not ARCHIVED, not
  deleted, and its product is ACTIVE and not deleted
  (`CatalogReadService.listResellableVariants`, MUST #13 — extended for
  this; capped at 2,000 with `truncated` said out loud).
- A store SELLS a variant only when `enabled` AND it is resellable AND it
  has an effective transfer price. Enabling without a price is refused
  (`TRANSFER_PRICE_REQUIRED`); enabling a non-resellable variant too
  (`VARIANT_NOT_RESELLABLE`). A row whose variant was archived later
  stays on the seller's screen, labelled, and drops off the store's.
- Removing a default price is refused while an enabled live store sells
  that variant AT the default (`DEFAULT_PRICE_IN_USE`, naming the stores).

### Stock — the formula as implemented (`reseller-visible-stock.ts`, pure)

`realAvailable` = INV-3 availability summed over every warehouse that
fulfils orders (`WarehouseResolverService.fulfillingWarehouseIds`, CNS-2),
pickable bins only (BIN-2's shared constant): Σ pickable `qtyOnHand` −
Σ ACTIVE reservations, clamped at 0 — read LIVE through the new
`StockReadService.getSellableStockLive` (inventory-stock's sanctioned
surface; INV-2, no cache). `onHand` is the same Σ pickable `qtyOnHand`
before reservations — the set-aside basis.

```
unused(store)  = max(0, set_aside_qty − consumedByStore)
SHARED:    floor(max(0, realAvailable − Σ other live stores' unused set-asides) × (100 − hidden) / 100)
SET_ASIDE: floor(min(unused, max(0, realAvailable)) × (100 − hidden) / 100)
```

Integer arithmetic, so the floor is exact. **Phase-3 seam:**
`consumedByStore` is `ResellerCatalogueService.consumedByStore()`, which
returns `CONSUMED_BY_STORE_BEFORE_ORDERS` (0) — phase 3 answers it from
the store's own ACTIVE reservations, and both the seller's preview and
the store's page follow because both go through `visibleFor`.

- "Live stores" whose set-asides HOLD stock (`COMMITTING_STORE_STATUSES`):
  PENDING_SELLER_APPROVAL, ACTIVE, PAUSED. A closed or rejected store's
  set-aside holds nothing, and its terms can no longer be edited
  (`STORE_FINAL`). A pending store can be set up before the seller
  approves it, so its commitment already counts.
- A set-aside counts whether or not the variant is `enabled` there — it
  is a commitment the seller made and the guard checked; freeing it is
  switching the store to SHARED.
- **The set-aside guard.** On save, under `AdvisoryLock.RESELLER_SET_ASIDE`
  (`0x05241`, key `<seller>|<variant>`) INSIDE the writing transaction:
  if the save GROWS the store's commitment (new SET_ASIDE, or a larger
  quantity), Σ other live stores' set-asides + the new quantity must not
  exceed `onHand`, else 409 `SET_ASIDE_EXCEEDS_STOCK` saying how many are
  free. A DECREASE is always allowed — refusing somebody who promises
  less because stock fell since would only leave the over-commitment for
  the sweep. `set_aside_at` is stamped only when the commitment grows.
- **The shrink sweep** (`ResellerSetAsideSweepService`, own BullMQ queue
  `reseller-set-aside`, hourly at :20, `WorkerRoleService` per SCALE-1):
  every (seller, variant) whose live set-asides exceed `onHand` is cut
  NEWEST-FIRST (`set_aside_at` desc, then id desc; an undated row is the
  oldest) until it fits, under the same lock, re-reading rows and stock
  inside it; each cut is a guarded `updateMany` on the quantity read, cut
  to 0 at most (the store stays SET_ASIDE — the seller decides what
  next). It never touches stock. **Recorded as append-only
  `reseller_set_aside_shrinks` rows, written in the shrink's own
  transaction**, not as audit rows: the audit writer is best-effort by
  design and the seller's screen lists these, so a lost row would be a
  cut nobody can see (the `reseller_store_events` argument). One MEDIUM
  audit row per (seller, variant) as well, `entityId` null. The seller
  is told in-app — topic `seller.reseller_set_aside_shrunk`
  (catalogued, NOTIF-17), to `SELLER_PERMISSION stores.pricing`, event id
  from the first shrink row — awaited after commit and never throwing,
  so nothing outlives the job (no drain needed).

### Overlay

Per (store, variant): title, description, pictures. The store sees
`overlay_title ?? product name`, `overlay_description ?? product
description`, and the overlay pictures, else the catalogue thumbnail
(`CatalogReadService.thumbnailUrlsByVariant`, fail-open).

### Who sees what

| Surface | Endpoint | Permission |
|---|---|---|
| Seller default price list | `GET /seller/reseller-price-list` | `stores.pricing` or `stores.manage` |
| | `PUT /seller/reseller-price-list/:variantId`, `DELETE …` | `stores.pricing` |
| Seller store terms | `GET /seller/reseller-stores/:storeId/catalogue` | `stores.pricing` or `stores.manage` |
| | `PUT /seller/reseller-stores/:storeId/catalogue/:variantId` | `stores.pricing` |
| | `POST …/:variantId/images/presign`, `POST …/images`, `DELETE …/images/:imageId` | `stores.pricing` |
| Store | `GET /store/catalogue` | store `catalogue.view` (every role) |
| Admin | `GET /admin/reseller-stores/:storeId/catalogue` | `reseller.stores.view` |

Every seller write audits MEDIUM with before/after (`entityId` = the row).
The store's response carries ONLY: variant id, SKU, title, label,
description, picture URLs, transfer price, retail range, suggestion,
visible quantity — never the seller's cost, real stock, set-asides,
hidden share or anything about another store (pinned in
`tenant-isolation.e2e-spec.ts`). The admin view is the seller's view,
read-only.

**Screens.** apps/seller: `/reseller-stores/price-list` (gate
`stores.pricing`, nav "Reseller price list") and a "Catalogue & stock"
tab on `/reseller-stores/[storeId]` (page gate `stores.manage`; Edit
offered only with `stores.pricing` — so a person with pricing but not
manage edits defaults only; a known, cosmetic limit). The tab shows real
availability beside what the store sees, the free-to-set-aside figure,
and the recent shrinks. apps/reseller: `/catalogue` (gate
`catalogue.view`, nav, linked from the dashboard). apps/admin: a
read-only "Catalogue terms" section on the store detail page.

**Left for phase 3.** `consumedByStore` (the seam), confirmation checking
real availability AND the store's set-aside, retail within [min, max]
enforced on a store order, and snapshotting the effective price onto the
order (RS-4). No order path reads any of this yet.
## Terms as built (RS-4, 2026-09-14)

Migration `20260914220000_reseller_store_terms`; module
`apps/api/src/modules/reseller-store-terms/` (its own module, EXPORTING
`ResellerStoreTermsService`, importing nothing order-shaped, so phase 3b's
order module can import it without a cycle).

**Schema.** `reseller_store_terms_versions` — APPEND-ONLY, one row per
version, `version` 1, 2, 3… per store (unique `(store_id, version)`), one
`DECIMAL(5,2)` column per fee for the share the STORE pays
(`delivery_fee_…`, `return_fee_…`, `customer_return_fee_…`, `cod_fee_…`,
`cod_tax_…`, `instant_pay_fee_store_percent`), `store_credit_trigger` +
`store_credit_days`, `seller_credit_trigger` + `seller_credit_days` (enum
`reseller_credit_trigger`: ON_PAYOUT / AFTER_DELIVERY / INSTANT /
AFTER_CONFIRMATION), `note`, `created_by_actor_type` / `created_by_id`,
`created_at`. CHECKs: every share 0–100; days 0–365; INSTANT ⇒ 0 days;
AFTER_DELIVERY ⇒ ≥ 1 day; version ≥ 1. `reseller_store_terms_acceptances` —
APPEND-ONLY, UNIQUE per version, the store user, `accepted_at`,
`ip_address` (INET), `user_agent`; a COMPOSITE FK `(terms_version_id,
store_id) → versions (id, store_id)` makes "store A accepted store B's
terms" unrepresentable. Both FK-RESTRICT the store (and the store user); the
e2e reset truncates them before `store_users`.

**Fee split (the ONE arithmetic — `terms/fee-split.ts`, pure).**
`splitFee(amountInr, storePercent)`: `storeInr = round_half_up(amount ×
pct / 100, paisa)`, `sellerInr = amount − storeInr`. The two always add up to
the fee, neither is ever negative, 0% and 100% are exact; the rounding
half-paisa falls on the STORE's side. A negative fee, a fraction of a paisa,
a percent outside 0–100 or with more than two decimals is refused
(`FEE_SPLIT_*`) — a refund reverses the shares it recorded, it never splits
a negative amount. `splitFeeLines(lines, percents)` splits EACH line on its
own and totals the per-line shares (never a split of the total, so the
per-line wallet entries add up to the order's split). Fee types are an
F2-exhaustive TypeScript union (`terms/reseller-fee-types.ts`):
`storePercentField` (the one place a fee becomes a column) and
`walletDirectionForFee` (DELIVERY_FEE → ORDER_CHARGES, RETURN_FEE → RTO_FEE,
CUSTOMER_RETURN_FEE, COD_FEE → COD_COLLECTION_FEE, COD_TAX →
GST_WITHHOLDING, INSTANT_PAY_FEE). Inbound freight is not a fee type — it is
the seller's alone. Kept a TS union, not a Prisma enum, because nothing
stores a fee type as a value yet; phase 3b's per-order split lines are the
first column that will need one — promote it then.

**Credit timings (`terms/terms-rules.ts`, pure).** Per party, per version.
Decisions made here: INSTANT takes no days; **AFTER_DELIVERY needs at least
one day** — zero days after delivery IS Instant, which carries the Instant
Pay fee, so AFTER_DELIVERY(0) would be Instant with its fee left off; days
are capped at 365. Every trigger has plain words (`timingWords`), which both
portals show rather than composing their own.

**Credit after confirmation (decision 10).** SET-1 seller-overridable
boolean `reseller.credit_after_confirmation_enabled`, seeded FALSE, global
row `is_editable_by_admin = false` (flipping it globally would switch it on
for every seller) — inserted by the migration too, since the seed is
create-only. ONE writer: `CreditAfterConfirmationService.set`, through
`SettingsResolverService.setOverride(…, { dedicated: true })`; the generic
admin seller-settings PATCH/DELETE and any seller self-service writer are
refused `SETTING_HAS_DEDICATED_ENDPOINT` (`DEDICATED_OVERRIDE_KEYS`). The
endpoint is `PUT /admin/sellers/:sellerId/reseller-credit-after-confirmation`
(`reseller.credit_after_confirmation.enable`, dangerous, reason ≥ 20,
audited HIGH with the stores it flags). ONE reader: `isEnabled`, which
**fails CLOSED** (unreadable ⇒ off — it is fronted money). **Switching it
off rewrites no terms.** Instead: (1) publish refuses a new version using it
(`CREDIT_AFTER_CONFIRMATION_NOT_ENABLED`); (2) every live store whose CURRENT
version uses it is FLAGGED — derived on read, never stored, so it clears
itself when the seller publishes a version without it or the switch comes
back on — shown on the admin seller card, as `needsRevision` on all three
terms views, and in the seller's in-app notice at the moment of the switch;
(3) `orderReadiness` reports `AFTER_CONFIRMATION_NOT_ENABLED`, so phase 3b
refuses new orders on a flagged store rather than front money Skydrop has
withdrawn. Placed on the **admin SELLER page** (not a store page): it is
Skydrop agreeing to front money for that seller, and it governs every store
they run.

**Versions and acceptance.** `ResellerStoreTermsService.publish` (seller,
`stores.pricing`) is the only writer of versions: store must be non-terminal
(`STORE_IS_FINAL`; a PENDING_SELLER_APPROVAL store may be given terms before
approval), shares and timings validated, then under
`AdvisoryLock.RESELLER_TERMS` (per store) it reads the latest version and
inserts the next — unique `(store, version)` the backstop. `basedOnVersion`
(the version the seller was editing, 0 for none) refuses a stale edit
(`TERMS_CHANGED`); identical terms are refused (`TERMS_UNCHANGED`). Audited
MEDIUM `reseller_store.terms_published` with before/after. No
`reseller_store_events` row is written (the versions table IS that history,
and adding an event kind would alter a phase-1 enum the parallel phases also
touch). `accept` (store, `terms.accept`) takes the same lock, looks the
version up scoped by the TOKEN's store (another store's id is a 404), refuses
a replaced version (`TERMS_NOT_CURRENT`), and records who, when, IP and user
agent; already accepted is an idempotent success; audited MEDIUM
`reseller_store.terms_accepted`. A new version supersedes acceptance —
`acceptedCurrentTerms` asks about the LATEST version only.

**The surface phase 3b calls** (`ResellerStoreTermsService`, pass the order's
own tx as `db`, after the FOR SHARE lock on the store RS-1 asks for):
`currentTerms(storeId, db?) → StoreTermsSnapshot | null` (`termsVersionId`,
`version`, `storePercents` as Decimals, `storeCredit`, `sellerCredit`,
`acceptedAt`); `acceptedCurrentTerms(storeId, db?) → boolean`;
`orderReadiness(storeId, db?) → { ready, termsVersionId, reasons, message }`
with reasons `NO_TERMS` / `TERMS_NOT_ACCEPTED` /
`AFTER_CONFIRMATION_NOT_ENABLED`. Refuse the order when `ready` is false;
snapshot `termsVersionId` when true; split with `splitFeeLines(lines,
snapshot.storePercents)`.

**Permissions.** Store: `terms.view` (every default role — the terms decide
what every order costs, and the portal banner must read them for whoever is
signed in) and `terms.accept` (admin; the owner holds all implicitly) —
provisioned for EXISTING stores' system roles by the migration.
`store-permission-surface.spec.ts` names `terms.accept` as the ONE write key
that is not a `.manage` (the store cannot change terms, only agree to them).
Seller: `stores.pricing` is no longer reserved — reading terms needs
`stores.manage` OR `stores.pricing`, publishing `stores.pricing` alone.
Staff: `reseller.credit_after_confirmation.enable` is no longer reserved;
reading terms and the switch needs `reseller.stores.view`.

**Endpoints.** `GET /seller/reseller-stores/:storeId/terms`, `GET
…/terms/preview` (a draft through the real split — the Terms tab's live
worked example), `POST …/terms`; `GET /store/terms`, `POST
/store/terms/:versionId/accept`; `GET /admin/reseller-stores/:storeId/terms`;
`GET` / `PUT /admin/sellers/:sellerId/reseller-credit-after-confirmation`.

**Notifications.** Published → an EMAIL (`store.terms_published.email`,
OPERATIONAL, recipient STORE_USER) to each store user who may accept it.
Store users have no inbox in phase 1, so the in-app half is the **portal-wide
banner** (`TermsBanner`) shown on every page while the version in force is
unaccepted (or flagged) — stronger than a dismissible notice. Accepted →
in-app to the seller's `stores.pricing` holders
(`seller.reseller_terms_accepted`); switched off with stores flagged → in-app
to the same people (`seller.reseller_terms_need_revision`). Both topics are
in the catalogue and pinned by `notification-topic-catalog.service.spec.ts`.
`ResellerTermsNotifier` is AWAITED after the commit and never throws, so it
leaves no in-flight write for the e2e reset to drain (NOTIF-19).

**Worked examples.** Served by the API from `splitFee`: the delivery, return
and customer-return fees use what THIS seller is charged (their SET-1
`pricing.flat_delivery_fee_inr` / `flat_rto_fee_inr` /
`customer_return_fee_inr`, fail-open to the seeded 200 / 30 / 200); the
percentage-shaped fees are worked on ₹100 of the fee.

**Screens.** apps/seller: an Overview | Terms tab on
`/reseller-stores/[storeId]` — the version in force and its acceptance, the
worked example table, both timings in words, a publish form (gated
cosmetically on `stores.pricing`) with the live API preview ("on a ₹200.00
delivery fee the store pays ₹160.00, you pay ₹40.00"), and every version.
AFTER_CONFIRMATION is offered labelled "needs Skydrop to enable it" when off
(the server refuses verbatim — FE-2, no client mirror of the rule).
apps/reseller: `/terms` (plain words, the example, Accept with confirm,
history) and the banner. apps/admin: a read-only Terms section on the store
detail (with the acceptance IP), and the switch card on the seller page.
**Who sees the acceptance IP:** Skydrop and the store itself; the seller sees
who and when.

**Tests.** Unit: `reseller-fee-split.spec.ts` (odd paisa, 33.33 %, zero,
0/100 %, a sweep asserting the shares always sum and never go negative,
F2 mappings), `reseller-terms-rules.spec.ts`,
`reseller-store-terms.service.spec.ts` (lock before read, every refusal,
acceptance, readiness), `credit-after-confirmation.service.spec.ts` (dedicated
writer, flags, fails closed, the generic door refused). E2E (CI):
`reseller-terms-flow.e2e-spec.ts` (publish → accept → superseded, five
concurrent publishes get 1…5, the CHECKs, the switch end to end) and the RS-4
cases in `tenant-isolation.e2e-spec.ts`.
## Store wallet as built (RS-6, wallet half — 2026-09-14)

`20260914230000_reseller_store_wallet`. Store ORDERS are not in this wave:
phase 3b posts order money into the primitive described here.

**The ledger.** `store_wallet_entries` — APPEND-ONLY, INR, uuidv7 ids,
`amount > 0` (CHECK; `direction` carries the sign), `running_balance_after`,
`idempotency_key` UNIQUE, `share_of` (which Skydrop fee a share is of),
`linked_order_id` (plain id for 3b), `linked_entry_id` (the entry a refund /
reversal returns), `linked_seller_entry_id` UNIQUE (the seller-wallet twin of
a seller-managed move). Written ONLY by `StoreWalletService.applyEntry`,
which takes the **seller's** WALLET advisory lock (`<sellerId>|INR` — the
key the seller's own wallet takes), so the seller and every one of their
stores are serialised TOGETHER; checks the store is that seller's RESELLER
store; reads the balance as the last entry's running balance (WAL-7, never a
re-sum); writes; and hands the entry to
`SellerCashAttributionService.applyStore` in the same transaction.

**Directions** (`StoreWalletEntryDirection`; credit/debit in
`STORE_CREDIT_DIRECTIONS` AND `isStoreWalletCredit` in `@skydrop/ui/status`,
compared as whole sets by `store-wallet-directions.spec.ts`; the cash rule is
the F2 switch `storeDirection` in the attribution service):

| Direction | Way | Cash (the SELLER's) | Written by |
|---|---|---|---|
| `SELLER_TOPUP` | credit | none — twin `STORE_TOPUP_OUT` on the seller | seller-managed top-up |
| `SELLER_PAYOUT` | debit | none — twin `STORE_PAYOUT_IN` on the seller | seller's recorded payout |
| `TOPUP` | credit | posted by the acceptance (SELLER-owned, debt split on the group) | Skydrop-managed claim accepted |
| `WITHDRAWAL` | debit | posted by the payout (SELLER's as far as held, rest ours + `takeToCapital`) | Skydrop-managed payout |
| `ORDER_CREDIT` | credit | posted by the flow that brings it (payout / front) | 3b — COD margin |
| `ORDER_CREDIT_REVERSAL` | debit | posted by the payout taking it back | 3b — RTO / loss |
| `FEE_SHARE` | debit | TO_CAPITAL (clamped) | 3b — store's share of a fee (`share_of`) |
| `COD_TAX_SHARE` | debit | TO_CAPITAL (clamped) | 3b — store's share of the COD tax |
| `SHARE_REFUND` | credit | TO_SELLER (above the group's debt) | 3b — a share given back |
| `PREPAID_DEBIT` | debit | TO_CAPITAL (clamped) — in neither wallet until the seller is credited | 3b — prepaid order at confirmation |
| `PREPAID_REFUND` | credit | TO_SELLER | 3b — prepaid cancel before dispatch |

Seller-side: `WalletEntryDirection.STORE_TOPUP_OUT` (debit) and
`STORE_PAYOUT_IN` (credit), both cash `NONE`, registered in
`CREDIT_DIRECTIONS` / `isWalletCredit` / `walletDirectionLabel` (WAL-1). 3b's
seller-side credit of a prepaid transfer price must be a TO_SELLER direction
(it moves back what `PREPAID_DEBIT` made ours); it is not added here.

**The bank invariant (decision 7, TRE-8 generalised).** No store owner kind
exists in `bank_entries`. The invariant is

  held for a seller = max(0, seller wallet + Σ that seller's store wallets)

`SellerCashAttributionService.groupBalance` (seller wallet + Σ stores, under
the seller's WALLET lock) is read wherever the attribution read the seller's
own balance to decide cash: `debtSplit` (every cash-in), the TO_SELLER refund
clamp (`max(0,after) − max(0,before)`), the courier-settlement reversal
clawback and the Instant Pay reversal on an ended order. TO_CAPITAL clamps to
the seller's holdings as before, which equal `max(0, group)` by the invariant.
With no reseller stores `groupBalance` is exactly the seller's balance, so
every existing scenario in `settlement-bank-invariant.spec.ts` passes
unchanged; the spec gains thirteen reseller scenarios (seller-managed top-up
and payout, refusals, a store going negative, a refund against group debt,
Skydrop-managed top-up and withdrawal, a group in debt, two stores, lock
order) asserting the invariant after every step through the REAL services.
The combined read lives in the dependency-free
`treasury/services/store-wallet-balances.ts` (plain functions over a client),
so the treasury, the withdrawal guard and the reports share it without a
module cycle. Lock order unchanged: WALLET (sorted) < account keys <
ATTRIBUTION_RECONCILE_KEY.

**A store's negative balance is the seller's exposure.** The seller's
withdrawable (`WithdrawalRequestService.withdrawableBalance`, the ONE WAL-3
method) now adds `storeExposure = min(0, Σ store balances − Σ store requests
held)` — zero without stores. Liabilities and treasury coverage net a seller
with their stores ("Seller wallet balances" carries `parts`: own wallets /
stores' wallets); a group below zero is a receivable. The P&L reads none of
the new directions (`pnl.service.spec` pins it).

**SELLER-managed** (`SellerManagedStoreWalletService`, seller `stores.wallet`,
no bank entry either way, one transaction each, IDEM-1 key on the store
entry):
- top-up: refused beyond what the seller could WITHDRAW
  (`STORE_TOPUP_EXCEEDS_WITHDRAWABLE`) — balance − minimum balance − open
  requests + store exposure — read inside the tx under the lock. Audit MEDIUM.
- recorded payout (decision 9): store −X, seller +X, refused beyond the
  store's balance (`STORE_PAYOUT_EXCEEDS_BALANCE`); a note (≥5) the store
  reads. Audit HIGH.
- Only ACTIVE/PAUSED stores whose wallet the seller manages
  (`STORE_WALLET_SKYDROP_MANAGED`, `STORE_NOT_OPEN`).

**SKYDROP-managed** (cash posted as the SELLER's):
- top-up claim (`StoreTopupService`, store `wallet.topups.manage`): WAL-2 — a
  claim writes nothing; reference OR proof mandatory; proof is a Spaces KEY
  under `stores/<storeId>/topup-proofs/`; rupee accounts only
  (`STORE_TOPUP_ACCOUNT_NOT_INR`). Accept (staff `money.topups.review`):
  guarded `updateMany` on PENDING, then store credit + SELLER `SELLER_TOPUP`
  bank entry + `repayDebt` of the group's debt, one tx. Audit HIGH.
- withdrawal (`StoreWithdrawalService`, store `wallet.withdrawals.manage`):
  a request with payee details (IFSC checked). Withdrawable =
  `StoreWalletService.storeWithdrawable` = min(store balance − its open
  requests, group − every open request in the group) — the second keeps us
  from paying a store while its seller's group is in debt; no minimum.
  Approve (`money.withdrawals.review`) re-checks excluding itself; pay
  (`money.remittances.manage`) claims on the status read, debits the store and
  mirrors the remittance cash rule. **A dedicated service, not
  `RemittanceService`**: that one snapshots SELLER bank details, debits
  REMITTANCE_OUT and closes a SELLER withdrawal request — none of which is
  true of a store; the cash rule is the part that is the same, and it is
  mirrored. No bank fee on a store payout (not needed yet).
- Staff reuse the seller money-queue permissions (`money.view`,
  `money.topups.review`, `money.withdrawals.review`,
  `money.remittances.manage`) rather than a new key no role holds.

**Mode switch** is refused while a PENDING claim or a PENDING/APPROVED
withdrawal exists (`STORE_WALLET_HAS_OPEN_REQUESTS`), under the seller's
WALLET lock, which claim and withdrawal submission take too. **Close** is
refused while the store wallet is not ₹0 or has an open request
(`STORE_WALLET_NOT_SETTLED`, RS-1's "settled first"); close takes the WALLET
lock before touching the store row.

**Negative limit.** `store_wallet_settings.negative_limit_inr` (seller-set,
`stores.wallet`, ≥0 by CHECK; no row ⇒ 0), capped by
`reseller.store_negative_limit_cap_inr` (DECIMAL, 25,000, SET-1
seller-overridable by staff; seeded and inserted by the migration). A value
above the cap is refused (`STORE_NEGATIVE_LIMIT_ABOVE_CAP`), never silently
lowered. An unreadable cap counts as 0 (fails CLOSED). **For phase 3b:**
`StoreWalletService.storeCanSpend(tx, { storeId, sellerId, amount })` —
call it INSIDE the transaction that writes the debit; it takes the seller's
WALLET lock itself, so nothing moves the store, the seller or a sibling store
between the check and the write.

**Permissions.** Store: `wallet.view`, `wallet.topups.manage`,
`wallet.withdrawals.manage` (group Money; finance and admin roles, and every
existing store's admin/finance role by the migration). Seller: `stores.wallet`
is no longer reserved (not backfilled onto existing seller roles, as
`stores.manage` was not: the owner holds it implicitly).

**Screens.** apps/reseller `/wallet` (balance, withdrawable, limit, top-up
claim and withdrawal forms for a Skydrop-managed wallet, requests, ledger;
read-only "managed by <seller>" otherwise). apps/seller: the wallet section
on `/reseller-stores/[storeId]` (top up, record a payout, negative limit,
ledger). apps/admin: `/reseller-store-wallets` (claims and withdrawals with
accept / reject / approve / record payout) and a wallet panel on
`/reseller-stores/[storeId]`.

**Not in this wave:** store orders and their money (3b); notifications on
claim / withdrawal outcomes (the store sees the state on its wallet page);
a store bank account of record with change approval (payee details are
given per request); an unpayable-request sweep for store withdrawals (they
are re-checked at approve and pay instead).


## RS-10 as built (2026-09-14) — the customer sees the store

**The rule lives once.** `apps/api/src/common/brand/customer-facing-brand.ts`
(pure, no DI, no module — the R3 shape) exports `customerFacingBrand(order)`
and `CUSTOMER_BRAND_ORDER_SELECT` (the columns every surface reads). An order
whose store is `kind = RESELLER` presents as THAT STORE: the name the order
carried when it was placed (`orders.store_name_snapshot`, ORD-6 — RS-5 writes
`displayName ?? name`), and the store's CURRENT `logo_key`, presigned on read.
Every other order — every CHANNEL-store order, which is every order in
production today — presents exactly as before: the seller's company. **A
reseller order never falls back to the seller**: blank names fall through the
store's own names (snapshot → display name → name), never to
`seller.companyName`. No schema change and no migration.

**Surfaces.**

- **Call centre.** `PulledAssignment.customerBrand` (`kind`, `name`, the
  store's own contact phone/email for a reseller order), batched in one
  `order.findMany` per pull/list and FAIL-OPEN to null (the screen then shows
  the seller line it always showed). The admin station prints "Ordered from
  <store>" with a "Reseller store" badge, the script line "Say you are calling
  about their order from <store>. Do not mention the seller behind the
  store.", a "Store contact" field, and relabels the seller's contact "Seller
  contact (not for the customer)". A channel order renders byte-for-byte as
  before (`apps/admin/src/lib/call-brand.ts`, `call-brand.test.ts`).
- **Courier booking ("sold by").** `DispatchAwbInput.soldByName`, set by
  `AwbGenerationService` ONLY for a reseller order; the dispatcher (CUR-12)
  maps it to Delhivery's `seller_name` (sanitised like every other free text)
  and Shiprocket's `reseller_name`. Absent for every other order, so their
  payloads are byte-identical — pinned key-for-key in
  `courier-awb-dispatch.service.spec.ts`, `delhivery-awb.service.spec.ts` and
  `shiprocket-client.service.spec.ts`. Pickup location, return address and
  everything a courier matches on are untouched. **Unverified:** whether
  Shiprocket prints `reseller_name` on its label depends on their label
  settings — check the first real reseller parcel's label. Reverse bookings
  (customer returns) send nothing new.
- **Our own printed label** (manual-courier labels, `warehouse-printing`): the
  "order · from" line uses the brand, so a reseller parcel carries the store.
  Staff-only screens (print queue, selection table) still show the seller.
- **Public tracking.** `PublicTrackingResponse.soldBy?: { name, logoUrl }` —
  ONLY for a reseller order, ABSENT (not null) otherwise. TRK-8 holds: nothing
  of the underlying seller is projected; the logo is a 15-minute presigned GET
  and a failed presign costs the logo, never the page; the generic 404 is
  unchanged. apps/track renders "Sold by" / "विक्रेता" with the logo in its
  own design world; its CSP `img-src` now admits
  `https://*.digitaloceanspaces.com` (images only, never connect-src), pinned
  by `track-csp-store-logo.spec.ts`.
- **Customer emails.** A new `store_name` variable (the reseller store's name,
  else the seller company — never blank for an order that has one). The three
  customer templates that named the seller (`customer.order_{dispatched,
  delivered,cancelled}.email`) now read `{{ store_name }}`; the seed UPSERTS
  templates (bodyTemplate is in `update:`) and the deploy re-seeds when
  seed.ts changes, so **no `20260914250000_customer_templates_store_name`
  migration was needed or written**. For a reseller order's CUSTOMER target the
  listener also overrides `company_name` / `seller_company_name` with the store
  name, so a row still on its old wording until the re-seed cannot leak the
  seller; a channel order's customer target gets the very same variables object
  as before (pinned). Seller-facing emails are unchanged.
  **The logo is NOT in emails, on purpose:** nothing in the bucket is public
  and a presigned URL lives 15 minutes, so an email opened tomorrow would show
  a broken image. If a logo in email is wanted, it needs a durable, public,
  per-store asset — a decision, not a code change.
- **No tax invoices (decision 8).** `InvoiceService.assertInvoiceable` refuses
  a reseller order with 409 `INVOICE_NOT_FOR_RESELLER_ORDER` before any invoice
  row is read — on generate, the seller's GET and the PDF redirect; the
  DELIVERED listener skips it quietly. apps/seller shows the verdict verbatim
  and no "Generate now" (FE-2). Channel orders unchanged
  (`invoice-reseller-refusal.spec.ts`).

**Left for RS-5 to notice.** `orders.recipient_name` carries the seller's
initials code (`composeSellerPrefixedName`) and is printed on courier labels.
It is a short code, not a name, but for a reseller order RS-5 should decide
whether to prefix with the seller's code at all.

**Dormant until RS-5.** `resolveForOrder` still refuses a reseller store, so
no reseller order exists yet; every branch above is exercised by unit tests
only until store orders land.

## Store orders as built (RS-5, 2026-09-14)

Migration `20260914240000_reseller_store_orders`. **No money yet**: phase 3c
wires the fee split, the prepaid debit and the reversals onto these orders;
this phase posts no wallet entry of any kind.

### The master switch — OFF until 3c

`reseller.orders_enabled` (SET-1, BOOLEAN, seeded FALSE, seller-overridable,
editable by staff — per seller from the seller's settings; also inserted by
the migration because the seed is create-only). While it is off every store
order is refused `RESELLER_ORDERS_DISABLED`. **It must stay off until 3c
lands**: a delivered reseller order goes through today's money path, which
knows nothing of the store, so the SELLER would be credited the whole COD
(the store's retail margin included) and the store nothing. Read in ONE
place (`ResellerOrderService.assertOrdersEnabled`) and it FAILS CLOSED — an
unreadable switch is an off switch, because it guards money.

### Placing an order — three doors, one path

- **Portal** `POST /store/orders` (`orders.create`), **CSV** `/store/order-imports/*`
  (`orders.create`; the seller's CSV machinery — parser, `order-csv-import`
  queue and worker, processor — with the store on the upload row), and
  **API key** `POST /store-api/v1/orders` (`sks_…` key, `StoreApiKeyGuard`).
  All three call `ResellerOrderService.create` (order-core), the ONLY caller of
  `OrderService.create`'s `reseller` option. `resolveForOrder` still refuses
  a reseller store (`STORE_IS_RESELLER`), so the seller's own form cannot file
  an order under one.
- The order belongs to the SELLER (stock, warehouse, courier, WMS, CUR
  unchanged) with `store_id` = the store, `store_kind = RESELLER`, and
  `store_name_snapshot` = the store's `display_name ?? name` at create — the
  name the customer sees (RS-10 reads exactly that column; its meaning for
  CHANNEL stores is unchanged). It is created straight into
  PENDING_CONFIRMATION (a store has no drafts) and joins the call queue
  (CC-6) like any other order. Source: MANUAL (portal) / BULK_UPLOAD (CSV) /
  API (key). The actor on the order's events is `STORE` (the store user) or
  `API` (the key).
- **The refusals, in this order, before anything is written**
  (`ResellerOrderService.create`, pinned by `reseller-order.service.spec.ts`):
  1. the store is a live RESELLER store, ACTIVE, under an APPROVED seller —
     PAUSED is `RESELLER_STORE_PAUSED` (in-flight orders carry on), anything
     else `RESELLER_STORE_NOT_ACTIVE`;
  2. `reseller.orders_enabled` → `RESELLER_ORDERS_DISABLED`;
  3. `orderReadiness` ready (terms published, accepted, not flagged) →
     `RESELLER_TERMS_NOT_READY` with the reasons;
  4. every line's variant ENABLED for the store, resellable, with an
     effective transfer price → `RESELLER_VARIANT_NOT_OFFERED`;
  5. each line's retail inside the seller's [min, max] where set →
     `RETAIL_OUT_OF_RANGE`, naming the range;
  6. PREPAID → `RESELLER_PREPAID_NOT_YET_AVAILABLE` (the payment mode is
     carried through untouched, so 3c only swaps this refusal for the
     `STORE_BALANCE_INSUFFICIENT` wallet check);
  7. no line (summed per product) asks for more than the store is SHOWN →
     `RESELLER_QTY_EXCEEDS_VISIBLE`.
  Then `OrderService.create` runs what it runs for every order (seller
  restriction, seller credit block, address validation, the duplicate
  check — scoped to THIS store's orders).
- **ORD-10 is AMENDED for check 7 only.** Still no reservation at create and
  no real-availability refusal at create — a SHARED line's stock is judged at
  confirmation. But a store may never order more than it was SHOWN: the hidden
  share and the other stores' set-asides would mean nothing if it could. The
  visible quantity is the catalogue's own figure
  (`ResellerStockGateService.offersFor` → `reseller-visible-stock.ts`, with
  the store's real consumption — the same number `/catalogue` shows).
- A COD order with no amount stated collects Σ retail × qty + the customer's
  delivery fee − discount − advance (`toCreateOrderDto`). Store notes go on
  `seller_notes` (the store is the order's seller-side voice); a store may
  not write Skydrop's internal notes.

### The snapshot (ORD-6; RS-4 "later edits never re-price")

- **Order**: `reseller_terms_version_id` (FK RESTRICT; versions are
  append-only, so the id pins the terms), the six store shares
  `reseller_*_store_percent` (DECIMAL(5,2)), and both timings
  (`reseller_store_credit_trigger/_days`, `reseller_seller_credit_trigger/_days`)
  — copied so 3c and reports never join back.
- **Each line**: `reseller_transfer_price_inr`, `reseller_retail_unit_inr`,
  `reseller_min_retail_inr`, `reseller_max_retail_inr` (the range in force),
  `reseller_stock_mode` (the store's mode for the variant when placed), all
  DECIMAL(12,2). `unit_price_inr` carries the same retail, so every reader
  that already shows a unit price is right without knowing about stores.
- **CHECKs**: `orders_reseller_snapshot_ck` — a CHANNEL order carries none of
  the snapshot columns, a RESELLER order all of them (shares 0–100, days
  0–365). `order_items_reseller_snapshot_ck` — transfer (> 0), retail (≥ 0)
  and stock mode together or not at all, retail inside min/max where set.
  **The order's kind is its store's kind by FOREIGN KEY**: `orders.store_kind`
  + composite FK `(store_id, store_kind) → seller_stores (id, kind)` (new
  unique `seller_stores (id, kind)`), replacing `orders_store_id_fkey` with the
  same actions. So a reseller order on a channel store, or the reverse, is
  unrepresentable, and the CHECK is tied to the real store.
- The terms are read INSIDE the create transaction, after the store lock
  (`lockAndReadTerms`), so the version snapshotted is the one in force when
  the order committed; a version published unaccepted in between refuses it.
- **A reseller order cannot be edited from the seller's side**
  (`RESELLER_ORDER_NOT_EDITABLE` — an edit would re-price it outside the
  store's terms, and the seller cannot read the recipient it would correct),
  nor CSV-patched. **ORD-9 for a store's CSV: a reference already placed is an
  error row, never a PATCH** — cancel and re-upload to change one. The store
  may cancel its own order (`POST /store/orders/:id/cancel`, `orders.cancel`)
  through the SAME seller cancel (`OrderWriteService.cancelBySeller`: until it
  is packed, the open-box check, CC-6, the stock saga); the seller may still
  cancel it too (their stock).

### Set-aside at CONFIRMATION (RS-3's consumption half)

- **`consumedByStore` is answered**: Σ the store's orders' ACTIVE
  reservations of the variant (phase-1 + phase-2) —
  `StockReadService.activeReservedByResellerStore` (inventory-stock's read
  surface). The catalogue's visible quantity follows automatically.
- **The rule** (`reseller-order-gate/reseller-set-aside-rules.ts`, pure):
  a line of a store whose live row is SET_ASIDE may use
  `min(own unused set-aside, real available)`; a line of a SHARED store
  `real available − Σ OTHER live stores' unused set-asides`; **a CHANNEL
  (seller's own) order `real available − Σ every live store's unused
  set-aside`**. `unused = max(0, set_aside − consumed)`; a store's consumed
  units are already out of real availability (they are reservations), so the
  whole set-aside is protected exactly once. The store's mode AT CONFIRMATION
  decides (the commitment in force when stock is reserved); the line's
  snapshot records the mode it was placed under.
- **Where it runs**: M5 `reserve()` gained an optional `guard`, run INSIDE the
  reservation's own transaction before its availability read and insert.
  `OrderWriteService.transitionWithReserve` passes
  `ResellerStockGateService.guardFor(line)` for EVERY order; the guard takes
  `AdvisoryLock.RESELLER_SET_ASIDE` on (seller, variant) — the key the
  set-aside save and the shrink sweep take — reads the commitments and real
  availability inside that transaction, and throws `InsufficientStockError`,
  which the existing saga routes to OUT_OF_STOCK (visible), never a 500. The
  lock is held until the reservation commits, so the next confirm for the
  variant counts it — and no second pool connection is needed (a lock held
  across the reserve call would need two per confirm).
- **Behaviour change for sellers who run reseller stores**: a seller's own
  order can no longer eat a store's unused set-aside — it lands OUT_OF_STOCK
  where it used to reserve. A seller with no set-asides is untouched: a
  CHANNEL line of a variant nobody set aside returns straight after reading
  the commitments (no stock read, same result as before).
- **R3**: `reseller-order-gate` is a dependency-free primitive (imports the
  catalogue read boundary and inventory-stock only). The order module
  (confirm), order-core (create's offers) and the reseller catalogue
  (consumption) import it; it imports none of them.

### The close race (RS-1, finished)

- Order create's transaction locks the store row `FOR SHARE` first
  (`ResellerOrderService.lockAndReadTerms`) and re-checks ACTIVE — before an
  order number is allocated. `ResellerStoreService.transition` (close, pause,
  every transition) now takes the row `FOR UPDATE` first, then moves the
  status and counts in-flight orders under it. The two conflict: a close
  waits for an order already being placed to commit and then counts it
  (`STORE_HAS_ORDERS_IN_FLIGHT`), or the order waits for the close and then
  sees CLOSED and is refused. Concurrent orders do not block each other.
  Pinned deterministically in both directions by
  `reseller-store-orders.e2e-spec.ts`.

### Customers belong to the store (ORD-7 generalised)

- `customers.reseller_store_id` (nullable, FK seller_stores RESTRICT). The
  `(seller_id, phone_e164)` unique is REPLACED by two partial uniques:
  `customers_seller_phone_own_uq (seller_id, phone_e164) WHERE reseller_store_id
  IS NULL` and `customers_store_phone_uq (reseller_store_id, phone_e164) WHERE
  reseller_store_id IS NOT NULL`. Every existing row is the seller's own and
  lands in the first on the same key. Prisma cannot target a partial unique,
  so `CustomerService.findOrCreate` is find-then-create under
  `AdvisoryLock.CUSTOMER_IDENTITY` (owner, phone) — every caller passes its
  own transaction.
- **The seller reads a store's order IN FULL — customer included (AMENDED
  2026-09-16, owner).** RS-5 masked it: `order/reseller-privacy.ts` took the
  name, both phones, the email and the street address off every seller read,
  leaving city, state and PIN. **That module is deleted.** The order is the
  seller's — their stock, their warehouse slot, their courier, their money at
  risk — and a seller who cannot see who a parcel is going to cannot ring
  about a failed delivery, judge a bad address, or answer the call centre.
  So: the recipient block is whole on `OrderService.list` and
  `loadOwnedForSeller`; seller search by name or phone matches reseller
  orders too (a number visible on one screen must resolve on the next); the
  reputation lookup's SELLER scope is every order of theirs, a store's
  included — a customer who has refused through a store is exactly the
  history it exists to show. `CustomerService.list/getById` reach a store's
  customers.
- **Reading widened; writing did not.** `CustomerService.update/softDelete`
  go through the private `getOwnById` (`reseller_store_id IS NULL`) and still
  refuse a store's customer row — the store maintains its own record of the
  people it sold to. Identity stays per OWNER (the two partial uniques above
  are unchanged). A store's CSV uploads, staged rows and webhook endpoints
  stay invisible to the seller's screens, and seller CSV references still
  never match a store's order (that scoping is ORD-9's PATCH collision, not
  privacy). A STORE still reads only its own; staff read everything. Pinned
  by `tenant-isolation.e2e-spec.ts` and `reseller-store-orders.e2e-spec.ts`.

### Integrations

- **API keys** — `store_api_keys` (hash only, `sks_` prefix, shown once),
  `GET/POST/DELETE /store/api-keys` (`integrations.manage`),
  `StoreApiKeyGuard` (a revoked / expired / unknown key is one generic 401,
  audited; the store must be usable now — `storeMayBeUsed`). A key places and
  reads its OWN store's orders (`/store-api/v1/orders`, `GET …/:id`); it
  cannot cancel, see customers or manage keys. The seller's `skd_` keys are
  untouched.
- **Webhooks** — the existing machinery, scoped: a store's endpoints are
  `seller_webhook_endpoints` rows under the store's seller with
  `reseller_store_id` set, managed at `/store/webhook-endpoints`
  (`integrations.manage`, SSRF-checked like the seller's). The ONE listener
  routes a reseller order's events to that store's endpoints ONLY (payload
  gains `storeId`), and a channel order's to the seller's own
  (`reseller_store_id IS NULL`) ONLY — the seller's integration never hears
  what a store sold. `SellerWebhookService` filters `reseller_store_id IS
  NULL` on every query.

### Permissions (store)

`orders.view`, `orders.create`, `orders.cancel`, `customers.view`,
`integrations.manage`. Defaults: admin all; ops view/create/cancel orders
and customers; finance view orders and customers; viewer view orders only
(the customer list is a list of people); integrations admin only (and the
owner, implicitly). Granted to existing stores' system roles by the
migration. `orders.create` and `orders.cancel` are named in
`store-permission-surface.spec.ts` as deliberate non-`.manage` write keys.

### Seams for 3c (money)

No money listener is added here. 3c subscribes to the existing
`OrderLifecycleEventBus` and, for each event, calls
**`ResellerOrderReadService.snapshotFor(orderId)`** (exported by
`ResellerOrderModule`) — null for a channel order (leave today's path
alone), else the terms version, the six store shares as Decimals (feed
`splitFeeLines`), both timings, each line's transfer price / retail /
range / stock mode, and the transfer and retail totals. Where it hooks:
- **DELIVERED** (either writer — transition or god mode, WAL-8): split the
  delivery fee and COD fees/tax per the shares, credit each party at its
  trigger (store: retail − COD tax share − transfer − store fee shares;
  seller: transfer − seller fee shares). Today's `OrderDeliveredAccrualListener`
  must skip reseller orders (or delegate) once 3c lands, or it credits the
  seller the whole COD.
- **RTO_RECEIVED** (`RtoReceiptService` → `RtoFeeAccrualService`): split the
  return fee by `resellerReturnFeeStorePercent`.
- **CANCELLED / CANCELLED_BY_ADMIN / REJECTED\*** and **LOST_IN_TRANSIT**:
  reverse per party (WAL-6 / WAL-8), refund a prepaid debit (RS-5).
- **CONFIRMED**: the prepaid debit of the store wallet (and, where Skydrop
  enabled it, AFTER_CONFIRMATION credits).
- **Create**: replace refusal 6 (`RESELLER_PREPAID_NOT_YET_AVAILABLE`) with
  the store-balance check (`STORE_BALANCE_INSUFFICIENT`), then turn
  `reseller.orders_enabled` on per seller.

### Screens

apps/reseller: **Orders** (`/orders` — status filter, search, pagination;
`/orders/[id]` — customer, money (sold for / pay the seller / terms
version), lines, waybill, timeline, cancel; `/orders/new` — picker from the
store's catalogue with the retail range and the available quantity shown;
`/orders/import` — the CSV flow with the store template and error report),
**Customers** (`/customers`), **Integrations** (`/integrations` — API keys
and webhooks, secrets shown once). apps/seller: orders list shows "via
<store>" and the customer in full, the store filter includes the seller's
reseller stores (with `stores.manage`), and the store filter now actually
filters (the list hook was dropping `storeId`); order detail shows the whole
recipient under a "Sold by your reseller store X" note, and offers no Edit on
a reseller order.
apps/admin: order detail gains a "Reseller store" section (store, terms
version, shares, timings, each line's transfer price and retail as placed).

### Tests

Unit: `reseller-order.service.spec.ts` (the refusal order, fail-closed switch,
the snapshot, `lockAndReadTerms` FOR SHARE and re-check), `reseller-set-aside-rules.spec.ts`,
`reseller-stock-gate.service.spec.ts` (lock first, channel orders respect
set-asides, consumption), `customer.service.spec.ts` (owner identity under
the lock), `order-write.service.spec.ts` (the guard on every reserve),
`store-permission-surface.spec.ts` (the RS-5 surface and defaults). E2E (CI):
`reseller-store-orders.e2e-spec.ts` (the refusals, the snapshot and masking
end to end, confirm with set-aside / shared / channel and OUT_OF_STOCK
routing, the close race both ways) and the RS-5 cases in
`tenant-isolation.e2e-spec.ts`.

## Reports and analysis as built (RS-8 / RS-9, 2026-09-15)

Leaf module `reseller-reports` (imports AuthCommon, CatalogRead,
InventoryStock, NotificationAudience, ResellerStore, ResellerStoreWallet,
Settings, Treasury; exports nothing). Migration
`20260914260000_reseller_reports`. Built beside phase 3c, not on top of it:
**nothing here computes a fee share, a transfer price, a COD tax or a
credit.** Every figure is READ from the ledgers by direction, so it is
correct for whatever 3c posts, and the specs drive it with fixture entries
of exactly the shapes 3c writes.

### Rules every report follows

- Derived on read, never stored (the frozen months below are the only
  snapshots, and they are copies of a read).
- Windows are half-open `[from, to)`, cut at IST midnight
  (`report-window.ts`: default the last 30 days, `INVALID_DATE`,
  `INVALID_RANGE`, at most 400 days). Ledger rows are dated by `created_at`;
  an expense by its IST day (`expenseDate − 330 min`).
- Every line is the SUM of its rows, and every row has a stable id (the
  wallet entry, the expense). Two adjacent windows add up to the span.
- Pure arithmetic lives in `*.ts` modules with no database
  (`store-pnl-lines.ts`, `store-pnl-carry-forward.ts`,
  `reseller-scorecard.ts`, `reseller-fraud-rules.ts`, `autoPauseVerdict`);
  services only load rows.

### Store P&L (store `reports.view`)

`GET /store/reports/pnl?from&to`. The owner's formula — retail − transfer −
fee shares − return fees − the store's own expenses — read off the store
wallet by direction (`placeDirection`, F2-exhaustive over
`StoreWalletEntryDirection`, so a new direction fails to compile until it
is placed):

| Line | Kind | From |
|---|---|---|
| `order_margin` "Order credits" | revenue | ORDER_CREDIT (+), ORDER_CREDIT_REVERSAL (−) |
| `prepaid_sales` "Prepaid sales" | revenue | the order's snapshot retail on each PREPAID_DEBIT (+) / PREPAID_REFUND (−) |
| `prepaid_cost` "Paid for prepaid orders" | cost | PREPAID_DEBIT (+) / PREPAID_REFUND (−) |
| `fee_shares` | cost | FEE_SHARE whose `share_of` is a delivery / COD / Instant Pay fee |
| `return_fees` | cost | FEE_SHARE whose `share_of` is RTO_FEE or CUSTOMER_RETURN_FEE |
| `cod_tax_share` | cost | COD_TAX_SHARE, and FEE_SHARE with `share_of` GST_WITHHOLDING |
| `expenses` | cost | `store_expenses` not deleted, by category |

A SHARE_REFUND comes off the line of the share its `linked_entry_id`
names (falling back to its own `share_of`). TOPUP / SELLER_TOPUP /
WITHDRAWAL / SELLER_PAYOUT are CASH, reported beside the P&L as cash in and
out, never as profit. Net = revenue − cost. **Why this tiles whatever 3c
decides:** apart from prepaid sales (a snapshot figure, not money that
passed through us) every non-cash line is the store wallet's own movement,
so the P&L can never disagree with the store's balance — if 3c credits the
margin net of shares with no separate share entries, the share lines are
simply zero. The store also sees its position (`/position` — balance,
withdrawable, open requests, from `StoreWalletService.summary`), its
expenses and its withdrawals.

**Months (carry-forward, PNL-CF-1 for a store).** `GET /store/reports/pnl/months`
and `/pnl/months/:month`. The `reseller-reports` worker closes every ended
month from the store's first, oldest first, hourly (`12 * * * *` IST):
under `AdvisoryLock.STORE_PNL_PERIOD` a close first carries changes to the
months before it INTO the month being closed, then freezes the report and
every row. Refusals: `STORE_PNL_MONTH_NOT_ENDED`,
`STORE_PNL_EARLIER_MONTH_OPEN`, `OUT_OF_RANGE`; a closed month answers
`ALREADY_CLOSED`. Detect (`40 6 * * *` IST) recomputes every closed month,
diffs it row by row against snapshot + carries already written, and
appends each change to the month then open with before, after and a reason
("Expense dated 28 Aug recorded after the month closed", "…removed after
the month closed: <reason>"). Running it twice adds nothing. **Simpler than
Skydrop's on purpose:** no provisional state and no re-lock — a store
ledger waits on no nightly courier job. Invariant (spec): Σ frozen months +
Σ carry-forwards + the open month live = the live span, per line.

### Store expenses (store `expenses.view` / `expenses.manage`)

`GET /store/expenses?from&to`, `POST /store/expenses` (category, amount,
IST date, description, reference, IDEM-1 key — a replay returns the
original, a different request on the same key is `IDEMPOTENCY_KEY_REUSED`),
`POST /store/expenses/:id/remove` (reason ≥ 5 characters, a guarded
`updateMany` scoped by the token's store — another store's id is
`EXPENSE_NOT_FOUND`). Refused: `EXPENSE_DATE_IN_FUTURE`,
`EXPENSE_BEFORE_STORE` (before the store's first month). Audited MEDIUM
(`store.expense.recorded` / `.removed`, actor STORE). Never edited, never a
bank or wallet entry, and never offered to the seller.

### Store analysis (store `reports.view`)

`GET /store/reports/analysis`: confirmation rate, delivery and return rates
(the scorecard rules below), profit per product (retail − transfer per
line, from the order snapshot — fee shares are NOT allocated to products,
and the page says so), returns by pincode (top 50), and return on ad spend
= order margin ÷ AD_SPEND expenses in the window (null with no ad spend).
`GET /store/reports/cash-flow`: money already credited, and what is still
to come for open orders by the store's credit trigger (`creditDue`,
F2 over `ResellerCreditTrigger`) in IST weeks, plus a "waiting on an
outcome" bucket — the forecast is retail − transfer BEFORE shares, and
says so. The store never sees the seller's unit cost.

### Seller reporting (seller `stores.reports`)

`GET /seller/reseller-reports/scorecards` — per store: placed, confirmed,
called off, delivered, returned, lost; **confirmation = confirmed ÷ decided**
(decided = ever confirmed + called off before confirmation); **cancel =
called off ÷ placed**; **delivery / return = delivered or returned ÷
outcomes** (delivered + returned + lost) — a rate divides only by orders
whose outcome is known; margin = (transfer − the seller's unit cost) × qty
where a cost is known (the picked batch, else the latest costed batch),
coverage stated beside it; the store's wallet balance; the seller's net
from the store (their wallet entries on its orders, signed by
`isSellerWalletCredit` — the ONE credit set); COGS, profit, and the stores
RANKED by profit. **Never the store's expenses or its P&L** (there is no
seller route to either — pinned in `tenant-isolation.e2e-spec.ts`).
`GET /seller/reseller-reports/transfer-revenue` — the seller's reporting
gains transfer revenue BY STORE: one row per seller wallet entry naming a
reseller order, by `created_at`, rows adding up to each store's total.
Skydrop's own `PnlService` is untouched.

### Auto-pause (RS-9)

`PUT /seller/reseller-reports/stores/:storeId/auto-pause` (`stores.manage`;
enabled, limit %, minimum outcomes, window days; audited). Hourly
(`27 * * * *` IST) for ACTIVE stores only: returned ÷ (delivered +
returned) over the window, counting only outcomes since the later of the
window start and a RESUMED event after the last pause (so a store the
seller just resumed is not paused again by the same history). **Pause when
outcomes ≥ minimum AND the rate is ABOVE the limit.** The pause is
`ResellerStoreService.autoPause` — the one status writer, a SYSTEM actor
(`actorId` null, `ActorType.SYSTEM`), the same guarded PAUSE, event and
audit — and the seller is told in-app on `seller.reseller_store_auto_paused`
(to `stores.manage` holders; silenceable). Resume stays the seller's.

### Stock forecast (RS-9)

`GET /seller/reseller-reports/stock-forecast`: per variant enabled on a
live store, days of stock = sellable available (INV-3, via
`StockReadService`) ÷ (units confirmed in the last
`reseller.stock_forecast_window_days` ÷ days); reorder when below
`reseller.stock_reorder_days` (both SET-1, seller-overridable). An in-app
reorder alert from a daily job (`15 8 * * *` IST), sent at most once per
seller per ISO week (event id
`reseller_stock_reorder:<seller>:<isoWeek>:inapp`) on the silenceable
`seller.reseller_stock_reorder` topic, to `stores.reports` holders.

### Admin analysis (staff `reseller.stores.view`)

`GET /admin/reseller-analysis/fraud-flags` — the flags, each with its
reason in words, over `reseller.fraud_window_days` (30):

| Rule | Crossed when | Default |
|---|---|---|
| CANCEL_RATE | called off ÷ placed ≥ `fraud_cancel_rate_percent` | 40% |
| RETURN_RATE | returned ÷ outcomes ≥ `fraud_return_rate_percent` | 40% |
| NDR_RATE | parcels with a failed delivery attempt ÷ dispatched ≥ `fraud_ndr_rate_percent` | 50% |
| RAPID_ORDERS | most orders placed inside one hour ≥ `fraud_orders_per_hour` | 30 |
| RETAIL_MARKUP | a line's retail above the suggested retail by more than `fraud_retail_markup_percent` | 100% |
| SHARED_CUSTOMER | one customer phone (shown masked) on ≥ `fraud_shared_phone_stores` stores | 3 |

The three rates are judged only once a store has placed
`fraud_min_orders` (10). Severity MEDIUM when crossed, HIGH at twice the
threshold. The daily sweep (`5 7 * * *` IST) reads the SAME computation and
raises one `RESELLER_RISK` issue per (rule, store), keyed
`reseller-fraud:<rule>:<storeId>`, resolving it when the store is back
under — so a flag is listed on every read but an issue is raised only when
a threshold is crossed. `permissionsFor(RESELLER_RISK)` addresses
`reseller.stores.view`. `POST /admin/reseller-analysis/stores/:id/pause`
needs the new DANGEROUS `reseller.stores.pause` (reason, audited; resume
stays the seller's). `GET …/disputes` — tickets on reseller orders from
the last 365 days, by store, type and status. `GET …/float`
(`money.treasury.view`) — per seller and store: wallet balances, money
credited on reseller orders before the courier paid, and the Instant Pay
advance, read from WAL-9's `InstantPayAdvanceService` (now exported by
`TreasuryModule`) filtered to reseller orders rather than restating its
predicate.

### Worker

Queue `reseller-reports` (`ResellerReportsWorker`, gated by
`WorkerRoleService.shouldStart`, repeat jobs in `Asia/Kolkata`):
`store-pnl-close` `12 * * * *`, `store-pnl-detect` `40 6 * * *`,
`reseller-auto-pause` `27 * * * *`, `reseller-fraud-sweep` `5 7 * * *`,
`reseller-stock-forecast` `15 8 * * *`. Notifications are awaited and never
throw (no fire-and-forget writer, so no new NOTIF-19 drain hook).

### Permissions

Store: new group "Reports" — `reports.view`, `expenses.view`,
`expenses.manage` (all sensitive; defaults admin and finance; the owner
implicitly; granted to existing stores by the migration). Seller:
`stores.reports` (sensitive; granted to system admin roles that hold
`stores.manage`, not backfilled to anyone else — a company decides who
reads store profitability). Staff: `reseller.stores.pause` (dangerous).
Pinned in `store-permission-surface.spec.ts` (defaults and the expense
controller's handlers).

### Screens

No chart library exists in the workspace and none was added: every screen
is tables and `Stat` tiles. apps/reseller: **Reports** (`/reports` — the
P&L with its lines and rows, cash, months and carry-forwards;
`/reports/analysis` — rates, products, pincodes, ROAS, cash-flow weeks) and
**Expenses** (`/expenses` — list, record with an IDEM-1 key per form,
remove with a reason; writes shown only with `expenses.manage`, FE-2).
apps/seller: `/reseller-stores/reports` (scorecards, ranking, transfer
revenue by store, the auto-pause modal behind `stores.manage`) and
`/reseller-stores/stock-forecast`. apps/admin:
`/reseller-stores/analysis` (fraud flags, disputes, float; pause behind
`reseller.stores.pause`, float behind `money.treasury.view`).

### Tests

Unit (fake DB, `pnl-fake-db.ts` with column defaults added in
`store-pnl-fixtures.ts`): `store-pnl.spec.ts` (6 — placement, a refund
classified by its link, rows add up with stable ids, adjacent windows tile,
store scoping, every direction placed), `store-pnl-carry-forward.spec.ts`
(3 — ordered close and its refusals, back-dated and removed expenses
carried once with reasons, the close-time carry, the invariant),
`store-expense.service.spec.ts` (4), `reseller-auto-pause.spec.ts` (4),
`reseller-scorecard.spec.ts` (4), `reseller-fraud-rules.spec.ts` (6); plus
`store-permission-surface.spec.ts` and `notification-topic-catalog.service.spec.ts`.
E2E (CI only): three RS-8 / RS-9 cases in `tenant-isolation.e2e-spec.ts`,
and the five new tables are in the e2e reset.

### Not done / decided

- Store months have no provisional state or re-lock (see above).
- Fee shares are not allocated to products; the cash-flow forecast is
  before shares.
- The disputes view looks back 365 days.
- `stores.reports` is granted only to seller admin roles holding
  `stores.manage`.
- Nothing here has run against 3c's real entries yet: once 3c lands,
  re-run `store-pnl.spec.ts` against its fixtures and read a real store's
  P&L against its wallet balance movement.

## Order money as built (RS-6 phase 3c, 2026-09-15)

Migration `20260914250000_reseller_order_money`. **`reseller.orders_enabled`
stays seeded FALSE** — nothing here turns store orders on; see "Switching it
on" below.

### One planner, one executor

- **`reseller-order-money/plan/reseller-money-plan.ts`** (pure) is the ONE
  place a reseller order's money is decided: `codFees` (the channel's
  `CodCreditService` arithmetic, expression for expression — pinned against
  the real service), `planCredits` (each party's row), `anchorOf` (what a
  trigger counts from, F2-exhaustive), `creditMayRun` (money follows fate),
  `prepaidDebit`, `cashTakenOnReversal`. Every share is `splitFee`.
- **`ResellerOrderMoneyService`** executes it. Every write goes through
  `WalletService.applyEntry` (seller) or `StoreWalletService.applyEntry`
  (store), under the SELLER's WALLET lock, one transaction per event, each
  credit's status moved by a guarded `updateMany` on the status read.
- **`reseller_order_credits`** — one row per party per order (UNIQUE
  `(orderId, party)`), planned once (usually at confirmation; COD rates are
  the seller's AT THAT MOMENT and never re-priced), status WAITING → DUE →
  CREDITED (or SKIPPED / REVERSED), `timesCredited` counting re-credits.

### The rule (owner)

On a COD order, each party at its own trigger:

    store  += COD − its tax share − transfer price − its COD-fee and Instant Pay shares
    seller += transfer price − its tax, COD-fee and Instant Pay shares

and Skydrop's delivery / return / customer-return fees split by the order's
snapshot as they are billed (seller's share under its usual direction; the
store's as `FEE_SHARE` with `share_of`). Each fee's two shares add up to the
fee exactly, so **the two nets add up to what an identical channel order
credits its seller** and Skydrop's take is unchanged. Inbound freight stays
the seller's alone.

**Worked example (pinned in `settlement-bank-invariant.spec.ts`):** COD
₹1,180, transfer ₹700, GST 18% → tax ₹180.00 (post-tax ₹1,000), COD fee 1%
= ₹10.00, Instant Pay 2.5% = ₹25.00; the store pays 50% of the tax, 50% of
the COD fee, 100% of Instant Pay, 50% of delivery.

| | settled (both ON_PAYOUT) | store INSTANT |
|---|---|---|
| Store: COD − transfer | 1,180.00 − 700.00 | 1,180.00 − 700.00 |
| Store: tax / COD fee / Instant Pay | −90.00 / −5.00 / — | −90.00 / −5.00 / −25.00 |
| **Store net** | **385.00** | **360.00** |
| Seller: transfer − tax / COD fee | 700.00 − 90.00 − 5.00 | same |
| **Seller net** | **605.00** | **605.00** |
| Together (= channel credit) | 990.00 = 1,180 − 180 − 10 | 965.00 = 1,180 − 180 − 10 − 25 |
| Skydrop keeps | 190.00 | 215.00 |

A ₹236 delivery fee at 50% is seller `ORDER_CHARGES` ₹118.00 + store
`FEE_SHARE` ₹118.00. The odd-paisa case: COD ₹1,299 → tax ₹198.15, 50% store
share ₹99.075 → **₹99.08** (half up), seller ₹99.07 (the remainder).

### When (triggers)

| Trigger | Counts from | Notes |
|---|---|---|
| AFTER_CONFIRMATION (N) | CONFIRMED | only where Skydrop enabled it; FRONTED from capital, counted in the Instant Pay advance float (WAL-9), reversed on any non-delivery |
| INSTANT | DELIVERED with carriage evidence | the Instant Pay fee applies when EITHER party is INSTANT, split by the Instant Pay share, at the seller's rate |
| AFTER_DELIVERY (N) | DELIVERED with carriage evidence | the sweep writes it N days on |
| ON_PAYOUT (+N) | the courier payout line (COD); DELIVERED (prepaid — no payout exists) | |

A due credit is written only while the order still earns it: never on a
called-off or LOST order, never on one returned without ever being
delivered; delivery-anchored needs delivery OR a courier payment; a
payout-anchored one needs the courier's net payment > 0. Credits skipped or
reversed for want of the courier's payment are re-armed when it pays. Later
triggers are written by the `reseller-order-money` queue's
`sweep-reseller-credits` job (every 15 min, SCALE-1 `shouldStart`), per-row
isolated. A god-mode DELIVERED without carriage evidence arms nothing — the
courier's payout arms it (the channel's rule, WAL-8).

### The cash (TRE-8c)

**The store's ledger shape** (what the RS-8 reports read): `ORDER_CREDIT` =
the COD LESS the transfer price (the store's gross order credit, before its
shares); each share its own entry — `COD_TAX_SHARE`, and `FEE_SHARE` with
`share_of` per fee (COD fee, Instant Pay, delivery, return); a store that
sold below the transfer price gets a `TRANSFER_PRICE` debit for the
difference instead of a credit. Every reversal and share refund names what
it returns (`linked_entry_id`), and every order-money entry carries
`linked_order_id`. A prepaid order: `PREPAID_DEBIT` = the transfer price and
the delivery share as its own `FEE_SHARE` (so it is Skydrop revenue on the
P&L's delivery line), `PREPAID_REFUND` its give-back.

Each party's own money is FRONTED from capital before its credit is written
(`front`, reference = the order id — WAL-9): the store's COD − transfer, the
seller's transfer price — less any part repaying the group's debt;
deductions and `TRANSFER_PRICE` are TO_CAPITAL; a courier payout on a
reseller order lands wholly as capital's (it repays the fronts). A reversal
writes the reversal entry first (NONE), then the refunds (TO_SELLER), then
takes `max(0, before) − max(0, before − gross)` to capital, referenced by the
reversal entry. After every step: **held for the seller = max(0, seller
wallet + Σ store wallets)** — 11 reseller scenarios in
`settlement-bank-invariant.spec.ts` (settled, instant, after-confirmation,
prepaid, cancel, RTO, loss, fee split, two stores, idempotency).

### Prepaid (ON)

Create refuses `STORE_BALANCE_INSUFFICIENT` when the store's wallet (within
its negative limit) cannot cover the transfer price + its delivery share +
those of its other accepted-but-unconfirmed prepaid orders — `storeCanSpend`
INSIDE the create transaction under the seller's WALLET lock. At
CONFIRMATION the store pays `PREPAID_DEBIT` (transfer) + `FEE_SHARE`
(delivery share); the seller is credited `PREPAID_TRANSFER_CREDIT` (TO_SELLER)
at the seller's trigger — never before the store has paid
(`PREPAID_NOT_PAID_BY_STORE`). Cancelled before dispatch, lost or returned:
`PREPAID_REFUND` to the store and the seller's credit reversed
(`PREPAID_TRANSFER_REVERSAL`).

### Fates

Cancel / reject with the parcel still here and LOST: pending credits
skipped; anything written and not covered by a courier payout reversed per
party; the delivery fee refunded to both sides (`OrderChargesRefundService`
→ `refundDeliveryFee`). Called off with the parcel gone: credits stay for the
courier's settlement (channel parity). RTO received, never delivered:
reversed. Customer return after delivery: COD credits stand until the
courier reverses the COD on a payout (`reverseOnCourierReversal`, inside the
settlement's transaction). Return fees split by `resellerReturnFeeStorePercent`
/ `resellerCustomerReturnFeeStorePercent` (`RtoFeeAccrualService`).

### Where it hooks (channel orders byte-identical)

`OrderChargesAccrualService.debitIfNeeded`, `OrderChargesRefundService`,
`RtoFeeAccrualService` branch on `isResellerOrder` / `head` (null for a
channel order → today's code); `AccrualExecutionService` skips the Instant
Pay block for a reseller order; `CourierSettlementService.record` /
`allocateMore` / the RTO reversal branch on `storeKind`. A lifecycle-bus
listener (`ResellerOrderMoneyListener`, drained by the e2e harness) runs
CONFIRMED / DELIVERED / called-off / LOST / RTO. Pinned: the channel
scenarios of `settlement-bank-invariant.spec.ts` run unchanged (the world
passes the no-reseller stub when it has no reseller orders), the channel
unit specs pass with that stub, and `delivered-money-paths.spec.ts` is
unchanged.

### P&L

A store's `FEE_SHARE` and `COD_TAX_SHARE` (and their `SHARE_REFUND`s) are
Skydrop revenue on exactly the line the seller's own debit sits on —
delivery / returns / called-off / lost (fees billed), COD tax deduction,
COD handling fees — each named apart ("Reseller stores' share of …"), with
stable drill-down ids `store:<entry id>` (PNL-CF-1). `storeEntryMeaning` in
`pnl.service.ts` places every store direction (F2-exhaustive); transfer
price, store margin, prepaid holds, top-ups and disputes are on no line.
`pnl.service.spec.ts` proves a reseller order and the identical channel order
report the same Skydrop figures, per line and in the drill-downs.

### Screens and endpoints

`GET /store/orders/:id/money` (store `orders.view`), `GET
/seller/orders/:id/reseller-money` (seller `orders.view`, its own controller
so VIEWER stays closed), `GET /admin/orders/:id/reseller-money` (`orders.view`)
— module `reseller-order-money-view` (leaf, read-only). Store order detail →
Money section and wallet ledger lines linking to their order; seller order
detail → "Reseller store money"; admin order detail → the full split.

### Decisions made here (recorded, not asked)

- COD rates are fixed at plan time (usually confirmation); a god-mode COD
  edit after that does not re-price the credits.
- The Instant Pay fee is on whenever either party is INSTANT, charged at the
  seller's rate.
- ON_PAYOUT on a prepaid order counts from delivery.
- `gst_withholdings` is not written for a reseller order (it is read
  nowhere; the wallet lines carry the tax).
- A store's COD tax share is its own direction (`COD_TAX_SHARE`, `share_of =
  GST_WITHHOLDING`).
- `storeWithdrawable` does not reserve committed prepaid orders; the create
  check does.
- A store is not notified of its credits (no store inbox yet).

### Switching it on

1. Deploy (the migration only adds; nothing moves money until an order exists).
2. For one seller: `PATCH /admin/sellers/:sellerId/settings/reseller.orders_enabled`
   `{ valueType: 'BOOLEAN', value: true, note }` (SET-1, audited).
3. Place one COD order through the portal; confirm, deliver, record the
   courier's payout; check `/admin/orders/:id/reseller-money` and the
   liabilities page.
Keep the global default FALSE until that run is clean.

## RS-7 as built (2026-09-15) — returns, damage, disputes

- **Returned goods are the seller's stock** — the RTO path is unchanged.
- **Lost or damaged in our hands** → the seller is compensated through the
  existing ticket refund (`SCRAP_REFUND`) at most the **transfer price**
  (`REFUND_ABOVE_TRANSFER_PRICE`; the ticket's line when it names one, else
  the whole order) — never the store's retail.
- **Store ↔ seller disputes are tickets** (`TicketType.STORE_DISPUTE`,
  `tickets.store_id`, `opened_by_store_user_id`). A store raises one on ITS
  OWN reseller order only (`POST /store/tickets`, store `tickets.manage`;
  anything else is the same 404); reads its own (`GET /store/tickets`,
  `/:id`, `/:id/events`, store `tickets.view`) and replies while open. The
  seller sees it with their tickets; staff referee. The store's words go to
  the seller and to staff; nothing is sent TO the store (no inbox) — it reads
  the portal.
- **Settlement** — `POST /admin/tickets/:ticketId/store-dispute-settlement`
  `{ amountInr, payer: STORE | SELLER, notes? }` (`tickets.resolve`): the
  status is CLAIMED first (guarded `updateMany`), then a PAIR between the two
  wallets in the same transaction — seller `STORE_DISPUTE_IN` / `_OUT`, store
  `DISPUTE_SETTLEMENT_OUT` / `_IN` (`linkedSellerEntryId`) — no bank entry
  (one pot, decision 7), audited HIGH `ticket.store_dispute_settled`, the
  ticket recording `disputePayer`, `resolutionWalletEntryId` and
  `resolutionStoreEntryId`. The ordinary refund is refused on this type
  (`STORE_DISPUTE_USE_SETTLEMENT`). The payer may go negative (the group's
  exposure, TRE-8c).
- **Permissions:** store `tickets.view` (See disputes) and `tickets.manage`
  (Raise disputes); owner/admin/ops hold both, finance/viewer `tickets.view`;
  granted to existing stores' roles by the migration.
- **Screens:** apps/reseller `/tickets`, `/tickets/new`, `/tickets/[id]`
  ("Disputes" in the nav); admin ticket detail gains "Settle between store
  and seller".
- **Tests:** `store-dispute.service.spec.ts` (claim before money, amount
  rules, refused refund, transfer-price cap, store-scoped open); the RS-7
  case in `tenant-isolation.e2e-spec.ts`.

## Store actions as built (2026-09-16, reworked 2026-09-17, widened to the whole order 2026-09-18)

The owner: "give all of this access to the store directly but the seller can
select that which should go directly or which should by approving the seller",
and (2026-09-17) "if the store can do then will this will be done directly or
it requests to the seller and then the seller approve or reject it. it
approved then it will work directly. the approve and reject is done by seller
not by skydrop." So a Reseller store can act on its own live orders, and the
seller holds a switchboard — per store, per task.

### The policy

`reseller_store_action_policy`, one row per store, owned by the SELLER — the
same shape as `reseller_store_auto_pause`, and for the same reason: a rule
about one store that only its seller may set. Seven columns, each
`OFF | ASK_SELLER | DIRECT`.

**Seller staff are asked it as TWO questions per task** (owner, 2026-09-17):
"Can the Reseller store do this?" Yes / No, and only when Yes, "How?"
Directly / Needs my approval. No = OFF, Yes + Needs my approval = ASK_SELLER,
Yes + Directly = DIRECT. Only the screen asks it that way; the column and the
API are unchanged. **Every one of the seven supports all three answers** — no
choice on that screen is one the server then refuses.

| Capability | Default | What DIRECT actually does | Where ASK_SELLER waits |
|---|---|---|---|
| `recall` | DIRECT | our call centre is queued to ring the customer, and a ticket opens | `order_delivery_action_requests` |
| `orderChange` | DIRECT | the change is written onto the order — the customer's details, the products, the quantities, the retail, the money | `store_address_change_requests` |
| `cancel` | DIRECT | the order is called off (what stores could already do) | `store_order_requests` |
| `callCapDecision` | DIRECT | the store's "keep trying / give up" is applied | `store_order_requests` |
| `chaseSkydrop` | DIRECT | the issue ticket opens with Skydrop | `store_order_requests` |
| `reattempt` | ASK_SELLER | a ticket opens and the store's words go to the courier outbox; Skydrop admin sends them by hand | `order_delivery_action_requests` |
| `sendBack` | ASK_SELLER | **the courier is asked to cancel on the store's click and the parcel turns round — nobody checks it first** (CUR-10's seller amendment) | `order_delivery_action_requests` |

This table said, until 2026-09-17, that a DIRECT re-attempt and send-back
"still pass through Skydrop". For a send-back that was never true, and the
seller's screen repeated it; the words now say what happens, and the behaviour
is unchanged.

**A missing row is the defaults**, not a refusal — `DEFAULT_POLICY` in the
service and the column defaults in the migration must agree, and the spec
reads the migration file to check. `cancel` defaults DIRECT deliberately:
stores already hold `orders.cancel`, and a table that read an absent row as
OFF would have taken it away from every store silently.

**ASK_SELLER is a held request for all seven (2026-09-17).** It used to refuse
for `cancel`, `callCapDecision` and `chaseSkydrop`, on three arguments: a
cancel had nowhere to wait (the delivery-action queue needs a shipment), the
call-cap question is already the seller's, and an approval step on a complaint
about US would let a seller suppress it. The owner decided otherwise on the
last two ("Raise with Skydrop gets a real Ask me first"), and the first was a
storage problem, now solved.

### Where a held request waits — three tables, and why not one or four

- **Delivery asks** (`recall`, `reattempt`, `sendBack`) stay in
  `order_delivery_action_requests`: they are about a PARCEL and carry its
  shipment, NDR attempt and courier outcome, and the direct asks already live
  there.
- **Address corrections** stay in `store_address_change_requests`: one column
  per editable field, already shipped, and its apply path is the order edit.
- **Cancel, call-cap answer and issue with Skydrop** share ONE new table,
  `store_order_requests` (`kind` = CANCEL | CALL_CAP_DECISION | RAISE_ISSUE).
  All three act BEFORE a parcel matters, share the whole lifecycle (ask → seller
  decides → run exactly as DIRECT would → true outcome → expiry), and each
  kind's payload is a handful of nullable columns (`note`,
  `cancellation_reason`, `call_cap_proposal`, `issue_subject`). Three
  near-identical tables would drift; folding the two existing queues in would
  have meant migrating shipped data and giving up the per-field address
  columns.

`store_order_requests`: status PENDING → APPROVED | REJECTED | EXPIRED,
APPROVED → EXECUTED | FAILED; seller columns `decided_by_seller_user_id` /
`seller_decided_at` / `decision_note`, never a staff one; `executed_at`,
`execution_ref` (the ticket id for an issue, the review id for a call-cap
answer), `failure_reason` verbatim; `seller_reminded_at`, `expired_at`. FKs to
orders, sellers and seller_stores RESTRICT. **One open request per order per
kind** (`STORE_REQUEST_ALREADY_OPEN`), checked under
`AdvisoryLock.STORE_ORDER_REQUEST` inside the insert's transaction. A cancel or
call-cap proposal needs a reason (`STORE_REQUEST_REASON_REQUIRED`).

**Modules.** `store-order-request` is an R3 PRIMITIVE (the record, the
notifier, the reminder/expiry sweep) importing nothing order-, ticket- or
review-shaped, so `reseller-order` (cancel), `early-reservation-decision`
(call cap), `ticket` (issue) and `order-core` (the seller's edit, below) import
it to HOLD. Approving is in the LEAF `store-order-request-decision`, which
imports `order`, `early-reservation-decision` (now exporting
`EarlyReservationDecisionService`) and `ticket`, so an approved request runs
the SAME call a DIRECT one runs, attributed to the STORE: `cancelBySeller` with
`ActorType.STORE`, `decideAsStore`, `openStoreIssue`.

The store's endpoints did not change shape of URL, only of reply: `POST
/store/orders/:id/cancel`, `PATCH /store/call-reviews/:id` and `POST
/store/issues` now return a UNION `{ applied: true, … , request: null } |
{ applied: false, …: null, request }`, the address-correction shape, so the
portal says what happened from the REPLY rather than the policy it read on
load. The call-cap list stays readable on ASK_SELLER (the store proposes from
it); only OFF refuses.

### Endpoints

| Who | Route | Gate |
|---|---|---|
| Seller | `GET|PUT /seller/reseller-stores/:storeId/action-policy` | `stores.manage` |
| Seller | `GET /seller/store-action-requests` · `POST :id/approve` · `POST :id/reject` | `stores.manage` |
| Seller | `GET /seller/store-address-changes` · `POST :id/approve` · `POST :id/reject` | `stores.manage` |
| Seller | `GET /seller/store-order-requests` · `POST :id/approve` · `POST :id/reject` | `stores.manage` |
| Seller | `GET /seller/store-requests/count` (the nav badge, all three queues) | `stores.manage` |
| Store | `GET /store/action-policy` (its own effective policy) | `orders.view` |
| Store | `GET|POST /store/orders/:orderId/actions` | `orders.actions` |
| Store | `GET /store/orders/:orderId/requests` | `orders.view` |
| Store | `POST /store/orders/:orderId/cancel` | `orders.cancel` |
| Store | `PATCH /store/orders/:orderId/recipient` | `orders.actions` |
| Store | `GET /store/orders/:orderId/address-changes` | `orders.actions` |
| Store | `GET|PATCH /store/call-reviews[/:reviewId]` | `orders.actions` |
| Store | `POST /store/issues` | `tickets.manage` |

New store permission (2026-09-16): **`orders.actions`** — asking for something
to be DONE about a live parcel. Deliberately not folded into `orders.cancel`
and named in `store-permission-surface.spec.ts`'s `WRITE_KEYS_NOT_MANAGE` with
that argument. Held by the `ops` role by default.

### Attribution — a store's action is the STORE's

Everywhere it could have read as the seller's, it does not: `courierActor.store`
on the credential decrypt (so "who told Delhivery to turn this round" answers
the store), the ticket's `storeId`/`openedByStoreUserId` with an
`ActorType.STORE` opening event, `CallQueueReason.STORE_ASKED` so the call agent
is told the store asked — their customer has never heard of the seller — and
`store.delivery_action.requested` / `store.order_request.requested` on the
audit row. An APPROVED request stays the store's: the store user who asked is
the actor, and seller staff only appear in the decision columns and audit.

### Seller staff decide — never Skydrop admin

**Skydrop admin cannot decide a request held for Seller staff (2026-09-17).**
The admin "Failed deliveries" queue claimed on `{ id, status: PENDING }` alone,
and since every non-store ask is created already approved, the only PENDING
rows there WERE store asks waiting on a seller — deciding one ran a different
path (a live courier NDR call instead of the ticket; SELLER_ASKED instead of
STORE_ASKED; no email to the store). The claim predicate now carries
`needsSellerApproval: false`, and a miss on a held row is
`DELIVERY_ACTION_HELD_FOR_SELLER`. Skydrop admin still SEE those rows, marked
`waitingOnSeller` with the store's name, read-only. An admin-approved RECALL
now runs `runApproved` — the one recall implementation, ticket included.

On every queue the claim is a guarded `updateMany` on (PENDING, this seller's
[, held for the seller]); the loser is told `…_ALREADY_DECIDED`. A rejection
requires a reason, emailed to the store.

**Approving RUNS it, then records the TRUE outcome, then emails the store —
in that order (2026-09-17).** The delivery-ask approval used to email
"approved, being carried out" BEFORE running, so a recall that threw stayed
APPROVED with nothing recorded, and a send-back the courier refused became
FAILED with no second email. Now:

1. **Re-check it still applies.** A delivery ask: the order still
   OUT_FOR_DELIVERY or DELIVERY_FAILED, and the asked-about shipment still its
   live one (`DeliveryActionService.stillApplies`, also run before Skydrop
   admin's courier calls). A cancel: `cancelBySeller`'s own refusals (packed,
   already cancelled, being packed). A call-cap answer: the review still OPEN.
   An address correction: `OrderService.edit`'s refusals. A stale request runs
   NOTHING and is FAILED with a reason a person can repeat to a customer.
2. **Run** through the same path DIRECT uses. `runApproved` is the one path
   for delivery asks — an approved recall opens the same ticket a direct one
   does (it used to skip it).
3. **Record** EXECUTED or FAILED (verbatim `[CODE] message`), guarded on
   APPROVED. A throw anywhere is recorded FAILED; no APPROVED row is left that
   did nothing. A courier refusal writes `execution_error` and keeps seller
   staff's `decision_note`.
4. **Email** the store the result: `store.action_approved.email` now carries an
   `outcome` line; the new `store.request_approved.email` /
   `store.request_rejected.email` carry `request_label` and `outcome`. Event ids
   distinguish yes / yes-failed / no.

The Seller staff page shows what actually happened ("Approved and carried
out", or the verbatim failure) from the reply.

### Unanswered requests expire (owner decision, 2026-09-17)

`StoreRequestExpiryService`, queue `store-request-expiry`, every 15 minutes,
behind `WorkerRoleService.shouldStart` (SCALE-1). For EVERY held queue — the
delivery asks with `needs_seller_approval`, address corrections, and
`store_order_requests`:

- after `reseller.store_request_remind_hours` (24) Seller staff are reminded
  ONCE in-app (topic `seller.store_request_reminder`, `stores.manage`): the
  sweep claims `seller_reminded_at IS NULL` with a guarded `updateMany` before
  sending, and the event id is the NOTIF-2 backstop;
- after `reseller.store_request_expire_hours` (72) the request is closed
  EXPIRED by a guarded `updateMany` on PENDING — an approval landing first wins
  and nothing is sent — nothing is carried out, it is audited LOW as SYSTEM,
  and the store is emailed `store.request_expired.email` so it knows to follow
  up.

Age is `created_at`, never `updated_at` (rule 4b — stamping the reminder writes
the row). Both settings are GLOBAL, seeded, and inserted by
`20260917000000_store_requests_held_and_expiring`. EXPIRED joins
`DeliveryActionStatus` and `StoreAddressChangeStatus` (and
`deliveryActionStatusKind` / `storeAddressChangeStatusKind` route it, neutral
"Not answered in time"); `storeOrderRequestStatusKind` / `…Label` and
`StoreOrderRequestStatusBadge` are new in `@skydrop/ui`.

### Both sides may change the order (owner decision, 2026-09-18)

The owner, on the seller's side: seller staff may change products, quantities,
prices and the order's terms; edit anything on a reseller order; correct the
customer's details after confirmation and while the call centre is on the
phone; and edit the store's customer record. And, the same day, on the store's:
"reseller should be able to Edit the order beyond the customer's details if
possible, Edit the customer's record, Edit after confirmation or during a call.
but only if our main system allows it whatever the case is."

So the rule is symmetric, and the limits are only the real ones.

**What each party may reach.** Seller staff reach every field on
`UpdateOrderDto`. The store reaches every field but two, and each is closed for
a reason about the FIELD rather than about who is asking
(`STORE_FORBIDDEN_KEYS` in `order.service.ts`):

| Field | Why a store may not change it |
|---|---|
| `internalNotes` | Skydrop's own working notes on the order — not a fact about the sale |
| `storeId` | moving an order to another shopfront moves its money, its customer identity (ORD-7) and its terms snapshot to a deal that was never struck for it |

It is a DENY list on purpose. An allow list encodes the opposite rule: every
field added to the DTO afterwards is silently closed to the store until
somebody remembers to open it, which is the drift this decision reversed.

Three more things a store cannot do are STRUCTURAL rather than listed, and
worth saying out loud because they are what "only if our main system allows
it" means: the transfer price and the terms version are not fields on the DTO
at all (they are the seller's terms), the retail is checked against the store's
own agreed range, and a store may not touch another store's or the seller's own
order (a 404 that says nothing more).

**The lifecycle stage binds both.** `CONTENTS_EDITABLE_STATUSES`
(DRAFT, PENDING_CONFIRMATION — renamed from `RECIPIENT_EDITABLE_STATUSES`) is
when what is IN the parcel may change: after confirmation stock is held, a
waybill is booked and the box may be packed. Past it, a contents edit is
`NOT_EDITABLE` for seller staff and the store alike.

**The RECIPIENT is routed, and the router asks a fact.**
`order/recipient-change-route.ts` is the ONE place, pure, read by
`OrderService.edit` and — for the courier window — by `ShipmentAddressService`.
The question is not "which order statuses may be edited"; it is "does anybody
outside this building already hold this address?", and a WAYBILL is that fact:

| Live parcel | Route |
|---|---|
| none, or no waybill | `DIRECT` — nobody outside has it, so we write it |
| a waybill, courier window open | `COURIER` — ask them; stored only if they accept |
| a waybill, window closed (their "Dispatched" is our OUT_FOR_DELIVERY) | `COURIER`, `courierWillAccept: false` |
| a terminal order | `REFUSED` — no parcel left to redirect |

Reading a status list instead would be wrong both ways: `AWAITING_COURIER` and
a `CONFIRMED` order whose AWB job has not run carry no waybill and are safe to
correct, while `PENDING_MANUAL_PLACEMENT` may carry one typed off a paper
docket. `OrderService.edit` refuses a `COURIER` route with
`COURIER_MUST_ACCEPT_ADDRESS_CHANGE`, naming the endpoint that asks them —
`POST /seller/orders/:id/consignee` or `POST /store/orders/:id/consignee`.

**The courier decides, and a refusal writes nothing** (owner answer B). On
acceptance `ShipmentAddressService.change` writes the new name / phone /
address to the SHIPMENT and — new on 2026-09-18 — to the ORDER, in the same
transaction, so the label, the call centre and both portals say one thing. It
used to leave the order alone and call the change row "how the two are
reconciled", which left every screen showing an address the courier no longer
had. On refusal neither is written, the courier's own words are kept on the
change row, and BOTH sides are told them verbatim: the answer "they would not
take it" is what somebody has to repeat to the customer.

**The ONE place the store is narrower than seller staff, and why.** A store's
post-handover consignee ask refuses `ASK_SELLER` by name
(`STORE_ACTION_NEEDS_SELLER_NOW`). A held request is applied hours or a day
later, and by then the courier's own window may have closed — so holding it
would produce an approval that silently does nothing to a moving parcel while
both parties believe the address changed. Seller staff make that one
themselves, immediately.

**Editing during a call is allowed** (owner decision 4). `EDIT_DURING_CALL`
refused any change to the contents or the amount while an agent held the order.
The risk it named is real; the refusal was not the answer to it. The call
station copied the pulled assignment into React state and never looked again,
so an agent could already be reading out an address moved by an admin edit, a
god-mode change, a CSV patch or a second agent — none of which that guard
covered. It cost a seller, and now a store, the ability to fix a wrong number
at the one moment they find out it is wrong.

What replaced it: the order event says `— WHILE AN AGENT WAS ON THE CALL` and
the audit row carries `duringCall`, and the station re-reads the call it holds
(`useCurrentCalls` polls every 20s, paused on a hidden tab) and shows "This
order changed while you were on the call" above the panel, which is already
showing the new version. The comparison is a CONTENT SIGNATURE — the recipient,
the lines, the payment mode and the COD — never `updatedAt`: any write to the
row moves that (rule 4b), so a nightly cost sync would flash a warning about a
change nobody made, and a warning that fires on noise is one people learn to
ignore.

**The customer record.** `CustomerService.update` now accepts the seller's own
customers AND their reseller stores' (`getEditableById`: scoped on `sellerId`,
and for a store caller on the store too). A store edits its own at
`PATCH /store/customers/:id` behind the new `customers.manage` store permission
(granted to the admin and ops roles by the migration; finance and viewer read
customers, they do not maintain them). The PHONE is not an editable field
anywhere and the two partial uniques stand, so nothing here can merge a store's
customer into the seller's own. **Deleting is still the seller's own row only**
(`getOwnById`): deleting is not correcting, and a store's customer row is its
record of somebody it sold to.

**The money follows the order** — see "The money of a changed order" below.

**A store change waiting on seller staff closes SUPERSEDED** in the same
transaction when seller staff change the order themselves: two changes to one
order cannot both stand, and approving the store's later would silently undo
the seller's.

**Whoever did not make the change is told, every time**, with old → new and,
when it moved, the money's before and after (`order-change-description.ts` is
the ONE description both notices read). The store hears by EMAIL —
`store.order_changed_by_seller.email`, `store.customer_changed_by_seller.email`
— because a reseller store has no in-app inbox. Seller staff hear IN-APP,
addressed by PERMISSION `stores.manage` under the new topic
`seller.store_changed_order`. Neither notifier throws (NOTIF-1), and both are
awaited rather than fired and forgotten, so the e2e reset has nothing in flight
to drain (NOTIF-19).

### The money of a changed order (owner, 2026-09-18)

`ResellerOrderMoneyService.recalculateAfterEdit` runs post-commit, in ONE
transaction under the seller's WALLET lock (the seller and all their stores
serialise together).

**Which terms.** The ones SNAPSHOTTED ON THE ORDER — the six fee shares, both
credit timings and each line's transfer price as placed. Never the store's
current live terms or price list: re-pointing an existing order at newer terms
would change a deal neither side agreed for it. A REPLACED line set goes
through `ResellerOrderRetermService`: a KEPT line keeps its own snapshot, an
ADDED line is priced from that store's catalogue as it stands, and one with no
transfer price there is refused by name (`RESELLER_VARIANT_NOT_OFFERED`) rather
than given a price we made up. A retail with nowhere to come from is
`RESELLER_RETAIL_REQUIRED`, never defaulted to zero.

**Which COD rates.** The ones stamped on the plan when it was made
(`reseller_order_credits.gst_percent_at_plan`, `cod_fee_percent_at_plan`,
`instant_pay_fee_percent_at_plan`, new columns). They are live per-seller
settings (SET-1), so re-resolving them would let a rate somebody changed last
week move the money of an order placed before it — a change the edit did not
ask for, and one invisible in the before/after the store is shown. Rows planned
before the stamp existed fall back to today's, and the audit row says so
(`ratesFromPlan`).

**What happens to money already posted.**

| The credit row | What the recalculation does |
|---|---|
| WAITING / DUE / SKIPPED / REVERSED | nothing was written to a wallet, so the row IS the plan: its figures are rewritten by a guarded `updateMany` on the status it was read in. SKIPPED and REVERSED matter because a later courier payout can re-arm them, and a stale figure there would credit the old amount weeks later. |
| CREDITED | money HAS moved. It is TAKEN BACK through the exact reversal path a return uses — every deduction refunded, the cash returned to capital — and WRITTEN AGAIN at the new figures. |

The reversal-and-rewrite is deliberate. A signed difference across five
directions is where a correcting movement goes wrong; the reversal path is
already exact and already tested by returns, and both halves are operations
whose cash rules keep TRE-8c true, so `held = max(0, seller + Σ stores)` holds
after each step rather than only at the end. What the ledger shows is two
legible entries — taken back, credited again — which is what somebody arguing
about this in a month needs to see.

A PREPAID order's up-front debit follows the same shape: refunded and retaken
when the transfer total moved, and refused before anything is written when the
store's wallet cannot carry the bigger one (`STORE_BALANCE_INSUFFICIENT`).

**What is refused rather than guessed.** Changing how a PRICED order is paid
for (`RESELLER_PAYMENT_MODE_LOCKED`, checked BEFORE the edit is written). COD
and PREPAID are not two amounts of one thing — a COD order has a STORE credit
and a prepaid one does not, and a prepaid one takes a debit up front — so
turning one into the other after the plan exists means inventing a party's
credit with no anchor to arm it from and guessing whether a debit already taken
should come back. The order is called off and placed again instead.

A recalculation that throws does NOT fail the edit, which has committed: it
raises a HIGH `reseller_order.money_recalculation_failed` audit row naming the
order, because until somebody looks the order says one thing and the credits
behind it say another.

Pinned by `settlement-bank-invariant.spec.ts` (four re-price scenarios over the
in-memory book, including a CREDITED one), `reseller-money-recalculation.spec.ts`
and `reseller-order-money.e2e-spec.ts` against a real database.

### The held ORDER CHANGE (2026-09-16, widened 2026-09-18)

`store_address_change_requests` is where a store's change WAITS. The table
keeps its name — renaming a table and its status enum for a widened meaning is
a migration's worth of risk with no user-visible benefit — and now carries the
whole change.

One nullable column per RECIPIENT field — the ten in `RECIPIENT_KEYS` — plus
`patch` (JSONB, 2026-09-18: the validated store-scoped `UpdateOrderDto` minus
`reason`), `reason`, `status`, `decided_by_seller_user_id`,
`seller_decided_at`, `decision_note`, `applied_at` and `failure_reason`;
indexed `(seller_id, status)` for the seller's queue and `(order_id)` for "is
anything pending on this parcel"; all three FKs RESTRICT, because a decided
change is the evidence for why an order moved and must outlive everything short
of the order. A NULL column means "not part of this change", never "clear it" —
a store correcting a misheard house number sends that field alone.

**Why BOTH the columns and the patch.** A change that moves products,
quantities or the money cannot be expressed as columns without one per DTO
field, and adding ten more for the next widening is not a design. But the
recipient columns are read by the seller's queue, by `summarise`, by the
notices and by `toView`, and dropping them would have meant rewriting all of
that in the same change. So the columns stay written whenever the change
carries them, the patch is the authority when it is present, and a row held
before the patch existed has its whole change in its columns — which is exactly
what it always did. `AddressChangeRequestView` exposes both plus `changes`,
the list of keys, so a screen can list what is proposed without guessing.

**Applying re-runs the same validation a direct change does**, through the ONE
applier (`StoreOrderEditService.apply`), so a variant archived between the ask
and the answer is refused BY NAME and recorded FAILED rather than written. Two
callers of the writer would drift, and the one that drifted would be the
approval path — the one nobody exercises by hand.

**The proposal lives in its own table, and never on the order.** The order
must keep the address the courier was given until seller staff say otherwise.
Parking a pending correction on the order itself would mean every reader of
the recipient block has to know which of the two is live, and the first reader
that forgets prints an address nobody approved onto a label.

`StoreOrderEditService.editRecipient` is now a three-way branch rather than a
refusal and a write. OFF refuses and says who does it instead; DIRECT goes
through `OrderService.edit` with the store scope exactly as it always has;
ASK_SELLER holds it and answers with the request. It returns a UNION —
`{ applied: true, order, request: null }` or `{ applied: false, order: null,
request }` — rather than a nullable order, because "applied" and "waiting" are
different things for the portal to say and a caller inferring which from a
null field will eventually infer it wrong.

**`reason` is required on ASK_SELLER** (`ADDRESS_CHANGE_REASON_REQUIRED`):
seller staff read it before deciding, and they cannot tell a corrected typo
from a customer who has moved house — or an extra unit the customer asked for
from a mistake — without it. **It is also STRIPPED off the patch before it
reaches `OrderService.edit`**: that method does not know the key, and the
API's `forbidNonWhitelisted` would reject the whole call. A future field on
`StoreEditRecipientDto` has to be destructured off in the same way.

**One open change per order** (`ADDRESS_CHANGE_ALREADY_OPEN`). Two proposals
for one order cannot both be right, and approving them in whatever order they
happened to be decided would apply the older one last. An empty patch is
`ADDRESS_CHANGE_EMPTY`.

Seller staff decide at `/seller/store-address-changes` (`stores.manage`) — a
SIBLING of `/seller/store-action-requests` rather than part of it, since the
two hold different rows and folding them together would mean a response half
one thing and half another; the single queue PAGE calls both, which is where
they belong together. The list carries the order's CURRENT recipient block, so
the change can be read against what the parcel carries today. The claim is a
guarded `updateMany` on (PENDING, this seller's) — the loser gets
`ADDRESS_CHANGE_ALREADY_DECIDED` rather than quietly editing the order twice.
The answer lands in `decided_by_seller_user_id` / `seller_decided_at`, never a
staff column, or "who allowed this" reads as Skydrop when it was the seller.
Rejecting requires a reason.

**Approving RUNS the change, through the same `StoreOrderEditService.apply`
a DIRECT change takes** — so an approved change and a direct one cannot drift,
and the approval inherits the stage gate, the courier route, the address
revalidation, the line re-terming and the money recalculation rather than a
second implementation of any of them. It applies the WHOLE patch, not a
recipient-shaped subset of it. The edit is attributed to the STORE
(`ActorType.STORE`, the requester) even though the seller allowed it: the
timeline should say who asked, not only who permitted.

**A yes that could not be carried out is its own outcome, and that is the
point of the FAILED state.** Time passes between the ask and the answer, and
the order may have been confirmed or cancelled by then, a variant may have
been archived, or the parcel may have reached the courier; `edit` refuses those
by name. That refusal is NOT thrown at seller staff —
they answered correctly and the world changed underneath them. The row is
recorded FAILED with the refusal kept verbatim (`[NOT_EDITABLE] …`,
`[COURIER_MUST_ACCEPT_ADDRESS_CHANGE] …`, `[RETAIL_OUT_OF_RANGE] …`) and the
store is told, because "they agreed but it did
not happen" is what somebody has to tell the customer. Throwing instead would
leave the request APPROVED forever with nothing having happened and nobody
told. The claim moves the row to APPROVED first and on to APPLIED or FAILED
once it knows which, so a crash between leaves a row that visibly has not been
applied rather than a PENDING one that silently has — the visible-vs-silent
ordering.

The five states are an F2 mapping in `@skydrop/ui/status`
(`storeAddressChangeStatusKind` / `…Label`): PENDING "Waiting on seller
staff", APPROVED, APPLIED "Corrected", REJECTED "Declined" (neutral, not red —
a considered refusal is not a malfunction) and FAILED "Could not be applied",
the one state that needs somebody and so the one that is red. Since 2026-09-17 two more: EXPIRED "Not answered in time" and SUPERSEDED
"Seller staff corrected it themselves", both neutral.

**A NEW `AddressChangeNotifier`, deliberately, rather than reusing
`StoreActionNotifier`.** That one lives in `delivery-action`, whose module
header states it is a LEAF that nothing imports; reaching for it from
`reseller-order` would close no cycle, but it would spend that property — and
the property is what keeps the courier-facing module from slowly becoming
everybody's dependency. So this is a second notifier of the same SHAPE. The
seller hears IN-APP, addressed by PERMISSION `stores.manage` (NOTIF-10), under
topic `seller.store_address_change_waiting` — declared in the catalogue and
pinned against the sender's own constant in both directions by
`notification-topic-catalog.service.spec.ts` (NOTIF-17), so it cannot become a
switch on a settings page that silences nothing. The store hears by EMAIL and
only email — it has no in-app inbox, so an in-app leg would be written to a
feed nobody there can open (NOTIF-15's "a setting that changes nothing", in
notification form) — through `store.address_change_approved.email` /
`store.address_change_rejected.email`, whose `failure_reason` variable renders
empty on an ordinary approval and carries the refusal on the FAILED one. The
event id is per DECISION, not per request, so a rejection and a later approval
of the same correction are two things to say. Neither notifier throws
(NOTIF-1).

### Telling each side

The store has **no inbox**, so it hears by email only, sent to the store users
who may act on orders. Seller staff hear in-app, addressed by permission
`stores.manage` (NOTIF-10): `seller.store_action_waiting` (delivery ask — it was
sent since 2026-09-16 but missing from the topic catalogue until 2026-09-17),
`seller.store_address_change_waiting`, `seller.store_request_waiting` (cancel /
call-cap / issue) and `seller.store_request_reminder`, all pinned by
`notification-topic-catalog.service.spec.ts`. No notifier throws (NOTIF-1);
every one is awaited, so there is nothing new to drain (NOTIF-19).

### Screens

apps/reseller: the order page reads `GET /store/action-policy` and renders each
action accordingly — hidden when OFF; "Ask the seller to cancel" / "Propose an
answer" / "Seller staff approve it first" when ASK_SELLER; direct otherwise —
and shows "Sent to your seller to approve" with each held request's status,
their reason, the verbatim failure, or "Not answered in time". Cosmetic
(FE-2): the server still refuses by name. apps/seller: the per-store "What
they can do" section asks the two questions; `/reseller-stores/requests` lists
all three queues and says what an approval actually did; the nav badge counts
all three. apps/admin: "Failed deliveries" shows a store's held ask read-only as
"Waiting on seller staff".

### Migrations

`20260916000000_reseller_store_action_policy`,
`20260916010000_store_issue_ticket_type`,
`20260916020000_store_address_change_requests`, and
`20260917000000_store_requests_held_and_expiring` (the `store_order_requests`
table and its three enums; `delivery_action_status` += `expired`;
`store_address_change_status` += `expired`, `superseded`; `seller_reminded_at`
and `expired_at` on the two older queues; the two settings). DDL generated by
`prisma migrate diff`, data appended. None rewrites an existing row.

The first of those also left real drift behind it, worth recording because
nothing but one CI step could see it: `ResellerStoreActionMode` shipped in the
schema with no `@@map`, while its own migration had created the Postgres type
as `reseller_store_action_mode`. Fixed by naming the type the database already
has; no corrective SQL. See the enum note in `CLAUDE.md`.

### Tests

`reseller-store-action-policy.spec.ts`, `store-delivery-action.spec.ts`,
`store-orders-cancel-policy.spec.ts` (ASK_SELLER now holds),
`store-review-decision.service.spec.ts` (ASK_SELLER holds; an answered review
is refused; the list stays readable), `store-issue.service.spec.ts` (ASK_SELLER
holds and reaches Skydrop with nothing), `store-address-change.spec.ts`,
`delivery-action-decision.service.spec.ts` (Skydrop admin: the claim predicate
excludes held requests, `DELIVERY_ACTION_HELD_FOR_SELLER`, the read-only flag,
a stale approval calls no courier), `delivery-action-run-approved.spec.ts`
(`runApproved`: an approved recall opens the ticket, stale → FAILED with no
courier, a throw → FAILED, a refusal keeps the seller's note; Seller staff
approval runs then emails the true outcome, lost race, reject),
`store-order-request.spec.ts` (hold, one-open, reason; approve cancel / call
cap / issue as the store, FAILED verbatim, lost race, reject; the sweep reminds
once, expires once, an approval wins, delivery asks covered),
`store-requests-count.spec.ts` (all three list predicates pinned to the count),
plus `store-permission-surface.spec.ts` and
`notification-topic-catalog.service.spec.ts` extended.

### Not done / recorded

No e2e against a real database for any of the three queues — in particular
nothing proves two Seller staff racing one request, or an approval racing the
expiry sweep, leaves exactly one outcome; the guards are there and only mocked
tests cover them. The store still has no inbox. A held request cannot be
withdrawn by the store that sent it, nor amended; the store waits for Seller
staff or the expiry. Skydrop admin's own approval of a (legacy, non-store)
PENDING re-attempt still calls the courier's NDR API rather than opening the
ticket the seller's direct path opens — no such rows are created any more, so
it was left.

## UI audit fixes, 2026-09-15

A UI/UX audit of every reseller-store screen (store portal, the seller's
store screens, the admin ones). What it found, and what the fixes settle:

- **A payout was recorded up to 5h30m early.** The admin "Record payout"
  form defaulted "Paid on" to UTC wall clock and then read it back as
  local, so near midnight it recorded the previous day — on the 1st, the
  previous month. `toDateTimeLocalValue` / `localNow`
  (`apps/admin/src/lib/datetime-local.ts`) is now the ONE place a
  `datetime-local` default is built, and the four modals that each had
  their own copy read it. **A new datetime-local default goes through it**
  — the mistake is invisible in any timezone at UTC+0, which is why four
  copies drifted the same way.
- **Every store wallet ledger stopped at 100 rows** with no way to see
  older ones, on all three apps. Each now pages with the API's own
  `before` cursor (`useInfiniteQuery` + "Show older"), and says how many
  it is showing so a truncated history is never mistaken for the whole.
- **A store webhook switched off after repeated failures could not be
  switched back on** — `PATCH /store/webhook-endpoints/:id` had no caller.
  The portal gained an Edit form and a per-row On/Off switch, and the
  events are CHOSEN from a list rather than typed: `WEBHOOK_EVENT_CATALOGUE`
  (`seller-webhook-delivery/webhook-event-catalogue.ts`) is served by
  `GET /store/webhook-endpoints/events`, and a subscription to anything
  else is refused (`UNKNOWN_WEBHOOK_EVENT`). The catalogue is DECLARED and
  pinned against the F2 mapping in both directions by
  `webhook-event-catalogue.spec.ts` — a code nothing sends would be a
  checkbox that never fires; one the pipeline sends but the list lacks is
  an event no store can hear. Switching an endpoint back on clears the
  failure streak: a person saying "try again" means starting over.
- **IDEM-1 reached the store's own money forms.** `SubmitStoreTopupDto`
  and `RequestStoreWithdrawalDto` take an `idempotencyKey` minted when the
  form opens and reused on retry, stored behind a unique index
  (`20260915000000_store_money_idempotency`). Replay semantics are
  IDEM-1's exactly: the same key with the same claim answers with the row
  already written (nothing new, nothing audited twice); the same key with
  a different amount, reference or payee is 409 `IDEMPOTENCY_KEY_REUSED`;
  two copies racing let the unique index decide and the loser answers with
  the winner. `store-money-idempotency.spec.ts` covers all four.
- **Money actions ask first.** The store's "Ask to withdraw" names the
  amount, payee and account before sending; the admin's withdrawal
  Approve, the seller's wallet-manager change and the negative-limit save
  each confirm. Small destructive acts (withdraw an invitation, remove a
  logo or an overlay picture, remove a webhook, mint a new secret) do too.
- **The admin order panel showed the terms version's UUID.** `adminGetById`
  resolves `resellerTermsVersionNumber`, so it reads "Version 3" — the
  number the store and seller accepted.
- Smaller: a store customer's detail page (`/customers/[id]`) and
  URL-driven order filters so a link pre-fills; custom-range store P&L
  through `useStorePnl`; position tiles with loading, error and retry;
  a dashboard of real links rather than a "next release" note; "Pause
  store" on the admin store header (`reseller.stores.pause`, cosmetic —
  the gate lives beside the call in `PauseStoreModal`); disputes rows
  linked to their order and store; the `Money` primitive wherever a figure
  is shown; status BADGES rather than raw enum text (`topupStatusKind`
  joins the F2 mappers in `@skydrop/ui/status`); `serverVerdict` + retry
  on every report screen; and the stock forecast showing the product's
  name and picture (rule 5b) rather than a bare SKU.
