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
   A seller may also run a reseller store with nobody invited.
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
- PAUSED blocks NEW orders; in-flight orders finish. CLOSED only when no
  order is in flight; the wallet is paid out/settled first.
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
Close is refused while any order on the store is not terminal (checked
INSIDE the tx after the move, via `OrderReadService`); phase 3's order
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
