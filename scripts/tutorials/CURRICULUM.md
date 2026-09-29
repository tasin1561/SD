# The tutorial library

Every screen in `apps/seller` and `apps/admin`, sorted into tutorials, in the
order a person meets them. Derived from the code — the 47 seller pages under
`apps/seller/src/app/(authed)/`, the 84 admin pages under
`apps/admin/src/app/(authed)/`, both `page-access.ts` tables, and the flows the
components actually perform — not from the sidebar and not from memory.

**90 tutorials.** 18 filmed. Of the 72 left, **16 are `ready` today**, 54 need
demo data that does not exist yet, and 2 are `impractical locally`. 29 touch
something dangerous. Sections A–G are the seller app, H–P the admin app; the
pages deliberately left unfilmed are listed at the end, each with a reason.

**Ninety is a large number and it is meant to be read as one.** It is what
"every kind of task in both apps" actually comes to, and seeing it written down
is the point of this document. Do not commit to the whole thing — see
[the recommendation](#the-recommendation).

Read ["What this costs"](#what-this-costs) before committing to the whole thing.

**A third app is out of scope, and somebody should decide whether it stays
that way.** `apps/reseller` — the portal a reseller store's own staff sign into
at `reseller.skydrop.online` — has **23 gated pages** of its own (orders,
catalogue, wallet, tickets, reports, expenses, team, terms, integrations). This
curriculum covers the seller and admin apps, as asked. But section G teaches a
seller how to set a store up, and the people who then have to USE it get
nothing: the videos here are addressed to the seller who owns the stock, never
to the shopkeeper selling it. If reseller stores become a real channel, that is
a third section and roughly another fifteen tutorials.

---

## Where to pick up

**Filmed so far (18):** A1–A6, B1, B2, C3, C4, C5, E1, E3, E4, F1, F2, F3, F5.
Every one is listed in its own entry below with what it covers and what its
seeding does.

**Next, in order, and all `ready`:**

1. **G1, G2 — reseller stores and the price they pay.** Everything needed is
   surveyed in G1's entry below: a seller-created store lands ACTIVE at once
   (only an admin-created one is PENDING), `reseller.orders_enabled` gates
   ORDER PLACEMENT and not store creation, and all of contact email, contact
   phone and a first-user invitation are required on create.
2. **C6 — uploading a catalogue.** Needs a products CSV fixture, which does not
   exist. An hour's work, then a 4-minute video.

**Then build D0** (below) — the lifecycle seeding. It is still the single
highest-leverage thing in this document: it unblocks 20+ entries in D, E and K
and most of the admin side.

### What a following agent needs to know that is not obvious

- **Run `record.mjs --check <slug>` TWICE before spending a credit**, with
  `seed-demo-data.mjs <slug>` in between. The seed IS the between-takes step, so
  running it between the two checks is what proves the take is repeatable. Three
  videos in this library have needed a seeding fix found exactly this way.
- **A flow step that cannot find its target must THROW, never skip.** The roles
  video passed `--check` twice while saving a role with no permissions, because
  its step skipped quietly on a selector miss. Check mode only tests what the
  steps assert.
- **`TUT_CHECK_SHOTS=1 node scripts/tutorials/record.mjs --check <slug>` writes
  the end of every scene to `out/verify/<slug>-check/`.** Check mode proves a
  step was REACHED, never that the frame showed what the narration says about
  it — the photos video passed twice while rendering two of its three pictures
  broken, because a broken `<img>` is still a visible `<img>`. Look at the
  shots before spending a credit.
- **Sign-in is throttled 5 per 15 minutes and a video costs three.** Run
  `lib/clear-login-throttle.mjs` (local Redis counters; `make-tutorials.sh` does
  it automatically). Do NOT wait it out by retrying — a refused attempt writes a
  fresh `blocked` TTL and pushes the window further out.
- **Never pipe the seed through `grep`.** It reports failure on stderr and via
  exit code, and a pipe takes the exit status from grep — a cleanup written
  against the wrong Prisma model looked like it had worked.
- **Keep hard numbers out of narration** wherever the screen prints them. This
  document said "41 permissions" when there are 35; in a doc that is a small
  thing, in a voice clip it is a re-take nobody notices is needed.
- **A scene must open on the thing it is about.** Put a dialog dismissal in the
  PREVIOUS scene's tail, or the frame check shows the next scene opening on a
  closing modal.

---

## How to read an entry

- **Promise** — what the viewer can do afterwards. If it cannot be written as
  one sentence, the tutorial is two tutorials.
- **Length** — 2–4 minutes, which is 10–16 narrated scenes at the 8–15 s per
  line the pipeline enforces. Anything wanting eight minutes is split.
- **Needs** — the world the camera has to find. This is the field that decides
  whether a tutorial gets made, so it names rows, not moods.
- **Feasibility** — `ready` (today's seed, or no seed at all), `needs demo
data` (a seeding step that does not exist yet, described), `impractical
locally` (something outside this machine is required).

### What "locally" can and cannot reach

This was measured this session, not assumed.

**The whole parcel lifecycle is reachable.** `apps/delhivery-sim` is a fake
Delhivery speaking the real wire API; with `courier.delhivery_api_base_url`
pointed at it (the local database already is) the REAL adapter runs — booking,
labels, tracking webhooks, NDR, RTO. `scripts/sim-e2e.ts` drives an order from
placed to DELIVERED and a second one to RTO_RESTOCKED, and asserts stock is
conserved on each. **That script was broken in four places and is fixed** (see
[Bugs found](#bugs-found-while-establishing-feasibility)); it now passes, which
is what makes sections D, E and K filmable at all.

So: confirmed, picked, packed, dispatched, in transit, out for delivery,
delivered, failed delivery, returned, restocked, and the wallet and ticket
consequences of each — all reachable by seeding.

**What is not.** A real payment landing in a real bank. A courier's own web
portal (the browser-driven cost-sync and invoice-check runs sign in to
Delhivery). Shiprocket, which is stubbed and inactive locally. Anything whose
interest is months of accumulated history.

---

# SELLER APP

## A — Day one: before you can sell anything

A brand-new seller, signed in for the first time, with the dashboard's setup
checklist still showing. Film these against a fresh account, in this order:
the checklist is the tutorial index, and it disappears as they are completed.

### A1. Finding your way around · **FILMED** — `find-your-way-around.mp4`

**Promise** — you can find any screen, and you know what the five sidebar
sections are for.
**Length** 2 min 14 s. **Prerequisites** none.
**Needs** a seller with a handful of orders so the dashboard is not all empty
states — `seed-demo-data.mjs find-your-way-around` places four.
**Covers** the five collapsible sidebar groups (Selling, Stock, Money,
Reselling, Account), the header order search, the quick-actions menu, the
notification bell — the only control that survives on a phone — and the bottom
status strip. One pass, no clicks that change anything.
**Note:** an earlier draft of this entry said the groups carry ordinals
(01–05). The seller shell still passes them and **the `Shell` component ignores
them** ("Accepted and ignored: no index numbers"), so the narration describes
what is on screen instead. Worth remembering as the shape of a curriculum
mistake: a prop that is still being passed is not a thing a viewer can see.

### A2. Your company profile · **FILMED** — `set-up-your-profile.mp4`

**Promise** — Skydrop knows who you are, and your logo is on your customers'
tracking page.
**Length** 1 min 50 s. **Prerequisites** A1.
**Needs** nothing beyond the standard seed, which also clears any pending bank
change — with one open, the save dialog asks a different question and the take
would not match its own narration.
**Note:** filmed as **nine scenes, not eleven**, and both cuts are worth
knowing about. The voice budget ran out on the closing summary, so the video
ends on the bank-details save — which is the most important sentence in it
anyway. The other cut was a correction: a scene narrated "and a SWIFT code if
you have one" while the form on screen said "All six fields are needed
together", so the line went rather than ship a tutorial the page argues with.
The fields are still all typed on camera. Restoring either is one entry in
`narration.mjs` and one re-run, and the SWIFT one must be re-written before it
is re-recorded.
**Covers** the three independently-editable sections, and why they are
separate: company info, the logo (presign → register, removal asks first), and
bank details — where the lesson is that **editing an account already on file
goes to Skydrop for approval**, because that is where your money is sent.

### A3. Your first product · **FILMED** — `add-a-product-with-variations.mp4`

Covers `/products/new`: the shared weight and declared value, options as axes
rather than a tree, the four variants multiplied out, and the SKU being
permanent once saved.

### A4. Announcing your first consignment · **FILMED** — `announce-a-consignment.mp4`

**Promise** — you have told Skydrop stock is coming, and you chose the route
that decides what you are billed.
**Length** ~2 min 30 s (12 scenes). **Prerequisites** A3.
**Needs** products, **and a Bangladesh intake warehouse**. That second one was
not obvious and is the reason this entry said `ready` when it was not:
`ops.bd_intake_warehouse_id` is seeded EMPTY on purpose (CNS-2) and a Via-Dhaka
declaration is refused rather than quietly routed to India — so the more
interesting half of the form could not be filmed at all. `seed-demo-data.mjs`
now provisions one (`fulfilsOrders: false`, which the resolver re-checks).
**Status:** FILMED (2026-09-30). 12 scenes, 2 min 11 s.
**Covers** the question the whole page turns on — **Dhaka or India?** Send it
to Dhaka and Skydrop moves it across the border and bills the freight; send it
to India and you did that yourself and owe nothing. Then the contents, picked
with the variant picker, with expected quantity and optional unit cost (and
what an absent unit cost costs you later on the inventory valuation). Ends on
the register and on correcting a declaration while it is still PENDING.

### A5. The shopfronts you sell under · **FILMED** — `add-a-shopfront.mp4`

Covers `/settings/stores`: create, close, reopen and make default — each asking
first, and each confirmation filmed for what it restates. The load-bearing
sentence is the one the page itself leads with: a store decides **only which
brand an order belongs to**. Products, stock, wallet and couriers are shared.
"Store" is a word that invites the opposite assumption, which is why the video
dwells on the page saying so in its own words rather than only narrating it.

Rename is the one action not filmed — it is the same dialog as create, and a
scene whose only content is re-opening a form already shown earns nothing.

**Its seeding is the interesting part.** The take adds "Dhaka Boutique" and ends
with it as the default, so a second take would open on a register that already
has it, fail the add on a duplicate name, and film a store the narration calls
"not the default" while it is. `clearTutorialSettings` removes it and puts the
original store back as default — moving the flag BEFORE the delete, because the
partial unique index allows exactly one default per seller and deleting the
default first would leave order create with nothing to pre-select.

### A6. The delivery fee your customer pays · **FILMED** — `set-your-delivery-fee.mp4`

Covers the distinction the field exists to draw: this is what **your customer**
pays for delivery, added to the collectable amount. It is not what Skydrop
charges you to move the parcel — that is on `/wallet/limits`. The video opens
on the badge rather than the field, because an inherited default and a number
you chose look identical in the box, and closes on the badge flipping to "Your
own figure" — which is the proof the save landed and the only visible
difference the page makes.

The seed clears the seller's override before every take, or the second one
films a page that already says "Your own figure" while the narration is
explaining what "Skydrop default" means.

---

## B — The everyday job: orders

### B1. Placing an order by hand · **FILMED** — `place-an-order.mp4`

Covers `/orders/new` end to end: recipient, the landmark on line two, the PIN
doing the routing, your own reference, the call-centre note, products, quantity,
cash on delivery, and submission into the call queue.

### B2. Uploading a day's orders from a spreadsheet · **FILMED** — `upload-bulk-orders.mp4`

Covers `/orders/import`: the template, the check before importing, rows versus
orders, the row that will not import, the job, and the two rows that became one
order with two lines.

### B3. Fixing the rows that would not import · `needs demo data`

**Promise** — every row of your spreadsheet becomes an order, including the
ones the check refused.
**Length** 3 min. **Prerequisites** B2 — this is its direct sequel.
**Needs** a CSV import that produced failed rows. The fixture the bulk video
already uploads produces exactly one, so the seeding is: **run the B2 import
and stop**. Cheapest new demo data in the library.
**Covers** `/orders/pending`, which the nav never links — the only way in is
the "N pending" button on `/orders`, which appears only when the count is
non-zero, and that is worth showing rather than explaining. Then the per-row
address form (the band number is the spreadsheet's own row number), "Import
this row", and discarding one you do not want.

### B4. Finding an order · `ready`

**Promise** — you can find any order by any handle you have, and send someone
a link to what you are looking at.
**Length** 3 min. **Prerequisites** B1.
**Needs** orders spread across several statuses, so the chips and tiles have
something in them. Today's seed leaves them all PENDING_CONFIRMATION; the
lifecycle seeding described in D0 fixes that and this tutorial should be filmed
after it.
**Covers** the search box, the "Placed when" presets, the status chips with
their counts, the four tiles — and the thing that makes the page worth three
minutes: **the URL is the state**, so a filtered list is a link you can send
and the back button works.

### B5. Reading an order · `needs demo data`

**Promise** — you can tell where a parcel is and what it has cost you, from
the order page alone.
**Length** 4 min. **Prerequisites** B4.
**Needs** one DELIVERED order with charges. Seeded by D0.
**Covers** `/orders/[id]` as a **reading** exercise before any of the buttons:
the recipient block and why it never changes once placed, the items, the
charges breakdown, and the journey. Every action on this page gets its own
tutorial below — this one is the map of it.

### B6. Changing an order before it is confirmed · `needs demo data`

**Promise** — you can correct anything about an order until the call centre
confirms it, and you know when that window shuts.
**Length** 3 min. **Prerequisites** B5.
**Needs** an order in DRAFT or PENDING_CONFIRMATION. Today's seed produces
these; the Edit button does not render on anything further along, so this
tutorial is unfilmable against a confirmed order.
**Covers** `/orders/[id]/edit` — lines, quantities, prices, customer — then
"Save changes" versus "Save and submit", and discarding a draft behind its
typed confirmation. The window is the lesson: after confirmation stock is held
and a waybill is booked, and the contents stop being editable.

### B7. Cancelling an order · `needs demo data`

**Promise** — you can call an order off, and you know what it costs at each
stage.
**Length** 3 min. **Prerequisites** B5.
**Needs** two orders: one PENDING_CONFIRMATION and one CONFIRMED with a
waybill. Seeded by D0.
**Covers** the Cancel action, its reason, and the sentence the seller actually
needs: cancelling before confirmation releases nothing because nothing was
held; cancelling after it returns the stock and leaves a live waybill for
Skydrop to close with the courier. Worth saying that the button disappears once
the parcel is with the courier, and what to do instead (D4).

---

## C — Stock

### C1. Following a consignment from Dhaka to the shelf · `needs demo data`

**Promise** — you can tell where your goods are and why two counts exist.
**Length** 4 min. **Prerequisites** A4.
**Needs** a consignment part-way along: declared, counted in Dhaka, dispatched,
and arrived in India. The local database has exactly one consignment, so this
needs seeding — two legs with their own counts, deliberately disagreeing by one
unit so the page has something to explain.
**Covers** `/inbound/[id]`: the timeline labelled by what each step **means**
rather than by status, the declared-versus-counted table at each stop, and the
freight section. The disagreement between the two counts is the whole reason
there are two counts, and it is the thing to narrate.

### C2. Reading your stock · `needs demo data`

**Promise** — you can tell what is sellable today from what is merely yours.
**Length** 3 min. **Prerequisites** C1.
**Needs** received stock (today's seed has it) plus one consignment in transit,
so the in-transit column is not zero. Comes with C1's seeding.
**Covers** `/inventory` and its three separate numbers: India stock, reserved,
available. Then the column that is never added to the others — **in transit** —
and why: goods between Dhaka and Bangalore are in neither building and cannot
be sold. Ends on value at cost and the honest "uncovered" count for batches
that have no unit cost recorded, which is the consequence of skipping that
field back in A4.

### C3. Keeping a product up to date · **FILMED** — `keep-a-product-up-to-date.mp4`

**Promise** — you can change anything about a product except the things that
must never change.
**Length** 2 min 42 s. **Prerequisites** A3.
**Covers** `/products/[id]`: the four default tiles and what inheriting means,
inline edit (the box dimensions, which is where volumetric weight gets
explained), adding a variant to a product that already exists, then
`/products/[id]/variants/[variantId]` — the SKU greyed out with its reason,
and a weight override that beats the inherited one.

**The sentence that earns the tutorial is the last one.** Archiving a product
CASCADES to its variants (`CatalogProductService.archive` updates them in the
same transaction); restoring does NOT (`unarchive` audits the note "variants
left as-is"). So a seller who archives and then restores has a live product
whose every SKU is still archived — and the dialog says so in one line nobody
reads. The video archives and restores on camera so that line is read out.

**Seeding:** the shared catalogue puts weight and value on the VARIANT, so
every product's own defaults were null and the tiles read "Not set" — which
would have made the third scene's whole subject absent. `resetCatalogueEdits`
sets them on this one product, clears the box dimensions the video fills in,
deletes the `RSH-MUSLIN-INDIGO` size it adds, and un-archives everything.

**It runs BEFORE the catalogue loop, and that ordering is load-bearing:** a
goods receipt against an archived variant is refused, so a take left archived
would fail the next run's stock top-up rather than the video.

### C4. Product photos · **FILMED** — `add-product-photos.mp4`

**Promise** — your products have pictures, in the app and on the picking sheet.
**Length** 2 min 20 s. **Prerequisites** C3.
**Covers** the presign → upload → register sequence as the seller sees it, one
file and then two at once, which picture stands for the rest, and removing one.
`needsSpacesShim: true` on the flow.

**FILMING FOUND A REAL BUG, and it is the reason to keep taking check-mode
screenshots.** `SellerVariantImageView` in `packages/api-client` declared four
fields the API has never returned — `displayUrl`, `thumbnailSpacesKey`,
`contentType`, `sortOrder` against the API's `url`, `mimeType` and
`displayOrder`. The gallery renders `thumbnailUrl ?? displayUrl`, so until the
thumbnail worker caught up the `src` was `undefined` and the seller was shown a
BROKEN IMAGE — on every freshly uploaded picture, and permanently if that job
ever failed. Nothing failed loudly: the upload succeeded, the row existed, only
the frame was wrong. Fixed by naming the fields the API actually sends and
reading `thumbnailUrl ?? url`; the corrected type then caught a second one,
`sizeBytes` being nullable and rendering as "0 KB".

**It passed `--check` twice while showing it**, because a broken `<img>` is
still a visible `<img>`. `TUT_CHECK_SHOTS=1` was added to `record.mjs` for
exactly this: it writes the end of every scene to
`out/verify/<slug>-check/`, which is the cheapest way to look before spending
a credit. **Use it on every new flow.**

**A gap worth a decision, NOT a bug:** the seller cannot choose which picture
stands for the rest. Ordering is `isPrimary desc, displayOrder asc, createdAt
asc`; the UI sends neither of the first two and there is no update endpoint at
all (`presign`, `register`, `list`, `delete` is the whole surface), so the
earliest registered picture wins — and within one drop the uploads race, so
"earliest" is only decidable when a file is dropped on its own. The video says
so out loud and tells the seller to upload the good shot first, which is the
honest advice while it stays this way.

**Seeding:** `clearVariantPhotos` hard-deletes the rows and removes the whole
per-variant directory from mock storage. A soft delete would keep every take's
files on disk for ever, and the first two scenes are an empty drop zone.
Fixtures: three drawn fabric swatches (procedural, nobody owns them), visibly
different from each other so a gallery of three does not read as one picture
copied.

### C5. Being told before you run out · **FILMED** — `be-told-before-you-run-out.mp4`

Covers the account default on `/settings/stock` and the per-SKU override on the
variant page, which beats it. The sentence that earns the tutorial is the one
the page makes explicitly, and the video dwells on the page making it: **blank
and zero are different**. Zero warns you only at genuinely empty; blank never
warns you at all.

Filmed ahead of C3 and C4, which it nominally depends on — the dependency is
"has seen a product page", and the seeded catalogue supplies that without C3
having been made.

The seed clears BOTH thresholds (the seller's default and every per-SKU
override) before each take. Null is not tidiness here, it is the state being
filmed: `StockAlertService` resolves `variant.lowStockThreshold ??
seller.defaultLowStockThreshold ?? null` and returns SKIPPED_NO_THRESHOLD on
null, which is exactly what the "Off — nothing alerts by default" badge means
and exactly what a new seller has.

### C6. Uploading a catalogue from a spreadsheet · `ready`

**Promise** — you can load hundreds of products at once, and you never have to
rename your own column headers again.
**Length** 4 min. **Prerequisites** A3, and B2 for the shape.
**Needs** a products CSV fixture, which does not exist yet — one file, the
same commitment the bulk-orders fixture already is.
**Covers** `/products/import`, which is a **different importer with different
columns** from the order import, and then the feature no tutorial touches:
**saved column mappings**. Teach it once and the seller never renames a header
again. Ends on the history at `/products/import/jobs` and the error report.

---

## D — When something goes wrong

This is the section the lifecycle seeding exists for. Film D0's seeding once
and every tutorial here becomes `ready`.

### D0. (not a tutorial) The lifecycle seeding

`scripts/tutorials/seed-demo-data.mjs` grows a `--lifecycle` pass that drives
the demo seller's orders through the simulator to the states below, exactly as
`scripts/sim-e2e.ts` does — call confirmation, pick, the pack bench, the
handover scan, then simulator advances. One command, re-runnable, local-only.

| State wanted                    | How                                               | Used by        |
| ------------------------------- | ------------------------------------------------- | -------------- |
| DELIVERED                       | advance IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED | B5, D1, E2, D6 |
| DELIVERY_FAILED                 | … → NDR                                           | D1, D2         |
| RTO_IN_TRANSIT                  | NDR → RTO_INITIATED → RTO_IN_TRANSIT              | D1, D3         |
| RTO_RESTOCKED + a damage ticket | receive + inspect at the warehouse                | D6, E2         |
| AWAITING_SELLER_DECISION        | record attempts to the cap (see note below)       | D5             |
| CONFIRMED with a live waybill   | stop after confirmation                           | B7, D4         |

**One state needs checking before its seeding is written.**
`AWAITING_SELLER_DECISION` is the R5b pause at the call cap, and it happens only
when `inventory.early_reservation_ndr_action` is `MANUAL_REVIEW` — which it
already is by default. But `inventory.early_reservation_enabled` is seeded
`false`, and whether `handleNdrCap` still raises a review with holds switched
off is a question for the code rather than for this document. (CLAUDE.md says it
raises one "even with ZERO holds", which suggests yes; that sentence is about
holds, not about the switch.) Settle it before writing D0's last row, because
D5 is unfilmable if the answer is no.

### D1. Where is my parcel · `needs demo data`

**Promise** — you can answer a customer asking where their parcel is, without
ringing anyone.
**Length** 3 min. **Prerequisites** B5. **Needs** D0.
**Covers** `/tracking`: every parcel carrying a waybill, the search, the three
tiles (on the move / delivery failed / coming back), and the row expanding in
place to show the scan history. Entirely read-only, and that is worth saying —
there is no button here because there is nothing the seller can make the
courier do from this screen.

### D2. The customer was not there · `needs demo data`

**Promise** — you know what happens after a failed delivery and what you can
ask for.
**Length** 3 min. **Prerequisites** D1. **Needs** D0's DELIVERY_FAILED order.
**Covers** the order page's "Ask admin to act" dialog — the three things a
seller may ask for and what each costs. The honest framing matters: a
re-attempt **sends a van**, which is why it is a request rather than a button.

### D3. What needs you today · `needs demo data`

**Promise** — you can open one screen in the morning and know what is waiting
on you.
**Length** 3 min. **Prerequisites** D1. **Needs** D0.
**Covers** `/needs-attention` and its two lists, which are two different jobs:
orders the call centre could not confirm (**you owe a decision**) and parcels
out for delivery three nights or more (**you are waiting on a courier**). The
page has no buttons at all and says why: the seller cannot make a courier
deliver, and offering an action there would be theatre.

### D4. Asking for a parcel back · `needs demo data`

**Promise** — you can turn a parcel round, and you know the fee before you do.
**Length** 2 min. **Prerequisites** D1. **Needs** D0's CONFIRMED-with-waybill
and DELIVERED orders.
**Covers** the seller's own "send it back" on an in-flight parcel — **the one
customer-facing action that calls the courier directly, with no operator in the
loop** (CUR-10's seller amendment) — and, separately, "Request return" on a
delivered one. Both charge a return fee; the tutorial says the figure.

### D5. The customer would not answer · `needs demo data`

**Promise** — you can decide what happens to an order our agents could not
confirm.
**Length** 3 min. **Prerequisites** D3. **Needs** D0's
AWAITING_SELLER_DECISION order.
**Covers** `/holds` ("Unreachable customers"): how many calls were made, the
two choices — **let it go**, which rejects the order and returns any held units,
behind its own second confirmation, and **keep trying**, which puts it back in
the call queue. Worth noting the held-units figure is zero unless the seller
has opted into at-placement holds.

### D6. Something arrived damaged · `needs demo data`

**Promise** — you can follow a damage claim from the warehouse finding it to
the refund landing in your wallet.
**Length** 4 min. **Prerequisites** B5. **Needs** D0's damage ticket, resolved
with a refund.
**Covers** both halves of `/tickets`: the ticket **Skydrop raised** when a
returned parcel was inspected, and one the **seller raises** with "Raise an
issue". Then `/tickets/[id]` — the conversation, and the resolution leading
with the money and linking through to where it now sits in the wallet.

---

## E — Money

### E1. Paying money in · **FILMED** — `pay-money-in.mp4`

Covers the three-step top-up wizard: the bank accounts in full, the amount **in
that bank's currency** with the rupee equivalent beside it, and the reference.
The sentence that has to land is said twice, by the page and by the narration:
**a top-up is a claim, not a payment.** The last frame is the proof — the
Top-ups tab carrying one pending row while the balance still reads ₹0.00 and
"No activity yet".

It picks the **taka** account deliberately. An INR account shows no conversion,
so the "rupee equivalent underneath" the narration points at would be the same
number printed twice.

**The receipt drop zone is pointed at, not used.** A transaction reference or a
receipt satisfies the requirement, and uploading would mean inventing a bank
document to put on camera. The narration says the two are alternatives, which is
what the page says too.

The seed removes PENDING claims before each take — ACCEPTED ones are left, since
a wallet entry sits behind them and the ledger is append-only, so deleting the
claim would leave a credit with nothing explaining it.

### E2. Reading your wallet · `needs demo data`

**Promise** — you can tell what you have from what you have merely asked for.
**Length** 3 min. **Prerequisites** E1. **Needs** D0 (a delivered order and a
resolved refund put real entries in the ledger) plus one pending top-up.
**Covers** the three tabs and why they are three: **Ledger** is what happened;
**Top-ups** and **Withdrawal requests** are what was asked for and has not
landed. Then the entries themselves — delivery charges, COD credit, a refund —
and the balance shown in both rupees and taka.

### E3. Taking money out · **FILMED** — `take-money-out.mp4`

**Promise** — you can request a payout, and set one to happen by itself.
**Length** 2 min 30 s. **Prerequisites** E2.
**Covers** requesting a withdrawal — again **a request, not a movement**, which
the video proves by going back to the Ledger tab afterwards and showing it
unchanged — and then the schedule on `/wallet/limits`: the automatic switch,
the hour in the seller's own timezone, and the balance to keep. All three
changes are confirmed separately and the video reads each restatement out
rather than clicking past it.

**Seeding — and it is slug-tailored in BOTH directions, which is the
interesting part.** E1 films a transfer being DECLARED and closes on "your
ledger has not moved"; E3 needs a balance, which only exists because somebody
accepted a top-up. Each video's world is the other's contradiction, so
`walletWorldFor(slug, …)` builds one and dismantles the other: for
`take-money-out` it puts the bank details back (the profile video's clearing
takes them off, and a withdrawal is refused without them —
`NO_BANK_ACCOUNT_ON_FILE`) and tops the wallet to a floor through the REAL
claim-and-accept endpoints; for `pay-money-in` it removes the accepted claim
AND its ledger row together, so no credit is ever left with nothing explaining
it. **It refuses to touch a wallet carrying anything that is not a top-up** —
on a dev box an order charge means somebody was using this seller for
something, and rewriting a money ledger to tidy a video would be the worst
thing in that file.

It also clears the three `wallet.auto_withdraw_*` overrides between takes: the
switch being OFF is what makes the confirm dialog say "Turn ON", and a second
take starting from on would film the opposite sentence. Withdrawal REQUESTS are
deleted outright, which is safe precisely because of the rule the video teaches
— a request moves no money.

**The narration names no hour and no figure the screen prints.** An earlier
draft said "ten in the morning" while the flow selected 09:00.

### E4. What Skydrop charges · **FILMED** — `what-skydrop-charges.mp4`

Covers the withdrawal rules, when COD reaches you, what is deducted from it,
and what moving a parcel costs. The framing is narrated as well as shown: the
page deliberately has no stat tiles because every number on it is a
**threshold, not a position**, and a tile would put a rule where the console
puts a balance.

Filmed ahead of E2, which it nominally depends on — every figure is a platform
term rather than account activity, so it needs no wallet history. One of the
very few pages filmable on a blank account.

**Its flow points at rules by LABEL, never by position** (`dwellOnTerms`). The
list is whatever `GET /seller/wallet/settings` returns, so a scene aimed at
"the fourth row" would keep working and start describing a different rule the
day one is added upstream — the quietest way a tutorial goes wrong. A rule
removed upstream is skipped rather than failing the take.

### E5. What the freight cost · `needs demo data`

**Promise** — you understand why a freight bill is only partly owed.
**Length** 3 min. **Prerequisites** C1, E2.
**Needs** a consignment received **and billed**, with some of its units having
shipped. Comes with C1's seeding plus a freight bill.
**Covers** `/freight` and the one idea it exists to teach: a bill is spread
**per unit**, and a unit owes its share only when it leaves. Stock still on the
shelf owes nothing yet. Read-only, because freight is billed by Skydrop and
settled from the wallet.

---

## F — Your team, and your account

### F1. Inviting someone · **FILMED** — `invite-a-colleague.mp4`

**Promise** — a colleague can sign in, with only the access you meant to give.
**Length** 2 min 10 s. **Prerequisites** A1.
**Covers** `/team`: the invite modal, the link revealed **once**, resending
(which issues a NEW link and kills the one already sent — the video says so,
because a seller who resends without reading will wonder why the first link
stopped working), revoking, and changing somebody's role through the confirm
that restates who moves from what to what. Ends on the two things the page
refuses to let you do to yourself, and on deactivation leaving history alone.

**The narration says the invite dropdown offers only the six roles every account
begins with, and that a role you BUILT is given after somebody joins.** That is
true and worth saying: `CreateTeamInvitationDto.role` is the `SellerUserRole`
enum, `sellerRoleIdForEnum` maps it onto one of the six seeded `seller_roles`
rows, and a custom role has no enum value to be invited under. F2 teaches that
roles are data you invent; without this sentence a seller looks for their own
role in that box and does not find it.

**Seeding:** the demo seller is ONE person, and that person is `You` — the row
with a chip instead of a role select and no Deactivate button, which is exactly
the row a video about changing somebody's role cannot use.
`ensureTeamColleague` adds Shahidul Islam through the REAL invite-and-accept
path rather than inserting a `seller_users` row, because the enum→role mapping
is what makes the row one the product could have made. It also puts his role
back (the confirm dialog restates "moves from Inventory to…", so a second take
starting on Operations would read backwards) and hard-deletes the invitation
written on camera — the table lists revoked ones too, so a soft delete would
grow it by a row per take.

**One thing to fix before this is published.** The invitation link on screen
reads `http://localhost:3001/auth/accept-team-invitation?token=…` — the API
builds it from `SELLER_APP_URL` in `apps/api/.env`, which is a local default
pointing at a port nothing listens on. It is the only place in the library
where a viewer reads a localhost URL. Set that variable to the real seller host,
restart the API, and re-run this ONE video (about 800 credits).

### F2. Building a role · **FILMED** — `build-a-role.mp4`

Covers `/team/roles` — roles are **data**, so "Warehouse manager" is a thing you
invent, not a thing we ship. The permissions across seven groups (Orders,
Catalogue, Inventory, Money, Reseller stores, Support, Company), each with its
own sentence; the search that also matches the raw key, because somebody reading
a refusal knows `catalog.manage` and nothing else; and saving a role that
**loses** permissions asking first and naming exactly which ones go. Ends on the
owner row being inert, and why: it is the way back in from any mistake made on
this screen.

Sensitive permissions are marked and counted, and the count is of what is
SELECTED, so it moves as you tick. (The two apps name the flag differently:
`sensitive` on the seller catalogue, `dangerous` on the staff one. Neither is
enforced differently; both exist so a role that quietly acquired six says so
before it is saved.)

**This entry said "41 permissions" and "17 of the 41". The live catalogue has
35, of which 17 are sensitive** — the first number went stale and nothing
noticed, which is exactly what the narration must not be allowed to do. So the
narration names NO counts: it points at the figures the page prints, which are
computed from the catalogue and cannot go stale. **Keep hard numbers out of
narration wherever the screen already shows them** — a wrong number in a voice
clip costs a re-take and is invisible until somebody listens.

Two flow bugs worth recording, both found by `--check` before a credit was
spent. The permission switches carry `aria-checked`, not `data-state`, so the
first attempt waited thirty seconds for a selector that cannot exist; and
re-opening the editor draws every group CLOSED, so the switch to untick sat
behind a collapsed panel and Playwright kept clicking the accordion header
covering it. **The third is the one worth generalising:** the first `pick` step
skipped quietly when its selector missed, so it passed `--check` twice while
saving a role with no permissions at all — a video whose whole middle is
choosing permissions, filming a form where none were chosen. It now throws. A
step that cannot do its job must say so, or check mode is only testing that the
browser opened.

### F3. Sign-in and sessions · **FILMED** — `sign-out-everywhere.mp4`

Covers `/settings/security`: the single destructive action, for a laptop left at
a desk or a phone sold. Says out loud that there is **no session list**, because
the API exposes no such read and a table here would be invented — an absence, so
the scene points at the "This session" heading and lets the narration carry it.
Also what the action does NOT do: the password is unchanged and API keys keep
working, which is the half people assume the other way round.

The last scene lands on the server's own count, which on the demo account reads
**"no active sessions to revoke"** — the zero branch the component was
deliberately written for ("Zero is reported as zero rather than dressed up as
success"). The narration is written to that: _it tells you what the server
actually did, rather than simply claiming success._ A seeded second session
would make the number bigger and the lesson smaller.

**Its last scene must stay last.** The confirm click ends the session the
recording is running in, so anything after it is filmed signed out. The click
sits in the PREVIOUS scene's tail, so the final scene opens on the result rather
than on a dialog dismissing.

### F4. What Skydrop tells you, and how to quieten it · `ready`

**Promise** — you get the notifications you want and none of the ones you do
not.
**Length** 3 min. **Prerequisites** A1.
**Needs** notification rows for the inbox half; D0 supplies them. The settings
half is filmable cold — the topic catalogue is static.
**Covers** `/notifications` (read, unread, dismiss, the category tabs) and then
the two grains on `/notifications/settings`, which is the whole point of the
page: **your own** per-topic silences, and **your company's** per-category email
preferences. These were two screens and people changed the wrong one. Also:
switches with no Save button, because each flip is a request.

### F5. Letting another system place your orders · **FILMED** — `keys-and-webhooks.mp4`

**Promise** — your own software can create orders and be told when they move.
**Length** 2 min 47 s. **Prerequisites** B1.
**Covers** `/settings/api-keys` — issue, the plaintext shown **once**, the
prefix and last-used that survive it, revoke, and revoked beside expired so the
two words are seen to mean different things — and then `/settings/webhooks`:
an https endpoint, the signing secret, rotating it with the old one live for a
day, and **auto-disabled**, which is the state a seller meets at three in the
morning and understands least.

**FILMING FOUND A DEAD END AND IT IS FIXED.** Auto-disable sets `isActive =
false` AND stamps `autoDisabledAt`; the delivery listener selects on `isActive:
true AND autoDisabledAt: null`; and `SellerWebhookService.update` wrote
`isActive` alone. So a seller who fixed their end and switched the endpoint
back on got a switch reading "on", a chip still reading "Auto-disabled", and
no events, for ever — nothing in the codebase ever cleared that column. The
only way out was to delete the endpoint and add it again, which issues a new
secret they then have to redeploy. `StoreWebhookService.update` had done it
right since the day it was written, with a comment saying why; the two callers
share this table, this dispatcher and this listener, and only one of them was
correct. `webhook-re-enable-clears-auto-disable.spec.ts` now pins BOTH.

The video's fourteenth scene is that switch clearing the chip, and it waits on
the chip rather than on the switch — before the fix, waiting on the switch
would have passed while filming the bug.

**Three stale "Phase 1B" claims went with it.** The page subtitle told sellers
"the delivery worker will fire once it ships in Phase 1B" long after
`SellerWebhookDeliveryModule` was registered and sending real signed POSTs.

**Seeding:** an API key cannot be deleted through the product at all (create,
list, revoke is the whole controller), so a take left behind piles up a revoked
row per run. `integrationsWorldFor` removes both, seeds an EXPIRED key so the
scene about the two dead states has both on screen rather than one and a
description of the other, and seeds the auto-disabled endpoint — every column
written the way `OutboundWebhookDispatchService` writes it, including its own
wording for the reason, because producing one honestly means fifty consecutive
failed deliveries.

**The URLs are `example.com` on purpose.** `assertPublicHttpsUrl` resolves a
webhook host and FAILS CLOSED on one that does not, so an invented domain is
refused at create.

**A gap left alone, deliberately:** the seller's subscribed-events box is free
text with no vocabulary check (`IsString({each:true})`, `ArrayUnique()`), while
the store's path runs `assertKnownEvents` against `WEBHOOK_EVENT_CATALOGUE`. A
typo saves cleanly and then matches nothing, silently. Validating the seller
path too is a two-line change — but it would refuse a save of any existing row
whose codes are outside the catalogue, which is a decision about live data
rather than a bug fix, and the better answer is probably the store's
checkboxes. The narration says "copy a code exactly as Skydrop writes it" and
claims nothing about the box being checked.

---

## G — Reselling

Seven tutorials, and the order matters more here than anywhere else: each one
is the prerequisite for the next being non-empty.

### G1. What a reseller store is · `ready`

**Promise** — you can open a store for someone who will sell your stock under
their own name.
**Length** 3 min. **Prerequisites** A1.
**Needs** nothing. Creating a store is filmable cold.
**Covers** `/reseller-stores`, creating one, inviting its first user, and the
frame for everything after: their own login on `reseller.skydrop.online`, your
stock, your warehouse, your courier, your money at risk.

### G2. The price they pay · `ready`

**Promise** — every store has a default transfer price and a retail range.
**Length** 3 min. **Prerequisites** A3 (products), G1.
**Needs** products only — this page does **not** need a store to exist, which
makes it filmable earlier than its position suggests.
**Covers** `/reseller-stores/price-list`: the per-unit price every store pays
unless it has one of its own, and the retail range it may sell inside.

### G3. What one store sells · `needs demo data`

**Promise** — you can decide which products a store sees, at what price, and
how much of your stock it may have.
**Length** 4 min. **Prerequisites** G2.
**Needs** a store plus priced products. Seedable in a few rows.
**Covers** the "Catalogue & stock" tab: enabling products, a price that
overrides the default, the overlay name and pictures the store shows its own
customers, and the two stock modes — **shared** versus a **set-aside**
quantity — with the hidden share. The moment worth filming is the real
availability shown beside what the store will actually see.

### G4. The deal · `needs demo data`

**Promise** — you can publish terms and see exactly who pays what.
**Length** 4 min. **Prerequisites** G3.
**Needs** a store with a catalogue.
**Covers** the "Terms" tab: the share of each Skydrop fee the store pays, each
party's credit timing, and the **live worked example the API computes as you
type**. Then publishing a version and the store having to accept it. Terms are
versioned and an order snapshots the version it was placed under — which is why
a later change never re-prices a placed order.

### G5. What a store may do without asking · `needs demo data`

**Promise** — you decide, per task, whether a store acts directly or needs your
approval.
**Length** 3 min. **Prerequisites** G4.
**Needs** a store.
**Covers** the "What they can do" matrix: seven tasks, each asked as two
questions — can they, and if so, directly or with your approval. Then the
consequences, which differ per task and are the reason this is not one switch:
a direct **send-back calls the courier on their click**; a direct re-attempt
opens a ticket for a person. This tutorial is also the setup for G6.

### G6. Answering what a store has asked · `needs demo data`

**Promise** — you can clear the queue of decisions stores are waiting on.
**Length** 3 min. **Prerequisites** G5.
**Needs** at least one task set to "needs my approval" **and** a store that has
raised something. The heaviest seeding in the section: a store user, a store
order, and a request against it.
**Covers** `/reseller-stores/requests` and its three families — cancels and
call questions and issues, delivery asks, and order and address changes —
approve (restating what approving will do) and reject (which requires a reason;
the store is told either way). The live badge count in the nav is the reason
the queue does not sit unread.

### G7. How your stores are doing · `needs demo data`

**Promise** — you can see which store makes you money and stop one that is
losing it.
**Length** 3 min. **Prerequisites** G6.
**Needs** stores with orders inside the window. Needs D0's lifecycle applied to
store orders.
**Covers** `/reseller-stores/reports`: scorecards over a date window, stores
ranked by what they made you, and every margin figure carrying **how many lines
it could price** rather than a bare number. Then the write hiding on a reports
page — the **auto-pause rule**, which pauses a store above a return rate — and
`/reseller-stores/stock-forecast`, days of stock left at the recent rate.

---

# ADMIN APP

A different audience and a different tone. Staff screens move real money,
dispatch real vans and permanently change records, and several are irreversible
by design. **Every admin tutorial touching one says what it costs to get wrong,
in the narration, before the click** — not as a disclaimer at the end.

The recorder needs one change first: it is hardcoded to the seller app's URL
and credentials. A flow needs to declare which app it drives, and the staff
sign-in needs to exist beside the seller one. Half a day; see
[What this costs](#what-this-costs).

## H — Your first day on the ops desk

### H1. The ops dashboard · `needs demo data`

**Promise** — you can open one screen and know what needs a person today.
**Length** 3 min. **Needs** D0, so the attention tiles are loud rather than
all-clear.
**Covers** `/dashboard`: the seven attention tiles, quiet at zero and loud
otherwise, over the work queues; then performance and money. Read-only.

### H2. Finding an order and reading its history · `needs demo data`

**Promise** — you can answer any question about one order from its page.
**Length** 4 min. **Prerequisites** H1. **Needs** D0.
**Covers** `/orders` with its Indian-day date filters, then `/orders/[id]` as
a **reading** exercise: the immutable recipient snapshot, the items, the full
admin timeline including internal-only events. Every button on this page is
taught later, and separately, and this tutorial says so.

### H3. Things the system has raised · `needs demo data`

**Promise** — you can work the system-issue queue and know which to act on
first.
**Length** 3 min. **Needs** seeded system issues at two severities; a failed
auto-pickup and a stalled tracking issue are the natural pair.
**Covers** `/system-issues`: severity with the word always on the chip, age,
acknowledge versus resolve, and the deep links that take you to the screen that
fixes the thing. "Notify unannounced" is shown and explained — it fans out real
notifications, which is why it asks first.

### H4. The permission model · `ready`

**Promise** — you understand why someone cannot see a screen, and you can fix
it safely.
**Length** 4 min. **Needs** nothing.
**Covers** `/roles` as the teaching hook for the whole model: permissions are
data, each one is a line of code that checks it, they are grouped with a
sentence each — because "Finalise a return" and "Hand parcels to the courier"
both sound like routine warehouse work and both permanently remove stock. **84
permissions across ten groups, 32 of them marked dangerous** — marked and
counted, though the server treats all of them identically; the marking exists so
that a role which quietly acquired six says so before it is saved. Ends on the
two things that keep this screen safe: the super-admin row is inert, and **the UI is never the
boundary** — hiding a button is courtesy, the server refuses regardless.

---

## I — The call centre

### I1. Taking calls · `needs demo data`

**Promise** — you can work the call queue from your first shift.
**Length** 4 min. **Needs** orders in PENDING_CONFIRMATION — today's seed has
159 — and the agent marked available. **Note:** an agent who has not switched
themselves on is refused by the server, which is the first thing that goes
wrong on a real first shift and belongs in the tutorial.
**Covers** `/call-center`: availability first, pull next, the recipient and
items, the customer-risk strip for repeat customers, picking an outcome and
recording it, and releasing a call. The consequence to state: recording
**confirmed holds stock**, and every attempt is permanent and counts toward the
cap.

### I2. Supervising the queue · `needs demo data`

**Promise** — you can see what is waiting, who holds it, and move it.
**Length** 3 min. **Prerequisites** I1. **Needs** an assigned entry.
**Covers** `/call-center/queue`: reassign, reschedule, and `/call-center/agents`
— who is on, how many calls each holds, and the capacity bump.

### I3. Forcing an outcome on a stuck call · `needs demo data` · **dangerous**

**Promise** — you can close a call nobody can complete, and you know exactly
what it writes.
**Length** 3 min. **Prerequisites** I2.
**Covers** the force-outcome panel — and what makes it dangerous is precisely
that it is **not** a special case: it runs through the same service an agent
does, so the attempt lands in the append-only ledger **under the supervisor's
id**, moves the order by the ordinary mapping, counts toward the NDR cap, and
reserves stock if the outcome is confirmed. It cannot be undone or edited.
**Cost of getting it wrong:** a permanent record that a call happened when it
did not, and possibly stock held against an order nobody confirmed.

### I4. Sellers asking us to call again · `needs demo data`

**Promise** — you can decide a re-attempt request.
**Length** 2 min. **Needs** a rejected order with a seller request against it.
**Covers** `/reattempt-requests`: approve or decline, and the fact that
approving is **the only way out of a customer-rejected order** — it puts the
order back in the queue.

---

## J — The warehouse floor

Filmed in pipeline order, because that is how the building works and the hub's
own subtitle says so: consignment → receive → print → pick → pack → handover →
dispatch.

### J1. Where things live · `ready`

**Promise** — you can build a warehouse's locations and know what the tracking
switch does.
**Length** 4 min. **Needs** nothing; creating a warehouse provisions its own
zone and floor bin.
**Covers** `/warehouse/bins` and the two separate questions it keeps apart:
what locations **exist** (always editable) and whether the system **asks** for
one. Then the sentence the help text makes explicitly and this tutorial
repeats: **turning tracking off stops the system asking; it does not collapse
the bins you have built.** Collapse is a different, destructive act — named
here, taught in P4.

### J2. Receiving a consignment · `needs demo data` · **dangerous**

**Promise** — you can count goods in and write them to stock.
**Length** 4 min. **Needs** a consignment with a pending goods receipt. C1's
seeding provides it.
**Covers** `/warehouse/receive`: start receiving (which claims it), per-line
received and damaged and bin, then **"Complete and write stock"**.
**Cost of getting it wrong:** completion writes real stock through the one
sanctioned writer, and a wrong count becomes a wrong on-hand that only a
counted adjustment will fix. Also covers the rule that a variance no longer
blocks — the count is recorded, the gap is noted, and the goods carry on.

### J3. Labels and the picking sheet · `needs demo data`

**Promise** — you can get a day's parcels printed and picked.
**Length** 4 min. **Prerequisites** J2. **Needs** confirmed orders with
waybills. D0 provides them.
**Covers** `/warehouse/printing`, which owns picking now: shipping labels
(build → print → **confirm printed**, its own step because a PDF existing is
not paper existing), then the picking sheet, then marking the batch picked.
Confirming the print is what allocates the stock, so a shortfall surfaces at
the desk before anyone walks — that is the reason for the order of the steps.

### J4. Packing a parcel · `needs demo data`

**Promise** — you can pack a box so that what is inside it is what was ordered.
**Length** 3 min. **Prerequisites** J3. **Needs** a picked parcel.
**Covers** `/warehouse/pack`: scan the label to open the box, scan each product
in, scan the label again to close. The contents are checked as a **set**,
because a count alone passes a box with two of one thing and none of another.
Ends on cancelling a box — which returns nothing to stock, because the stock
has not left yet.

### J5. Packing without a scan · `needs demo data` · **dangerous**

**Promise** — you can get a parcel out when the label will not scan, and you
know what you gave up.
**Length** 2 min. **Prerequisites** J4.
**Covers** "Pack without scanning": a separate endpoint, a supervisor
permission a packer does not hold, a reason of at least twenty characters, and
its own distinct audit action so that "how often are we bypassing this" is a
question somebody can answer.
**Cost of getting it wrong:** an unverified parcel is a wrong item at a
customer's door with nothing in the record saying which step was skipped.

### J6. Handing parcels to the courier · `needs demo data` · **dangerous**

**Promise** — you can dispatch a van-load and know every parcel is accounted
for.
**Length** 3 min. **Prerequisites** J4. **Needs** packed parcels.
**Covers** `/warehouse/handover`: **the scan is the handover** — the parcel
dispatches there and then, and the manifest closes itself once the last one has
gone. A running list rather than a clearing form, so "did I do all forty" is
answerable. Then the duplicate-scan stop: scanning a box already with the
courier halts **that operator** until an admin clears it, because it means
either two boxes carry one waybill or the pile has already been done.
**Cost of getting it wrong:** a parcel recorded as dispatched that is still on
the bench, or a duplicate label delivered to nobody.

### J7. Booking the van · `needs demo data` · **dangerous**

**Promise** — you can raise a pickup, and you know when freeing a day is
dangerous.
**Length** 2 min. **Prerequisites** J6.
**Covers** `/warehouse/pickups` — one request per warehouse per day, normally
raised for you when the first box closes. Raising one is a live courier call
that books a van.
**Cost of getting it wrong:** "Free this day for a new request" is the sharp
edge — only after confirming in the courier's own panel that no request exists,
because if one does, freeing the slot books a **second van** against a live one.

### J8. Manifests · `ready`

**Promise** — you can answer "what went out on Tuesday's van".
**Length** 2 min. **Prerequisites** J6.
**Covers** `/warehouse/manifests` as what it now is: a **record, not a step**,
created for you at pack and finished for you at the last scan. Includes moving
a packed parcel between draft manifests, which is the only alternative to a
database edit. Short on purpose — the point is that nobody has to visit it.

---

## K — Returns

### K1. Taking a return in · `needs demo data`

**Promise** — you can book a returned parcel in at the door.
**Length** 3 min. **Needs** an RTO_IN_TRANSIT parcel. D0 provides one.
**Covers** `/warehouse/rto`'s four tabs, then receiving by waybill — and the
rule behind it: a courier scan **never** drives "received", because the
conservation-critical chain past this point needs physical confirmation. The
units are booked into the returns hold at this moment, so a received-but-
undecided return is on the ledger rather than nowhere.

### K2. Inspecting and finalising · `needs demo data` · **dangerous**

**Promise** — you can decide what happens to each unit that came back.
**Length** 4 min. **Prerequisites** K1.
**Covers** inspection per line **and by quantity** — two units of one line can
be one good and one damaged, which is the reason the split exists — across the
four dispositions, then **"Finalize disposition"**.
**Cost of getting it wrong:** its own confirm says it plainly — stock moves now
and this cannot be undone. A unit written off by mistake is a stock adjustment
and an apology; a damaged unit put back in stock is a second unhappy customer.

---

## L — Correcting stock

### L1. Adjusting stock · `needs demo data` · **dangerous**

**Promise** — you can correct a count, and you know which corrections need a
second person.
**Length** 4 min. **Needs** stock in a bin.
**Covers** `/inventory/adjustments`: posting one at the (variant, bin, batch)
grain with ids typed rather than picked — because the operator is reading them
off a count sheet — the mandatory reason stored permanently, and the threshold
that routes a large adjustment to **approve or reject** while a small one
executes in one go. Also the prefilled link from a bin's "Adjust", which is how
a unit kept aside in the damaged bin goes back to the seller.
**Cost of getting it wrong:** the adjustment is the record; the reason you type
is what somebody reads a year later trying to explain a variance.

### L2. Counting stock · `needs demo data` · **dangerous**

**Promise** — you can run a cycle count and turn its differences into
adjustments.
**Length** 3 min. **Prerequisites** L1.
**Covers** `/inventory/cycle-counts`: schedule, start, record, complete — where
completing turns **every** difference into a stock adjustment under the same
threshold rules. The discrepancy count is on screen before the button, and
narrating that is the tutorial's job.

### L3. Reading the stock ledger · `ready`

**Promise** — you can find out what happened to any SKU, or in any bin.
**Length** 2 min. **Prerequisites** L1.
**Covers** `/inventory/movements`: append-only, read-only **by construction** —
there is no endpoint to edit a movement and there should never be one. Filter by
variant to answer "what happened to this SKU", by bin to answer "what happened
here". The natural end of every stock investigation, which is why it is taught
after the two screens that write to it.

### L4. Moving stock between warehouses · `needs demo data` · **dangerous**

**Promise** — you can transfer stock without losing what the batch knows.
**Length** 2 min. **Prerequisites** L3.
**Covers** `/inventory/transfers`, and the one field that makes it a tutorial:
the destination batch is **required and never auto-created**, because an
invented batch drops expiry, unit cost and the goods-receipt link — breaking
picking order and margin at once.
**Cost of getting it wrong:** six-month-old stock that looks as fresh as
today's, and a margin figure with nothing behind it.

---

## M — Couriers

### M1. Courier accounts and credentials · `ready`

**Promise** — you can add a courier account and understand why you can never
read its password back.
**Length** 3 min. **Needs** nothing beyond the seeded couriers.
**Covers** `/courier-accounts`: several accounts per courier, one default per
pair, and a shipment recording which one carried it. Credentials are
**write-only** — there is deliberately no "view credential" control anywhere.
Changing a token means adding an account and deactivating the old one, so which
credential carried which parcel stays answerable. Also the master on/off, whose
copy is the lesson: **off is not a kill switch** — parcels the courier already
holds keep being tracked and cancellable.

### M2. Is the courier integration healthy · `ready`

**Promise** — you can tell at a glance whether we can still book parcels.
**Length** 3 min. **Needs** the simulator running, which makes the waybill pool
and the connectivity probe real on camera.
**Covers** `/delhivery`: waybills left, whether physical writes are permitted,
and the remaining rate budget — three things that fail silently until they are
expensive. The tracking **lookup** panel is the safe half and is shown here;
the poller is M3.

### M3. Making parcels move · `needs demo data` · **dangerous**

**Promise** — you can run the tracking poll and know what it sets in motion.
**Length** 2 min. **Prerequisites** M2. **Needs** dispatched parcels.
**Covers** "Run it now" on the tracking poll — and why it is not a refresh
button. Delhivery pushes us nothing, so this is the only thing that moves
orders through in-transit, out-for-delivery and delivered. It **acts**: it
writes tracking events, moves orders and credits money downstream.

### M4. When nobody will carry it · `needs demo data` · **dangerous**

**Promise** — you can get a parcel moving that every courier refused.
**Length** 3 min. **Needs** a parcel in `PENDING_MANUAL_PLACEMENT`, and getting
one is less obvious than it looks. The simulator refuses `000000` as
non-serviceable by design — but **an order can never carry that PIN**, because
`address-validation.service.ts` enforces `^[1-9][0-9]{5}$` at create and is
right to. `999999` is refused too, but as a TRANSIENT failure, which by CUR-2b
deliberately does NOT route to manual placement. So the two real routes are a
**pick shortfall** (confirm an order, then take the stock away — WMS-4 routes it
here with no side-effects), or **teaching the simulator to refuse a nominated
valid pin permanently**, which is a few lines and makes the courier-refusal
shape reachable as well. Take the pick shortfall first; it needs no new code.
**Covers** `/manual-placement` as the worklist — showing **why** each parcel is
there, in the courier's own words — and then placing the waybill on the order
page. The consequence to state: recording a waybill dispatches the order and
tells a customer their parcel is on its way, so the number has to be one a real
docket carries.

### M5. Choosing a carrier · `needs demo data` · **dangerous**

**Promise** — you can pick the carrier for a parcel that is waiting on a
person.
**Length** 2 min. **Needs** a seller on the manual selection policy with a
confirmed parcel.
**Covers** `/courier-decisions`: price and days side by side, cheapest and
fastest marked, and how long it has been waiting. Booking real carriage on a
confirmed, stock-reserved parcel is the act. Also: past the deadline the system
books the cheapest itself **and says so loudly**, because auto-picking quietly
would make the policy indistinguishable from "cheapest" to anyone not watching.

### M6. Acting on a failed delivery · `needs demo data` · **dangerous**

**Promise** — you can decide what a seller has asked us to do about a parcel.
**Length** 3 min. **Needs** D0's failed delivery plus a seller request.
**Covers** `/delivery-actions`: approve or reject with a reason.
**Cost of getting it wrong:** approving a re-attempt **dispatches a van** at our
cost; approving a return turns a moving parcel round. Recall is the exception
and reaches no courier — it asks our own agents to phone.

---

## N — Money

Ten tutorials, and the tone throughout is that none of these screens is a form.
Each one moves money that exists.

### N1. How seller money works · `needs demo data`

**Promise** — you can read a seller's wallet and explain any line in it.
**Length** 4 min. **Needs** D0.
**Covers** `/seller-wallets` and one seller's ledger: what a top-up, a COD
credit, a delivery charge, a return fee and a refund each are. Read-only, and
deliberately first — every screen after this writes to what this one shows.

### N2. Accepting a top-up · `needs demo data` · **dangerous**

**Promise** — you can credit a seller for money that has actually arrived.
**Length** 3 min. **Prerequisites** N1. **Needs** a pending claim from E1.
**Covers** `/topups`: the claim, its reference and proof, and matching it
against the bank before accepting.
**Cost of getting it wrong:** **accepting is the credit.** A seller declaring a
transfer is a claim, not a payment — accept one that never landed and you have
given away money that can then be withdrawn.

### N3. Paying a seller out · `needs demo data` · **dangerous**

**Promise** — you can take a withdrawal request through to money leaving the
bank.
**Length** 4 min. **Prerequisites** N2. **Needs** a request from E3.
**Covers** `/withdrawals` (approve, and what the balance rule refuses) and then
`/remittances` — the rate, the bank fee, and the reference. Also why a request
the wallet can no longer cover is rejected automatically.
**Cost of getting it wrong:** real money to a real account, and the destination
comes from the seller's bank details — which is why N4 exists.

### N4. Approving a change of bank account · `needs demo data` · **dangerous**

**Promise** — you can approve a seller's new bank details safely.
**Length** 2 min. **Prerequisites** N3. **Needs** a pending change from A2.
**Covers** `/bank-changes`. Short, and the shortest tutorial with the highest
stakes in the library: this screen decides **where a seller's money goes**, and
approving a change somebody else requested is the whole attack.

### N5. Recording what the courier paid us · `needs demo data` · **dangerous**

**Promise** — you can record a COD payout and match it to the orders it covers.
**Length** 4 min. **Prerequisites** N1. **Needs** delivered COD orders.
**Covers** `/settlements`: recording the payout against its own reference —
which is the guard against recording one bank credit twice — then allocating it
to orders, the short-payment figure that appears when the courier paid less than
the order was worth, and the reversal when a parcel came back after they had
paid.
**Cost of getting it wrong:** the seller is credited what the **order was
worth**, so a mis-recorded payout is money out of Skydrop's pocket, quietly.

### N6. Moving money in or out of a seller's wallet by hand · `needs demo data` · **dangerous**

**Promise** — you can correct a wallet with a reason the seller will read.
**Length** 3 min. **Prerequisites** N1.
**Covers** `/wallet-transfers`: a staff debit or credit, the reason of at least
twenty characters that **the seller sees in their own ledger**, and the separate
internal note that only the audit keeps. The distinction to teach: this **moves
cash**; an adjustment does not.

### N7. The bank book · `needs demo data` · **dangerous**

**Promise** — you can keep the treasury agreeing with the statements.
**Length** 4 min. **Prerequisites** N5.
**Covers** `/treasury`: accounts, transfers between them, reconciling against a
statement, owner money in and out, and the opening balance.
**Cost of getting it wrong:** a reconciliation is append-only, so a wrong one is
corrected by another entry and never by an edit — and an opening balance
mistyped as a reconciliation reads as **profit**.

### N8. Freight bills · `needs demo data` · **dangerous**

**Promise** — you can bill a consignment's freight and correct one you got
wrong.
**Length** 3 min. **Prerequisites** C1's consignment.
**Covers** `/freight`: recording a bill in the currency it was agreed in, how
it is split across lines by weight, settling and waiving — and **voiding**,
because a wrong bill is withdrawn and re-raised, never edited. Editing in place
would leave the wallet holding a figure the bill no longer claims.

### N9. Is the money picture true · `ready`

**Promise** — you can tell how much of the P&L is measured and how much is
missing.
**Length** 3 min. **Needs** whatever data exists; the honesty of the page is
the subject, so a thin month is fine.
**Covers** `/pnl` and, more importantly, the coverage figures: a missing
courier cost is reported as **uncovered**, never as zero, because zero would
report the whole of that revenue as profit. Also `/cost-sync` — whether the
nightly sync is even running, since a stopped one is invisible until a margin
looks wrong weeks later.

### N10. Closing a month · `impractical locally` · **dangerous**

**Promise** — you can close a month and understand why it never reopens.
**Length** 4 min.
**Why impractical:** the whole subject is months of accumulated activity and
their carry-forwards. Seeding a believable three months across every P&L line is
a project in itself, and a tutorial filmed against a synthetic month would teach
the buttons while misrepresenting the arithmetic they exist for. **Recommend
writing this one, not filming it**, until there are real closed months.

---

## O — Sellers, stores and the platform

### O1. Letting a seller in · `ready`

**Promise** — you can take someone from asking to signed in.
**Length** 3 min. **Needs** nothing.
**Covers** `/leads` (the drawer, notes, status) and inviting them, then
`/sellers` and the pending-invitations panel — invite, resend, delete.

### O2. Managing a seller · `needs demo data` · **dangerous**

**Promise** — you can suspend, restrict or correct a seller's account.
**Length** 4 min. **Prerequisites** O1.
**Covers** `/sellers/[id]`: suspend and reapprove, the identity correction that
sits behind its own button because it is a correction and not routine editing,
and the restrictions — split into **the safe four**, which stop new work, and
**the three that touch parcels in flight**.
**Cost of getting it wrong:** the copy says it — blocking those three strands
goods we are still paying to move.

### O3. Per-seller settings and courier routing · `needs demo data` · **dangerous**

**Promise** — you can change one seller's behaviour without touching anybody
else's.
**Length** 3 min. **Prerequisites** O2.
**Covers** the settings section showing every overridable key with its
**effective** value and where that value came from, then the courier-account
links and their weights — which accounts carry this seller's parcels. An empty
list is normal and means the pair's default.

### O4. Changing how the platform behaves · `ready` · **dangerous**

**Promise** — you can change a system setting and know what it will do.
**Length** 4 min. **Needs** nothing.
**Covers** `/settings`: grouped by what a setting decides rather than by its raw
category, each row leading with a plain-English name and an example, the raw key
underneath for searching a log, and the type-aware editor. Sensitive values start
masked and need an explicit reveal.
**Cost of getting it wrong:** these are runtime behaviour switches with no
deploy between typing and effect — the reason that is the point is also the
reason it is dangerous.

### O5. Staff, and telling everyone something · `ready` · **dangerous**

**Promise** — you can add a colleague and send a message to an audience.
**Length** 3 min. **Prerequisites** H4.
**Covers** `/staff` (invite with its one-shot token reveal, change a role,
deactivate) and then `/notifications/broadcasts`, whose **shape is the lesson**:
you cannot reach Send without first asking how many people it reaches, and the
count you saw is carried into the send so the server refuses if the population
moved in between.

---

## P — The dangerous five

Deliberately last, deliberately their own section, and deliberately a different
tone from everything above. Each one is something a person should have watched
a tutorial about **before** the day they need it.

### P1. God mode · `needs demo data` · **dangerous**

**Promise** — you can force an order into a state the rules forbid, and you
know everything that follows.
**Length** 4 min. **Needs** a stuck order.
**Covers** force-mutate on `/orders/[id]`: the typed `FORCE-MUTATE`, the reason
of at least thirty characters, the risk acknowledgement, the field whitelist.
Then the half people miss — **a forced status has the same consequences as a
real one, except stock**: notifications go out, webhooks fire, money moves, a
waybill is booked. So the reservations are cleaned up separately, with the
companion dialog, and the tutorial shows both.
**Cost of getting it wrong:** `hasAdminOverride` is set once and **never
cleared**, the audit is CRITICAL, and stock can be left held against an order
that no longer exists. Use it when nothing else can work, and write the reason
for the person reading it next year.

### P2. Live courier writes · `needs demo data` · **dangerous**

**Promise** — you can cancel a waybill, re-attempt a delivery or record a scan
by hand.
**Length** 4 min. **Needs** D0's dispatched and failed parcels, against the
simulator.
**Covers** the courier-ops panel — collapsed by default because opening it
costs live calls — and the four acts: cancelling a waybill, the NDR action,
editing a shipment, and recording a scan by hand with a backdatable time.
**Cost of getting it wrong:** there is no sandbox. A cancel turns a moving
parcel into a return; an NDR re-attempt sends a van; a hand-recorded scan tells
a customer something that may not be true.

### P3. Refunds and disputes · `needs demo data` · **dangerous**

**Promise** — you can close a ticket with money attached.
**Length** 3 min. **Needs** D0's damage ticket.
**Covers** `/tickets/[id]`: replying to the seller, and the four outcomes at
close — where **refund writes a credit to the seller's wallet inside the same
transaction as the close**. Also settling a reseller-store dispute, which moves
money between two wallets as one pair and refuses the ordinary refund path.

### P4. Collapsing a warehouse's bins · `impractical locally` · **dangerous**

**Promise** — you can merge every bin into the floor, and recover if it was
wrong.
**Length** 3 min.
**Why impractical:** it needs a super-admin, a typed warehouse code, a
thirty-character reason **and a six-digit code emailed to the actor** — and
local mail is a dev stub, so the confirmation step cannot be filmed honestly.
Feasible if the seed reads the code from the notification row, but that is
teaching a path production does not use. **Recommend writing this one**, and
filming only the read-only "what a collapse would move" half.

### P5. What we cannot undo · `ready`

**Promise** — you can name every irreversible act in the admin app and say what
it costs.
**Length** 4 min. **Needs** nothing — it is a tour, not a demonstration.
**Covers** no clicks at all. It walks the list: god mode, finalising a return,
completing a receipt, forcing a call outcome, packing without a scan, freeing a
pickup day, closing a month, collapsing bins, accepting a top-up, approving a
bank change. For each: what it writes, what it cannot take back, and what asks
first. **This should arguably be the first admin tutorial anybody watches**,
and it is placed last only because it makes more sense once the screens are
familiar.

---

## Pages deliberately not filmed

Every remaining page, with the reason.

| Page                                                                                                                                                   | Why not                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| seller `/dashboard`                                                                                                                                    | Covered inside A1. Read-only; no flow of its own.                                                                                                                                                     |
| seller `/settings`                                                                                                                                     | A tile hub. Filming navigation to navigation.                                                                                                                                                         |
| seller `/settings/notifications`                                                                                                                       | A redirect kept for old bookmarks. Nothing happens on it.                                                                                                                                             |
| seller `/orders/import/[id]`, `/products/import/jobs/[id]`                                                                                             | One import's detail. A ten-second beat inside B2 and C6, not a tutorial.                                                                                                                              |
| seller `/inventory/units`                                                                                                                              | Needs strict-mode serialised SKUs **and** a real discrepancy — a stuck unit or a count mismatch. Seedable, but it teaches a screen most sellers will never open. Revisit if strict mode is adopted.   |
| seller `/customers`                                                                                                                                    | Genuinely thin: counts, a risk badge, correct-details, remove. Folded into B5 as a thirty-second aside. Promote it if the risk badge starts driving decisions.                                        |
| admin `/holds`                                                                                                                                         | Read-only by design — there is deliberately no Release button, because the decision is the seller's. Named inside D5 and H1.                                                                          |
| admin `/nsa`, `/reports`, `/liabilities`, `/bank-accounts/history`, `/system/capacity`, `/margin`, `/inventory-units`                                  | Read-only or single-button screens. Each gets a sentence in the neighbouring tutorial; none carries three minutes. `/system/capacity` in particular is prose already — reading it aloud adds nothing. |
| admin `/warehouse/pick`                                                                                                                                | The retired per-parcel station, unlinked from the nav. It survives only for serialised stock, which nothing local uses. Film it the day strict mode ships.                                            |
| admin `/shiprocket`                                                                                                                                    | Stubbed and inactive locally, so every panel would film as an empty state. `impractical locally` until Shiprocket is live in a dev environment.                                                       |
| admin `/courier-escalation` and its three tabs                                                                                                         | The whole subsystem is manual-by-design against a courier's own support desk. Filming it needs a real courier ticket to point at. Worth a tutorial once escalations are routine; not filmable now.    |
| admin `/cost-sync` portal runs                                                                                                                         | Browser-driven sign-ins to Delhivery's own portal. `impractical locally` and unwise to demonstrate anywhere else. The read-only half is inside N9.                                                    |
| admin `/expenses`, `/expenses/categories`, `/courier-wallet`, `/bank-accounts`, `/reseller-store-wallets`, `/stores`, `/reseller-stores*` (admin side) | Real screens, genuinely deferred rather than dismissed — they are a second money wave once N1–N9 exist. Listing them here so the gap is visible rather than forgotten.                                |
| both apps `/notifications`, `/notifications/settings`                                                                                                  | Seller side is F4. Admin side is the same screens; one cross-reference is cheaper than a second video.                                                                                                |
| admin `/account`                                                                                                                                       | The staff equivalent of F3. One sentence in H1.                                                                                                                                                       |

---

## What this costs

### Producing it

The three existing videos took roughly **a day each**, and that was with the
pipeline being built at the same time. With it built, a tutorial is:

| Step                                            | Effort                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Write 10–16 narration lines                     | 1–2 h, and it is the part that decides whether the video is any good |
| Write the flow — the selectors and the gestures | 1–3 h, longer on a form-heavy screen                                 |
| Seed whatever state it needs                    | 0 for `ready`, 1–4 h for a new state                                 |
| Record, compose, verify, re-take                | ~1 h of wall clock, mostly waiting                                   |

Call it **half a day for a `ready` tutorial and a full day for one needing new
demo data**, with the seeding amortised across everything that shares a state.

For the 87 unfilmed: 31 `ready` at about half a day is ~16 days; 54 needing new
demo data at about a day is ~54 days, though the seeding amortises heavily
within a section. Call it **14 to 18 working weeks** of focused effort — three
to four months for one person doing nothing else. Plus these one-offs first:

- **The lifecycle seeding (D0)** — 1–2 days. Unblocks 20+ tutorials and is the
  single highest-leverage thing in this document.
- **Teaching the recorder the admin app** — half a day. It is hardcoded to the
  seller URL and the seller credentials; a flow needs to declare its app and a
  staff sign-in needs to exist beside the seller one. **No admin tutorial can be
  made until this is done.**
- **A products CSV fixture** for C6 — an hour.

### The voice budget

**This was the constraint that stopped the first run, and it is now a much
smaller one.** Narration is ElevenLabs, billed per character. The first batch
ran against a single 10,000-credit allowance — roughly **eight tutorials'
worth** — and ran out part-way through the third video.

There are now **two accounts of 121,000 credits, 242,000 in total**, and
`generate-voice.mjs` moves between them: it spends the first until it answers
`quota_exceeded`, then retries **that same clip** on the second. See
[The keys](README.md#the-keys) for the rotation rule and the two ways it can
go silently wrong.

**Budget the words, not the videos.** A tutorial is 10–16 lines of 120–180
characters, so **roughly 2,000 credits**. That is the unit to plan in, and at
242,000 credits it makes the arithmetic straightforward:

| Scope                         | Lines  | Credits  | Fits in 242,000? |
| ----------------------------- | ------ | -------- | ---------------- |
| One tutorial                  | 10–16  | ~2,000   | yes, 120× over   |
| Sections A + B (13, 5 filmed) | ~100   | ~16,000  | yes              |
| Whole seller app (A–G, 44)    | ~560   | ~88,000  | yes              |
| The whole library (90)        | ~1,150 | ~180,000 | yes, once        |

So **the voice is no longer what limits this** — the 14-to-18 working weeks
of writing flows and seeding demo data above is. The one thing to keep in
view is that the figure is a **one-off**, not a rate: re-takes cost again
(only for the lines that changed — the per-clip cache is what makes that
true), and a library that is re-shot every quarter spends a fresh slice each
time. Plan the allowance against the maintenance cycle, not against the
build.

**Two free checks before spending anything.**
`generate-voice.mjs --quota` prints what each key has left, and a generation
run does the same check before its first clip, refusing up front when the
total is known to be short. `--voice-check` confirms both accounts see the
same narrator for `EXAVITQu4vr4xnSDxMaL`: it is a stock voice and should be
identical everywhere, but an account can clone over a voice id, and a library
that changes narrator half way through is invisible until a viewer notices.
**Both need scopes the current key does not carry** (`user_read` and
`voices_read`); a key scoped to text-to-speech alone reports "unknown" and
the run goes ahead, which is why the voice check has teeth only from the
second key onward.

A partial failure used to be worse than it looked: the clip manifest was written
only after the whole run, so a run that died on its last line **discarded every
clip it had just paid for**. It is written per clip now, and
`generate-voice.mjs --adopt` recovers mp3s orphaned by the old behaviour (opt-in,
and it says on every line that it cannot verify the audio against the text).

### Keeping it

This is the part to think hardest about, because it does not appear until later.

**A library this size goes stale a few videos at a time, silently.** A
renamed button, a moved field, a new required input — each breaks one or two
videos, and nothing tells you. A viewer following a video that no longer matches
the screen trusts the product less than one with no video at all.

Three things in the pipeline make a re-take genuinely cheap, and they are worth
knowing before deciding:

1. **The words live in one file.** `narration.mjs` is the only place. Edit a
   line and re-run: the voice generator regenerates that clip alone (cached on a
   hash of the text and the voice settings), the recorder re-times that scene,
   the composer places it at its new offset. No timeline, no subtitle file, no
   shot list to keep in step.
2. **Seeding is per video, not per session.** Any one video is re-takeable on
   its own, so a break in one costs one re-take and not a batch.
3. **A broken flow fails loudly and lands a screenshot.** `record.mjs` refuses
   to open the browser if a step has no action, and writes
   `out/verify/<slug>-failure.png` when a flow breaks mid-take. In practice that
   image has been enough on its own.

So a re-take is **one to three hours**, not a day — provided you know which
video broke.

**Nothing currently tells you that.** The honest estimate for maintenance is
**two to four days per quarter for every forty videos** — so a completed library
of ninety is roughly **a week a quarter, indefinitely**, and that assumes
somebody re-runs everything periodically and watches the output. A library
nobody re-runs is worse than no library: the videos keep playing, and they keep
being wrong.
Two things would cut it, and both are cheap next to the production cost:

- **Run every flow in CI without the voice.** `record.mjs --check <slug>` now
  exists and does exactly this: it drives the flow with no narration and no
  video, holding each scene for a fixed beat, and fails on the first step that
  cannot find what it reaches for. It was written because the voice budget ran
  out with two finished flows and no way to exercise them — and it earned its
  keep immediately, catching a click the dialog intercepted, a date field that
  garbles when typed into character by character, and a missing Bangladesh
  warehouse, all without spending a credit. **Wiring it into a nightly is now
  an hour's work, not a day's**, and it converts silent staleness into a red
  build.
- **Film the stable things first.** The ordering in this document already does
  some of that — A, F, J1 and M1 are screens whose shape has not changed in
  months, while the reseller section (G) and the money section (N) are the
  newest and most likely to move. **Producing G and N last is a maintenance
  decision, not just a priority one.**

### The recommendation

Do not commit to ninety. Commit to **A and B** — thirteen tutorials, of which
**five are already filmed** and most of the rest are `ready` — ship them, and
find out what people actually ask for. That is a fortnight, it covers everything a
new seller does in their first week, and it is the part of this document least
likely to be wrong.

Then decide the next section from support questions rather than from this file.
The curriculum is written so it can be reordered without being rewritten, and a
fair part of it may turn out not to be worth making. **The admin sections in
particular are a bet** — they assume the ops team grows past the people who
built the screens. If it does not, P5 ("What we cannot undo") is worth making on
its own and the other forty-three are not.

---

## Bugs found while establishing feasibility

`scripts/sim-e2e.ts` — the one-command local lifecycle driver — was broken in
four places and could not complete a single parcel. Each failure was a rule that
landed after the script was written, and each one stopped it at a different
step:

1. **A staff user cannot be created without a role row.** RBAC-1 made
   `staffRole` a required relation; the script set only the legacy enum. It died
   on its first line of real work. (`seed-demo-data.mjs` already handled this,
   with a comment — the two had diverged.)
2. **The landmark is required.** ORD-5's 2026-08-07 amendment made
   `recipientAddressLine2` mandatory; the script sent no line two, so every
   order it placed was refused.
3. **An agent must be marked available before pulling a call.** The server
   decides who may take work; a fresh staff user is not available, so the pull
   was refused with `AGENT_NOT_AVAILABLE`.
4. **A parcel cannot be packed without a scanned box.** LBL-4 made a closed
   `pack_box` the gate; the script called `complete` directly. Fixed by driving
   the real bench — open by label, scan each unit by SKU, close — rather than by
   routing through `force-complete`, which would have left the box ritual the
   one path the script never exercises.

Plus one **stale expectation**: the script closed the manifest and then waited
for it to reach CONFIRMED, which was the pre-CUR-2b world where closing the
manifest was what generated the waybill. The AWB has been issued at order
confirmation since; that wait could only ever time out. Replaced with the
handover **scan**, which is what CUR-4 has said is the everyday path since
2026-09-03 — the parcel dispatches at the scan and the manifest closes itself.

It now runs green: one parcel to DELIVERED, one to RTO_RESTOCKED, stock
conserved on each.

**And three in the tutorial pipeline itself**, found while producing this
batch rather than while planning it:

- **The clip manifest was written once, after the whole run.** A run that died
  on its last line therefore discarded every clip it had just paid for — which
  is what happened, on a quota that then had nothing left to buy them again
  with. Written per clip now, with `--adopt` to recover what the old behaviour
  orphaned.
- **Check mode wiped the raw recording directory.** Running a check to see
  whether a flow still worked would have silently destroyed the take it was
  checking on behalf of. Caught before it cost anything.
- **A `mock://` image cannot be rendered by the browser**, so the logo the
  profile video uploads would have appeared as a broken frame — in a tutorial
  about uploading a logo, which is the worst possible place for it. The shim
  now serves the bytes back as a `data:` URL.

**Two curriculum errors, both from trusting a description over the code**: the
seller roles editor has 41 permissions in seven groups and not 68 in ten (that
is the staff catalogue), and the sidebar's section ordinals are passed by the
seller shell and IGNORED by the component that renders it. Both were written
into entries above and then corrected against the source. It is the argument
for deriving a curriculum from code rather than from a tour of the UI — and for
re-deriving anything in it that is a number.
