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
build/restart lines. The DNS record is an owner action.
