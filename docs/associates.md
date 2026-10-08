# Associates — a reseller store's own sales people (ASSOC-1)

> **Hostname, needing the owner's word.** The owner chose the subdomain
> `portal`. The TLD here is `skydrop.global`, not the `skydrop.online`
> first discussed: `docs/infrastructure.md` records the estate moving to
> `.global` on 2026-10-04 with `.online` retired once `.global` serves,
> so a brand-new app on `.online` would mean doing DNS, Caddy and the
> certificate twice. It is one Caddy block and one DNS record either way.

An **associate** generates a reseller store's sales. They place orders, follow the
ones they placed, and sell at a price the reseller sets per person per product.
The reseller sees every associate's orders beside their own and can tell which
associate is performing, then switch one's order creation off.

Owner's capability list, verbatim, and where each lands:

| # | Asked for | Built as |
|---|---|---|
| 1 | create single order | `POST /store/orders` on the portal, stamped with the associate |
| 2 | create bulk order | `/store/order-imports/*`, same CSV machinery |
| 3 | track only order submitted by this account | `store_roles.order_scope = own` |
| 4 | rate check (special pincode charges higher rate) | **DEFERRED** — see "Not built" |
| 5 | request to create support ticket | `tickets.view` + `tickets.manage` ("raise an issue") |
| 6 | get notified everyday about delivered + return + NDR | the daily digest, scoped per associate |

## What an associate is NOT

Not a tier. An associate is a **store user with a narrow role and a scope**, so
none of the three two-party invariants moves:

* **RS-4's `splitFee`** still has exactly one remainder-holder. An associate pays
  no Skydrop fee; the store does.
* **TRE-8c's bank invariant** still walks ONE level of store wallets
  (`held for a seller = max(0, seller wallet + Σ that seller's store wallets)`).
  An associate has **no wallet**: the reseller settles with them outside Skydrop.
* **RS-3's visible stock** is still a set-aside, not a set-aside inside one.

If an associate ever needs a wallet, that is a different size of project and the
invariant above is what it has to answer first.

## The two privacy boundaries, and why each is structural

The owner's constraint: *"the reseller should not be able to see the seller real
product cost. and the associate shouldn't be able to see that how much the
reseller is getting paid and whats the cost?"*

**Boundary 1 — the seller's cost is already withheld from the store**, in two
places, and neither is a filter somebody has to remember: `StoreCatalogueItem`
does not carry the field at all, and `StoreAnalysisService.analysis()` passes
`unitCostInr: null`. Both are now pinned by a spec, because a `: null` with no
test naming it is one refactor from becoming a value.

**Boundary 2 — the store's cost is withheld from the associate by PERMISSION.**
`catalogue.view` carries `transferPriceInr` (what the store pays its seller);
the associate does not hold it. `catalogue.sell` is the same catalogue with the
store's cost removed and the associate's own retail in its place. A separate
permission opening a narrower endpoint beats a filter inside the wide one: a
filter is something somebody has to remember on every new field.

Also withheld, each for a reason about the field: `terms.view` (the fee split
and credit timing — the store's margin is derivable from it), `reports.view`
and `wallet.*` (the store's money).

**The response sweep** (`associate-response-boundary.spec.ts`) is the backstop:
every response shape an associate-reachable route returns must carry no
store-cost or store-earnings field, or name itself in an allow-list with the
reason it is safe. Neither is the default, so the decision is forced in the
commit that adds the field.

## The role

`store_roles.key = 'associate'`, provisioned with the other five
(`provisionDefaultStoreRoles`) and backfilled onto every existing reseller store
by `20261008120000_associates`. A sixth FIXED key, not a role the store invents:
the store side is key-based on purpose (`@IsIn(STORE_ROLE_KEYS)` is the complete
vocabulary because that function is the only writer).

Holds: `store.profile.view`, `catalogue.sell`, `orders.view`, `orders.create`,
`orders.cancel`, `orders.actions`, `customers.view`, `tickets.view`,
`tickets.manage`.

## Scope — `store_roles.order_scope`

`OWN | ALL`. **ALL is what every role meant before associates existed**, and the
migration states it on the five seeded keys rather than leaving them to the
column default — defaulting them would have silently narrowed every existing
store login to "only orders I placed myself", and since no order placed before
today records a store user at all, that reads as every store suddenly having no
orders.

The column default is `own`, so a role added later is narrow until somebody
widens it. `provisionDefaultStoreRoles` writes it explicitly for every role
anyway: the default is what a role gets when nobody decided.

**`storeOrderScope(roles)` is the ONE resolver** (`common/auth/store-order-scope.ts`,
pure) and **WIDEST WINS** — adding a role must never take something away
(RBAC-1b's ANY-semantics in the other direction), so ALL beside OWN is ALL, and
an OWNER role is ALL whatever its column says. Resolved over the SAME live roles
the permissions came from, in the guard, onto `req.storeUser.orderScope`.
Applied as `storeOrderOwnerFilter(...)` **in the WHERE clause** — never compared
to a role key at a call site, which is how a person holding two roles would be
narrowed by the one that was only meant to grant more.

It narrows **orders AND customers**. "Only his customers" is "a customer this
person has placed an order for" — customer identity is per OWNER (ORD-7), so two
associates selling to the same phone share one row; the scope is over the orders,
not over the identity.

## `orders.placed_by_store_user_id`

NULLABLE for ever. Every order placed before today genuinely has no answer, and
a backfilled guess would be a claim about who sold something. **Null means "no
store user placed this"** — a seller's own order, staff, a CSV on the seller side
— not "unknown".

Stamped by `ResellerOrderService.create` from `req.storeUser.id`, for every store
caller including the owner, so an associate's scorecard and the store's own
"placed by" column read off one column. A store API key places with no store user
(`storeApiKey` carries no person), so those orders stay null.

## `store_users.orders_paused_at`

RS-1's PAUSED semantics one level down: **no NEW orders, everything already
placed carries on, and they keep reading, tracking, cancelling and chasing it.**
Gates `orders.create` ONLY — refused `ASSOCIATE_ORDERS_PAUSED` at the create
boundary, before anything is written. Re-read per request with the roles, so
switching it off takes effect on their next call rather than when their token
expires.

The reseller sets it (`associates.manage`). It is not a restriction row and not
a role change: the person keeps their login and their history.

## `associate_prices`

One row per `(store_user_id, variant_id)`: what ONE associate sells ONE product
at. Set **by hand, per associate** (owner's call — A and B may sell the same
product at different prices) with **no markup rule and no fallback**: a product
with no row is refused BY NAME rather than priced at something nobody chose.

The price is **FIXED** — the associate cannot change it at order time, and a
retail that disagrees with their row is refused rather than accepted.

**It must still satisfy the seller's terms.** The seller sets a retail RANGE per
store variant (RS-3, `minRetailInr` / `maxRetailInr`); a reseller setting an
associate price outside it is refused (`ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE`),
because *no associate can break the seller's terms* — and refused at the moment
the reseller sets it, not weeks later at the order, so the person who can fix it
hears about it while they are looking at the screen.

A store variant whose range moves under an existing associate price leaves that
price OUT OF RANGE; it is reported on the pricing screen (per row, and as a count
on the roster) and the order is refused at create. Deliberately not
auto-adjusted: a price somebody negotiated is not ours to change.

**The range is read from `ResellerStockGateService.offersFor`, never re-derived.**
"override ?? default" is decided per ROW (RS-3), and a second implementation of
it is how the pricing screen comes to show a range the order gate does not
enforce. That gate is the dependency-free R3 primitive, so there is no cycle:
`reseller-associates` → `reseller-order-gate`, and `reseller-catalogue` →
`reseller-associates`.

**On a copy-from, an out-of-range line is a NAMED SKIP, not a refusal of the
whole copy** — refusing fifty prices over one is how a store gives up and sets
none. The report names every SKU under `created` (with the price), `overwritten`
(`fromInr` → `toInr`), `unchanged` and `skipped` (with the reason), and all the
writes are one transaction, so a half-copied list is unreachable.

**The price routes accept any live member of the store, not only somebody on the
`associate` role.** A person may hold `associate` beside another role (RBAC-1b),
and a role change must not strand prices already set for them. The LIST is the
associate roster; the price routes are "a person at my store".

## Endpoints

### The associate's own portal — `portal.skydrop.global`

Every one is an existing `/store/*` route the associate's role reaches, narrowed
by scope. **Nothing new is invented for them except the catalogue projection.**

| Route | Permission | Narrowed |
|---|---|---|
| `POST /store/orders` | `orders.create` | stamped + pause-gated |
| `GET /store/orders` · `GET /store/orders/:id` | `orders.view` | scope |
| `POST /store/orders/:id/cancel` | `orders.cancel` | scope |
| `POST /store/orders/:id/{recall,reattempt,…}` | `orders.actions` | scope |
| `POST /store/order-imports/*` | `orders.create` | stamped + pause-gated |
| `GET /store/order-imports` · `/:id` · the error report | `orders.create` | scope |
| `GET /store/customers` · `/:id` | `customers.view` | scope |
| `GET /store/tickets` · `POST /store/tickets` | `tickets.*` | scope |
| **`GET /store/catalogue/sell`** | **`catalogue.sell`** | **new projection** |

**`GET /store/orders/:id/money` is REFUSED at OWN scope, not narrowed.** It is
the fee split and the credit — the store's economics on that order. Scoping it
to the associate's own orders would still show them the margin on a sale they
made, which is the fact `catalogue.sell` exists to withhold; so the whole route
is closed to them rather than filtered.

**The reads an associate reaches carry NO cost block.** Three responses were
designed for a store whose whole team holds `terms.view`, and were correct until
an associate could read them: the order view's `transferPriceInr` /
`minRetailInr` / `maxRetailInr` / `totals.transferInr`, the money view above,
and RS-7's `disputedFigures` (`transferTotalInr`, `netInr`, the fee shares) on
the ticket routes. Each is now a DISCRIMINATED UNION on scope rather than an
optional field or a filter:

```ts
type StoreLineCost =
  | { readonly visible: true; readonly transferPriceInr: string; /* … */ }
  | { readonly visible: false };
```

A reader must narrow on `visible` before touching any of it, so **a cost field
added to the visible arm later is unreachable at OWN scope by the type system**
rather than by somebody remembering a filter. What an associate keeps is
everything they need to answer their own customer: the retail paid, the
quantity, the product, the COD owed, the ticket and its conversation. What goes
is the store's cost and the store-versus-seller settlement arithmetic — they are
not a party to it.

**The error report is scoped too.** A CSV error report carries the customer rows
of the file it came from, so an unscoped one breaches "only his customers" by a
different door; `bulk_order_uploads.uploaded_by_store_user_id` already existed.

`GET /store/catalogue/sell` returns, per variant the store may sell: product and
variant names, the picture, `retailPriceInr` (THIS associate's own row, absent
when unpriced), and `availableQuantity` (RS-3's visible stock, unchanged). It
carries **no** `transferPriceInr`, no suggested retail, no range, no hidden
share, no set-aside.

### The reseller’s side — `reseller.skydrop.global`

| Route | Permission |
|---|---|
| `GET /store/associates` | `associates.manage` |
| `POST /store/team/invitations` with `roleKeys: ['associate']` | `team.manage` (the EXISTING store invitation — there is no `/store/associates/invitations`, deliberately) |
| `PATCH /store/associates/:storeUserId/orders-paused` | `associates.manage` |
| `GET /store/associates/:storeUserId/prices` | `associates.manage` |
| `PUT /store/associates/:storeUserId/prices/:variantId` | `associates.manage` |
| `POST /store/associates/:storeUserId/prices/copy-from/:otherStoreUserId` | `associates.manage` |
| `GET /store/associates/analysis` | `associates.manage` |

**The invitation is the existing one, and there is no associate-specific route
for it.** The reseller sends a link through `POST /store/team/invitations` with
`roleKeys: ['associate']`; `StoreUserInvitationRole` already carries the role, so
nothing is new in the invitation table and nothing new gates it — the permission
is `team.manage`, because inviting somebody is inviting somebody whatever role
they land on. An earlier draft of this table named a
`POST /store/associates/invitations`; it was never built and should not be.

**Which app the link points at is a DECISION, not a constant** (`invitationAppUrl`
in `store-team.service.ts`). An associate works in `apps/associate` and everybody
else at a store works in `apps/reseller` — separate ORIGINS, and the
`__Host-storeRefresh` cookie is bound to the origin that set it, so an associate
who accepted at the reseller origin would hold a session the portal cannot read
and would land on an app where almost every page refuses them. **Widest wins, as
everywhere else**: only an invitation that is `associate` AND NOTHING ELSE goes to
the portal; any wider set means the person needs the wide app. A resend reads the
keys back for the same reason, so it cannot point somewhere the original did not.
`ASSOCIATE_APP_URL` is the env key, defaulted like `RESELLER_APP_URL` so an
unconfigured environment still boots.

**`GET /store/associates/analysis`** answers "which associate is performing how
much, and what do I do about it?" — per associate: orders placed, confirmed,
delivered, cancelled, NDR, RTO; the **money**, as retail sold and the store's own
margin on it (retail − the store's transfer price, which the reseller may see —
it is their own cost); rates divided only by orders whose outcome is KNOWN
(RS-9's rule: confirmation ÷ decided, delivery ÷ delivered+returned+lost), with
coverage stated. Unpriced-product counts and out-of-range prices beside each
person, because that is the thing that silently stops them selling.

## Not built, and why

**Capability 4 — the pincode rate check.** Pricing has been a FLAT per-seller fee
since the zone/slab engine priced a production order at ₹0.00 (PRC-1..8): there
are no per-pincode rates to check. Building a rate check means building a
pincode rate card, which is a pricing-engine project with its own invariants,
its own seed data and its own failure mode (the one PRC-6 exists for). It is
listed here so it is a decision on record rather than an omission.

**An associate wallet.** See "What an associate is NOT".
