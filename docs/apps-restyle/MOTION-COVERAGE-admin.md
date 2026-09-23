# Motion coverage — apps/admin (Phase 5)

Pattern → where used, or n/a with the reason, per area. Merged from the six area notes. Admin creates no orders, so the van drive-off is n/a everywhere in this app.

## Motion coverage — admin area AA (order operations)

Pages: `/orders`, `/orders/[id]` (every panel, god mode included), `/call-center`,
`/call-center/queue`, `/call-center/agents`, `/delivery-actions`,
`/reattempt-requests`, `/manual-placement`, `/courier-decisions`, `/holds`, `/nsa`.

Shared area pieces: `orders/_components/order-ops-parts.tsx` + `order-ops.css`
(prefix `oo-`: soft section cards, fact lists, notices, `AgeChip`, queue cards,
the god-mode panel). Per-folder CSS: `order-core.css` (`oc-`),
`order-shipping.css` (`os-`), `call-center/_components/call-center.css` (`cc-`),
`courier-decisions/_components/courier-decisions.css` (`oq-`). Tokens only; every
grid uses minmax columns.

### Area-wide n/a

| Pattern | Why not here |
|---|---|
| Van drive-off (create order busy state) | Admin creates no orders. |
| Paper-plane send | No ticket reply in this area. |
| ParachuteProgress | No bulk, import or backfill operation in this area (charges backfill and bulk dequeue live in other areas). |
| SegmentedCode | No six-digit code in this area. |
| Stepper (u34) | No multi-step flow. God mode keeps its own two-stage chrome (edit → typed confirm) by rule. |
| Liquid-bead Tabs | None of these pages had a tab UI. |
| Per-row table animation | Forbidden. Rows get hover only. |

### /orders

| Pattern | Where |
|---|---|
| PageHeader | Breadcrumbs + "N orders" / "Filtered" meta fact |
| FilterBar | Search (form submit on Enter unchanged), status, source, seller, placed from/to |
| DataTable + Pagination | Page size 20; row `onActivate` → `/orders/{id}` unchanged |
| StatusChip | `orderStatusKind` / `statusLabel` via `chipWords` |
| Skeleton / EmptyState / ErrorState | SkeletonRows; EmptyState; ErrorState with retry |
| Toasts, KPI, Timeline, confirms | n/a: no actions and no summary endpoint on the page |

### /orders/[id]

| Pattern | Where |
|---|---|
| Skeleton / ErrorState | Header + row skeletons; ErrorState with retry |
| u17 Timeline | Journey stage list (full history stays on the shared `JourneyTimeline`); consignee change history |
| StatusChip | Order status, shipment status, reseller credit status |
| ConfirmDialog | Cancel order, release reservations, restore stock claim, compute charges (new), retry stock (new), send back to pick (new), NDR re-attempt (new), shipment cost (new), cancel with courier / cancel voided waybill / mark cancelled outside (reason-gated confirm) |
| Dialog | Admin return, god mode (critical, locked while running), correct recipient, e-way bill, manual scan, manual placement place / cancel (critical) |
| AsyncButton (rolling label) | Courier correction, e-way bill, courier cancel confirms, consignee send, manual placement, manual scan |
| Toasts (app `useToast`) | Stuck recovery, return, compute charges, courier ops, consignee, manual placement |
| DataTable | Items, charges, reseller lines, reseller money tables |
| KPI count-up | n/a: no plain counts |

### /call-center (station)

| Pattern | Where |
|---|---|
| AsyncButton (controlled by `isPending`) | Check for a call, Record outcome, Release |
| u17 Timeline | Previous calls on this order and earlier orders |
| EmptyState | Positive when available and nothing is queued |
| Skeleton | Availability, my-call history |
| Toasts | Record / queue-empty / release results |
| StatusChip | Availability |
| Keyboard / flow | Unchanged: no Enter handlers or autoFocus existed; heartbeat, bootstrap gate and timers byte-identical |

### /call-center/queue

| Pattern | Where |
|---|---|
| KpiCard count-up | Open, Pending, Assigned, Agents holding work |
| DataTable + Pagination | Page size 25; row → order unchanged |
| AgeChip | Waiting since (neutral: the queue had no severity rule) |
| StatusChip | Local `queueKind` |
| Dialog | Reschedule, reassign, force outcome (critical) |
| AsyncButton | Reschedule, reassign, record forced outcome |
| EmptyState | Positive "Queue is empty" |

### /call-center/agents

| Pattern | Where |
|---|---|
| KpiCard count-up | Agents, marked available, calls held now |
| DataTable | Roster, outcome metrics |
| AsyncButton | Save capacity |
| Skeleton / EmptyState | List + attempts skeletons; neutral empty |

### Queues: /delivery-actions, /reattempt-requests, /manual-placement, /courier-decisions, /holds, /nsa

| Pattern | Where |
|---|---|
| Prioritised list + AgeChip | Every row. Tones reuse each page's existing thresholds (manual placement 12h/24h, courier decisions 2h/6h, holds ≥3 days open, NSA 2nd/3rd night); delivery actions and reattempts had no rule → neutral |
| StatusChip | Delivery actions (local `statusKind()`), holds (early-review mappers), others where a status existed |
| Layout | Tables for the five dense queues; queue cards (`oo-qcard`, severity bar) for reattempts |
| EmptyState | Positive when a queue is empty; neutral for filtered / "all" views |
| Skeleton / ErrorState | All six |
| KpiCard | Holds (one count-up, two `<Num>` figures), NSA (three count-ups) |
| ConfirmDialog | NSA "Check now" sweep (new) |
| Dialog + AsyncButton | Delivery-action decide, reattempt decide, NSA acknowledge |
| Toasts | NSA acknowledge + sweep (app `useToast`) |

## Motion coverage — apps/admin, area AB1 (warehouse benches)

Every motion pattern used on the warehouse hub and the scanner benches —
pick, pack, handover, printing, receive and RTO — after the apps restyle
(Phase 5). Catalogue names are the premium-ui-motion skill's (`u01`–`u35`,
storytelling controls by name).

**The rule that outranks every pattern here: a bench is run by a barcode
gun.** The scan fields (`#pack-scan`, `#handover-scan`, the shared
`SerialScanner`, the RTO AWB field, the receive count fields, the printing
label quantity) keep their element, id, type, focus and refocus effects,
Enter handling, trimming, disabling and the refusal-dialog refocus exactly
as the `scan-*.test.tsx` specs pin them. Their only visual state changes
are colour and opacity (focus ring, disabled fade). A scan result — a line
counting up, a parcel joining the session list, a serial chip — appears
instantly with no entrance animation, so nothing ever delays the next scan.

Shared guardrails: tables animate on hover only (no per-row animation),
nothing re-animates on a refetch, navigation is never delayed, and reduced
motion is handled once by `@skydrop/ui/brand/app.css`.

Not used in this area, and why: **van drive-off** and **label-into-parcel**
(reserved for order creation), **paper-plane** (no ticket replies here),
**odometer / KPI count-up** (no dashboard figures — the counts here are
live worklist sizes that must read instantly), **u34 stepper** (the pick →
pack → handover sequence is spread across separate benches, not one
multi-step form), **parachute progress** (no bulk or backfill operation
on these screens), **segmented code** (no six-digit code), **AsyncButton
rolling label** (see below).

**Why no rolling-label AsyncButton on the benches.** Every bench button
already swaps its label to the real in-flight word ("Finishing…",
"Receiving…", "Shelving…") and back, which the specs read by accessible
name; AsyncButton also mounts its own `role="status"` live region, and the
RTO split spec (`getByRole('status')`) and pack spec (`getByRole('alert')`)
each require exactly one such region on screen. The in-flight label states
are kept on the new `Button` instead.

### /warehouse (hub)

- Page header (plain title and subtitle).
- u21-style tiles: soft card, icon chip that fills with the accent on hover
  or focus, card lifts 2px, chevron steps right (transform only). Links,
  so navigation is immediate.

### /warehouse/pick

- Page header; a standing blue banner pointing at Printing.
- "Pull next", "Start pick", "Record", "Complete pick": new `Button`, label
  swaps to the in-flight word (unchanged strings).
- Line cards: a recorded line turns accent-tinted (colour only) with a
  "Recorded" check. Bin and Batch are u33 floating-label fields (identifier
  face); a STRICT line carries the `SerialScanner` (unchanged behaviour).
- u27 empty state "No pick in progress".
- "Release a stuck pick": section heading + Dialog (scale + fade, focus
  trap and return) with the u33 `fe-shipment` field; server verdict
  verbatim.

### /warehouse/pack

- Page header. Scan panel: the large `#pack-scan` field (colour-only
  states). "Box open on …" meta line with figures in the tabular face.
- The box contents: one row per product, the outstanding count large; a
  satisfied row goes quiet (colour change) with a check — no motion.
- Serial step: `SerialScanner` (`#pack-finish-serials`, autofocus kept).
- Cancel the box / pack without scanning: inline two-step kept (reason
  ≥3 / ≥20 characters as before), now u33 fields.
- The refusal is a critical Dialog ("That scan was refused"), blocking; "I
  have fixed it" returns focus to the field (the spec's fix, kept).
- Pack queue under the bench: u21 list rows (icon chip, AWB in the
  identifier face, status chip "Label printed" / "No label" with icon and
  word, a severity stripe on unlabelled parcels, hover lift only); skeleton
  rows while loading; u27 positive empty state "Nothing waiting to be
  packed"; error state with Retry.
- Camera: `CameraScanButton` (secondary button) opens the camera Dialog.

### /warehouse/handover

- Page header with breadcrumb (Warehouse → Handover).
- Scan-block card: red, icon + words (SCAN-1), no animation.
- `#handover-scan` scan field with the camera button beside it.
- Session list: u21 list rows, newest first, status chip "Dispatched" /
  "Scanned" / "Already gone"; rows appear instantly.
- Waiting-for-a-van queue: u21 list rows, checked rows dimmed (opacity);
  skeleton; u27 positive empty state; error with Retry.
- Refusal: critical Dialog; "Understood" returns focus to the field.

### /warehouse/printing

- Page header with breadcrumb.
- The five views are a segmented bar of real `<button>`s with
  `aria-pressed` and a colour-transition pill — not the liquid-bead Tabs,
  because `scan-printing-quantity.test.tsx` drives "Find a product" by
  `role="button"`, and Tabs would make it `role="tab"`.
- Label / picking / reprint queues: u07 DataTable (hover only), native
  checkboxes (accent-coloured), skeleton rows, in-table empty rows.
- "Did the labels print?" / "Did the picking list print?": Dialogs (the
  existing confirms), failure and shortfall lists in a red callout.
- Abandon a batch (from the print dialog and from Past batches) and Mark
  picked: **new ConfirmDialogs** restating the batch number and what
  happens to its parcels.
- Past batches: u07 table, StatusChip per batch, icon buttons with their
  original accessible names.
- Find a product: u33 search field with icon; u27 empty state "Where is
  it?"; results as soft cards with bin chips. "Labels" still asks the
  quantity with `window.prompt` (pinned by the spec — see the report).
- Recently printed stickers: section heading + u07 table.

### /warehouse/receive

- Page header; filters as native u05 selects in a responsive grid; u07
  table with whole-row activation (unchanged), receipt and consignment
  numbers in the identifier face, status as a neutral StatusChip; skeleton
  rows; u27 empty state; error with Retry; u16 pagination (bubble moves to
  the active page).

### /warehouse/receive/[id]

- Breadcrumb (Warehouse → Receive queue → receipt), title in the
  identifier face, status chip in the meta row.
- Facts as a description grid.
- Product cards: a recorded line turns accent-tinted with a "recorded"
  chip. Received qty / Damaged are u33 number fields (type, min, max,
  inputMode unchanged); Putaway bin is a u05 native select.
- **Complete now asks first**: ConfirmDialog restating the receipt number,
  the seller, how many products carry a count and that stock is written
  and cannot be cancelled afterwards.
- Cancel receipt: critical Dialog with a required-marked "Why" field; the
  ≥10-character gate on the button is unchanged.
- Loading is skeleton rows; the "stock written" line carries a check.

### /warehouse/rto

- Page header. The four views are the liquid-bead Tabs (a real tablist;
  arrow keys move and select); counts appear only when non-zero, "At our
  door" in red when anything is waiting. The Receive panel stays mounted
  while hidden (unchanged), so a half-typed inspection survives a look at
  another tab.
- At our door / Still with the courier / On the bench: u07 tables, waiting
  time as a StatusChip, skeleton while reading the bench.
- Receive: u33 "AWB number" field (Enter still does nothing), camera
  button, "Receive" button (unchanged request).
- Inspection line cards: product thumbnail kept (`ProductThumb`, the
  pinned `bg-surface-raised` placeholder), u05 selects for condition and
  decision with the slip warning as the field's notice, u33 notes; "What
  each choice does" is a native disclosure; split-by-quantity rows keep
  their live `role="status"` arithmetic.
- **Finalize now asks first**: ConfirmDialog restating the shipment number
  and the units going back in stock / kept aside damaged / written off
  (red when anything is written off).
- **Putaway now asks first**: ConfirmDialog restating each SKU → shelf and
  that the units become sellable.

### Shared pieces touched

- `SerialScanner` (`components/ui/serial-scanner.tsx`): tokens-only restyle
  of the box, count, notice and chips; the input element, Enter capture,
  trimming, de-duplication notice, `n / required` count and the
  `text-critical` over-count class are unchanged.
- `BarcodeCamera` / `CameraScanButton` (`components/barcode-camera.tsx`):
  the new Dialog and Button; lazy zxing import, stop-on-read, stop-on-close
  and the hidden-without-camera rule unchanged.
- `WarehouseFormPanel` (rendered on /warehouse/bins): Dialog with u33
  fields (Code and Name required-marked, Name shows its 120 counter), u05
  selects and the u03 checkbox.

## Motion coverage — admin, warehouse records + inventory (area AB2)

Pages: `/warehouse/bins`, `/warehouse/bins/[binId]`, `/warehouse/consignments`,
`/warehouse/consignments/[id]`, `/warehouse/manifests`, `/warehouse/manifests/[id]`,
`/warehouse/pickups`, `/inventory` (redirect), `/inventory/adjustments`,
`/inventory/cycle-counts`, `/inventory/movements`, `/inventory/transfers`,
`/inventory-units`.

Shared kit: `apps/admin/src/app/(authed)/inventory/_components/stock-kit.tsx` +
`stock-kit.css` (`stk-` classes, tokens only). Area CSS: `warehouse/bins/_components/bins.css`,
`warehouse/consignments/[id]/_components/consignment.css`, `inventory-units/_components/units.css`.

| Pattern | Where used | n/a — reason |
|---|---|---|
| Rolling-label AsyncButton | Bins: Add bin, Create zone, tracking Confirm, Move the whole bin, Apply N line(s). Consignment: Print labels, Ask for approval, Send to India, Send on without counting, Cancel and return the goods. Manifest: Close manifest, Confirm handoff, Move shipment. Pickups: Request pickup, Free the day. Adjustments: Raise adjustment, Approve — this moves stock, Confirm reject. Cycle counts: Schedule, Start counting, Complete — …, Record line. Transfers: Transfer stock. | Label-reprint row buttons (Approve / Print these labels) are small row buttons that open a ConfirmDialog, whose own confirm shows the busy state. |
| Liquid-bead Tabs | — | No page in this area had tabs. |
| Skeletons | Every list and detail load (SkeletonRows sized to the table's columns; Skeleton blocks for the unit KPI row). | — |
| u27 EmptyState | Bins overview, bin detail ("This bin is empty"), consignments, manifests, manifest shipments, pickups, adjustments, cycle counts, counted lines, movements, serial units. **Positive tone**: adjustments "Nothing waiting" (PENDING filter), serial units "No serialized stock anywhere". | — |
| Toasts | Pickups, manifests, move shipment, new adjustment: app `useToast`. Bins, bin ops, consignment panel, label reprint requests: **legacy `useToast` kept** — `bin-contents.test.tsx` and `scan-consignment-serials.test.tsx` mount these with only the legacy `<Toaster>` (the shell mounts both). | — |
| KpiCard count-up | Adjustments (rows shown, awaiting approval; value at stake as a `<Money>` figure), cycle counts (counts shown, in progress, discrepancies), serial units (needs attention, sellers affected; report time as a figure). | Bins / consignments / manifests / pickups / movements / transfers have no headline tiles. |
| u17 Timeline | Consignment event history ("Timeline" panel). | Unit trace history stays a dense table (When / Moved / Gate / Parcel / Note) — five columns of ledger data. Movements is a ledger, stays a DataTable. |
| u34 Stepper | Consignment journey: wizard-mode header, `navigable="none"`, current step derived from the journey (announced → BD intake → labelling → dispatch → arrival). The numbered stops below it (`steps.tsx`) carry the same done/current/todo state on their nodes. | Presentation only; no step is clickable. |
| ParachuteProgress | Bulk bin transfer ("Apply N line(s)") while the request runs (indeterminate — the API reports no progress). | — |
| SegmentedCode | — | There is no bin-collapse screen in apps/admin (the emailed six-digit code). `bin-ops-panel.tsx` records it as deliberately not built there; nothing else in this area takes a code. |
| PaperPlaneSendButton | — | No ticket replies in this area (and admin's reply stays quiet). |
| ConfirmDialog | Delete a bin; move whole bin; consignment dispatch (counted and unopened); label reprint approve / reject / print; stock transfer; manifest close / confirm handoff (moved to the app ConfirmDialog). | Label reprint REQUEST ("Ask for approval") — see the report: `scan-consignment-serials.test.tsx` requires the click to POST directly. |
| Hover-only rows | DataTable everywhere; `onActivate` rows (consignments, manifests, manifest shipments, serial triage) keep their navigation / toggle. | No per-row animation. |

Scanner / keyboard fields kept byte-identical in behaviour: unit trace serial (raw `<input>`, Enter
→ trace, placeholder "Scan or type", no id), consignment "Serials to reprint" and "Why" (raw
`<input>`, `aria-label`s unchanged, no Enter handler), consignment "Units of {sku} leaving" (raw
`type=number min=0 max=left`), cycle-count `cc-variant` / `cc-qty` (`type=number min=0`) /
`cc-bin` / `cc-batch` / `cc-notes` (same ids, no Enter handler), bin-ops line inputs (raw, same
`aria-label`s). Only colour/border changes; nothing animates on a scan field.

Print: `label-sheet.tsx`'s `<style>` block and label grid are unchanged; only the on-screen chrome
(title, "Send to printer", "Done") moved to the app Button.

## Motion coverage — admin area AC (people and configuration)

Routes: `/sellers`, `/sellers/[id]`, `/stores`, `/reseller-stores`,
`/reseller-stores/[storeId]`, `/reseller-stores/analysis`, `/leads`, `/staff`,
`/roles`, `/account`, `/settings`, `/notifications`,
`/notifications/broadcasts`, `/notifications/settings`.

Shared pieces: `(authed)/settings/_components/ac-parts.tsx` + `ac.css`
(page column, section / card, description list, alert, callout, fact pill,
reveal field, `SellerStatusChip`, `phaseOf`). Tokens only.

| Pattern | Where used | n/a (reason) |
|---|---|---|
| Rolling-label AsyncButton | Every async submit: invite seller, reveal bank account, save short code, apply identity correction, place / lift a hold, credit-after-confirmation switch, set override, link account, save weight, open a reseller store, pause a store, show older ledger rows, store add / rename, lead save / send invite / resend, staff invite, role save, account "send a new link", system setting save, broadcast count + send | Plain row actions that only toggle (pause/activate link, make default, close/reopen, mark read, reset override) stay plain buttons — their result is the row changing |
| Liquid-bead Tabs | `/leads` status tabs (replaced the hand-made button row; counts as tab badges) | No other page in the area has tabs |
| Skeletons | Every list and detail loading state (replaced `LoadingState`) | — |
| EmptyState (u27) | All empty lists; **positive** tone for "No store is over a threshold", "No open disputes", empty notification inbox | — |
| Toasts (app `useToast`) | Results across the area | Three components keep the legacy `useToast` because their tests mount only the legacy `<Toaster>`: `seller-courier-links-section`, `bulk-dequeue-panel`, `role-editor` (the shell mounts both, so users see the same toast) |
| KpiCard | Store wallet (balance, manager, negative limit, waiting), reseller analysis (open / settled disputes with count-up; float totals as `<Money>` figures) | Not a dashboard elsewhere in the area |
| Timeline (u17) | Reseller store status history | Terms history stays a table (versions, not a journey) |
| Stepper (u34) | — | No multi-step flow in the area |
| ParachuteProgress | — | No bulk/import/backfill here; bulk dequeue is one request with no progress to report |
| SegmentedCode | — | No six-digit code in the area |
| PaperPlaneSendButton | — | Admin quiet set (APPS-INVENTORY §4): broadcast send keeps the rolling-label button |
| Status chips | Seller status, reseller store status, lead status, invitation status, override source, link state, store open/default, fraud severity, ticket status, broadcast status, setting value type | — |
| DataTable | Every table (the two raw staff tables moved onto it) | Settings and notifications are lists, not tables |
| Pagination (u16) | `/sellers`, `/leads` | Other lists are unpaged or cursor-paged ("Show older", "Older") |
| MotionSwitch | `/account` → "This browser" card | — |
| Switch (u08) | Credit after confirmation; per-topic notification settings | Other booleans are checkboxes where a test or a form expects a checkbox |
| Row hover | Tables and list rows (hover background only, no per-row animation) | — |

Confirm dialogs (ConfirmDialog, restating entity + consequence): suspend /
reapprove seller, delete seller invitation, unlink courier account, close a
seller's call queue, delete role, sign out everywhere (all existed as modals
and moved); **new**: staff role change (the select now opens a confirm
instead of firing the PATCH), deactivate staff member and revoke staff
invitation (were inline Confirm / Cancel buttons), clear all notifications.
Pause store keeps its critical dialog with the reason field (ConfirmDialog
cannot disable its confirm, which the permission gate needs). No
`window.confirm` / `window.prompt` existed in the area.

Reduced motion: handled by the primitives; nothing here animates on its own
except the disclosure chevron (transform, collapsed by the global rule).

## Admin restyle — area AD "Money 1" (sellers' money): motion coverage

Shared pieces: `seller-wallets/_components/money-kit.css` (prefix `mk-`, tokens only,
every grid `minmax(0, …)`) and `money-parts.tsx` (MkCard, MkSection, MkCallout, MkAlert,
MkDl, WithdrawalChip, TopupChip, FreightChip). Every figure is still the original
`<Money>` / `<Num>` with its original props.

| Pattern | Where used | n/a (why) |
|---|---|---|
| Rolling-label AsyncButton | top-up credit/reject; bank change approve/reject; withdrawal resolve; move-seller-cash; allocate / record payout; wallet transfer Preview; freight record, waive, void, cost only, pay forwarder; store top-up credit/reject, store withdrawal approve/reject/pay | Remittance and FX override submit through a native `<form>` (the button stays a submit `Button` with `loading`, so Enter-to-submit and native validation are unchanged) |
| Liquid-bead Tabs | seller wallets filter (All / In credit / In debt / Pending payout, with counts); seller wallet detail (Ledger / Top-ups / Withdrawal requests — replaced the `aria-current` buttons) | — |
| Skeletons | every list and the wallet KPI rows | — |
| EmptyState (u27) | every empty list; `positive` tone for empty queues (top-ups pending, withdrawals pending, bank changes, nothing overdue, store queues) | — |
| Toasts (app `useToast`) | withdrawals, resolve, remittances, settlements, bank changes, freight, FX, seller wallets | top-ups, reseller store wallets keep the legacy `useToast` (their tests mount only the legacy Toaster) |
| KpiCard | seller wallets (4 money tiles, `<Money>` as figure, taka as secondary, footer word), wallet detail (4), withdrawals (3), settlements (3), freight (3) | No count-up anywhere: these are money screens and queues, not dashboards |
| ConfirmDialog | re-check ledgers; approve withdrawal; record remittance; post wallet transfer; settle freight bill | — |
| ParachuteProgress | re-check ledgers (while running); reading a courier remittance file | — |
| Timeline / Stepper | — | No event history or multi-step flow in this area (FX "Timeline" is a rate table) |
| SegmentedCode / PaperPlane | — | No six-digit code; no ticket reply |
| Pagination (u16) | withdrawals | Other lists are unpaginated today |

## Motion coverage — admin area AE (Money 2: our money and reports)

Pages: `/treasury`, `/bank-accounts`, `/bank-accounts/history`, `/liabilities`,
`/liabilities/instant-pay`, `/pnl`, `/pnl/carry-forward`, `/expenses`,
`/expenses/categories`, `/courier-wallet`, `/margin`, `/pricing`, `/reports`.

Shared area pieces: `treasury/_components/money-parts.tsx` + `money.css`
(prefix `mo-`: soft section cards, fact lists, notices, `AgeChip`, form grids,
radio cards). Per-folder CSS: `treasury.css` (`tr-`), `bank-accounts.css` (`ba-`),
`bank-account-history.css` (`bh-`), `liabilities.css` (`li-`), `pnl.css` (`pl-`),
`expenses.css` (`ex-`), `courier-wallet.css` (`cw-`), `margin.css` (`mg-`),
`pricing.css` (`pr-`), `reports.css` (`rp-`). Tokens only; every grid uses
minmax columns.

### Area-wide n/a

| Pattern | Why not here |
|---|---|
| Van drive-off | No order creation in this area. |
| Paper-plane send | No ticket reply in this area. |
| SegmentedCode | No six-digit code in this area. |
| Stepper (u34) | No multi-step flow; money forms are form → confirm, which ConfirmDialog carries. |
| Timeline (u17) | The only history lists (P&L locked versions, bank-account changes) are dense comparison tables with per-row actions or diff columns; kept as DataTable. |
| Per-row table animation | Forbidden. Rows get hover only. |

### /treasury

| Pattern | Where |
|---|---|
| PageHeader | Title, subtitle, "Move money" primary action (permission-gated as before) |
| KpiCard | Owed to sellers, held for sellers, surplus/shortfall, in courier wallets (links out), total per currency — figure is the existing `<Money>` |
| DataTable | Accounts (expandable holder breakdown), recent movements |
| Skeleton / EmptyState / ErrorState | KPI + row skeletons; bare EmptyState in both tables; ErrorState + retry |
| StatusChip | Opening balance (confirmed), Phase 1B (draft) |
| Notice | Shortfall explanation (bad tone, icon) |
| ConfirmDialog | NEW review step for transfer, owner money, reconcile (same request, same idempotency key) |
| Dialog + AsyncButton | Mark as opening balance (replaces `window.prompt`; same reason, same request) |
| Toasts | n/a: none before; outcomes shown by the dialog closing |

### /bank-accounts

| Pattern | Where |
|---|---|
| PageHeader + section card | Change history link, Add account |
| DataTable | Accounts; account number / IFSC / routing in `sk-ident` |
| StatusChip | Offered / hidden |
| Skeleton / EmptyState / ErrorState | SkeletonRows; EmptyState ("cannot top up at all"); ErrorState + retry |
| Dialog + AsyncButton | Add / edit account form |
| ConfirmDialog | Retire (NEW, destructive) |
| Toasts (app `useToast`) | Added, updated, retired — same messages |

### /bank-accounts/history

| Pattern | Where |
|---|---|
| BackLink + PageHeader, Notice | Back link; "Recording began on 7 September 2026" |
| DataTable, StatusChip | When / What / Changed / By; Added / Edited / Retired |
| Skeleton / EmptyState / ErrorState | yes |
| Confirms, toasts, KPI | n/a: read-only audit list |

### /liabilities

| Pattern | Where |
|---|---|
| PageHeader | Title and subtitle |
| KpiCard | We owe, Owed to us, Net position (`<Money>` figures) |
| Notice | "The two sides do not cancel"; notes under "Sellers in the red" |
| DataTable | We owe / Owed to us lines (instant-pay drill-down kept); sellers in the red |
| StatusChip | Covered by stock / Uncovered |
| Skeleton / ErrorState | yes, with retry |
| Toasts, confirms | n/a: read-only |

### /liabilities/instant-pay

| Pattern | Where |
|---|---|
| PageHeader | Back link "What we owe" as a ghost button |
| KpiCard | COD awaiting courier, cash fronted, credited (`<Money>` figures) |
| FilterBar + Select | Seller, courier account (same state and query params) |
| DataTable + SortableTh | Oldest first, unchanged |
| AgeChip | Age column (neutral: no severity rule existed) |
| Skeleton / ErrorState / TableEmpty | Empty copy + "See courier payouts" unchanged (pinned) |
| Toasts | n/a: read-only; the test mounts it without the app ToastProvider |

### /pnl

| Pattern | Where |
|---|---|
| PageHeader | "Carry-forward P&L" link |
| DateField | From / To (IST window arithmetic untouched) |
| KpiCard | Gross margin, Operating expenses, Net |
| Accordion (u19) | Every P&L line, one open at a time; drill-down mounted and fetched only while open |
| DataTable | Rows behind a line |
| Notice / Skeleton / ErrorState | Warnings; skeletons; ErrorState + retry |
| Toasts, confirms, ParachuteProgress | n/a: read-only |

### /pnl/carry-forward

| Pattern | Where |
|---|---|
| Select, KpiCard, StatusChip | Month picker; own net, carried-in, net incl. carry-forwards; Provisional / Locked permanently |
| Accordion (u19) | Month lines, carried-forward groups (drill-downs mounted only while open) |
| DataTable | Locked versions, frozen/live rows, carried changes, backfill preview/result |
| Dialog (critical, locked while running) + AsyncButton | Close month, lock permanently, god-mode re-lock (justification ≥30, risk checkbox, typed month) |
| ConfirmDialog | Backfill close (entity, month count, consequence) |
| ParachuteProgress | Backfill real close (indeterminate, running/done/failed from the real request) |
| EmptyState | "Nothing carried forward" (neutral), "None yet" (positive) |
| Toasts | n/a: none before |

### /expenses

| Pattern | Where |
|---|---|
| Liquid-bead Tabs | Spending / Investments (replaces local `TabButton`; same values and state) |
| DataTable, StatusChip | Ledger; investments; Uncategorised / Out / Closed |
| Dialog + ConfirmDialog | Record expense / pay forwarder, place capital, record return (form then NEW confirm); attach to consignment (ConfirmDialog with search) |
| Skeleton / EmptyState / ErrorState | yes, with retry |
| Toasts (app `useToast`) | Expense, attribution, capital placed, return, attach |
| KPI | n/a: no summary figures |

### /expenses/categories

| Pattern | Where |
|---|---|
| DataTable, StatusChip, Checkbox | Code in `sk-ident`; Active / Retired; show retired |
| Dialog + AsyncButton | New / edit category |
| ConfirmDialog | Retire (destructive) / restore |
| Toasts | Added, saved, retired, restored |

### /courier-wallet

| Pattern | Where |
|---|---|
| KpiCard | Held at couriers (`<Money>`); count-up on unbooked recharges and paid-never-arrived |
| DataTable, StatusChip | Never-arrived payments, wallets, recharges; match state (same words) |
| Dialog | Record bank side (restates amount/account/date — it is the confirm), explain (critical, 20-char gate) |
| ConfirmDialog | NEW: record a wallet top-up (wallet, amount, paid-from, date, reference; same idempotency key) |
| AsyncButton, toasts | Record payment, record explanation; results toasted |

### /margin

| Pattern | Where |
|---|---|
| KpiCard | Billed, courier charged, margin (`<Money>`); loss-making lanes (count-up) |
| DataTable, StatusChip | Row → order unchanged; "Loss" chip |
| AsyncButton (controlled) | "Quote against the rate card" follows the live query |
| Skeleton / EmptyState / ErrorState | yes |

### /pricing

| Pattern | Where |
|---|---|
| TextField / Select, AsyncButton | Preview form (ids `pp-*` unchanged); Calculate; backfill Preview buttons |
| ConfirmDialog | NEW before "Add the missing charges"; "Charge them" moved to the app ConfirmDialog |
| ParachuteProgress | Both real runs (indeterminate; done/failed from the real result) |
| Toasts, Notice, DataTable | Backfill results; engine fallbacks; the charge |

### /reports

| Pattern | Where |
|---|---|
| DateField | From / To (ids `reports-from`, `reports-to`; same value/onChange) |
| KpiCard | Seven order counts (count-up); rates, averages, wallet `<Money>` figures |
| Skeleton / ErrorState | yes, with retry |
| Toasts, confirms | n/a: read-only |

## Motion coverage — admin area AF (couriers, system, tickets, dashboard)

Pattern → where it is used, or n/a with the reason. Shared area pieces live in
`apps/admin/src/app/(authed)/system/_components/af-parts.tsx` + `af.css`
(section, soft card, notice, meta chip, fact list, transform-only meter,
queue card, message bubbles).

| Pattern | Where | n/a reason |
|---|---|---|
| Rolling-label AsyncButton | Escalation: Reconcile, Claim, Mark sent, Give back, Send confirmation code, Confirm (code); Threads: Queue reply, Save their reply; Templates: Make it live, Not worth one; Tickets: Apply (detail); System issues: I'm on it; Delhivery: Run a cycle now, Look up; Shiprocket: Check (reachability); Cost sync: Check bills now; unused ticket courier panel: Start, I have sent this | Buttons whose handler never rejects (register/update pickup, portal login, create/edit account, resolve issue) keep `Button loading` so a refusal is never shown as "done" |
| Liquid-bead Tabs | `courier-escalation/_components/escalation-tabs.tsx` (route tabs, same four hrefs, `aria-current="page"`) | — |
| Skeletons | Every list/table load (tickets, escalation queue/threads/patterns/runs/categories, cost sync, Shiprocket, Delhivery status, capacity, system issues, webhooks, courier accounts, master switches, dashboard tiles) | — |
| EmptyState (positive) | No open tickets, Nothing waiting (send queue), Nothing unmatched (patterns), Nothing needs you (system issues) | Neutral where the empty list is not good news (no conversations, worker has not run, no accounts, no webhook deliveries) |
| Toasts (app `useToast`) | All pages except those below | Legacy `useToast` kept in `admin-ticket-conversation`, `store-dispute-settle`, `templates-index` — their tests mount them under the legacy Toaster only |
| KpiCard count-up | Dashboard attention counts (Odometer), Orders created, Dispatched; tickets Matching / Auto-raised; escalation Today counts; portal Shadow runs / Failed; system issues Open / Nobody on it / Urgent; capacity Orders 30d; Shiprocket Final bills that disagree | Rates, "x / y" coverage and money are passed as `figure` (Money nodes unchanged) and do not roll |
| u17 Timeline | n/a | Ticket history is a status log with free-text notes and no step states; rendered as a ruled list |
| u34 Stepper | n/a | No multi-step flow in this area (mode change is request → code, shown as two states) |
| ParachuteProgress | n/a | No bulk/import progress with a known total (wallet import and runs are single requests) |
| SegmentedCode | Escalation write-mode six-digit confirmation | — |
| PaperPlaneSendButton | Admin ticket reply ("Reply to seller") — the plane flies only after the reply request resolves; a refusal rejects and shows "Not sent" | — |
| ConfirmDialog | Ticket refund on transition; store dispute settle (moved to app dialog); escalation pause/resume; portal Go LIVE; courier master on/off (replaces `window.prompt`, same reason field); account deactivate / make default; waybill pool refill; Delhivery and Shiprocket browser runs (cost sync, wallet sync, invoice check, website access); Notify unannounced; webhook retry | Stopping the portal (back to SHADOW / OFF) stays one click — the off switch must be faster than the thing it stops |
| Hover-only rows | DataTable rows, queue cards, dashboard attention cards (lift on hover) | No per-row entrance animation anywhere |
| Transform-only meters | Dashboard rates, Delhivery rate budget, capacity gauges (`scaleX`) | Capacity "unknown ceiling" is a static hatch |
