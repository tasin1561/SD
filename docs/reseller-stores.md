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
