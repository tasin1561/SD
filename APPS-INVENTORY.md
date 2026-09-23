# Apps restyle — Phase 0 inventory and plan

Branch `feat/apps-premium-restyle`, cut from `main` at `9fc408fa` on 2026-09-23. Nothing in any app, `packages/ui`, `apps/api` or `apps/marketing` has changed. **This document waits for approval before Phase 1.**

The four product apps are the seller console (`apps/seller`), the staff console (`apps/admin`), the reseller store portal (`apps/reseller`) and public tracking. The brief calls the last one `apps/tracking`; in the repo it is **`apps/track`**, and this plan uses that name.

## What is in this folder

| File | What it holds |
|---|---|
| `APPS-INVENTORY.md` (this file) | Findings, the token and primitive proposals, the pattern map per screen, build order, risks, rollback, and the decisions I need from you |
| `docs/apps-restyle/inventory-seller.md` | Every seller route, endpoint, table, form, dialog, status chip, state, money action, test pin and formatter, read from source |
| `docs/apps-restyle/inventory-admin.md` | The same for admin, plus every scanner, Enter-to-submit and barcode field (§4 of that file) |
| `docs/apps-restyle/inventory-reseller-track-ui.md` | The same for reseller and track, and a full catalogue of `packages/ui` |
| `docs/apps-restyle/baseline-first-load.md` | First-load JS for every route of every app today — the budget reference |
| `scripts/ui-fixtures.ts` | Dev-only fixture builder for the local database (see "How the screenshots were made") |
| `scripts/screenshots/apps-capture.mjs` | The before/after screenshot harness |
| `screenshots/apps-restyle/<app>/before/` | The current-state screenshots (gitignored, local only — about 120 MB) |

## How the screenshots were made

- **Local stack only.** Local Postgres and Redis (`127.0.0.1`), the API built from this branch and run with `WORKERS_ENABLED=false`, and each app's production build served by `next start` on `localhost`, one app at a time.
- **Nothing reached outside this machine.** Email is the dev stub (empty `RESEND_API_KEY`); Delhivery points at the local simulator on `127.0.0.1:4010`, which was not running; Shiprocket has no base URL (stub mode); there are no SMS, WhatsApp, push or payout providers in the local env; there are no outbound webhook endpoints in the local database; and with workers off, no queued job was processed at all.
- **Data is fixtures.** The local database held only simulator rows ("Simulator Brand", "Simulator Customer", `*.local` staff). `scripts/ui-fixtures.ts` added, through the real API as the local test seller and admin: 14 orders spread across the lifecycle (draft, pending, confirmed, picked, packed, dispatched, in transit, out for delivery, delivered ×2, delivery failed, returning, cancelled), an accepted and a waiting top-up, a withdrawal request, a ticket, a consignment and a reseller store with a login. Customer names and addresses are invented and phone numbers sit in the unused `+91 90000 000xx` block.
- **The fixture script is dev-only by construction.** It refuses to run unless `SKYDROP_UI_FIXTURES=1` is set, `NODE_ENV` is not `production`, and the API, `DATABASE_URL` and `REDIS_URL` are all `127.0.0.1`/`localhost`.
- **Variants:** every page at 1440 light, 1440 dark and 390 light, full page. Signed-out pages are captured signed out. `screenshots/apps-restyle/<app>/before/index.json` lists every shot and any page that redirected or failed.
- **Pages with no local id** are skipped and listed, never guessed: seller's two import-run pages, and reseller's order, customer and ticket detail pages (reseller orders are switched off locally, as `reseller.orders_enabled` is in production).

### Screenshot record

| App | Pages | Shots | Not captured (no local id) | Redirected by design |
|---|---|---|---|---|
| track | 3 | 9 | — | — |
| seller | 51 | 153 | `/orders/import/[id]`, `/products/import/jobs/[id]` | `/settings/notifications` → `/notifications/settings` |
| reseller | 25 | 75 | `/customers/[id]`, `/orders/[id]`, `/tickets/[id]` | — |
| admin | 89 | 267 | — | `/inventory` → `/inventory/adjustments` |

Every shot is in `screenshots/apps-restyle/<app>/before/`, named `<route>__<variant>.png`, with `index.json` beside it. The consoles' `/` only redirects to the dashboard, so it isn't captured as a page. The harness re-runs unchanged for the "after" set in Phase 7 (`--only` re-takes single routes).

## First-load JS today

Every app shares a 102 kB runtime. Full per-route tables are in `docs/apps-restyle/baseline-first-load.md`.

| App | Routes | Median first load | Heaviest pages |
|---|---|---|---|
| track | 2 | 119 kB | `/[awb]` 120 kB |
| reseller | 29 | 146 kB | `/orders/[id]` 188, `/wallet` 181, `/customers/[id]` 180 |
| seller | 54 | 169 kB | `/orders/[id]` 203, `/reseller-stores/[storeId]` 197, `/products/import` 197 |
| admin | 90 | 173 kB | `/orders/[id]` 212, `/call-center` 207, `/warehouse/rto` 202 |

The budget in §6 is **+15 kB gz per route over these numbers**, and the public tracking page keeps its Lighthouse score or better (measured at the start of Phase 2, before anything changes).

---

## 1. What the inventory found

### The debt mostly lives in `packages/ui`, not in the pages

This is the finding that shapes the plan. The look the brief wants gone is baked into shared components that every console page renders:

- **"01 //" eyebrows** come from `SectionBand` (`console.tsx:175`), which seller calls **110 times across 56 files**. Admin and reseller never use it.
- **Mono breadcrumbs** ("SELLER CONSOLE / …") come from `Crumbs` (`console.tsx:65`), used in 47 seller files.
- **Uppercase tracked labels** come from `THead` (every table header), `StatusBadge` (every chip), `Stat` labels, `MetaChip`, `StripFact` and the `AppShell` group headings.
- **Monospace money** in seller comes from ONE rule: `seller-theme.css:438` sets `.skydrop-tabular { font-family: mono }`, and `Money` (108 uses) and `Num` (48 uses) both carry that class.
- **Status shown as colour and a word, never an icon**: `StatusBadge` has no icon slot.
- **Native selects**: the ui `Select` is a styled native `<select>`; there are no raw ones (a test forbids them).

Fixing these at the source restyles most of every app at once. The pages then need the richer patterns (KPI cards, filter bars, timelines, wizards) one area at a time.

### Four token worlds, one of them broken

| App | CSS it loads | Fonts it loads | Fonts it actually renders |
|---|---|---|---|
| admin | `tokens.css` | Geist, Geist Mono | **the system sans** — `tokens.css` names `'Geist'` literally while the layout exposes `--font-geist-sans`, so the committed Geist files are downloaded and never used |
| reseller | `tokens.css` | Geist, Geist Mono | **the system sans** — same mismatch |
| seller | `tokens.css` + `seller-theme.css` | IBM Plex Sans, JetBrains Mono | Plex, and mono for every figure |
| track | `corridor.css` | Space Grotesk, Inter, JetBrains Mono | as loaded |
| marketing | its own `scales.css` + `theme.css` | Plus Jakarta Sans | as loaded (the target) |

Theme behaviour differs too. The three consoles default to **dark and ignore the OS** when nothing is pinned (FE-7). Track and marketing **follow the OS** when nothing is pinned.

### Money and irreversible actions without a confirm step

The brief asks for a confirm dialog that restates the amount or ID and the consequence on every money-moving or irreversible action. Most have one. These do not, and adding one is an interaction change the brief asks for (no API change):

- **Seller:** request a withdrawal (the form modal is the only step), the automatic-withdrawal schedule, bank details, generate invoice, courier consignee change, submit an order for confirmation, pending-row import and **discard**, archive or restore a product, delete a variant image, remove a CSV mapping, resume a reseller store, approve a store request (three queues), store catalogue save, store action-policy save, close/reopen/make-default a shopfront, rotate a webhook secret, change a team member's role (fires on select change), delete a role (**`window.confirm`**), dismiss one or **all** notifications.
- **Admin:** approve a withdrawal (one click from the row), re-check seller ledgers, remittance, treasury transfer / owner money / reconcile (form modal only), **mark opening balance (`window.prompt`)**, **courier master switch (`window.prompt`)**, printing label quantity (**`window.prompt`**), ticket refund on transition, compute charges, backfill charges (real run), stock transfer, **delete a bin**, **complete a goods receipt (writes stock)**, **RTO finalize (restock / write-off)**, RTO putaway, **consignment dispatch**, abandon a pick batch, mark picked, label reprint approve / reject / print, courier account deactivate / default, escalation channel pause / resume, staff role change (fires on select change), revoke a staff invite, NSA sweep, announce unnotified issues, webhook retry.
- **Reseller:** top-up claim, place an order, CSV import, call-review release (modal, no second confirm), delivery actions, address correction, courier consignee change, figure-correction dispute, record expense, role change (select change), create key, toggle webhook, mark all read / clear all notifications.

**Undo toasts:** no endpoint in the API can undo a money action (the ledgers are append-only by design and corrections are new entries). An undo that delays the request client-side would change behaviour. So the plan has **no undo toasts**; the confirm dialog is the guard. Say if you want a delayed-commit undo on any specific non-money action.

### Admin scanning and keyboard entry have no tests at all

There is **no global keyboard-shortcut map** in admin — no `useHotkeys`, no app-level `keydown`. Keyboard behaviour is local: Enter-to-submit on scan fields and Escape/Enter in the header search. **Not one vitest or Playwright test drives any of it.** The brief (§2.8) requires a spec before each of these screens is touched:

| Screen | Field | Behaviour to pin |
|---|---|---|
| Pack bench | `#pack-scan` | Refocus after every state change; Enter opens a box / scans a product / closes on the box's own AWB; switches to the serial step on `UNIT_SCAN_REQUIRED`; disabled while busy or refused; refusal modal refocuses the field |
| Handover bench | `#handover-scan` | Enter submits; focus restored after each submit and after the refusal modal; disabled while pending, refused or blocked |
| Pick, pack, receive | `SerialScanner` | Enter captures, trims, ignores empty, de-duplicates with a notice, counts `n / required`, turns critical when over |
| RTO station | AWB field | No Enter handler — receiving stays a deliberate click; the camera only fills the field |
| Receiving | Received / Damaged counts, putaway bin | Numeric inputs, no Enter handling |
| Cycle counts, adjustments, transfers, bin ops | Quantity fields | Numeric, no Enter handling |
| Serial trace | Serial | Enter submits ("a barcode gun types the number and presses Enter") |
| Header search | Omnisearch | 250 ms debounce; Escape closes; Enter navigates only on exactly one result; outside click closes |
| Printing | Label quantity | `window.prompt` |
| Consignment | Serials to reprint | Pasted or scanner-separated list parsing |
| Camera | `BarcodeCamera` | First read stops and hands the code to the same handler as the keyboard path |

### Tests that pin today's markup

These will need updating in the commit that changes what they pin (full list per app in the inventory files):

- `apps/admin/src/tests/ui-primitives.test.tsx` pins `.skydrop-tabular` on `Money`/`Num`, `.font-mono` on `Ident`, the credit/debit colour classes and `EmptyState bare` having no border.
- `apps/admin/src/tests/auth-console-copies.test.ts` requires the login-screen files to be byte-identical across admin, seller and reseller, and seller's `console.css` to differ.
- `apps/seller/src/tests/seller-theme-scope.test.ts` pins the seller theme import order and exact colour values in seller's `console.css`.
- `ticket-conversation.test.tsx` pins `justify-end`/`justify-start` on bubbles; `rto-line-thumbnail.test.tsx` pins `bg-surface-raised`; `new-product.test.tsx` pins literal JSX strings (`variant="ghost"`, `sticky bottom-0`, the safe-area class).
- The three login specs pin exact text: "seller portal", "operations console", "store portal", and "Invalid email or password."
- `e2e-shared/responsive.spec.ts` fails on any horizontal overflow, any tap target under 30 px tall, and any input under 16 px on touch devices — at 320, 360, 414 and 768.

### Smaller facts worth knowing

- Reseller uses four Tailwind classes that match no token and generate no CSS: `text-text-inverse`, `border-border-subtle`, `text-warning`, `text-danger`. They are bugs today and get fixed by the token move.
- Track's fonts are Latin-only subsets, so the Hindi page falls back to the system Devanagari face. Plus Jakarta has no Devanagari either.
- Spinners exist in only three places (the header omnisearch in admin and seller, and the courier cost-sync run buttons). Everything else already uses skeletons.
- `packages/ui/src/tokens/index.ts` (the TypeScript token mirror) is stale against `tokens.css`.
- Seller and admin both have their own `Stepper`, tab, money-tile, reveal-card and timeline implementations beside the ui ones (listed in the inventory files).

---

## 2. Tokens: one source for all five apps

**Proposal.** Move the brand token set into `packages/ui/src/brand/`:

- `scales.css` — the eight raw hue scales (blue, saffron, green, teal, violet, magenta, red, slate), 50–950, declared once. Copied **verbatim** from marketing.
- `theme.css` — the four-block semantic theme: `--{hue}-text`, `-fill`, `-on-fill`, `-fill-hover`, `-tint`, `-on-tint`, `-surface`, `-line`, `-glow`, surfaces, text, lines, focus, shadows and `--corridor-gradient`. Same values as marketing, same four blocks (dark twice, light twice), same `data-theme` plus OS-preference mechanism.
- `app.css` — what the apps need and marketing doesn't: the app spacing scale (4 px base), app type scale (13/14 px body), radius scale (8/12/16), `tabular-nums` for every figure in Plus Jakarta, mono only for `.sd-ident` (AWB, order ID, serial, SKU), the status-chip roles, and a **legacy alias layer** that maps today's names (`--color-*`, `--status-*`, `--color-credit`, the corridor `--tone-*`) onto the new semantics.

**The legacy alias layer is what makes per-app rollout safe.** When an app switches its `globals.css` from the old CSS to the brand CSS, every screen that hasn't been rebuilt yet still resolves every variable it reads, now in brand colours. No screen goes blank or falls back to nothing.

**Marketing stays untouched, which conflicts with "one token source".** You asked for both. To honour both, `packages/ui/src/brand/scales.css` and the four theme blocks are **copies** of marketing's, and a gate (`scripts/check-brand-tokens.mjs`, in the static CI job) fails the build if the copies drift from marketing's files by one declaration. Switching marketing to import from `packages/ui` is a two-line change to `apps/marketing/src/app/globals.css`, which I'd do as a follow-up **only if you approve touching marketing**. Until then there are two files and one gate, not two sources.

**The contrast is computed.** Marketing has no standalone contrast script: the ratios are computed inside its swatch page (`apps/marketing/src/app/dev/swatches/palette.ts`). I'll lift that function into `packages/ui/scripts/contrast.mjs` (a copy, marketing untouched) and run it over every text/surface and chip pair in both themes; it fails under 4.5:1 for text and 3:1 for control borders.

**Theme default changes for the consoles.** Following the OS when nothing is pinned (the brief's four-block mechanism) replaces FE-7's "dark remains the default". A pinned choice still wins, and the server-rendered `data-theme` cookie path stays. I'll update CLAUDE.md's FE-6/FE-7 in the same commit.

**Fonts.** Plus Jakarta Sans (the committed latin woff2 from marketing) for everything, JetBrains Mono for identifiers only, both through `next/font/local` per app (the committed-fonts rule). This also fixes admin and reseller rendering in the system font. For Hindi on track, I propose adding **Noto Sans Devanagari as a committed latin-free subset** behind a `unicode-range`, so English pages never download it. That's a font file, not an npm dependency — say no and track stays on the system Devanagari face.

---

## 3. Primitives: what exists, what becomes what

**Two layers, so each app can move on its own.**

- **Layer A — skin (Phase 1, visible only when an app opts in).** The legacy components in `@skydrop/ui/components` get stable class hooks (`sd-band`, `sd-band-index`, `sd-crumbs`, `sd-th`, `sd-chip`, `sd-stat-label`, `sd-figure`, `sd-ident`) — class additions only, no visual change under today's CSS. The brand CSS styles those hooks: no "NN //" index, sentence-case sans breadcrumbs, sentence-case headers, chips with icons, Plus Jakarta tabular figures. **An app's whole look flips with one `globals.css` change, and flips back with its revert.**
- **Layer B — patterns (Phases 2–5).** New components in `packages/ui/src/app/`, exported as `@skydrop/ui/app`, applied one area per commit. Pages keep their hooks, endpoints and field names; only the rendered component changes.

**The micro library moves into `packages/ui/src/micro/`** (the patterns the apps use, listed below) as copies of marketing's with app density and the app tokens. Marketing keeps its own copies until you approve pointing it at the shared one. Each pattern ships only with the routes that import it.

| Existing today | Duplicates found | Becomes |
|---|---|---|
| `AppShell` | — | u23 sidebar (brand header, gradient active row, sliding accent bar, collapsible groups, count badges, user card), u31 top bar, u20 drawer. Same props, same `aria-current`, same `data-slot` hooks the responsive spec and the light-theme rules read |
| `PageHeader`, `Crumbs`, `Section`, `SectionBand` | Seller's hand-made back-links, reseller's "← Orders" links | Page header: sentence-case breadcrumb, title, primary action (u28 sweep). Section heading as plain text |
| `Stat`, seller `MoneyTile`/`WalletBalanceCard`, admin `MoneyCard`, `MoneyTile`, reseller local `Stat` | 5 | **KPI card**: label, big tabular figure with a once-per-load odometer count-up, secondary figure, state chip, hue glow by meaning (green credit, red debit, amber pending) |
| `Table`, `THead`, `Tr`, `Th`, `Td`, `TablePaginator`, `SortableTh`, raw `<table>` in 10 admin files | 10 | **Data table** u07: toolbar (search, u04 filter bar, primary action), sticky header, row hover lift and accent bar, u03 checkboxes where selection exists today, u16 pagination with per-page. Keeps the mobile card layout and `data-label` stamping. No per-row animation |
| `StatusBadge` and its 14 typed wrappers | Local kind maps in ~15 files | **Status chip**: colour + icon + word, driven by the existing kinds in `@skydrop/ui/status` (the words don't change) |
| `FilterChip` | Four hand-made tab sets in admin, one in reseller | u09 liquid-bead tabs (`role=tablist`, arrow keys) and filter chips |
| `Input`, `Textarea`, `FormField` | — | u33 floating-label field with helper and counter |
| `Select` (native) | — | u05 custom select on fine pointers, **native select kept on touch** (the premium skill's own rule, and what the 16 px touch spec expects); searchable u18 where the list is long (seller picker, courier, category) |
| phone inputs (`lib/phone.ts` logic) | — | u02 phone field (+880/+91, auto-format, live check) — formatting logic reused, not rewritten |
| `Switch` | — | u08 switch with ON/OFF in the track |
| seller `Stepper` (quantity) | 2 | u12 number stepper |
| radio-card labels (reseller ×2) | 2 | u10 choice cards |
| image/proof/logo/CSV file inputs | — | u15 drop zone |
| `Button` | Reseller's hand-rolled error-page button | u28 sweep for primary; rolling-label for every async button, wired to the real request state |
| `Toaster`/`useToast` | — | u32 toast (icon, title, body, close, draining bar); same `useToast()` API |
| `Modal`, `ConfirmDialog` | `window.confirm` ×1, `window.prompt` ×3 | Dialog with focus trap and return; confirm dialog that restates amount/ID and consequence; success dialog u11 where a flow ends |
| `OrderJourneyPanels`, `JourneyTimeline`, seller `parcel-timeline`, `ticket-timeline`, consignment `Timeline`, track `TimelineView` | 5 | **One u17 timeline** (filled connector, pulsing current step, time chips, ETA) used by track and all three consoles |
| seller `topup-wizard` stepper | 2 | u34 stepper |
| `LoadingState`, `Skeleton`, `SkeletonRows` | — | Shimmer skeletons (transform/opacity) |
| `EmptyState`, `ErrorState`, `ErrorNote` | Ad-hoc alert paragraphs in reseller | u27 empty state (positive variant for "nothing needs attention"), error with retry |
| help disclosure | — | u35 tooltip card for glossary terms |
| key/secret/invite reveal cards | 3 in seller | One reveal card |
| `Money`, `Num`, `Ident`, `formatInr` | Local `Intl` and `toLocaleString` in both consoles | **Unchanged logic.** Only the class changes (Plus Jakarta tabular instead of mono). The money snapshot test proves the strings |

**Micro patterns moving to `packages/ui`:** rolling-label button, sweep, liquid-bead tabs, odometer, text field, phone field, combo select, chip select, choice cards, stepper, progress stepper, tracking card (u17), toast, success card, empty state, parachute progress, van drive-off, paper-plane send, label-into-parcel, segmented code, data table, pagination, tooltip card, list row, `use-async-state`. **Not moving** (marketing-only): reactive mascot (no mascot, per the brief), contact fan, carousel, scene switcher, door hover, glow field, connector draw.

**The `/dev/ui` gallery** is a `page.dev.tsx` route in each app, compiled only when `APPS_DEV_ROUTES=1` (marketing's `pageExtensions` mechanism), so it never reaches a production build.

---

## 4. Where each pattern goes

Abbreviations: **KPI** card, **T** data table u07, **F** filter bar u04, **Ch** status chip, **Tl** u17 timeline, **W** u34 stepper, **CD** confirm dialog, **Sk** skeleton, **E** u27 empty state, **RL** rolling-label async button, **Sel** u05/u18 select, **Fld** u33/u02 fields, **Sw** u08 switch, **Tb** u09 tabs, **Acc** u19 accordion, **DZ** u15 drop zone, **Par** parachute progress, **L** u21 list.

### apps/track (Phase 2)

| Page | Patterns | Not applicable |
|---|---|---|
| `/` lookup | u33 waybill field (mono value), RL "Track" (idle → finding → navigates), language pill (u09), theme switch u14 | Everything console-side |
| `/[awb]` found | **Tl is the page**: header card with AWB, courier, Ch, ETA; filled connector, pulsing current step, time chips; sold-by row; shareable status card (copy link) | Odometer, tables |
| `/[awb]` not found / unavailable | u27 empty state, retry | — |

The corridor map canvas stays (it's the brand, and it's marketing's hero art) but re-reads the brand tokens.

### apps/seller (Phase 3)

| Area | Pages | Patterns | Not applicable |
|---|---|---|---|
| Sign in and account setup | `/login`, `/password-reset`, `/auth/reset-password`, `/auth/verify-email`, `/auth/accept-invitation`, `/auth/accept-team-invitation` | Fld, RL, **u13 password strength** on the three set-a-password forms, u14 theme switch | Tables |
| Dashboard | `/dashboard` | KPI ×(balance, owed, money in flight), T recent orders, L needs-attention with severity chips, quick actions u05 menu, onboarding card, E | — |
| Orders | `/orders`, `/orders/pending` | T + F (status chips, dates, store, search), Ch, u16, E; pending rows as L cards with inline Fld | — |
| Create / edit order | `/orders/new`, `/orders/[id]/edit` | W as a progress header over the same single form (see decision 4), Fld, u02 phone, Sel (store, product picker u18), u12 stepper for quantity, **van drive-off on "Create order" submit only**, duplicate-order dialog | — |
| Order detail | `/orders/[id]` | Tl journey, call cards (attempt + outcome as friendly cards), charges band, invoice band, CD on cancel / return / delivery action / generate invoice, Ch, tickets L | — |
| Imports | `/orders/import`, `/orders/import/[id]`, `/products/import`, `/products/import/jobs`, `/products/import/jobs/[id]` | DZ, **Par for the import run**, results summary, T | — |
| Tracking | `/tracking` | T with expandable rows, the same Tl as the public page, F | — |
| Needs attention | `/needs-attention` | L with severity chips, **positive E when empty** ("Nothing of yours needs you") | — |
| Customers | `/customers` | T with reputation Ch, expandable detail with order-history Tl, CD on remove | — |
| Tickets | `/tickets`, `/tickets/[id]` | L with state Ch, thread view, reply box like the marketing contact form (u33 + counter), **paper-plane on "Send reply"** | u26 chat header chrome (the thread is not a live chat) |
| Products | `/products`, `/products/new`, `/products/[id]`, `/products/[id]/variants/[variantId]` | T, Fld, choice chips for options, DZ for images, **STRICT mode switch u08**, CD on archive and image delete | — |
| Inventory | `/inventory`, `/inventory/units` | T with four labelled figures (on hand / reserved / available / in transit), low-stock chip that pulses once, serial-trace Fld | — |
| Inbound and held stock | `/inbound`, `/inbound/[id]`, `/holds` | T, consignment wizard W, leg counts as a Tl, CD on cancel and on release | — |
| Wallet and freight | `/wallet`, `/wallet/limits`, `/freight` | KPI balance cards, ledger T with direction colour + icon, top-up W ending in the "Waiting for Skydrop to see it" pending chip, withdrawal CD, withdrawal settings Sw, freight mode as u10 choice cards, "Your limits" rows styled as info | — |
| Reseller stores | `/reseller-stores` and its 5 sub-pages | T, Tb (store detail tabs), permission matrix as Sw in a table, terms as a versioned card with CD, price fields, CD on approve/reject/pause/close | — |
| Settings, team, notifications | `/settings` and its 6 sub-pages, `/profile`, `/team`, `/team/roles`, `/notifications`, `/notifications/settings` | Acc groups, L members with role chips, permission Sw with CD on removal, notification topics as Sw, key/secret reveal card, CD on revoke/delete/rotate/dismiss-all | — |

### apps/reseller (Phase 4)

Same shell and primitives. Store catalogue T with the hidden columns simply absent (they already are); terms as a versioned card with CD; permission matrix as Sw; disputes as a Tl; wallet KPI and ledger T; withdraw CD already exists and gets the new dialog; order detail Tl; import DZ + Par; the store's primary CTA ("New order") gets label-into-parcel hover. **Not applicable:** van drive-off (the brief reserves it for the seller), mascot, u26 chat.

### apps/admin (Phase 5) — the quiet set

Dense T + F + Ch + Sk + toasts + CD everywhere; queues (calls to make, units to inspect, top-ups to check, delivery actions, courier decisions, manual placement, NSA, reattempts, holds, withdrawals, bank changes, system issues) as prioritised L with age and severity chips. Money and irreversible actions get the CD listed in §1, restating seller, amount or ID and consequence. Scanner and count screens (pack, handover, pick, receive, RTO, cycle counts, printing, bins) keep their exact input flow: restyled fields, same focus, same Enter behaviour, same disabling, each pinned by a spec first. The escalation six-digit confirmation and the bin-collapse emailed code use **segmented code**. RL on async buttons and Par on bulk operations (charges backfill, bill unbilled, CSV, bulk dequeue, bulk bin transfer). **Not applicable:** van drive-off, paper-plane (admin's ticket reply stays quiet), label-into-parcel on anything but the one primary CTA, odometer on anything but dashboard KPIs, u26 chat.

### Not applicable anywhere (recorded as such)

- **u13 password strength** applies only where a password is set: seller reset / accept-invitation / accept-team-invitation, admin reset / accept-invitation, reseller reset / accept-invitation. Nowhere else.
- **u06 / u26 chat**: ticket threads are asynchronous message logs, not live chat. They get the reply-box treatment, not chat chrome.
- **u01 footer, u29 URL input**: the consoles have no footer; the webhook URL field is the one URL input and gets u29's live validation.
- **Mascot, van drive-off outside seller "Create order", paper-plane outside seller ticket reply.**

---

## 5. Motion and performance plan

- transform and opacity only; no animated blur; loops pause off-screen and on hidden tabs; `prefers-reduced-motion` gives identical end states.
- Entrance animations run once per page load, keyed on the first successful data render — not on refetch, not on navigating back. Table rows never animate individually.
- Micro patterns import per route; the shell imports none of them.
- **INP measurement needs a 200-row page.** Admin's `/webhooks` renders up to 100 rows unpaginated and seller's wallet ledger loads pages of 50; neither has 200 rows locally. The fixture script gains a `--bulk` option in Phase 6 that adds 200 orders and ledger rows so the measurement is real.

---

## 6. Build order, risks and rollback

### Build order

1. **Phase 1 — `packages/ui`.** Brand tokens + drift gate + contrast script; class hooks on legacy components (no visual change); `@skydrop/ui/app` primitives; `micro/`; `/dev/ui` gallery in each app, both themes; **the money snapshot test recorded against today's markup before any component changes**, for seller's dashboard treasury cards, wallet ledger and an order's charges band, and admin's seller-wallet ledger and top-up screens (recorded now rather than in Phase 5, so admin's baseline predates every change); a spec for every §1 scanner and keyboard field (written now, green on today's code). Per-primitive gzip sizes in the report. **WAIT.**
2. **Phase 2 — track.** Lighthouse before, restyle, Lighthouse after, screenshots. **WAIT briefly.**
3. **Phase 3 — seller.** Skin switch first (one commit), then shell + dashboard, then orders, then the rest one area per commit.
4. **Phase 4 — reseller.**
5. **Phase 5 — admin.** Skin switch, then one queue/area per commit; scanner screens only after their spec exists (it will, from Phase 1).
6. **Phase 6 — polish, reduced motion, keyboard, INP.**
7. **Phase 7 — verification**, after-screenshots with the same harness and fixtures, this file updated to done / n/a per pattern per page, legacy CSS files and unused legacy components deleted only when nothing imports them.

### Risks

| Risk | Guard |
|---|---|
| A shared-component change restyles apps before their phase | Layer A adds class hooks only; nothing changes visually until an app switches its CSS. The screenshot harness diffs every app after Phase 1 to prove it |
| A restyle changes a money string | The snapshot test compares visible text before and after, and `Money`/`Num`/`formatInr` logic is not touched |
| A scanner screen loses focus or Enter behaviour | Specs first (Phase 1), restyle after; the input element, its handlers and its `id` stay |
| Custom selects break keyboard or touch use | Native select stays on coarse pointers; the custom one is a WAI-ARIA listbox with type-ahead |
| Responsive spec regressions (overflow, 30 px targets, 16 px inputs) | Targets designed at 40 px dense / 44 px touch; run the spec per commit |
| Hydration and CSP (nonce) regressions | `e2e-shared/csp.spec.ts` per app; no new inline scripts |
| Bundle growth | Per-route imports; the Phase 0 baseline and a per-route check each phase |
| Theme default change surprises staff | Pinned choices keep working; the default only changes for people who never pinned |
| Pinned tests fight the change | Each pin is updated in the commit that changes what it pins, and listed in the phase report |

### Rollback

- **A whole app:** revert its skin-switch commit — `globals.css` goes back to the old CSS, and the legacy components still render with their old classes.
- **One area or screen:** every area is its own commit touching only that area's files, so `git revert <sha>` restores it; the shared primitives it used stay for the others.
- **A primitive:** the legacy component is kept until Phase 7, so a page can point back at it.

---

## 7. Decisions I need from you

1. **Marketing and the "one token source".** Copies in `packages/ui` plus a drift gate now (my recommendation), and marketing switched to import them later with your approval? Or may I touch `apps/marketing/src/app/globals.css` in Phase 1 to import the shared files?
2. **Theme default.** The brief's four-block mechanism means the consoles follow the OS when nothing is pinned, replacing "dark is the default" (FE-7). Confirm.
3. **Hindi font on track.** Add a committed Noto Sans Devanagari subset behind `unicode-range`, or keep the system face?
4. **Create order as a wizard.** A true multi-step wizard hides fields per step and changes the flow. I recommend a u34 stepper as a **progress header over the same single form** (it tracks the section you're in and jumps on click), which keeps the form and its behaviour exactly as they are. Or do you want the real wizard?
5. **Confirm dialogs where none exist today** (§1 lists them). Add all of them, or only the money-moving and destructive ones (withdrawal, discard, delete, dispatch, receive-complete, RTO finalize, bin delete, invoice, role changes) and leave the routine ones (make default, toggle webhook, mark read)?
6. **Auth screens.** They share a login design that a test requires to be byte-identical across the three consoles, with the telemetry look ("sys online", mono labels). Rebuild them in the brand look (updating that test) — or leave them for last?

## 8. Owner decisions after Phase 3 (2026-09-24)

- **Create order uses the van as the BUSY animation** (`VanDriveOffButton
  mode="while-busy"`): the button turns into the van when the request is
  sent, the van keeps driving while it runs, the page navigates the moment
  the API succeeds (nothing waits for the animation), and on an error the
  van reverses into the button, which shows the error. Done for seller
  (`/orders/new`, "Submit for confirmation"). **The same treatment is
  required for reseller and admin order creation** — applied in Phases 4
  and 5 when those create-order screens move onto the primitives.
- **Counters show, never enforce** (`countMax`), unless the field already
  enforced the limit. No new `required`, `maxLength`, `pattern` or `min`/
  `max`; a visual-only asterisk is `requiredMark`.
