# The tutorial library

Every screen in `apps/seller` and `apps/admin`, sorted into tutorials, in the
order a person meets them. Derived from the code — the 47 seller pages under
`apps/seller/src/app/(authed)/`, the 84 admin pages under
`apps/admin/src/app/(authed)/`, both `page-access.ts` tables, and the flows the
components actually perform — not from the sidebar and not from memory.

**90 tutorials.** 26 filmed, and D0 is built — so section D is no longer
blocked. Of the 64 left, 12 are `ready` without any lifecycle at all, most of
D / E / K is `ready` now that D0 exists, and 2 are `impractical locally`. 29 touch
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

**Filmed so far (41):** A1–A6, B1–B7, C1–C6, D1–D6, E1–E4, F1–F5, G1–G7.
**Sections A, B, C, D, F and G are complete — the whole seller app except E5.**
Every one has its own entry below saying what it covers and what its seeding
does.

**THE NEXT ENTRY IS E5**, and then the admin sections.

**What E5 needs that nothing has built: a freight bill that is genuinely
PART-OWED.** C0 has built the consignment it hangs on (`RSH-CN-LANDED`), and
recording a bill against its India receipt is straightforward. Making it
part-owed is not, and the reason is worth reading before starting: FRT-1
amortises a bill per unit as units LEAVE, and attribution walks
`shipment_item.pickedBatchId → stock_batch → goods_receipt_lines.batchId →
allocation` — so ONLY parcels picked from that consignment's own batch charge
it. The demo seller already holds older stock of both its SKUs and the allocator
reaches that first, so shipping a parcel proves nothing. The two honest routes
are (a) give the consignment's batch an earlier expiry so FEFO reaches it first,
or (b) give the consignment a SKU the seller has no other stock of. Check either
against `StockPickAllocationService`'s real ordering rather than against an
assumption about it. `docs/consignment-two-leg.md` and the FRT rules in
CLAUDE.md are the rest of the brief.

**After E5 the seller app is done and sections H–P (the admin app) begin.**
They are 44 entries and this document is explicit that they are a BET — read
[the recommendation](#the-recommendation) first, and consider taking support
questions rather than this file's order.

### The three seeded worlds, and which list puts a video in one

Every video that needs more than the standing catalogue names itself in one of
these Sets in `seed-demo-data.mjs`. Forget it and the take runs against a box
that has never been driven.

- **`LIFECYCLE_SLUGS` → D0 (`lib/lifecycle.mjs`)** — nine parcels driven the
  whole way, so the videos about something GOING WRONG have something to film.
  Three of them are SPENT by their own take and retired-and-remade rather than
  rewound (`retireSpentParcel`): D4's `RSH-LIFE-SENDBACK` and
  `RSH-LIFE-RETURNREQ`, and B7's `RSH-LIFE-CONFIRMED`. **Read D4's and B7's
  entries before writing any seeding that has to survive its own take.**
- **`CONSIGNMENT_SLUGS` → C0 (`lib/consignments.mjs`)** — two consignments, one
  landed with its two counts deliberately disagreeing and one still in the air.
  Build-once and idempotent; C1 and C2 only read it.
- **`STORE_REQUIRED_SLUGS` / `STORE_ORDER_SLUGS` / `STORE_REPORT_SLUGS`** — the
  reselling worlds. Two SEPARATE stores and they must stay apart: `Kolkata Silk
  Room` is configured on camera by G3–G5 (`standingStoreFor` wipes its terms
  versions on every run), while `Pune Silk Studio` is the one that TRADES
  (`tradingStoreWorld`: a signed-in store user, `reseller.orders_enabled`,
  accepted terms, priced products, an action policy and five orders). An order
  pins a terms version through a RESTRICT FK, so a store order on the standing
  one would break G4 permanently. Anything later needing a reseller store that
  trades reuses `tradingStoreWorld` rather than building a third.

### What the last few rounds learned about cost

**Anything that only READS is now a narration-and-flow job.** D0's nine parcels
spread orders across every status the lists filter on, its delivered one carries
charges, an invoice, a tracker and a full history, and C0 supplies the two
consignments. B4, B5 and C2 needed no new seeding of their own beyond naming a
list; F4 needed none at all, only a RESET.

**A video that PRESSES needs its world put back, and how depends on what the
press wrote.** F4's seeding is the worked example of all three shapes at once:
an append-only ledger row is UN-MARKED and never deleted (NOTIF-21), a
row-absence default is DELETED, and a row the page does not recreate on read is
UPSERTED back to its defaults. Getting the third one wrong left a table empty
under a line describing it, and only the frame showed it.

**There is no C7.** Two earlier passes over this file listed one as the next
entry and put it in the ready list; section C runs C1 to C6 and always has.
**When an entry is named in the pick-up order, check it has a heading of its
own.**

**Filming these screens is finding real bugs at a steady rate — twenty-nine so
far, plus seven in the seeding itself.** Every one is on a path nothing else
exercises: a gallery that rendered every fresh picture broken, a webhook switch
that was a silent dead end, a catalogue importer whose preview crashed, saved
column mappings that drove nothing, a tracking filter that 500'd, a stuck
parcel's clock that started when we WROTE DOWN the courier's scan rather than
when the courier made it, a delivery attempt drawn against every scan in the
order history, an auto-approval note describing a send-back on a request that
was not one, a ticket that existed but a panel saying "nothing raised yet" a
few centimetres below it, an order named by eight characters of a uuid on
the one screen whose job is to say which order needs you, a return fee printed
as a literal in the copy over a setting that is per seller and per currency —
beside a second return path that charged a DIFFERENT fee and named no figure at
all — and a refund's ledger note naming its ticket by uuid, which is the SAME
defect as the order one, in a second place, found by filming the wallet.
**And, on 2026-09-30, TWO that had never worked at all.** The order tracker told
every confirmed seller that picking and packing were "not needed" — a fallback
onto the waybill's own timestamp, correct until CUR-2b moved the booking to
order confirmation two months ago and silently wrong on every confirmed order
since. And the seller's
"Waiting on you" queue threw the moment any store asked for a change, and
React's error boundary took the WHOLE page with it — so the two queues beside
it became unreachable too, while the nav badge carried on counting rows nobody
could open. Its list endpoint returned the raw database rows, typed
`unknown[]`, where the screen and every other reader of that request expect the
map the view builds. **A return type that promises nothing cannot disagree with
a client that assumes something**, which is how it shipped and why nothing
caught it.
**Budget time for the fix as well as the film.**

**The recurring shape is worth naming: a value that is CLOSE ENOUGH most of the
time.** `order_events.created_at` really is the scan time on a healthy evening;
a delivery attempt really is in the same minute as its scan; a uuid really does
identify an order; `₹200` really is the return fee — on the seeded default, for
a seller who never negotiated one, until the day somebody changes it. Each is
wrong exactly where it matters, and none of them fails loudly.

**A second shape has now appeared twice, and it is about the TESTS rather than
the code: a gate that passes on the wrong thing.** D4's send-back scene waited
for the order's status to read "Rto initiated" and passed while the order
plainly still said "Out for delivery" — the regex matched elsewhere on a long
page. The status was never going to move (CUR-11: the courier accepting a
cancellation is not a scan), so the narration was wrong too. **Only the frame
caught it**, which is the whole argument for `TUT_CHECK_SHOTS=1`. Anchor a
gate on the thing the narration CLAIMS, as specifically as you can: D4's fee
scene waits for the hint text to contain "return fee is", so an endpoint that
is down or gated wrong fails the check instead of filming prose.

### What a following agent needs to know that is not obvious

- **Run `record.mjs --check <slug>` TWICE before spending a credit**, with
  `seed-demo-data.mjs <slug>` in between. The seed IS the between-takes step, so
  running it between the two checks is what proves the take is repeatable. Three
  videos in this library have needed a seeding fix found exactly this way.
- **A flow step that cannot find its target must THROW, never skip.** The roles
  video passed `--check` twice while saving a role with no permissions, because
  its step skipped quietly on a selector miss. Check mode only tests what the
  steps assert.
- **Run `pnpm typecheck` after ADDING A SPEC, not only after touching src.**
  `apps/api`'s tsconfig covers `test/`, and neither the jest run nor `pnpm
  lint` does. A spec constructing a service with the wrong number of arguments
  passed the whole unit suite here and turned CI red on the commit after it
  (82fb69f4) — the same shape as the "gate a subset" trap, one directory over.
  **IT HAPPENED AGAIN ON 2026-09-30 (`ba413eb5`), to somebody who had read this
  line**, which is why it is worth restating rather than merely leaving here:
  the spec ran green under jest and turned main red on `tsc`, because
  `jest.fn(async () => …)` infers its call tuple as `[]` and reading
  `mock.calls[0]![4]` is then TS2493. The tell is that **jest does not
  typecheck what it runs** — `ts-jest`'s isolated transpile does not, so a spec
  can pass and not compile. Typecheck AFTER the spec is written, not before.
  And a red main blocks DEPLOY, so it holds up whatever else is waiting on the
  branch — which on that day was somebody else's security work.
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
  thing, in a voice clip it is a re-take nobody notices is needed. It nearly
  happened twice more: "ten in the morning" over a 09:00 dropdown, and "the one
  ABOVE it reads Expired" over a list sorted the other way.
- **A video costs about 800 credits all in**, measured over nine of them
  (2026-09-30). The pre-flight estimate over-states it. At that rate the
  remaining balance is worth well over a hundred videos, so **a re-take to fix a
  line that misreads the screen is nearly free and shipping a wrong one is
  not.**
- **Budget time for FIXING as well as filming.** Six real bugs in one session,
  every one on a path nothing else exercises. If a screen behaves oddly during a
  `--check`, that is the finding — do not narrate around it.
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

### B3. Fixing the rows that would not import · **FILMED** — `fix-the-rows-that-failed.mp4`

**Promise** — every row of your spreadsheet becomes an order, including the
ones the check refused.
**Length** 2 min 18 s (13 scenes). **Prerequisites** B2 — this is its direct sequel.
**Needs** a CSV import that produced a failed row, and it really was the
cheapest new demo data in the library: `pendingRowsWorldFor` runs B2's own
fixture through the real presign → process → poll and stops. Exactly one of the
six rows cannot become an order — Kavya Reddy's, which carries no Address
line 2, and ORD-5 made the landmark required. **Through the endpoints, never by
inserting a staged row**: the row's `problems` are written by the import
worker, and a hand-made one would be a fixture somebody wrote to look like what
the worker produces — which goes on passing after the worker's output changes
shape. It asserts the row it needs is there, so an importer that suddenly
accepts everything fails the seed instead of leaving the video filming an empty
state.
**Covers** `/orders/pending`, which the nav never links — the only way in is
the "N pending" button on `/orders`, which renders only when the count is
non-zero, so the video shows that rather than explaining it. Then the three
tiles, the band headed by the spreadsheet's own row number and the seller's
reference, the marked field and the sentence under it, the fix typed in, the
three things you can do with a row, the Discard confirmation BACKED OUT OF, and
Import — which saves what was typed before it imports. Ends on the order in the
list with the rest of the file.

**Three bugs, and the last one is the kind this library exists to find** — see
[Bugs found](#bugs-found-while-establishing-feasibility). A raw Prisma error,
absolute server path and source excerpt included, was written verbatim into a
seller-facing field; every "X is required" message named our internal key under
a field labelled something else; and **a row fixed on this page became a DRAFT**
— so nobody ever rang that customer, while the dialog said "it becomes an
order" and the row left the queue.

### B4. Finding an order · **FILMED** — `finding-an-order.mp4`

**Promise** — you can find any order by any handle you have, and send someone a
link to what you are looking at.
**Length** 2 min 37 s (14 scenes). **Prerequisites** B1.
**Covers** `/orders`: the four tiles and the second line on each, the search box
and every handle it takes, the Reset marker, the status chips with their counts,
the "Placed when" presets, the store filter, the columns, and the page size.

**The page's best idea cannot be filmed directly, and the way round it is worth
knowing.** Its filters live in the URL — which is what makes a filtered list a
link somebody can be sent — and **Playwright records the PAGE, never the
browser's own chrome**, so there is no address bar to point at. The scene
RELOADS instead: the search survives, the row is still the only one, and that is
the same fact seen from the only side the camera has. Reach for this shape
whenever a claim is about something outside the viewport.

**It writes nothing at all** — types into a filter, reloads, resets — so it needs
no seeding beyond D0 and its own take leaves the world byte-identical.

**The search is filmed on a PARTIAL PHONE**, because that is the handle a
customer actually has in front of them, and because showing that a fragment is
enough is worth more than showing that an exact order number works. All four
handles were checked against the API first; all four match on a fragment.

### B5. Reading an order · **FILMED** — `reading-an-order.mp4`

**Promise** — you can tell where a parcel is and what it has cost you, from the
order page alone.
**Length** 2 min 47 s (14 scenes). **Prerequisites** B4.
**Covers** `/orders/[id]` as a READING exercise and nothing else: the header's
four facts, the tracker and who recorded each step, the recipient snapshot, what
it is worth and what it weighs, the lines by SKU, the charges with tax on its own
row and what "estimated" means, the invoice, the parcel's own figures, and the
full history. **It presses nothing** — every button on the page has a tutorial of
its own, and this is the map.

**It reaches the order through the UI rather than by URL**, which is not fussiness:
the camera records the page and never the address bar, so a `goto` reads as the
screen changing for no reason. Clicking Orders and searching the seller's own
reference is also the path B4 has just taught.

**`ordSection` scrolls a section to the CENTRE, not merely into view.**
`scrollIntoViewIfNeeded` stops the moment the top edge is on screen, which on a
tall section — Charges, the tracker — leaves most of what the narration is about
below the fold. Worth copying for any future read-heavy flow.

**The scene about the parcel's own figures was REWRITTEN after looking at the
frame.** It first said the courier's weight and the money collected "fill in as
the journey happens"; on the delivered order it films, the simulator reports
neither, so the page reads "Not yet weighed" and "Not yet". The line now says
that the courier has told us neither and that the page says so rather than
guessing — which is true, is the better lesson, and is the thing the frame
actually shows. **This is the `TUT_CHECK_SHOTS` rule earning its keep for the
fourth time.**

**One bug, found by opening the page** — see [Bugs found](#bugs-found-while-establishing-feasibility):
a DELIVERED order carried a section heading reading "Out for delivery".

### B6. Changing an order before it is confirmed · **FILMED** — `changing-an-order.mp4`

**Promise** — you can correct anything about an order until the call centre
confirms it, and you know when that window shuts.
**Length** 2 min 32 s (14 scenes). **Prerequisites** B5.
**Covers** `/orders/[id]/edit` on a DRAFT: the four-step rail, the lines with the
catalogue and its live stock underneath, changing a quantity, the payment section
noticing that the parcel is now worth more than the amount being collected and
offering the figure, the two lines of address help that matter most, notes, the
action bar, and Save + submit with its confirmation. It ends on the order sitting
in the call queue with its contents settled.

**IT NEEDS A DRAFT, NOT A PENDING ORDER, and that is a real constraint rather
than a preference.** `EditOrderForm` computes `canEdit = isDraft || isPending`
and then renders **"Save + submit" and "Discard draft" only for a draft**; on a
PENDING_CONFIRMATION order its own notice says the server allows the recipient
and the notes alone. The video is about the window while everything is still
changeable, so it needs the state where everything still is.

**Its seeding is three lines and no cleanup**, which is the nicest shape in this
file: `clearPreviousOrders` already removes every pre-dispatch order not under a
protected prefix, and DRAFT is the first entry in `REMOVABLE_STATUSES` — so a
take that saved it, submitted it or discarded it leaves nothing to collide with,
and `editDraftWorldFor` simply creates a fresh one afterwards. Cheap for the same
reason the call-cap parcel is cheap to rebuild: nothing is reserved before
confirmation (ORD-10). The draft is seeded WITH a unit price, so the payment
section opens agreeing with itself and the video is what makes it disagree.

**One bug, and it is the largest this library has found** — see
[Bugs found](#bugs-found-while-establishing-feasibility). **No order edit could
be saved at all.** The check run's very first Save returned
`[BAD_REQUEST] packageType must be one of the following values: BOX, POLYBAG,
ENVELOPE, TUBE, CUSTOM`, and the whole screen had been unusable for as long as
that select has existed.

**`getByLabel` is SUBSTRING by default and it cost a run here too** — "Quantity
of RSH-KANTHA-BLUE" also matches the Increase and Decrease buttons either side of
it, so Playwright refused all three under strict mode. The quantity box is
addressed by its ROLE (`spinbutton`). That is the third video in this library to
be bitten by the same default.

### B7. Cancelling an order · **FILMED** — `cancelling-an-order.mp4`

**Promise** — you can call an order off, and you know what it costs at each
stage.
**Length** 2 min 44 s (15 scenes). **Prerequisites** B5.
**Needs** TWO orders, and it SPENDS BOTH. `RSH-CANCEL-PENDING` is placed fresh
by `cancelWorldFor` on every seed run and sits in the call queue;
`RSH-LIFE-CONFIRMED` is D0's, now marked `spendable` so the lifecycle pass
retires the cancelled one and builds another. A `--check` pass spends them too,
so seed-check-seed-check-seed-take is three of each; the confirmed one costs a
real courier booking each time (about twenty seconds on the simulator).
**Covers** the Cancel action on both, its reason, and the sentence the seller
actually needs: **the dialog says something different at each stage, and that is
the video.** Before confirmation it names the call queue and nothing is released,
because nothing was ever held (ORD-10). After it, "the stock held for this order
goes back to available straight away". It ends on a parcel already out with a
driver, which has no Cancel button at all, and on the button it has instead.

**Its seeding retires rather than deletes, and that is forced rather than
chosen.** `clearPreviousOrders` sweeps PENDING_CONFIRMATION but not CANCELLED,
and a cancelled order cannot simply be deleted either — the cancel emails the
seller, and `notification_logs.order_id` refuses the row. So the spent one keeps
everything and only its NAME moves aside (D4's `retireSpentParcel` rule), which
it must: `sellerOrderRef` is unique per seller and store.

**`needsLiveCourier` is new on `LIFECYCLE_PARCELS` and exists because of this
one.** D4's two parcels are retired when the SIMULATOR has forgotten their
waybill, since D4 calls the courier on it. A seller cancel calls the courier
NOTHING (CUR-10 amendment #4 — it voids our shipment and a person closes the
waybill on Delhivery's desk afterwards), so that test would have bought a
courier booking after every sim restart for nothing. Only the two parcels whose
video makes a live call carry the flag.

**Three bugs, and one of them had been on screen for two months** — see
[Bugs found](#bugs-found-while-establishing-feasibility): the tracker told every
confirmed seller that picking and packing were "not needed"; the cancel dialog's
money line had nothing supplying it; and `AWAITING_COURIER` was missing from the
server's own cancellable set while the button was offered on it.

---

## C — Stock

### C0. (not a tutorial) The consignment seeding · **BUILT** — `lib/consignments.mjs`

```bash
node scripts/tutorials/seed-demo-data.mjs --consignments
```

TWO consignments, built through the real endpoints — declare, count,
dispatch, count again — because C1, C2 and E5 are the same thing seen from
three sides. The same shape as D0 for section D, and it took about two minutes.

| Ref              | State                              | Used by    |
| ---------------- | ---------------------------------- | ---------- |
| `RSH-CN-LANDED`  | COMPLETED — both legs counted      | C1, (E5)   |
| `RSH-CN-FLYING`  | IN_TRANSIT — dispatched, not landed| C2         |

**Its counts DISAGREE twice, for two different reasons**, because a page
showing two counts that match explains nothing. One line is counted SHORT in
Dhaka against what the seller declared (16 declared, 15 found — ours to take up
with THEM); the same line is then counted short again in India against what
Bangladesh dispatched (15 sent, 14 found — ours to take up with the FORWARDER,
and CNS-4 posts it as an `IN_TRANSIT_LOSS` out of the transit bin rather than
pretending the goods are somewhere). The other line matches all the way, so the
page has something un-alarming beside them.

**`RSH-CN-FLYING` exists for one column.** Its units sit in the destination
warehouse's TRANSIT bin — in neither building, sellable from nowhere (CNS-1) —
and they are the only thing on this box that makes `/inventory`'s in-transit
figure non-zero. That column is what C2 is about.

**It never rewinds, and unlike D0 it deletes rather than resumes — but only a
consignment nobody has counted.** A leg that has been counted has written stock
and a batch points back at it, so deleting its receipt would leave the ledger
describing goods that arrived against nothing. Anything past that is carried
FORWARD from wherever it is: the first build threw half way (it asked for a leg
named `INDIA`; the enum says `IN_FINAL`), which left a consignment dispatched
with its Indian leg uncounted — a state the next run refused to delete AND
refused to finish, which is a state nothing can get out of. Resume was the fix,
and it is the same rule D0 arrived at for the same reason.

**BUILD-ONCE.** Neither C1 nor C2 writes on a consignment — both only read — so
a re-take needs no rebuild and `CONSIGNMENT_SLUGS` can stay empty until one of
them is filmed.

**What it does NOT yet build, and what that costs E5.** A freight bill that is
genuinely PART-owed. `record` is straightforward, but FRT-1 amortises a bill per
unit as units LEAVE, and attribution walks
`shipment_item.pickedBatchId → stock_batch → goods_receipt_lines.batchId →
allocation` — so only parcels picked FROM THIS CONSIGNMENT'S BATCH charge it.
The demo seller already holds older stock of both SKUs, and the allocator picks
that first, so shipping a parcel proves nothing. The honest routes are (a) give
the consignment's batch an earlier expiry so FEFO reaches it first, or (b) give
the consignment a SKU the seller has no other stock of. Either is a small change
to `TUTORIAL_CONSIGNMENTS` plus a couple of driven parcels; neither is guesswork,
but both need checking against `StockPickAllocationService`'s real ordering
rather than against an assumption about it.

**One bug, on the page C1 films** — see
[Bugs found](#bugs-found-while-establishing-feasibility): a consignment that had
landed and been counted short told its seller the missing unit was "still to
come — in Dhaka or in the air".

### C1. Following a consignment from Dhaka to the shelf · **FILMED** — `follow-a-consignment.mp4`

**Promise** — you can tell where your goods are and why two counts exist.
**Length** 2 min 35 s (14 scenes). **Prerequisites** A4.
**Needs** C0, which is BUILT: `RSH-CN-LANDED` is declared, counted in Dhaka,
dispatched and counted in India, with its two counts deliberately disagreeing
twice and for two different reasons. It is in `CONSIGNMENT_SLUGS`.
**Covers** `/inbound` (the register and its three tiles) and then `/inbound/[id]`
— the route sentence that decides the bill, the four tiles, the timeline
labelled by what each step **means** rather than by a status word, both count
cards with their per-product differences, and the freight section.

**The two differences are the video, and they are different KINDS of thing.**
The Dhaka count is short against what the SELLER declared — a conversation
between them and whoever packed it. The India count is short against what
BANGLADESH dispatched — ours to take up with the forwarder. Narrating them as
one thing ("a count went wrong") would lose the only distinction the page
exists to draw, which is also why C0 seeds both on the SAME line rather than
one each.

**It presses nothing**, so its take leaves the world byte-identical and C0's
consignments never need rebuilding.

**Its narration names no quantity.** The counts are the subject, and repeating
them would make the video wrong the day somebody edits
`TUTORIAL_CONSIGNMENTS` — so every line describes the SHAPE ("one line came up
short of the declaration") and lets the table carry the figures. Worth copying
for any video whose subject is a number.

**The section helper is `ordSection` one domain over, with one difference worth
knowing**: a leg's heading renders its title and its receipt number inside one
span, so its text is "Counted at our Bangladesh warehouseGR-2026-09-0027" and an
exact `getByText` finds nothing. `hasText` plus `.last()` is the handle —
sections nest here (the two legs live inside "Each stop") and a parent opens
before its child, so the last in document order is the innermost one carrying
the words.

### C2. Reading your stock · **FILMED** — `read-your-stock.mp4`

**Promise** — you can tell what is sellable today from what is merely yours.
**Length** 2 min 30 s (12 scenes). **Prerequisites** C1.
**Needs** TWO worlds, and the second one is the part that is easy to miss. C0's
`RSH-CN-FLYING` is dispatched and not landed, so its units sit in the
destination TRANSIT bin and the in-transit column is not zero — that is the
obvious half. The other is D0's `RSH-LIFE-CONFIRMED`: **"held for orders" is a
zero unless something is genuinely reserved**, and the difference between owning
stock and being able to sell it is the whole video. So the slug is in
`CONSIGNMENT_SLUGS` AND `LIFECYCLE_SLUGS`, and the flow ASSERTS the register's
reserved column adds to more than zero rather than trusting it.
**Covers** `/inventory` and its three separate numbers: India stock, reserved,
available. Then the column that is never added to the others — **in transit** —
and why: goods between Dhaka and Bangalore are in neither building and cannot
be sold. Value at cost, split the same way; the honest "units with no cost —
excluded" line, which is the consequence of skipping that optional field back in
A4; the register with the same three numbers per SKU; and the low-stock column,
which hands off to C5.

**It presses nothing.**

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

### C6. Uploading a catalogue from a spreadsheet · **FILMED** — `upload-a-catalogue.mp4`

**Promise** — you can load hundreds of products at once, and you never have to
rename your own column headers again.
**Length** 2 min 18 s. **Prerequisites** A3, and B2 for the shape.
**Covers** `/products/import` — a **different importer with different columns**
from the order import — and the feature no tutorial touched: **saved column
mappings**. The arc is auto-detection getting three columns, the import being
BLOCKED because the seller's sheet calls the product name `Item`, a mapping
being saved and made default, the same untouched file being uploaded again, and
the import running.

**IT WAS UNFILMABLE, AND TWO SEPARATE FAULTS MADE IT SO.**

**1. The preview step CRASHED on a catalogue file.** `CsvImportPanel` is shared
with the order importer and its `CsvPreview` declared `orderCount`,
`ignoredHeaders`, `rowsWithProblems` and `problems` as required, above a comment
saying both importers return identical fields. The catalogue preview returns
none of the four. So the panel read `preview.ignoredHeaders.length` on
`undefined`, which THREW DURING RENDER and took the whole "Check before
importing" step down — on the only screen that imports a catalogue. The button
beneath it read "Import undefined orders". Nothing caught it: the fetch casts
`as CsvPreview`, so typecheck believed the declaration, and no test uploads a
catalogue CSV. The four are optional now, defaulted where read, and the two
sentences that differ are chosen by `kind`.

**2. Saved column mappings were applied to nothing.** `resolveMapping` used one
only when the caller passed a `mappingId`; the panel has never passed one and no
screen lets one be picked. A mapping could be saved, marked default, listed with
a chip reading "default", and change nothing about any import — which is the
whole feature. It now falls back to the seller's default for the import type,
laid OVER auto-detection so a header we already recognise keeps working, and
stamps `lastUsedAt` on whichever mapping drove it.
`csv-default-mapping-applies.spec.ts` pins all three properties.

**Also removed: a dead column in the template Skydrop hands out.** `HS Code`
was still in `TEMPLATE_COLUMNS` although `hsCode` left the schema on
2026-08-18 and is not a `CsvTargetField` — so a seller who downloaded the
official template, filled it in and uploaded it was told one of OUR OWN columns
would be ignored.

**Fixture:** `fixtures/rangpur-catalogue.csv`, 12 rows over 5 products, with the
SELLER's headers (`Item`, `Style code`, `Net wt (g)`, `MRP`, `Box L/W/H`) —
none of which is in an alias list, which is what makes the mapping the lesson
rather than a detail. Committed, because the preview's figures are narrated.

**Known and left:** the mapping row still reads "Last used: never" straight
after driving an import — `markUsed` writes it at PREVIEW time and the
`SavedMappings` list is a sibling component with its own query that nothing
invalidates. Cosmetic; the video does not point at that column.

---

## D — When something goes wrong

This is the section the lifecycle seeding exists for. Film D0's seeding once
and every tutorial here becomes `ready`.

### D0. (not a tutorial) The lifecycle seeding · **BUILT** — `lib/lifecycle.mjs`

```bash
node scripts/tutorials/seed-demo-data.mjs --lifecycle
```

NINE parcels, driven the whole way by the real path: an order placed by the
seller, confirmed on a CALL, a waybill booked against the local Delhivery
simulator, picked, packed at the bench with the box ritual, scanned at handover,
then advanced by the simulator — which fires the same signed webhooks the real
courier does. Takes about two and a half minutes from cold. **Verified 2026-09-30, all nine
green, and idempotent: a second run says "already" and changes nothing — except
for the two D4 parcels, which are retired and remade whenever a take has spent
them (`retireSpentParcel`, and see D4).**

| Ref                  | State                             | Used by        |
| -------------------- | --------------------------------- | -------------- |
| `RSH-LIFE-DELIVERED` | DELIVERED                         | B5, D1, E2, D6 |
| `RSH-LIFE-FAILED`    | DELIVERY_FAILED                   | D1, D2         |
| `RSH-LIFE-RETURNING` | RTO_IN_TRANSIT                    | D1, D3         |
| `RSH-LIFE-RESTOCKED` | RTO_RESTOCKED + a REFUNDED ticket | D6, E2         |
| `RSH-LIFE-REVIEW`    | AWAITING_SELLER_DECISION          | D5             |
| `RSH-LIFE-CONFIRMED` | CONFIRMED — **spent by B7**       | B7             |
| `RSH-LIFE-OVERDUE`   | OUT_FOR_DELIVERY, flagged day 3   | D3             |
| `RSH-LIFE-SENDBACK`  | OUT_FOR_DELIVERY — **spent by D4**| D4             |
| `RSH-LIFE-RETURNREQ` | DELIVERED — **spent by D4**       | D4             |

It also leaves behind what those states imply and the videos will want: the
`SCRAP_DAMAGE` ticket **with our reply on it and a `SCRAP_REFUND` credit in the
wallet**, an OPEN early-reservation review, delivery attempts, tracking events,
and `ORDER_CHARGES` and `RTO_FEE` wallet entries.

**`RSH-LIFE-OVERDUE` is the seventh, and it is the one the simulator cannot
produce.** `/needs-attention`'s second list is parcels out for delivery three
nights or more, and the simulator moves a parcel through every scan in seconds.
Its two courier scans are recorded through the product's own admin manual-scan
endpoint with back-dated `eventAtIso` (TRK-9 requires the operator to supply
it, for exactly this), and the flag is raised by running the real NSA sweep
(`POST /admin/nsa/sweep`) rather than by stamping `nsa_*`.

**`RSH-LIFE-REVIEW` is REBUILT rather than resumed** — see D5 for why, and why
it is the only parcel that may be DELETED.

**D4's two are RETIRED and remade, which is a third thing and not a rewind.**
`RSH-LIFE-SENDBACK` and `RSH-LIFE-RETURNREQ` are spent by their own take, so a
parcel found past its state has its `sellerOrderRef` moved to `<ref>-SPENT-<n>`
and a fresh one is built under the canonical name. Nothing is deleted and
nothing is unwound: the spent parcel keeps every movement, every wallet entry,
its waybill and its reverse booking. Three tests make a parcel spent, and the
second two exist because the first is not enough:

1. **its status moved** — a return request takes it to RTO_INITIATED;
2. **the courier has already been told** (`shipments.courierCancelledAt`) — a
   SEND-BACK leaves the order at OUT_FOR_DELIVERY, because CUR-11 says the
   courier's scans are the only authority on our status and accepting a
   cancellation is not a scan. Without this, the next take would film a second
   send-back on a waybill the courier had already cancelled;
3. **the simulator has forgotten its waybill.** The sim keeps parcels in
   memory and says so ("Restarting is the reset"), our database keeps the
   waybill either way — so after a sim restart the order sits perfectly at
   OUT_FOR_DELIVERY carrying a waybill the courier has never heard of, and the
   one thing D4 does with it is a live call against that waybill. It cost a
   failed take once; it is checked now (`/_sim/parcels`, failing safe towards
   "the sim still knows it").

**The retired parcels ACCUMULATE, about two per take, and that is the price of
never rewinding.** After D4 was built there were eight
(`RSH-LIFE-SENDBACK-SPENT-1…4`, `RSH-LIFE-RETURNREQ-SPENT-1…4`). Each is a real
parcel with stock decremented, money charged and a waybill, which is exactly why
none of them is deleted. Two consequences to know before they surprise somebody:
the seller's order list and its status tabs grow by two per take (every D-section
video finds its parcel BY CUSTOMER NAME, so no scene is aimed at a row that
moves), and **a retired SENDBACK sits at OUT_FOR_DELIVERY for ever** — so three
nights later the NSA sweep will start flagging it onto `/needs-attention`'s
overdue list, which is D3's second list. D3 finds its own parcel by name too, so
its scenes hold; what changes is how many rows are beside it. If that list ever
needs to be exactly one row again, the honest fix is to cancel the retired ones
through the product (which gives their stock back through `UNPACK_STOCK`), not
to delete them.

**Wiring:** `LIFECYCLE_SLUGS` in `seed-demo-data.mjs` holds the five D-section
slugs filmed so far. A new video that needs a moved parcel adds its slug there,
and the pass then runs before that video's take — it is expensive (a courier
booking and a warehouse run per parcel) so it does not run for videos that do
not need it. `--lifecycle` forces it, which is how it is built the first time.

**The open question is settled: yes, D5 is filmable.** `handleNdrCap` resolves
`inventory.early_reservation_ndr_action` (MANUAL_REVIEW by default) and nothing
else — it never reads `inventory.early_reservation_enabled`. The enable switch
governs whether stock is booked AT PLACEMENT; the pause at the cap is a
question about whether to keep CALLING, and every seller gets to answer it. The
seeded review carries `heldQty: 0`, which is the honest number.

#### What the build found, and what it refuses to do

**IT NEVER REWINDS, BUT IT DOES RESUME.** These parcels carry stock, money and
a courier booking, so a seed that unwound a delivered one to re-film a video
would be the most dangerous thing in this directory. But the first build has to
survive a crash halfway through — which it did not, twice — so a parcel found
short of its state is carried FORWARD from where it is
(`RESUMABLE_FROM`: PENDING_CONFIRMATION, CONFIRMED, DISPATCHED). One abandoned
mid-warehouse is named and left, because picking up a half-made allocation
blind is how a seed corrupts stock.

**It refuses any courier that is not the simulator.** `assertSimulator` demands
a loopback `courier.delhivery_api_base_url` AND the simulator's own route
answering on it. This is the one script here that would book REAL PARCELS
against the real base URL with live writes on — which is the configuration
production runs.

**A stale call-queue entry can block the whole call centre, for ever.** CC-6's
dequeue is post-commit and best-effort, and CLAUDE.md says the recovery is "an
admin re-enqueue / out-of-band reconciler". There is no such reconciler, so on
this box an entry left by an abandoned simulator run sat at the head of the
queue pointing at an order that had reached RTO_RESTOCKED — and because the
FIFO is `(scheduled_attempts > 0) DESC, available_at ASC` and forty-four
reschedules had accumulated on it, it OUTRANKED every genuine call. Releasing
it put it straight back at the front. **Nothing on the box could be confirmed
through the call centre at all.** `reconcileStaleCallQueue` closes entries
whose order is no longer PENDING_CONFIRMATION — the rule itself, which is why
it is safe across every seller. **Worth considering as a real background
sweep**: on production the same leak would quietly starve the call queue.

**A crash between `pick_started_at` and the PENDING_PICK transition makes a
parcel invisible.** `PickExecutionService.start` stamps the claim and THEN
transitions, and the pick queue filters on `pick_started_at IS NULL` — so the
queue answers "empty" to an order sitting plainly at CONFIRMED.
`releaseStalePickClaim` uses WMS-5's own supervisor override
(`POST /admin/warehouse/picks/:id/expire`), which is the product's recovery
path rather than a seeding shortcut.

**`warehouses[0]` was a coin toss.** The seed picked the first warehouse the
admin list returned, and `ensureBdIntakeWarehouse` adds one that does not
fulfil orders (CNS-2) — so a putaway was refused as "must be a non-hold bin in
the receipt warehouse", which names neither the warehouse nor the cause. It
picks the one with `fulfilsOrders` now.

**The restocked parcel carries TWO units, and that is the point.** The
curriculum wanted it RTO_RESTOCKED *and* carrying a damage ticket, which on a
one-unit line is a contradiction — a restock means the unit was GOOD. WMS-8d is
exactly the answer, so the line is inspected BY QUANTITY: one unit back on the
shelf, one written off. Order status RTO_RESTOCKED, scrap ticket beside it.

#### The one thing D0 did NOT produce — BUILT 2026-09-30, and it found a bug

**A parcel stuck with a courier** — `RSH-LIFE-OVERDUE`, now built. Driven to
DISPATCHED like the others, then given its IN_TRANSIT and OUT_FOR_DELIVERY
scans through the admin manual-scan endpoint with back-dated `eventAtIso`, and
flagged by running the real NSA sweep. No column is written that the product
does not write itself.

**AND IT DID NOT WORK, WHICH WAS THE FINDING.** The sweep raised nothing. Its
`outForDeliveryAt` read `order_events.created_at` — when WE RECORDED the
courier's scan, not when the courier made it. On a healthy evening the two
agree, which is why it had never shown; they part company in exactly the cases
the sweep exists for. A webhook queue stuck for a day and then drained writes
today's order event for yesterday's scan. A scan recorded by hand writes one
dated now for a scan a week old. Either way the clock restarts at zero, so the
parcels whose scans were themselves late — the ones most likely to be genuinely
stuck — are the ones never flagged. The same shape as the returns worklist's
`shipments.updatedAt` bug (rule 4b), one directory over. It reads
`tracking_events.eventAt` through `reachedStatusAt` now, with the order event
as the fallback for a parcel that has no scan at all, and `list()` stopped
asking per row against the tracking hypertable while it was there.

#### Two findings left OPEN, for whoever films next

**The `/tickets` "Raise an issue" modal asks for an order by UUID.** Its hint
says "copy the ID from the order page", and the order page shows an order
NUMBER. `CreateSellerTicketDto.orderId` is `@IsUUID()`, so a number is refused
at validation with a generic message. The path that works is "Raise an issue"
ON the order, where the field is not asked for at all — which is what D6 films.
Fixing it means teaching `TicketService.open`'s scoped lookup to accept a
number as well, and five other callers share that method.

**The D-section parcels now carry a take's leavings unless the seeding clears
them.** `clearDeliveryTakeArtefacts` removes the delivery-action request, the
requested call and the ticket of either kind. **A new D/E video that WRITES on
a lifecycle parcel must add its leavings there in the same change** — those
parcels are never rebuilt, so anything written on one survives into every later
take.

**Consequence for every OTHER video:** once this has been run on a box, the
demo seller has delivered and returned parcels for good — `clearPreviousOrders`
excludes the lifecycle refs deliberately, because rebuilding one costs a real
courier booking and a warehouse run. A re-take of an earlier video therefore
films a fuller order list than the first take did. That is an improvement, not
a regression, but it is the kind of thing worth knowing before staring at a
diff between two takes.

### D1. Where is my parcel · **FILMED** — `where-is-my-parcel.mp4`

**Promise** — you can answer a customer asking where their parcel is, without
ringing anyone.
**Length** 1 min 47 s. **Prerequisites** B5. **Needs** D0, and it is in
`LIFECYCLE_SLUGS`.
**Covers** `/tracking`: every parcel carrying a waybill, the three tiles and
the small print under them (they count the parcels SHOWN, not the fleet), the
two filters a seller actually comes for, the scan history, the search, and the
fact that nothing on the screen is a button. **The history opens BENEATH the
table, not inside the row** — this entry said "expanding in place" and it does
not.

**FILMING FOUND A 500 ON THE ONE FILTER A SELLER COMES HERE FOR.** The
component's `FILTERS` list said `DELIVERY_FAILED`, which is an ORDER status;
the shipment enum's value is `DELIVERY_ATTEMPTED`. So the tab sent Prisma a
value the column cannot hold and the whole screen came back `API 500
(INTERNAL_ERROR)`. The KPI tile counted the same non-existent value and
therefore read **0 failed deliveries for ever**, beside a parcel that had
plainly failed one. Two faults, one mistake, both invisible to typecheck
because a query string is a string.

Fixed, and pinned twice: `tracking-filters-are-shipment-statuses.test.ts`
reads the FILTERS list out of the source and checks every value against the
enum, and `seller-tracking-status-filter.spec.ts` makes an unknown `?status=`
a **400 that names the value and lists what was allowed** rather than a 500 —
a bad query parameter should never be an internal error.

**And a third: a delivery attempt was drawn against every scan.** The timeline
joined attempts to scans on the minute alone, which is right when scans are
hours apart and wrong the moment a parcel moves quickly — five simulator scans
inside one minute all matched the single attempt, so "In Transit — Attempt 1 —
Failed" appeared against a parcel that was simply moving. An attempt now
attaches only to a `DELIVERY_ATTEMPTED` scan, which is the scan that caused it.

### D2. The customer was not there · **FILMED** — `the-customer-was-not-there.mp4`

**Promise** — you know what happens after a failed delivery and what you can
ask for.
**Length** 2 min 16 s. **Prerequisites** D1. **Needs** D0's DELIVERY_FAILED
order, and it is in `LIFECYCLE_SLUGS`.
**Covers** the failed order end to end: the tracker, the "Delivery did not
succeed" panel, every call we have made to that customer, and then the "Ask
admin to act" dialog — all three choices, each SELECTED so its own hint is on
screen while it is described. It SENDS a recall, and closes on the card that
appears on the order carrying what was asked, our reply and the ticket it
opened.

**It sends the RECALL, not the re-attempt, and that is deliberate.** A
send-back reaches the courier on the click (CUR-10's seller amendment) and
would turn D0's failed parcel into a returning one — D4 owns that. A
re-attempt opens a COURIER escalation with a thread hanging off it; a recall
opens a plain seller issue and queues a call, both of which the seeding clears.

**FILMING FOUND THREE.** (a) A delivery attempt was drawn against EVERY scan
in the order's Full history — the identical defect D1 fixed on the tracking
page, in a second place (`OrderJourneyService`), and equally invisible until a
parcel moves fast enough to put several scans in one minute. The simulator does
exactly that, so "In transit — Delivery attempt 1 — could not reach the
customer" appeared three times on a parcel that was plainly still moving. (b)
Every auto-approved request replied with ONE hard-coded sentence — "returning
their own parcel is the seller to decide" — which is true of a send-back and
false of the other two, so a seller who asked us to RING their customer read
back a note about returning a parcel as our reply to them. (c) Asking opens a
ticket, and the mutation invalidated only the actions list — so "Issues raised
on this order", a few centimetres below the reply, went on saying "Nothing
raised yet" about the ticket just created, on the same page, until a reload.

### D3. What needs you today · `needs demo data`

**Promise** — you can open one screen in the morning and know what is waiting
on you.
**Length** 3 min. **Prerequisites** D1. **Needs** D0.
**Covers** `/needs-attention` and its two lists, which are two different jobs:
orders the call centre could not confirm (**you owe a decision**) and parcels
out for delivery three nights or more (**you are waiting on a courier**). The
page has no buttons at all and says why: the seller cannot make a courier
deliver, and offering an action there would be theatre.

### D4. Asking for a parcel back · **FILMED** — `ask-for-a-parcel-back.mp4`

**Promise** — you can turn a parcel round, and you know the fee before you do.
**Length** 2 min 52 s (15 scenes). **Prerequisites** D1. **Needs** D0, and it is
in `LIFECYCLE_SLUGS`.
**Covers** the seller's own "send it back" on an in-flight parcel — **the one
customer-facing action that calls the courier directly, with no operator in the
loop** (CUR-10's seller amendment) — and then "Request return" on a delivered
one. **Both are PRESSED.** The send-back goes through the ask dialog (the choice
changes the dialog's own description and the button's colour), a reason nobody
approves but the returns bench reads, and the second confirmation that names the
order and repeats the fee. The return request closes on the toast carrying the
**reverse waybill** — the collection really is booked.

**This entry named the wrong parcel, and the code says why.** It asked for "D0's
CONFIRMED-with-waybill" order. `DeliveryTroublePanel` renders only while the
order is `DELIVERY_FAILED` or `OUT_FOR_DELIVERY`, so on a CONFIRMED order there
is no panel and no button at all. The send-back needs a parcel that is MOVING.

**IT IS THE ONE VIDEO THAT SPENDS WHAT IT FILMS**, so it has its own two parcels
— `RSH-LIFE-SENDBACK` (out for delivery) and `RSH-LIFE-RETURNREQ` (delivered) —
rather than borrowing D2's failed one or D0's delivered one, which four other
videos read between them. `retireSpentParcel` is what makes it re-takeable: a
parcel found past its state has its `sellerOrderRef` moved to
`<ref>-SPENT-<n>` and a fresh one is built under the canonical name. **Nothing
is unwound** — the spent parcel keeps every movement, every wallet entry, its
waybill and its reverse booking, and carries on being a parcel that is coming
back. That is the only shape that respects D0's never-rewind rule for a parcel
this far down the line; the only other departure, `rebuildStaleReviewParcel`,
really does delete, and is safe only because its parcel was never confirmed.
**A `--check` pass spends one too** — check mode drives the real app and really
presses the button — so "check twice with a seed in between" is three parcels,
about twenty seconds each on the simulator.

**FILMING FOUND THE FEE ON SCREEN WAS A LITERAL.** `RequestReturnDialog`'s copy
carried `₹200`, and `pricing.customer_return_fee` is per seller with its own
currency key beside it (PRC-8) — so the sentence was right for the seeded
default and wrong for anybody who negotiated one, and wrong for everybody the
day the default moves. Which has happened: the DELIVERY fee's default became
৳200 on 2026-09-20 and no screen changed. The send-back half was worse — it said
"a return fee applies" and named no figure at all, while charging a **different**
fee (`pricing.flat_rto_fee`, ৳30 ≈ ₹22), so a seller who read the ₹200 in one
dialog and pressed the other paid something else.

And **not one of the three flat fees was readable anywhere in the seller app**:
`/wallet/limits` (E4) lists the wallet's terms and deliberately names only the
TIMING of the delivery fee, never the amount. E4's narration is honest about
that and needs no re-take.

`GET /seller/pricing/fees` is the fix — the three fees priced in rupees at the
moment they are read, from the engine that takes the money, with the agreed
amount and currency beside each so "৳30" and "₹22.22" are both on screen. Gated
on `orders.view`, **not** `wallet.view`: the callers are return dialogs on an
order and the Operations role cancels orders without ever seeing the wallet.
An unpriceable fee answers `amountInr: null`, never a zero — PRC-8 already
refuses to CHARGE a zero, and showing one would promise a free return and then
take money for it. `feeFigure` in `apps/seller/src/lib/fee-figure.ts` is the one
formatter both dialogs read.

**The narration names neither figure**, now that both are on screen — which also
means a price change does not silently make this video wrong.

### D5. The customer would not answer · **FILMED** — `the-customer-would-not-answer.mp4`

**Promise** — you can decide what happens to an order our agents could not
confirm.
**Length** 2 min 23 s. **Prerequisites** D3. **Needs** D0's
AWAITING_SELLER_DECISION order, and it is in `LIFECYCLE_SLUGS`.
**Covers** `/holds` ("Unreachable customers"): how many calls were made, the
two choices — **let it go**, which rejects the order and returns any held units,
behind its own second confirmation, and **keep trying**, which puts it back in
the call queue. One scene is about the tile that is NOT there: the held-units
figure is absent rather than zero unless the seller has opted into
at-placement holds, and the page says why.

**It presses KEEP TRYING and cancels out of the confirm.** Letting the order go
is a terminal reject and D0 cannot rebuild a rejected order; "keep trying" puts
it back in the queue, which the seeding rings to the cap again.

**THE REVIEW PARCEL IS THE ONE LIFECYCLE PARCEL THAT IS REBUILT RATHER THAN
RESUMED.** `handleNdrCap` upserts with `update: {}`, so an ANSWERED review is
never reopened — ring the order back to the cap and it parks at
AWAITING_SELLER_DECISION with nothing open on `/holds`, and the video cannot be
re-taken. (The order is not stranded; the product's own `sweepOrphans` expires
it on the TTL. It is simply not filmable.) So `rebuildStaleReviewParcel` deletes
and remakes it whenever it is not exactly right — which is safe for THIS parcel
and no other, because it was never confirmed: no waybill, no picked stock, no
wallet entry, no courier booking.

**FILMING FOUND ONE, and the seeding three.** The register identified an order
by the first eight characters of its uuid — which a seller cannot read down a
phone, match against their order list, or search for, and which
`/needs-attention` prints as a proper order number two clicks away. `ReviewView`
carried no `orderNumber` at all. Now it does, on every read.

The three in the seeding, each a predicate about the wrong thing: the stale-call
reconciler closed the legitimate re-queue of every second ring (an order at
CALL_NO_RESPONSE is still callable); the ring loop stopped after one attempt for
the same reason; and putting our entry at the front of the queue computed
"earliest minus a minute", which on a queue holding only a backed-off retry is
still in the FUTURE, so `pullNext` correctly handed back nothing.

### D6. Something arrived damaged · **FILMED** — `something-arrived-damaged.mp4`

**Promise** — you can follow a damage claim from the warehouse finding it to
the refund landing in your wallet.
**Length** 2 min 26 s. **Prerequisites** B5. **Needs** D0's damage ticket,
which the lifecycle pass now REPLIES TO and SETTLES WITH A REFUND, and it is in
`LIFECYCLE_SLUGS`.
**Covers** both halves of `/tickets`: the ticket **Skydrop raised** when a
returned parcel was inspected, and one the **seller raises**. Then
`/tickets/[id]` — the conversation, which opens with what the bench actually
found unit by unit (WMS-8d's own wording), and the resolution leading with the
money — followed through to the `Damage settlement` credit sitting in the
wallet ledger.

**The issue is raised FROM THE ORDER, not from `/tickets`.** That is the path a
seller uses, and it is the one that works: the modal's own order field is a
paste box for a UUID whose hint says "copy the ID from the order page", and the
order page shows an order NUMBER. From the order the field is not asked for at
all. **Reported, not fixed** — `CreateSellerTicketDto.orderId` is `@IsUUID()`
and accepting a number as well means changing `TicketService.open`'s scoped
lookup, which five other callers share.

**The category is chosen BY LABEL, never by index.** Delhivery's list is
ordered by their own id, so the first entry is "Behaviour complaint against
staff" — which a first cut selected, under narration about a missing saree. A
frame check is what caught it.

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

### E2. Reading your wallet · **FILMED** — `read-your-wallet.mp4`

**Promise** — you can tell what you have from what you have merely asked for.
**Length** 3 min 03 s (16 scenes). **Prerequisites** E1. **Needs** D0, and it is
in `LIFECYCLE_SLUGS`.
**Covers** the three tabs and why they are three: **Ledger** is what happened;
**Top-ups** and **Withdrawal requests** are what was asked for and has not
landed. Then the entries themselves, one scene each — a delivery charge, the COD
credit, the tax deduction directly beneath it, a damage settlement — and the
balance shown in both rupees and taka with the rate it used. It presses nothing
that moves anything.

**Its seeding had to produce a COD credit, which is the one ledger entry a
parcel cannot write on its own.** On the default `wallet.cod_credit_mode` of
SETTLEMENT a COD is credited when the COURIER PAYS US (WAL-5) — an operator
recording a payout, not a consequence of delivery. So
`settleOneCodForLedger` records a real one through
`POST /admin/courier-settlements`, which writes the credit AND the tax
withholding beside it; that pair is the middle third of the video. Two things it
learned: a settlement must name **the account that CARRIED the parcel** (CACC-1
— this box has two Delhivery accounts whose labels differ by one word, and
`SETTLEMENT_ORDER_OTHER_COURIER` refuses the wrong one), and the courier account
needs a rupee bank account linked or TRE-3 refuses it outright. It settles
`RSH-LIFE-DELIVERED` only: D4's parcels are retired and remade, and money
against an order about to be renamed would be money nobody can find.

**Scenes point at rows BY LABEL (`ledgerRow`), never by position** — the ledger
is newest-first and any seed run can add an entry. The matcher looks for a CELL
STARTING WITH the label rather than an exact match: `LedgerEntryLabel` renders
the direction's words as a bare text node with the entry's note in a `<div>`
right after, so nothing in the row is exactly the label and an exact match finds
nothing at all.

**FILMING FOUND THE REFUND'S LEDGER NOTE NAMED ITS TICKET BY UUID.**
`TicketService.transition` wrote "Ticket &lt;uuid&gt; settled" on the
`SCRAP_REFUND` — the line a seller reads under "Damage settlement", and the only
pointer from the money back to the claim it settled. A uuid cannot be read down
a phone, matched against the ticket list or typed into its search box, which is
precisely why TKT-1 gave tickets a number. **The same defect D5 found on
`/holds`, in a second place.** It names `TK-YYYY-NNNNNN` now; the seeded row is
brought into line by `renameRefundNoteToTicketNumber` (the note only — no
amount, no direction, no running balance). D6 films that row too.

**Two seeding tells were on camera and are gone**: the accepted top-up's
operator note read "Seeded for the withdrawal tutorial." and its reference
"TXN-SEED-1790717138318". Both are printed in full on the Top-ups tab, which
this video dwells on for eight seconds. **A note or a reference a seed writes is
published material if any video shows the screen that prints it.**

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

### F4. What Skydrop tells you, and how to quieten it · **FILMED** — `quieten-your-notifications.mp4`

**Promise** — you get the notifications you want and none of the ones you do
not.
**Length** 2 min 40 s (14 scenes). **Prerequisites** A1.
**Needs** nothing built: D0's parcels and the nightly sweeps have filled that
inbox many times over. What it needs is a RESET, because everything it presses
is durable — a message read, a message dismissed, a topic silenced.
`notificationWorldFor` puts all three back.
**Covers** the bell, `/notifications` (the counts, the two rows of filters, a
message opened in place, the unread filter proving it was read, and Dismiss)
and then the two grains on `/notifications/settings`: **your own** per-topic
silences and **your company's** per-category email. These were two screens and
people changed the wrong one. Ends on what cannot be switched off at all.

**Its seeding is the shape to copy for any video that changes a PREFERENCE.**
The messages are UN-MARKED, never deleted: `notification_logs` is the ledger the
NOTIF-2 dedup gate reads, and NOTIF-21 is explicit that a "delete" in this inbox
is a dismiss for exactly that reason. The per-topic silences ARE deleted,
because an absent `notification_subscriptions` row means the topic reaches you.
The company's categories are **upserted back to their defaults rather than
deleted** — and that distinction was found in a frame: deleting them looked
right (the resolver fails open, NOTIF-15), and left the company half of the
settings page reading "Company categories — 0" under a line describing a table,
because nothing recreates those rows on a read.

**Two flow lessons, both cheap and both general.** A `<li>` whose `id` is a
uuidv7 cannot be addressed as `#id` — it starts with a digit, which is not a
valid CSS identifier, and Chromium throws rather than matching nothing; use
`[id="…"]`. And **a page-header action can share its name with a nav item**:
`getByRole('link', { name: 'Settings' }).first()` took the sidebar's Account →
Settings, which navigates perfectly to the wrong page, so the failure arrived as
a URL wait timing out thirty seconds later rather than as a selector miss. The
href is the unambiguous handle.

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

### G1. What a reseller store is · **FILMED** — `open-a-reseller-store.mp4`

**Promise** — you can open a store for someone who will sell your stock under
their own name.
**Length** 2 min 20 s. **Prerequisites** A1.
**Covers** `/reseller-stores`, opening one end to end, and then its own page:
the four tabs, the details record, pausing, and the fact that closing for good
is reachable only from paused.

**Three things the video says because the screens only half say them.** A store
the SELLER opens is ACTIVE at once — `initialStatusFor` maps SELLER → ACTIVE
and ADMIN → PENDING_SELLER_APPROVAL, derived from the actor and not from the
body, so a seller cannot create a pending store and never sees the approve /
reject card. The two names are different things: one is what you call them, the
other is what a customer reads on a parcel. And the invitation is REQUIRED —
"a store with nobody able to sign in is a row that looks open and can do
nothing", which is the DTO comment's own reasoning.

**Closing is named and not clicked.** It is final, and the page states its
conditions in one sentence the narration follows rather than restates.

**Seeding:** a store name is unique per seller (`STORE_NAME_TAKEN`), so a take
left behind refuses the next one. The delete is HARD and safe for a stated
reason: nearly everything hanging off `seller_stores` is `onDelete: Cascade`
(roles, invitations, users, events, wallet, terms, tickets, webhooks), and the
thing that is not — orders — is exactly what the cleanup refuses to delete
around.

### G2. The price they pay · **FILMED** — `set-a-reseller-price.mp4`

**Promise** — every store has a default transfer price and a retail range.
**Length** 2 min 5 s. **Prerequisites** A3 (products).
**Covers** `/reseller-stores/price-list`: an unpriced row and what that means,
the four figures, and removing a price again. **It needs no store to exist** —
G1 is not really a prerequisite, and the video is filmed against a catalogue
alone.

**The sentence it makes sure lands** is the page's own subtitle: a price for
one particular store is set on THAT STORE'S page, not here. The screen says it
once, in small type, above three tiles that pull the eye — so the video scrolls
back up and dwells on it.

**The video removes the price it set**, which leaves the world clean and
teaches the guard on removal (a store already selling at your default price
must be given one of its own first). The seed clears it anyway, as the backstop.

### G3. What one store sells · **FILMED** — `what-one-store-sells.mp4`

**Promise** — you can decide which products a store sees, at what price, and
how much of your stock it may have.
**Length** 2 min 58 s (16 scenes). **Prerequisites** G2.
**Covers** the "Catalogue & stock" tab, one product end to end: enabling it, a
price that overrides the default, the two stock modes — **shared** versus a
**set-aside** quantity — the hidden share, and the overlay name the store's own
customers read. It closes on the row's last two columns DISAGREEING, which is
the whole idea of the page: 40 really available, 9 that the store is shown
(a 12-unit set-aside, a quarter of it held back).

**Its seeding is the mirror image of G1's and G2's, and that is the interesting
part.** G1 opens a store on camera and would collide on the name
(`STORE_NAME_TAKEN`); G2's fourth scene is an UNPRICED row whose button reads
"Set price". So `resellingWorldFor` REMOVES the store and the price for those
two and `standingStoreFor` BUILDS both for this one — the same shape
`walletWorldFor` uses for E1 and E3, where each video's world is the other's
contradiction.

What it deliberately does not leave is any per-variant term:
`reseller_store_variants` is wiped on every run, because a second take starting
from a row already enabled would film the switch going the other way over a form
pre-filled with the first take's figures. The store and the prices are built
through the REAL endpoints — `initialStatusFor` maps a SELLER-created store to
ACTIVE and an ADMIN-created one to PENDING_SELLER_APPROVAL (derived from the
actor, never the body), and the price PUT is what applies
`RETAIL_RANGE_INVERTED` / `SUGGESTED_OUTSIDE_RANGE`.

**The product is `RSH-KANTHA-BLUE`, not the scarf.** G2's take clears the
scarf's default price on every run, and a product with no default is the one
this video must not open on — the form then says "set one on your price list",
which is a different lesson. Rows are found BY SKU (`storeCatalogueRow`), never
by position: the table is every active variant the seller has.

### G4. The deal · **FILMED** — `the-deal.mp4`

**Promise** — you can publish terms and see exactly who pays what.
**Length** 3 min 03 s (15 scenes). **Prerequisites** G3.
**Covers** the "Terms" tab: the share of each of the six Skydrop fees the store
pays, each party's credit timing, and the **live worked example the API computes
as you type** — against the seller's REAL fees, so the table reads ₹148.15
delivery and ₹200.00 customer return rather than round numbers. Then publishing
a version, and the panel saying it is in force but not yet accepted.

**Its seeding is one line on top of G3's.** `standingStoreFor` already builds
the store, so `'the-deal'` joins `STORE_REQUIRED_SLUGS` and the only addition is
clearing the terms version a take publishes. That clearing is not optional:
versions are append-only and NUMBERED (RS-4), so a second take would open on
"Publish version 2" over a card already holding the first take's percentages,
and every sentence about "the first terms" would be wrong. **Deleting is safe
for a stated reason** — an order snapshots its version through a RESTRICT
foreign key, so a version any order points at cannot be deleted at all; the
database refuses rather than the script having to judge. There are no store
orders until G6.

**`getByLabel` is SUBSTRING by default and it cost a run**: "Return fee — store
pays (%)" matched the customer-return field as well and Playwright refused under
strict mode. Every fee field is `{ exact: true }` now, whether or not it
collides today — a seventh fee could make any of them ambiguous.

**The `live-example` scene is anchored on the computed sentence's own wording**,
not on the element: its placeholder while the request is in flight is "Working
out an example…", so waiting for the real text is what stops the scene filming
the placeholder and calling it a worked example.

### G5. What a store may do without asking · **FILMED** — `what-a-store-may-do.mp4`

**Promise** — you decide, per task, whether a store acts directly or needs your
approval.
**Length** 2 min 43 s (14 scenes). **Prerequisites** G4.
**Covers** the "What they can do" matrix, THREE of its seven rows rather than
all of them: the gentlest task set to direct, the send-back set to
needs-my-approval, and one turned off entirely. Seven rows narrated one at a
time would be a list; three chosen for the argument they make is a tutorial. The
consequences differ per task and are the reason this is not one switch — a
direct send-back asks the courier to turn the parcel round the moment the store
clicks, and the row says so in its own words.

**The seeding DELETES the policy row, and that is exactly right rather than
convenient**: a missing row IS the defaults (`DEFAULT_POLICY`, pinned against
the migration's own column defaults), so removing it is not clearing the store's
permissions — it is putting them back to what a store nobody has configured has.
It also makes the page open on "Running on the defaults — you have not set this
store yet", which is the sentence the second scene argues from and which never
appears again once a take has saved.

**READING `DEFAULT_POLICY` BEFORE WRITING THE SCRIPT CAUGHT TWO LINES THAT WOULD
HAVE BEEN WRONG ON CAMERA**, and the lesson generalises: when a video is about a
form's settings, read what the form OPENS ON before writing what the video does
to it. (a) `recall` already defaults to DIRECT, so a scene claiming to choose it
would have been a click that changes nothing under narration saying otherwise —
it reads the row instead. (b) The save confirm lists only what CHANGED, not the
whole matrix, so "restates the whole matrix task by task" was false; it now says
"lists exactly what you are changing… nothing you left alone is listed", which
is both true and a better thing to teach. The take's only net change is
`cancel` going to No, and the confirm shows exactly that one line.

### G6. Answering what a store has asked · **FILMED** — `answer-what-a-store-asked.mp4`

**Promise** — you can clear the queue of decisions stores are waiting on.
**Length** 2 min 36 s (14 scenes). **Prerequisites** G5.
**Covers** `/reseller-stores/requests` and its three families — cancels and call
questions and issues, delivery asks, and order and address changes. It
**approves** one (the confirmation restating the store, the order and what
approving will DO), **turns one down** (which needs a reason, and the store
reads it), and **reads** the third, because the third is a comparison rather
than a decision. The nav badge is the bookend: it is on every screen, which is
why this queue does not sit unread.

**Which row is answered and which is only read is a SEEDING decision as much as
a teaching one**, and it is what makes the take repeatable at all:

- the **cancel** is APPROVED, which ends that order — so the seeding places a
  new one, numbered, on the next run and leaves the spent one exactly as it is
  (the D4 rule: forward motion, never a rewind). It is the cheapest order in
  the library to remake, because nothing is reserved before confirmation
  (ORD-10).
- the **delivery ask** is TURNED DOWN, which changes NOTHING about the parcel —
  so the expensive one (a real waybill against the simulator, a pick, the pack
  bench, a handover scan and two scans on the road) is re-used for ever and
  only the ask is raised again. Approving it would have asked the courier to
  turn a parcel round, and the next take would have needed a whole new parcel.
- the **issue** and the **order change** are read and not answered, so they
  stand from one take to the next.

**It films a SECOND reseller store, `Pune Silk Studio`, and that is not
decoration.** G4's seeding DELETES every terms version of the store it
configures, so its take can publish "version 1" — and an order snapshots the
version it was placed under through a RESTRICT foreign key (RS-4). The moment a
store has an order, that delete is refused BY THE DATABASE. Putting G6's orders
on the standing store would therefore have made G4's own seed throw on its next
run, and G4 could never be re-taken. G4's entry named this trap and ended
"there are no store orders until G6"; the answer is to keep the two worlds
apart rather than weaken a delete that is right. It also reads better — the
queue's first column is the STORE, and a column with one value in it teaches
nothing.

**Its seeding is the heaviest in the library**, and every step is a refusal the
product makes if it is skipped: a store USER who has actually signed in (a store
whose invitation nobody accepted can do nothing), `reseller.orders_enabled`
switched on for this seller (SET-1, seeded FALSE, fails closed — it guards
money), terms PUBLISHED and ACCEPTED (`RESELLER_TERMS_NOT_READY` until both),
one product enabled in the store's catalogue at a price of its own, and an
action policy saying the seller wants to see these tasks first. Only then can
the store place anything.

**The invitation token is not recoverable, and the seeding says so out loud.**
`store_user_invitations.token` holds a SHA-256; the plaintext exists only in the
email, and there is no mail here. So the seed mints a plaintext of its own,
writes its hash onto the invitation, and goes through the PRODUCT'S OWN
acceptance endpoint with it — which creates the user, hashes the password,
attaches the role and opens the session. Only the delivery of the token is
faked.

**`clearPreviousOrders` had to learn a second protected prefix.** `RSH-STORE-`
joins `RSH-LIFE-`, and protecting it is not an economy — it is a REFUSAL: a
reseller order carries held requests, a terms snapshot and its store's money
rows, none of which that function's delete list knows about, so sweeping one
would fail on a foreign key half way through some OTHER video's seed run.

**Two bugs, both found by opening the screen** — see [Bugs found](#bugs-found-while-establishing-feasibility).
The queue CRASHED outright as soon as any store asked for a change, taking the
two working queues down with it; and one store appeared under two different
names in one stack of tables.

### G7. How your stores are doing · **FILMED** — `how-your-stores-are-doing.mp4`

**Promise** — you can see what each reseller store is doing to your goods and
your money, and stop one that keeps sending them back.
**Length** 2 min 48 s (14 scenes). **Prerequisites** G6.
**Covers** `/reseller-stores/reports` — the four figures across every store, the
per-store scorecards, the ranking, and the transfer revenue each store put on
your wallet — then the one WRITE hiding on a reports page, the auto-pause rule,
and finally `/reseller-stores/stock-forecast`.

**Two of its scenes exist because the page is honest about what it does not
know, and those are the ones worth keeping.**

- **Coverage.** Every margin on this page carries how many of its lines it could
  put a cost against, because a cost is not recorded for every line and a bare
  rupee figure would read as complete (TRE-6's rule, applied to a store). The
  seeding records a unit cost on ONE of the store's two products for exactly
  that reason — through the goods receipt, which takes it per line, never
  written onto the batch by hand.
- **Why a store that has delivered can show a LOSS.** The ranking is "wallet
  credits less charges, less the cost of the goods delivered", and under the
  terms the seeding publishes both parties are credited three days after
  delivery — so on the day it is filmed the goods have gone, the charges are on
  the wallet and the credit is DUE rather than paid. The figure is negative and
  it is correct. **This was left as it is rather than engineered away**: INSTANT
  credit timing would have made it positive, but an order snapshots the terms it
  was placed under (RS-4), so a box that had already traded could never be made
  to agree with a fresh one — and a narration that is right on one box and wrong
  on the other is worse than a number that needs a sentence. The sentence is the
  scene, and it is the most useful thing in the video.

**Its seeding shares G6's world and adds two parcels whose FATE IS KNOWN.** The
scorecards divide by outcomes, never by orders placed (`reseller-scorecard.ts`),
so G6's world alone — two cancels, one order waiting on a call and one parked out
for delivery for ever — leaves four dashes where the rates should be. One order
is driven all the way to DELIVERED and one through the returns bench to
RTO_RESTOCKED, on two different products. Neither is ever answered or spent:
**this take writes the auto-pause rule and touches no order at all**, which is
what makes it re-takeable without a courier booking.

**`driveOrderThrough` is the generalised form of G6's driver** (`lib/lifecycle.mjs`):
the same call, the same box ritual, the same signed webhooks, plus whatever
scans the caller names and optionally the returns bench. It can also pick a
parcel up MID-ROAD — `MID_JOURNEY` — because its caller names a target several
scans away and a run that died between two of them leaves a parcel it knows how
to finish. Replaying a scan the order is already past costs nothing: TRK-4 drops
it.

**The seeding DELETES the auto-pause rule**, for the same reason G5's deletes the
action policy: the page draws a missing row as "Off" and the dialog behind it
falls back to Skydrop's own defaults, so removing it is not switching the rule
off — it is putting the store back to one nobody has configured, which is what
the take opens on and changes on camera.

**Two things it deliberately does not do.** It does not engineer a stock
shortage, so the forecast reads "Nothing to reorder" — the video explains what
the flag means rather than staging one. And it names no figure the screen
prints, which on a page that is nothing but figures took some care.

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

**And two from filming G6 (2026-09-30), both in the seller's "Waiting on you"
queue — the screen that queue exists to be.**

- **The page CRASHED the moment any store asked for an order or address
  change**, and took the two queues beside it down with it: React's error
  boundary replaced the whole page with "This page did not load", while the nav
  badge went on counting rows nobody could reach. The cause is one line:
  `SellerAddressChangeDecisionService.listPending` returned the RAW Prisma rows,
  typed `Promise<readonly unknown[]>`, where every other reader of that request
  — the store's own portal, the decision path, the notice — gets the `fields`
  MAP that `toView` builds. The screen read `request.fields[k]` on an object
  that was not there. **`unknown[]` is what let it ship**: a return type that
  promises nothing cannot disagree with a client that assumes something, and the
  client's own interface was a claim rather than a check. The queue is fixed and
  typed, the payload now names the NON-address things a change moves
  (`otherChanges`, from the server's own labels — a change that moved only the
  quantities rendered an empty cell above an Approve button), and the page
  defends itself against an absent `fields` as well. Pinned by
  `store-address-change.spec.ts`, proved red on the old code.
- **One store appeared under two names in one stack of tables.** The delivery-ask
  column printed the store's plain `name` while the two tables either side of it
  printed `displayName ?? name`, so `Kolkata Silk Room` and `Silk Room` read as
  two different businesses on one screen. The payload already carried both.

**And one from filming B5 (2026-09-30), on the most-read screen in the seller
app.** A DELIVERED order carried a section heading reading **"Out for
delivery"**, two inches under a chip saying Delivered. The heading was a
two-branch ternary on the current order status — DELIVERY_FAILED, or, for
everything else, "Out for delivery" — which is right for the two statuses the
panel is rendered for WHILE a parcel is moving, and wrong for every order it is
rendered for afterwards. And it is rendered for most of them: the panel
deliberately stays on any order carrying a call or a delivery request, so the
seller can read back what was said. It is the recurring shape again — a FALLBACK
that is correct most of the time it was written for and wrong everywhere else —
and a render test asserting "a heading is shown" passes either way, which is why
`deliveryPanelTitle` is now pure, exported and pinned by its WORDS
(`delivery-panel-title.test.ts`, proved red both ways).

**And the largest one yet, from filming B6 (2026-09-30): NO ORDER EDIT COULD BE
SAVED AT ALL.** The check run's very first Save came back

>   `[BAD_REQUEST] packageType must be one of the following values: BOX,
>   POLYBAG, ENVELOPE, TUBE, CUSTOM`

The seller app had invented three package types of its own — STANDARD, FRAGILE
and DOCUMENT — over an enum that has only ever held those five, and a comment
beside the display mapping said "the enum names the same three things", which was
simply false. `buildPatch` sends `packageType` on EVERY save, so every save of
every order — draft or pending, whatever had been changed — was refused, and had
been for as long as that select existed. The order-CREATE form escaped only
because it sends no package type at all, which is why B1 has always worked.

The list now lives once in `apps/seller/src/lib/package-type.ts`, the form offers
"Not stated" and omits the field when there is none rather than inventing one,
and `package-type-vocabulary.test.ts` pins it **against `schema.prisma` itself**
rather than against a copy — a second hand-written list is exactly what went
wrong, and a test holding one would drift the same way. Proved red.

**Three from filming B7 (2026-09-30), and the first of them had been on screen
for two months.**

1. **The order tracker told every confirmed seller that picking and packing were
   "not needed".** The `Ready to dispatch` rung fell back to
   `shipments.awbGeneratedAt`, which was right under the model the ladder was
   written against — a waybill was booked when a supervisor closed the manifest,
   by which point the parcel really was packed and waiting for a van. **CUR-2b
   moved the booking to order CONFIRMATION on 2026-08-01 and nothing here
   noticed.** So the rung carried a time days before anything was picked, which
   made it CURRENT — and the two rungs above it, with no times of their own and
   a later rung passed, rendered as `Picked from shelf — Skipped · not needed`
   and `Packed — Skipped · not needed`, on the one screen whose job is to say
   where the parcel has got to. The recurring shape once more: a fallback that
   was correct for the world it was written in. The rung reads its own event
   only now, and stays SKIPPED on a parcel the handover scan dispatched with no
   manifest at all — which is the ordinary path (CUR-4) and is exactly what "not
   needed" is for. Pinned both ways, proved red.
2. **The cancel dialog's money line had nothing supplying it.**
   `CancelOrderDialog` takes an optional `chargedInr` and renders "The delivery
   fee of ₹X already charged for this order goes back to your wallet" — the
   paragraph its own docblock calls "the reason this is not a plain confirm: the
   seller is owed something back and should see the number before agreeing, not
   discover it in the ledger afterwards." Its ONLY caller never passed it, so it
   was always `undefined` and the paragraph had never rendered for anybody. **An
   optional prop nobody supplies is indistinguishable from one legitimately
   absent**, which is why nothing failed and why a render test cannot see it —
   hand the dialog a figure and it works perfectly. The missing thing was the
   WIRE, so the guard reads the source of both files. The figure itself is the
   server's: `unrefundedCharge` is now the ONE pairing, shared with
   `OrderChargesRefundService`, which reads the original entry rather than
   re-summing the charge rows and says why — "the seller would be refunded a
   different number from the one they were charged". A screen deriving it
   independently would be that drift with the worse symptom.
3. **`AWAITING_COURIER` was missing from `SELLER_CANCELLABLE_STATES`.** The
   matrix has carried `AWAITING_COURIER → CANCELLED` with RELEASE_STOCK since
   the state existed, the seller's order page offers the button there citing
   CUR-17, and CLAUDE.md says in as many words that the state "is in
   `SELLER_CANCELLABLE_STATES`". Only the set itself disagreed, so a seller
   whose parcel was paused for a carrier decision pressed Cancel and read
   `[NOT_CANCELLABLE] An order in AWAITING_COURIER cannot be cancelled` — on the
   one state where cancelling costs least. The same set answers
   `capabilities.cancel` for a reseller store's order list, so their screens were
   wrong in step. Found by reading, not by filming; proved red.

**And a seventh in the seeding**: `raiseOverdueFlags` asked for "our parcel out
for delivery" as `want === 'OUT_FOR_DELIVERY'`, which has been TWO parcels since
D4 — the back-dated one, and `RSH-LIFE-SENDBACK`, which is rebuilt fresh on every
take and is therefore always day 0. `findFirst` promises no ordering, so which
one answered was a coin toss on the heap; it came up SENDBACK in the middle of a
take and threw "the sweep did not flag it" about a parcel that could not possibly
have been flagged. It selects on `backdatedScans` now, which is the only thing
that can make a parcel old enough.

**Three from filming B3 (2026-09-30), and the last of them is the kind this
library exists to find.**

1. **A raw Prisma error was written into a seller-facing field.** Every failure
   the import worker caught on one row went into
   `staged_order_rows.problems[].reason` — and into the error-report CSV the
   seller downloads — as `err.message`, verbatim. A transaction timeout on one
   row therefore put this on the seller's Pending page: the ABSOLUTE PATH of the
   file on our server, an excerpt of our source, and the advisory lock it was
   inside. And because those rows carry `field: ''` the page said "1 value to
   fix" and marked no field, so the seller was asked to correct something no
   value they could type would ever fix. `rowFailureForSeller` splits the two:
   a 4xx of our own is a refusal we MEANT to make about their row and is shown
   verbatim (that is the whole value of the screen); anything else is ours, so
   the row is still staged — "Import as order" re-runs it, which is the right
   recovery for a timeout — the seller is told plainly it is not their data, and
   the real error goes to the log. The three `Variant SKU … not found` throws
   became `BadRequestException`s in the same change, because the commonest
   seller-fixable case was a bare `Error` and would otherwise have been hidden.
2. **Every "is required" message named our internal key.** `addressLine2 is
   required`, under a form field labelled "Address line 2" and over a
   spreadsheet column headed "Address Line2". `orderCsvFieldLabel` reads the
   FIRST alias of each field, which is already its human name and the spelling
   the seller's own file most likely carries — so there is no second list to
   maintain and a field added to the alias map gets a label by construction.
3. **A row fixed on the pending page became a DRAFT.**
   `StagedOrderRowService.importRow` passed neither `source` nor
   `initialStatus`, so `OrderService.create` used its own defaults — while the
   bulk processor passes PENDING_CONFIRMATION because ORD-9 says in as many
   words that "CSV is submission, not drafting". One row of a spreadsheet, fixed
   five minutes after the rest imported, quietly became a different KIND of
   order from its siblings. **And it failed in the worst way available**: a
   DRAFT is never enqueued for a confirmation call (CC-6 enqueues on entry to
   PENDING_CONFIRMATION), so nobody ever rang that customer and the parcel never
   moved — while the row left the queue, the dialog said "it becomes an order",
   and the order sat in the list looking like the four beside it. Seen in a
   check-run FRAME: the status chip read `Draft` where the narration said
   "waiting on the call centre". Proved red.

**One from building C0 (2026-09-30), on the page C1 will film.** A consignment
that had LANDED and been counted short told its seller the missing unit was
`Still to come: 1 — in Dhaka or in the air, not sellable yet`. It is the
recurring shape yet again: `stillToCome = countedInDhaka − receivedInIndia` is
exactly right while the goods are travelling, and becomes a promise of goods
that are never coming the moment the last carton is opened —
`TransitArrivalService` has already posted that unit as an `IN_TRANSIT_LOSS` out
of the transit bin (CNS-4), and the bin holds nothing. A leg that has been
COUNTED now takes what it was SENT out of the outstanding figure whatever it
found, so what is left is genuinely still in Dhaka or on an open flight; the
shortfall on counted legs comes back as `lostInTransit`, and the tile's hint
says it ("1 unit left Bangladesh and did not arrive — see the arrival count
below") rather than leaving a zero with no explanation for why the arithmetic
does not reach what Dhaka counted. Both halves pinned — the counted leg AND the
open one, because the fix must not take away the case the tile exists for.
Proved red.

**Observed and deliberately NOT fixed:** the order's Full history labels every
one of OUR events `SKYDROP`, the seller's own cancellation included — so a seller
reads "Cancelled · SKYDROP · <their own words>". The field is the two-valued
`MilestoneOwner` and means "our side, not the courier's", which is true and is
what the section's note says ("Our handling and the courier's scans, together").
Telling the seller apart from Skydrop staff would be a third value flowing
through both apps and the ui package, and a decision about what SYSTEM reads as.
Worth doing; not worth doing inside a filming session.

**Two curriculum errors, both from trusting a description over the code**: the
seller roles editor has 41 permissions in seven groups and not 68 in ten (that
is the staff catalogue), and the sidebar's section ordinals are passed by the
seller shell and IGNORED by the component that renders it. Both were written
into entries above and then corrected against the source. It is the argument
for deriving a curriculum from code rather than from a tour of the UI — and for
re-deriving anything in it that is a number.
