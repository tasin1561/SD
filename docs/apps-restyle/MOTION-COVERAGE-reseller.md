# Motion coverage — apps/reseller (Phase 4)

Pattern → where used, or n/a with the reason, per area. Merged from the four area notes.

## Motion coverage — apps/reseller, area RA (orders)

Every motion pattern on the store portal's orders pages (apps restyle,
Phase 4, 2026-09-24). Pattern names are the premium-ui-motion skill's
(`u01`–`u35`, storytelling 01/02/05/06). Guardrails that hold on every page:
storytelling only on an in-page async action; navigation is never delayed;
table rows animate on hover only (no per-row entrance); nothing re-animates on
a refetch; reduced motion ends every pattern in its correct state (handled once
in `@skydrop/ui/brand/app.css`, and by the van's own reduced-motion branch).

Layout and the area-only pieces: `apps/reseller/src/app/(authed)/orders/_components/orders.css`
(`ro-` classes, tokens only, every grid on `minmax(0, …)` columns) and
`orders-parts.tsx` (`RoSection`, `LinkButton`, `BackLink`, `Facts`, `Notice`,
`ConfirmSubject`).

Toasts: the reseller layout mounts only the LEGACY `<Toaster>`, so this area
keeps the legacy `useToast` (the app `useToast` throws outside its own
provider). The u32 toast arrives here the day the shell mounts `ToastProvider`.

- **`/orders`** — page header; "Upload a CSV" (u28 ghost sweep) and **"New order" with label-into-parcel** (the store's one primary CTA; hover/focus only, the link navigates at once); u04 filter bar (search field with its submit magnifier, status select, active count + reset); **u09 liquid-bead status tabs** (All + seven lifecycle statuses, the active URL status joins them); u07 data table with hover lift and accent bar, status chips (icon + word); u16 pagination; skeleton rows while loading; u27 empty state (package icon, next step "New order"); error state with retry.
- **`/orders/new`** — back link; **u34 stepper in sections mode** (Products · Customer · Payment) over the SAME single form, sticky, marks the section in view, click scrolls; u05 native select per product; **u12 number stepper** for quantity; u33 floating-label fields with hints; textarea counter for the notes (limit already enforced); sticky submit bar; **van drive-off as the BUSY state** on "Place order" (`mode="while-busy"`, controlled `state`): the confirm dialog closes at once, the van starts when the request is sent, the page navigates the moment the API succeeds, on a refusal the van reverses into the button which reads "Not placed" and the server's words appear above the bar; reduced motion = plain "Placing…" busy label. Confirm dialog (scale + fade) before the request. Skeleton / u27 empty / error states for the catalogue.
- **`/orders/[id]`** — back link; page header with the order status chip; customer and money fact cards; products table (hover rows); parcel row with shipment status chip; **the order journey as the u17 timeline** (filled connector, current step pulsing and paused off-screen, time chip per event, failed/returning tone, header with order id and status chip); cancel as a critical dialog restating the order and COD with a **rolling-label** confirm (idle → Sending… → result); call-cap panel (notice + the answer dialog); delivery actions and address correction: form dialog → **confirm dialog** → rolling-label buttons; courier consignee change: rolling-label "Ask the courier" → confirm dialog; held requests and change history tables with status chips; order money facts and wallet tables; skeletons and error-with-retry on every sub-query; u27 empty state for an empty timeline.
- **`/orders/call-reviews`** — page header with an "All orders" link button; two KPI cards (tone glow; figures are the existing `Num`, not rolled); data table with hover rows; the answer dialog (below); skeleton rows; positive u27 empty state ("Nothing waiting"); an info notice when the seller answers these.
- **`/orders/import`** — back link; **u15 drop zone** (lifts and tints on drag; real picker button); **rolling-label** "Upload and check", "Import N orders", "Download the template" and "Error report" (each wired to its real request state); **confirm dialog** before the import; **parachute progress** on the run this page started, driven by the uploads list's own 5 s refresh (indeterminate while PENDING, rows handled ÷ rows in file while PROCESSING, lands on done / folds red on FAILED or CANCELLED); uploads table with upload status chips; u16 pagination; skeleton; u27 empty state.
- **Call-cap answer (`components/call-review-decision.tsx`)** — dialog (scale + fade, bottom sheet on a phone) that turns critical with a warning chip on the destructive branch; **u10 choice cards** for the two answers; the consequence notice appears only on "Give up"; textarea with counter (limit already enforced) and a visual-only required mark; **rolling-label** commit button (idle → Sending… → result).

Not used here, and why: **paper-plane** (seller ticket reply only), **odometer**
(the two queue counts render through the existing `Num`), **success dialog**
(every act ends in a toast, as before), **u02 phone field** (the order form
takes the full `+91…` string in one box; the phone field splits off the dial
code, which would change the value sent).

## Motion coverage — apps/reseller, area RB (money and catalogue)

Every motion pattern used on the store portal's wallet, expenses, reports,
analysis, terms and catalogue pages (apps restyle, Phase 4, 2026-09-24).
Catalogue names are the premium-ui-motion skill's (`u01`–`u35`). The
guardrails that hold on every page here: storytelling only on an in-page
async action, navigation is never delayed, tables animate on hover only (no
per-row entrance animation), nothing re-animates on a refetch, and every
pattern ends in its correct state under reduced motion (handled once in
`@skydrop/ui/brand/app.css`).

Layout and the area-only pieces live in
`apps/reseller/src/app/(authed)/wallet/_components/rm.css` and
`rm-parts.tsx` (`rm-` classes, tokens only; every grid declares
`minmax(0, …)` columns so nothing sizes to its content at 320–390 px). The
other five pages import them from there.

Not used in this area, and why: **van drive-off** (order creation only),
**label-into-parcel** (the store's "New order" CTA is on the orders area),
**parachute progress** (nothing here uploads in bulk), **u34 stepper** (the
reseller top-up is one form, not a wizard — making it one would change the
flow), **odometer** on money (money is never rolled; only plain counts are),
**success dialog** (every act here ends in a toast, as before).

### Money is never re-formatted

Every figure is the existing `<Money>` node with the same props as before
(`size`, `convert`, `direction`); a KPI card takes it as `figure`, so the
card never formats it. Direction on the ledger is shown three ways: the
arrow chip (`RmDir`, ArrowDownLeft / ArrowUpRight), the sign and the colour
`<Money direction>` already carries — read from `isStoreWalletCredit`, the
one credit switch in `@skydrop/ui/status`.

### Wallet (`/wallet`)

- Page header; **KPI cards** (soft depth, tone glow): Balance (debit tone
  when below zero), You can withdraw, May go below zero by, and Waiting on
  Skydrop — the one plain count, rolled once by the **odometer**
  (formatted as the bare number it always was). Skeleton KPI tiles and rows
  while the summary loads; error state with retry.
- **Top up** card: icon chip header, u05 native select "Paid into", u33
  floating-label fields, the chosen account's details in a soft well
  (account number and IFSC in the identifier face), **u15 drop zone** for
  the receipt (it resets after a successful claim). Submit is a
  **rolling-label AsyncButton** bound to the real request (Tell Skydrop →
  Sending…). **New confirm dialog** (owner's rule): restates the account,
  the amount and, when given, the reference, and says nothing is credited
  until Skydrop sees the money — then sends the SAME request. The server's
  verdict shows verbatim in an alert under the form. Toast (u32) on success.
- **Withdraw** card: same field treatment; the existing confirm moved to
  the new `ConfirmDialog` (entity = payee · account, amount, bank and IFSC
  in the consequence). Rolling-label submit (Ask to withdraw → Asking…).
  Keeps the legacy toast hook — its test mounts only the legacy toaster.
- **Top-ups you told us about** / **Withdrawals you asked for**: u07 tables,
  hover lift only; withdrawal state is a **StatusChip** (icon + word,
  `withdrawalStatusKind` + `withdrawalStatusLabel(…, 'seller')`); top-up
  state is an icon + colour chip that shows the page's own words verbatim
  ("Waiting for Skydrop to see it" — `StatusChip` would lower-case
  "Skydrop"). "View receipt" is a ghost button with a full tap target.
  Skeleton rows, u27 empty states, error with retry.
- **Every movement**: u07 ledger with the direction chip; "Show older" is a
  rolling-label AsyncButton bound to the real next-page fetch.

### Expenses (`/expenses`)

- Page header; "Record an expense" form card with u05 select, u33 fields,
  a date field; rolling-label "Record" (Recording…). **New confirm dialog**
  restating category · date · what it was for, and the amount, and that it
  moves no money — then the same request; toasts unchanged.
- From / To date fields; skeleton rows; u27 empty state with an icon;
  table with a struck-through description for removed entries.
- Remove: the Dialog (critical tone, scale + fade, focus trap and return)
  with the required "Why" field; rolling-label destructive "Remove"
  (Removing…), disabled until a reason is typed, exactly as before.

### Reports (`/reports`)

- Header action is a button-styled link to Analysis (u28 sweep on hover;
  navigation is immediate). Position: seven **KPI cards** (credit tone for
  "You are owed", pending tone when the store owes its seller), skeleton
  tiles while loading.
- Period: u05 select plus date fields for a custom range.
- Revenue / Costs / Net KPI cards (net in credit or debit tone).
- **Profit and loss lines as a u19 accordion** (several may be open, as
  before): icon chip with the line's direction, the `<Money>` in the header,
  the entries table in the inset well.
- Expenses by category, money in and out (with arrows beside In / Out), and
  carried-in / carried-out tables; warnings as amber callouts with an icon
  (they were a colourless class before).

### Analysis (`/reports/analysis`)

- Header link back to Profit and loss; date fields.
- KPI cards: "Placed" is the one plain count (odometer, bare number);
  rates, ROAS and money are fixed figures. Tables in tabular figures;
  overdue credits carry a clock icon as well as the amber colour.
- "Nothing waiting to be credited" uses the positive empty state.

### Terms (`/terms`)

- The current terms are a **versioned card**: icon chip, "Version N", a
  StatusChip (Accepted / Not accepted yet — icon + word beside the sentence
  that already says it), the two blocks of plain-word terms as tick lists,
  the seller's note as a callout, the worked-example table. The
  needs-revision notice is a critical callout with an icon.
- "Accept version N" opens the new `ConfirmDialog` (entity: store ·
  version · seller; consequence: the existing sentence). Its confirm is
  busy while the real request runs; the error still shows verbatim on the
  card, as before.
- Every version: u07 table; u27 empty state.

### Catalogue (`/catalogue`)

- Table toolbar search (same label and placeholder, same client-side
  filter). The hidden columns (cost, real stock, set-asides, hidden share)
  are simply absent — the API never sends them.
- "You pay" carries a **u35 glossary tooltip card** for *transfer price*
  (the header keeps its own mobile card label). Product cell: thumbnail,
  title, SKU in the identifier face. Skeleton rows; u27 empty states (no
  products / no match) with icons.

## Motion coverage — apps/reseller, area RC (customers, tickets, notifications)

Every motion pattern used on the store portal's customers, tickets and
notifications pages (apps restyle, Phase 4, 2026-09-24). Catalogue names
are the premium-ui-motion skill's (`u01`–`u35`, storytelling controls by
name). The guardrails that hold on every page here: storytelling only on
an in-page async action (the ticket reply), navigation is never delayed,
tables animate on hover only (no per-row animation), nothing re-animates
on a refetch, and every pattern ends in its correct state under reduced
motion (handled once in `@skydrop/ui/brand/app.css`).

Not used in this area, and why: **van drive-off** (reserved for order
creation), **label-into-parcel** (the store's "New order" CTA lives on the
orders area), **u26 chat chrome** (a ticket thread is an asynchronous log,
not live chat), **odometer** on the notification-settings counts (they are
"n of m" strings, not single counts, so they render as a fixed figure).

### Customers

- **/customers**: page header; u07 data table with row hover lift only,
  the whole row still opens the customer; phone in the identifier face.
  The search is the toolbar's search box inside a form, so it still
  commits on Enter exactly as before (Name, phone or email). Skeleton rows
  while loading; u27 empty state (illustrated) for "No customers yet" /
  "Nobody matches"; error state with retry. u16 pagination (20 a page,
  unchanged).
- **/customers/[id]**: breadcrumb back to Customers; the record as a soft
  card of facts (phone and other phone in the identifier face, dates as
  tabular figures). "Edit details" opens the Dialog (scale + fade, focus
  trap and return) with u33 floating-label fields `cust-name`,
  `cust-email`, `cust-alt` (helper text under the last). "Save" is a
  rolling-label AsyncButton wired to the real PATCH (Saving… → Saved /
  Not saved); the server's verdict shows verbatim under the fields; the
  success toast (u32) is unchanged. Their orders: u07 table, StatusChip
  (icon + word) per order, `<Money>` unchanged, "Prepaid" unchanged;
  skeleton, u27 empty state, error with retry.

### Tickets

- **/tickets**: "Raise a ticket" is a primary button-styled link (u28
  sweep) — a plain navigation, nothing delays it. The stage filter is
  u09 liquid-bead tabs (All · Open · Being reviewed · Closed — the same
  words and values as the select it replaced). u07 table, hover lift
  only, TK- number in the identifier face, StatusChip per ticket. Skeleton
  rows; u27 empty state — POSITIVE when nothing is filtered (nothing
  raised is good news), neutral when a stage is chosen — with "Go to your
  orders" as the next step.
- **/tickets/new**: the audience is u10 ChoiceCards (Your seller /
  Skydrop, each with its consequence underneath; Skydrop is absent when
  the seller switched it off, exactly as before). u33 fields for Order,
  What is wrong (its existing 200 cap now drawn as a counter) and Tell us
  more (its existing 4000 cap drawn as a counter). The figure correction
  is the u03 Checkbox, revealing How much (u33) and Who owes it (u05
  native select). The submit is a CONTROLLED rolling-label AsyncButton:
  busy exactly while the caller's mutation runs (`pending`), and "Not
  raised" on the control after a refusal, whose verdict shows verbatim in
  the alert. Its accessible name is the destination ("Raise it with your
  seller" / "Raise it with Skydrop" / "Send it to your seller to approve").
  No confirm (opening a ticket is an ordinary action).
- **/tickets/[id]**: breadcrumb back to Tickets; StatusChip in the header.
  A settled outcome is a green card with a soft glow; the figures card
  keeps the snapshot wording. The conversation is a thread of bubbles
  (the store's own on the right in the accent tint). The reply box is a
  u33 TextArea with a display-only counter `n / 2000` (the server's note
  limit); the field's own 4000 cap is unchanged. **"Send" is the
  PaperPlaneSendButton**: busy while the real reply runs, the plane folds
  and flies only after a real success (a green pill beside the button
  under reduced motion), a shake and "Not sent" on a refusal with the
  verdict in the alert. Toast "Reply sent." unchanged.

### Notifications

- **/notifications**: header actions — "Mark all read" and "Clear all"
  each open a ConfirmDialog first (new, owner 2026-09-24), restating how
  many it touches and the consequence; Clear all is destructive (red).
  "Settings" is a ghost button-styled link. The filter is the toolbar
  search box ("Filter what is loaded…", unchanged reach). The kind tabs are
  u09 liquid-bead tabs with counts (All + each group present); "Unread
  only" is the u03 Checkbox. Rows: a kind-coloured edge and icon chip,
  unread tint and a "New" pill, hover tint only; opening a row expands its
  text in place (and marks it read, unchanged). "Mark unread" is a
  rolling-label AsyncButton on the real request. "Clear from my list"
  opens a destructive ConfirmDialog (new — once cleared it cannot be
  brought back from here). Skeleton rows; u27 empty state, positive when
  the inbox is empty. "Load earlier" appends, unchanged.
- **/notifications/settings**: breadcrumb back to Notifications. The
  three counts are KPI cards with a glow by meaning (reaching you: green,
  store-wide: blue, always sent: amber). Each section is a soft card with
  an icon chip. Every toggle is the u08 switch with On / Off in the track
  (state spelled out, not colour alone), saving instantly as before;
  locked rows keep the server's reason beside a lock icon. The
  store-wide half stays cosmetically gated inside the ungated page
  (NOTIF-11 / FE-2), unchanged. Skeleton rows while topics and
  categories load.

## MOTION-COVERAGE — apps/reseller, dashboard + setup + sign-in (area RD)

Every motion pattern on the reseller store portal's dashboard, setup pages
(team, integrations, store settings, my account), the two shell notices
(terms banner, role boundary) and the signed-out forms (apps restyle,
Phase 4, 2026-09-24). Catalogue names are the premium-ui-motion skill's.
Guardrails that hold on every page: navigation is never delayed, no
per-row table animation (hover only), nothing re-animates on a refetch,
every async button is wired to the REAL request, and every pattern ends in
its correct state under reduced motion — the OS setting OR the per-person
"Reduce motion" switch on /account (localStorage `sd-motion` only), both
handled by the one path in `@skydrop/ui/brand/app.css`.

Area stylesheets: `(authed)/settings/_components/rd.css` (shared by the
setup pages and the two notices), `(authed)/dashboard/_components/rd-dashboard.css`,
`login/_components/rd-auth.css` (the signed-out forms). All `rd-` prefixed,
tokens only, every grid declares `minmax(0, 1fr)` or explicit columns.

Not used here, and why: **van drive-off** — the brief reserves it for
order creation, which is another area's screen; **odometer count-up** — the
dashboard's three figures are MONEY (`<Money>`, byte-identical strings), not
plain counts, so they never roll; **paper-plane** — no reply box here.

### Dashboard (`/dashboard`)

- **Label-into-parcel** on the page's one primary CTA, "New order" (header
  action, shown only with `orders.create`, the same permission as the
  shortcut card): flaps open and the label drops in on hover/focus, ≤ 350 ms,
  the link navigates at once.
- **KPI cards** (glow by meaning): Wallet balance (neutral), You are owed
  (credit, green), You owe your seller (pending/amber when not `0.00`, else
  neutral — the old warn/neutral rule). Each figure is the unchanged
  `<Money amount size="lg">`; a shimmer skeleton while the position loads;
  on error the tiles are hidden, exactly as before.
- **Shortcut cards**: icon chip fills with the accent, the card lifts 2 px
  and "Go →" steps right on hover (and on keyboard focus). No entrance.
- **Paused-store callout** (icon + words, amber) and the store card with a
  **StatusChip** (icon + word) for the store's status.

### Setup

- **/team**: u07 data table (hover lift only, mobile cards); StatusChip-free
  (roles are words); u27 empty states; skeleton rows while loading; toasts
  (u32). **Role change now CONFIRMS**: the select opens a ConfirmDialog
  restating the person, their current role, the new role and the
  consequence; only Confirm sends the same PATCH (the select keeps showing
  the current role until the change lands). Remove and Withdraw keep their
  confirms, now the new ConfirmDialog (entity + consequence, busy and locked
  while the request runs). The invite dialog (scale + fade, focus trapped)
  has u33 floating-label fields and a rolling-label "Send invitation".
- **/integrations**: u33 fields with counters where a limit already existed
  (key name 80, webhook name 160, description 2000 — all already enforced).
  **Creating an API key now CONFIRMS** (restates the key's name, how long it
  works and that it is shown once). The one-time secret is a reveal card
  (accent tint, key chip, mono value, Copy → toast). Key state is a
  StatusChip (Live / Expired / Revoked + date). Webhook "On" is the u08
  switch with On/Off in the track; **toggling it now CONFIRMS** (restates the
  endpoint and what switching it on/off does) and only Confirm sends the same
  PATCH. New secret / Remove / Revoke keep their confirms on the new dialog.
  Event picker = u03 checkboxes whose tick draws in. Rolling-label buttons on
  Create key, Add webhook and the edit dialog's Save.
- **/settings** (store-wide, gated): u33 fields, rolling-label "Save", the
  logo chooser styled as a secondary button over the real file input,
  destructive ConfirmDialog for "Remove logo", toasts.
- **/account** (every store user): rolling-label "Send a confirmation link",
  destructive ConfirmDialog for "Sign out everywhere", and the **"This
  browser" card with the MotionSwitch** ("Reduce motion", u08 switch,
  localStorage only). It lives here rather than /settings because /settings
  is store-wide and needs `store.profile.view`.
- **Terms banner** (every signed-in page): a callout with an icon — info
  (no terms yet) or critical (unaccepted / needs revision). Static; it is a
  condition, not an event.
- **Role boundary**: u27 empty state (the parcel under a sweeping magnifier,
  paused off-screen) with one action, "Go to the dashboard".

### Signed-out (`/login`, `/password-reset`, `/auth/*`)

All inside the shared `AuthFrame` (SignInFrame + SignInCard — map after
first paint, card rise, theme switch); only the forms changed.

- u33 floating-label fields with icon chips; `PasswordField` show/hide
  toggle ("Show password").
- **u13 password strength** on the two set-a-password forms
  (`/auth/reset-password`, `/auth/accept-invitation`): one chip, "At least
  10 characters", DISPLAY ONLY — the rule both pages already state in words;
  nothing is refused client-side, the server's verdict still decides.
- Rolling-label AsyncButton (controlled by the real request) on Sign in,
  Send the link, Set password, Join the store, Confirm my email. "Sign in"
  keeps that accessible name throughout (the login spec finds it by name).
- Notices (refusal = red with an icon, `role=alert`; done = green,
  `role=status`) replace the bare coloured paragraphs; the texts are
  unchanged.
- Accept-invitation: a three-block shimmer skeleton while the preview loads,
  then the invitation's facts in a tinted box before the fields.
