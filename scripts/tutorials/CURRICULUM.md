# The tutorial library

Every screen in `apps/seller` and `apps/admin`, sorted into tutorials, in the
order a person meets them. Derived from the code — the 47 seller pages under
`apps/seller/src/app/(authed)/`, the 84 admin pages under
`apps/admin/src/app/(authed)/`, both `page-access.ts` tables, and the flows the
components actually perform — not from the sidebar and not from memory.

**90 tutorials. 54 filmed — sections A to G, which is the WHOLE SELLER APP,
plus the whole of H, the whole of I, J1–J3 and P5.** The 36 left are all in the admin app: 2 are
`impractical locally` and 29 touch something dangerous. Sections A–G are the seller app, H–P the admin app; the
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

**Filmed so far (54):** A1–A6, B1–B7, C1–C6, D1–D6, E1–E5, F1–F5, G1–G7 —
**the whole seller app** — plus **P5**, **H1–H4**, **I1–I4** and **J1–J3**.
Every one has its own entry below saying what it covers and what its seeding
does.

**THE NEXT ENTRY IS J4 — "Packing a parcel"**, and J3 has left it most of what
it needs. `pickWorldFor` (`seed-demo-data.mjs`) places three confirmed, labelled
parcels addressed to one pin, and J3's take walks them all the way to PICKED —
**measured, not predicted: after the take the three sat at PICKED and the pack
queue held them**, which is exactly what the bench selects on (`o.status =
'picked'`, WMS-2). **So J4's seeding is probably `pickWorldFor` plus one step**:
drive the three through the printing station with the API rather than the
camera, and stop at PICKED. It is the same shape as I2 and I3 sharing
`SUPERVISE_SLUGS`.

**Its retire-forward is already PICKED-aware**, which J4 needs and would
otherwise have had to add: a spent parcel at CONFIRMED, PENDING_PICK or PICKED
is cancelled through the ordinary admin cancel, so it leaves every warehouse
queue and gives its reserved unit back. Without that the pack queue grew by
three a take, all carrying the pin J4 would want to select by. It was widened
after J3's own take proved it: eleven orders were sitting at PICKED, eight of
them retired.

**Read PACK-1 and LBL-4 before writing a line of it**, because the pack bench is
the most rule-dense screen in the app and every rule is a scene: the BOX is the
claim and it is taken up front (two partial unique indexes — one open box per
shipment, one per packer); contents are verified as a SET, per SKU and per unit,
because a count alone passes a box with two of one thing and none of another;
over-scanning is refused AT THE SCAN; cancelling a box returns NOTHING to
inventory (PACK-2, and `pack-box-flow.e2e-spec.ts` asserts on-hand is
byte-identical across a cancel, so a "fix" fails); and `PackService.complete`
REFUSES without a closed box (LBL-4) with a supervisor-only `force-complete`
carrying its own audit action as the escape hatch. **Do not route the flow
through `force-complete`** — the README says so and the reason is that it would
make the only exercised path the one production should not use.

**And the scan needs a barcode to scan.** LBL-2: the code is
`variant.barcode ?? skuCode`, nothing is minted, and `PackBoxService.scan`
accepts BOTH scoped to the order's seller. The demo catalogue's variants have
no `barcode`, so the SKU code is what a scan resolves — which means the flow can
type the SKU into the scan field and it is the real path, not a workaround.
`packAtBench()` in the API e2e harness is the worked example of the ritual.

P5 was taken out of order on purpose (this document argues it should
be the first admin tutorial anybody watches, and
[the recommendation](#the-recommendation) goes further: if the ops team never
grows, P5 is worth making on its own and the rest are not); H1, H2, H4 and then
H3, then all of I, then J1, J2 and J3 followed. From here, work sections J–P as written, and read
[the recommendation](#the-recommendation) first — they are 32 entries and this
document is explicit that they are a BET.

**WHAT I2 ACTUALLY NEEDED, and the two things the note that stood here got
wrong.** That note was written from the database rather than from the page, and
both halves of it were wrong in the same way.

- **It said "the agent roster is five rows and four are debris". The roster was
  EMPTY.** `AdminAgentService.listAgents` selects `staff_users` by the LEGACY
  `role` enum being `CALL_AGENT`, and not one of this box's 39 staff users
  carried it — every `sim-staff-*` account is a SUPER_ADMIN. The five rows are
  `agent_call_settings`, which is a DIFFERENT TABLE and is not what that page
  reads. So `/call-center/agents` rendered "No call agents", and — far worse for
  a video about moving work between people — the **Reassign dropdown had nobody
  in it**, because it lists `useAgents()` filtered to available. **Read the
  SCREEN, not the table you think it reads.**
- **It said "there is already an ASSIGNED entry". There was not** — the queue
  held two PENDING rows and nothing else, I1's seeding having released what its
  take left behind. Which is the correct behaviour and exactly why the note went
  stale between being written and being acted on.
- **And a THIRD thing nothing warned about: the presence sweep runs EVERY
  MINUTE.** `AgentPresenceService.sweep` stands down any agent who is AVAILABLE
  with a `lastSeenAt` older than `ops.agent_presence_timeout_minutes` (10) — or
  null — and hands back whatever they were holding. A seeded available agent is
  therefore gone inside sixty seconds unless `lastSeenAt` is stamped, and the
  Reassign dropdown is empty again. The seed stamps it NOW, which is honest and
  buys ten minutes. **Generate the voice before the take** if the clips are not
  cached: that step is the only thing between the seed and the camera.

So `superviseWorldFor` in `seed-demo-data.mjs` builds the whole thing: two real
call agents upserted exactly as `ensureOps` upserts ops (the legacy enum AND the
RBAC row together — one without the other is a staff user who either holds no
permissions or is invisible to every screen that asks the enum), three
confirmation calls placed and submitted, and one of them written ASSIGNED to the
agent who is marked OFF. That last pairing is the story: `AgentSettingsService`
does not release holds when somebody marks themselves unavailable, so an agent
who closed their laptop keeps the customer's order — which is what
`QueueIndex`'s own docstring names as the reason the screen exists.

**Two things it does NOT do, each for a reason.** It does not PULL the
assignment through `/agent/calls/next`: that would cost a login and arm CC-7's
fifteen-minute expiry, which hands the row back part-way through a take that
started late — a take failing on the scene AFTER the one that broke it. And it
does not touch the two pre-existing stale entries; they are genuine
DELIVERY_FAILED follow-ups and they give the "Waiting since" column a range
(14h and 4h beside the seeded 5h, 3h and 39m) that three rows placed in one
breath cannot.

**"Reassign" renders only on an ASSIGNED row**, so the seed asserts there is
EXACTLY ONE across the whole queue and the flow reaches for the button by name.
That is the P5 lesson applied rather than re-learned.

**What I1 needed, read from the code rather than guessed (2026-10-01) — kept
here because I2 and I3 are about the same queue and inherit every one of them:**

- **The station AUTO-ADVANCES.** `CallCenterStation` pulls the next call on an
  interval and again straight after an outcome, gated on availability and on
  the tab being visible. So "pull next" is not a button the video presses —
  **availability IS the control**, which is why `MyAvailability` sits at the top
  of the station, and the narration has to say that rather than describe a
  queue you ask for work from.
- **The queue is nearly empty and two of its three entries are STALE.** There
  are 3 PENDING `call_queue_entries` against 157 orders in
  `PENDING_CONFIRMATION` (H1's entry explains the split), and two of the three
  are `DELIVERY_FAILED` calls on orders that have since been returned and
  restocked — so the station would open on a TICKET call, which has a different
  vocabulary (one outcome, "Called", and the note is the answer) from the
  CONFIRMATION call the video is about. `reconcileStaleCallQueue` in
  `lib/lifecycle.mjs` deliberately does NOT touch those (its comment says why),
  and `callThisOneFirst(orderId)` — same file — is the lever that puts a seeded
  order at the head of the FIFO.
- **It SPENDS what it films.** Recording `CONFIRMED` is append-only (CC-1),
  reserves stock (ORD-10) and books a waybill (CUR-2b). So its seeding is the
  `cancelWorldFor` shape — place and submit a fresh order under a stable
  reference on every run, retire the spent one forward rather than rewinding
  (the D4 / B7 rule). **`tutorial-ops` turned out to HAVE an
  `agent_call_settings` row already**, which was the one guess in this list that
  was wrong in our favour; had it not, `MyAvailability` renders NOTHING for a
  staff user who is not a call agent and the station would have had no switch at
  all.
- **And two the code did not warn about, both found in frames.** A released call
  JUMPS the whole queue (`ORDER BY (scheduled_attempts > 0) DESC, …`), so
  `callThisOneFirst` is not enough and the seeding has to put that counter back;
  and a second order for the same customer is refused as
  `DUPLICATE_ORDER_SUSPECTED` while the previous take's one is still unpacked,
  so the seed acknowledges it exactly as the real form makes a person do.

**Every admin flow so far has `app: 'admin'` and nothing else special.** The
three selector traps H2 hit are in its entry and are worth reading before
writing any flow against a form: a form that needs Enter, a field whose label
belongs to the button inside it, and `exact: true` meaning opposite things on
`getByText` and `getByLabel`.

**THE ADMIN RIG IS BUILT AND PROVEN.** `record.mjs` takes `app: 'admin'` on a
flow and drives apps/admin on :3002 as `tutorial-ops@skydrop.local` (the
SUPER_ADMIN the seed already makes); `peek.mjs --admin` photographs one admin
screen and `--routes` walks several on ONE sign-in; `make-tutorials.sh`
health-checks only the consoles a run needs. See
[Re-running](README.md#re-running) for the two commands that start the app.
P5 drove ten admin screens through it with no changes to the rig at all.

**WHAT THE ADMIN VIDEOS COST, MEASURED:** P5 **1,032 credits** (89,000 → 87,968
on the one configured key) for 13 scenes and 156 s, H1 **946** for 13 and 143 s,
H2 **1,044** for 14 and 159 s, H4 **972** for 13 and 148 s, H3 **1,068** for
14 and 180 s, I1 **1,067** for 14 and 172 s, and I2 **1,185** for 16 and 197 s, I3
**1,049** for 14 and 169 s, I4 **920** for 13 and 151 s, J1 **1,024** for 14
and 171 s, J2 **994** for 14 and 163 s, and J3 **937** for 13 and 152 s —
**12,238 for the twelve, or roughly a third each of the 1,200 the seller videos
were costing**, because a tour writes shorter lines than a demonstration. Every
pre-flight estimate was about 2× the real spend (I2's said 2,695, I3's 2,386,
I4's 2,087, J1's 2,329, J2's 2,262, J3's 2,129). The `--check` runs and the seed
runs cost nothing, and there have been fifty-five.
**Balance after this batch: 76,762 of 121,027** on the one configured key, which
is seventy-odd more admin videos.

**Every admin video's subtitle is `Skydrop for ops`**, not `Skydrop for
sellers`. That is the convention for H–P; the title card is the only place it
shows.

**C1 was re-taken the same evening and nothing is outstanding.** E5 bills the
very consignment C1 films, so C1's `freight` line — which said "nothing has been
billed against this one yet" — stopped being true the moment that world existed.
The line now describes the bill, `follow-a-consignment` is in `FREIGHT_SLUGS` so
its world is built before its take, and its `freight` scene is gated on the words
"Charged so far" rather than on the section, which renders an empty panel just as
happily. **The whole re-take cost 86 credits**, because clips are cached on their
words and only the one that changed was bought again.

### The four seeded worlds, and which list puts a video in one

Every video that needs more than the standing catalogue names itself in one of
these Sets in `seed-demo-data.mjs`. Forget it and the take runs against a box
that has never been driven.

- **`LIFECYCLE_SLUGS` → D0 (`lib/lifecycle.mjs`)** — nine parcels driven the
  whole way, so the videos about something GOING WRONG have something to film.
  Three of them are SPENT by their own take and retired-and-remade rather than
  rewound (`retireSpentParcel`): D4's `RSH-LIFE-SENDBACK` and
  `RSH-LIFE-RETURNREQ`, and B7's `RSH-LIFE-CONFIRMED`. **Read D4's and B7's
  entries before writing any seeding that has to survive its own take.** The
  tenth, `RSH-LIFE-ATDOOR`, is P5's and is the only one whose ORDER and SHIPMENT
  deliberately disagree — see D0.
- **`CONSIGNMENT_SLUGS` → C0 (`lib/consignments.mjs`)** — two consignments, one
  landed with its two counts deliberately disagreeing and one still in the air.
  Build-once and idempotent; C1 and C2 only read it.
- **`FREIGHT_SLUGS` → E5 (`lib/freight.mjs`)** — the freight world: a PAY_LATER
  bill on `RSH-CN-LANDED`'s Indian arrival, with some of its units already
  delivered so the bill is PART-owed. It BUILDS ON C0 rather than replacing it,
  so E5 is in both lists. Read its own note below before changing what it bills
  — three separate things have to be true at once for `/freight` to say anything
  at all, and two of them are not obvious.
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

**Filming these screens is finding real bugs at a steady rate — THIRTY-SEVEN so
far, plus EIGHT in the seeding itself and one whole capability with no screen.** Every one is on a path nothing else
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
**And on 2026-09-30, the last one filmed found a defect that could not exist
until that day.** The consignment page's freight tile printed
`charge.status.toLowerCase()` — which reads perfectly for three of the five
values and is wrong for the two a bill has to actually REACH: `PARTIALLY_SETTLED`
came out as "partially_settled", an underscore straight out of the database on a
seller's own screen, and `VOIDED` came out as "voided" where `statusLabel` and
every sentence beside it say "Withdrawn". It survived because no bill on any box
had ever been in either state, and the reason nothing could catch it is one
type: `ConsignmentView.freightCharges[].status` was `string`, so every reader
had to word the enum for itself and nothing could disagree with them. **That is
the same shape as the "Waiting on you" crash below** — a return type that
promises nothing — in a second place, found by seeding a state the product had
never reached. **A seeding pass that puts a row into a status nothing has used
before is a bug hunt in its own right.**

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
- **A video written from SCRATCH costs about 1,200 credits; a re-take that
  changes one line costs about 90.** Measured on E5 (2026-09-30) by the BALANCE,
  not by the estimate: 16 clips, 177 s of speech, and the key went from 90,265 to
  89,086 — so about 7 credits a second of narration, and a whole video for a
  fraction of one per cent of the allowance.
  **The pre-flight estimate is a CHARACTER count and is roughly twice the real
  spend** (it said 2,677 for that run). That is worth knowing before it misleads
  somebody: this line was first written from the estimate and had to be
  rewritten from the balance an hour later. The earlier note here — "about 800
  credits all in, measured over nine of them… the pre-flight estimate
  over-states it" — was right on both counts.
  **The conclusion it drew is the important half and stands: a re-take to fix a
  line that misreads the screen is nearly free, because only the changed line is
  bought again, and shipping a wrong one is not.** C1's re-take the same evening
  bought exactly one clip. Balance with the seller app complete: about 89,000 of
  121,027 on the one configured key, which is seventy more fresh videos.
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

**The freight bill it does NOT build is now `lib/freight.mjs` (E5, 2026-09-30),
and it deliberately does not live here.** Route (a) won — the consignment's
batches are given an expiry so FEFO reaches them ahead of the seller's older
stock — but it is applied to the BATCHES after the fact rather than declared in
`TUTORIAL_CONSIGNMENTS`, because C0 is BUILD-ONCE and never rewinds: on every
box that has already filmed C1 the consignment is counted, its batches exist,
and a declaration-time field can no longer reach them. See E5's entry.

**E5's bill changed what C1 SAYS.** A bill now sits on `RSH-CN-LANDED`, so C1's
freight line no longer described the page; it was rewritten and C1 re-taken the
same evening for 86 credits. That is the cost of the two videos sharing one consignment, and it was
taken knowingly — a third consignment would have put a third row in the register
C1 films and a SECOND landed one under its line "open the one that has landed",
which is worse.

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

**RE-TAKEN 2026-09-30, and the reason is worth keeping.** E5 raises a freight
bill against THIS consignment, so the `freight` scene's line — "nothing has been
billed against this one yet" — became false the moment that world existed. The
line describes the bill now, and the scene is **gated on the words "Charged so
far"** rather than on the section: the panel renders a "Nothing billed yet" note
just as happily as it renders a bill, so a box without the freight pass would
have filmed the empty version under the new words and nothing would have failed.
`follow-a-consignment` is in `FREIGHT_SLUGS` as well as `CONSIGNMENT_SLUGS` for
the same reason. The re-take cost **86 credits and one clip** — which is what
makes "fix the line rather than live with it" the right call every time.

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

TEN parcels, driven the whole way by the real path: an order placed by the
seller, confirmed on a CALL, a waybill booked against the local Delhivery
simulator, picked, packed at the bench with the box ritual, scanned at handover,
then advanced by the simulator — which fires the same signed webhooks the real
courier does. Takes about two and a half minutes from cold. **Verified 2026-09-30, all ten
green, and idempotent: a second run says "already" and changes nothing — except
for the two D4 parcels, which are retired and remade whenever a take has spent
them (`retireSpentParcel`, and see D4).**

**`RSH-LIFE-ATDOOR` is the tenth, and it is the only parcel whose ORDER and
SHIPMENT deliberately disagree.** It is `RSH-LIFE-RETURNING` plus one scan: the
courier says it has handed the return back. TRK-6 forbids that scan moving the
ORDER (only a person at the bench may start the restock chain), so the order
stays at RTO_IN_TRANSIT while the shipment reaches RTO_DELIVERED — which is the
one thing that puts a row in the RTO station's "At our door" worklist. `want`
alone therefore cannot tell it from `RSH-LIFE-RETURNING`, so it carries
**`wantShipment`**, which the skip test AND `lifecycleReport` both read; a run
that died between the last two scans is resumed rather than reported green.
Only a parcel that names one pays for the extra lookup. **It needed a product
fix to exist at all** — see [Bugs found](#bugs-found-while-establishing-feasibility).

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
| `RSH-LIFE-ATDOOR`    | RTO_IN_TRANSIT, **parcel RTO_DELIVERED** | P5      |

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

### E5. What the freight cost · **FILMED** — `what-the-freight-cost.mp4`

**Promise** — you understand why a freight bill is only partly owed.
**Length** 3 min 12 s (16 scenes). **Prerequisites** C1, E2. **Needs** C0 AND
its own world; it is in `CONSIGNMENT_SLUGS` and `FREIGHT_SLUGS`.
**Covers** `/freight` — the four tiles, the status tabs, the one row and its
terms, and the page's own paragraph about why a bill stays partly owed — then
through the row's link to `/inbound/[id]`, where the same bill is a six-fact
panel with the forwarder's own note under it and a "Freight billed" entry on the
timeline. **It presses one link and nothing else**, so its take leaves the world
byte-identical and none of this is rebuilt for a re-take.

**Its world (`lib/freight.mjs`) needs THREE things true at once, and two of them
are not obvious.** A consignment landed and counted — C0 already builds it. A
bill against the ARRIVAL, which must be **PAY_LATER**: FRT-5 decides the leg
from the mode, and PAY_NOW is debited in full at record time and never
amortises, so on any other mode this video has no subject at all. And then the
part that took the longest:

**Some of the consignment's OWN units having left.** FRT-1 charges a unit's
share when it leaves and attributes it by walking `shipment_item.pickedBatchId →
stock_batch → goods_receipt_lines.batchId → inbound_freight_allocations`, so
only a parcel picked from THIS consignment's batch charges THIS bill. Shipping a
parcel is not enough: FEFO is `expiresAt ASC NULLS LAST, then receivedAt ASC`,
every batch on this box has a null expiry, and the consignment's batch is the
NEWEST thing in the warehouse — so the allocator reaches the seller's standing
stock every time. `giveTheConsignmentAnExpiry` is the fix and it is a real
field, not a thumb on the scale: a seller may declare a manufacture and expiry
date per line, `GoodsReceiptService.complete` copies it onto the batch, and the
child `<parent>-IN` batch inherits it across the flight. It writes the receipt
LINES and the BATCHES, only where null, so the data is what it would have been
had the seller filled that box in.

**And then the money is dated the SEVENTH.** The first build produced a perfect
parcel, a perfect bill, and a page reading "0 of 38 units charged" — because the
default accrual tier is `T_PLUS_N` with `wallet.accrual_delay_days` of seven
(R2c chose it deliberately), so `DeliveredAccrualService` SCHEDULES the whole
delivered-money step — the order charges, the COD credit, and the freight share
— as a `pending_accruals` row a week out. `letTheClockRun` pulls that one row's
due date forward and adds the job the hourly cron adds, which is an early TICK
rather than a bypass: `PendingAccrualSweepService` does every bit of the work
and none of its gates are touched. **Both halves are needed** — back-dating
alone waits for the top of the hour, and the job alone sweeps nothing, because
the sweep takes `eligibleAt <= now`. Anything later that needs a delivered
order's money to have LANDED has the same problem and the same answer.

**The pass ASSERTS what it cannot see**, and that is the lesson worth copying: a
parcel can be delivered perfectly and charge a different batch's freight, or
none, and the only symptom is a page saying "0 of 38" under narration claiming
otherwise. `ensureFreightWorld` refuses to finish unless the bill is
PART-charged, and the flow's `open` scene gates on the words "Partially settled"
rather than on the tile that would contain them.

**`RSH-FRT-01` is in `PROTECTED_REF_PREFIXES`.** It is delivered, it carries a
freight charge in the wallet, and re-driving it would charge the bill twice.

**Filming it found a bug on the page it clicks through to** — the consignment's
freight tile printed the raw enum, "partially_settled", on a seller's own
screen. See [Bugs found](#bugs-found-while-establishing-feasibility).

**Its narration names no figure the screen prints.** Not the total, not the
taka, not "five of thirty-eight" — every line describes the SHAPE and lets the
table carry the numbers, which is what stops the video going wrong the day
somebody edits the invoice in `lib/freight.mjs`.

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

### H1. The ops dashboard · **FILMED** — `the-ops-dashboard.mp4`

**Promise** — you can open one screen and know what needs a person today.
**Length** 13 scenes. **Prerequisites** none — with P5 it is the pair to watch
first. **Needs** `seed-demo-data.mjs the-ops-dashboard`, which is D0: the
attention tiles have to be loud rather than all-clear, and D0's parcels are what
lights them.
**Covers** `/dashboard` and nothing else, read-only. Three bands and the lesson
that they answer three different questions: what is waiting on a person RIGHT
NOW (seven tiles, lit when they have work and quiet at zero), how the last
thirty days have gone (rates, each with its denominator printed under it), and
whose money is where (ending on the one tile that is a debt rather than income).

**NO FIGURE IS SPOKEN, and here that is not only the standing rule.** The
call-centre tile counts ORDERS in `PENDING_CONFIRMATION` and links to
`/call-center/queue`, which counts live queue ENTRIES. On a healthy database
those agree (CC-6 enqueues on entry to that status); on this box they read 157
and 3, because 153 Test Brand orders were bulk-loaded on 23 Sept with no entry
ever created. **I1 films that queue**, so a spoken figure here would put the two
videos in contradiction. Describing the shape is true either way.

**`networkidle` never arrives on this page** — it polls — so the opening scene's
wait burned its whole 30-second timeout and the first `--check` showed
`intro … scene 34.58s`. It failed nothing; it would simply have filmed
thirty-four seconds of picture under an eleven-second line. Gate on the
subtitle instead. **A slow scene is not a failed step, and only the timing
column says so.**

**Tiles are picked by their AREA word inside `.db-attn`, never by position.**
The grid is permission-filtered (a role without money sees five tiles, not
seven), so an index films whichever tile happened to be fourth for whoever last
edited the guards. The same words are in the sidebar, which is why the filter is
scoped to the card class — `attnCard()` in `flows.mjs`.

**One bug, found by counting the tiles in a frame:** the note under the band
read "4 queues need staff attention" over FIVE lit tiles. See
[Bugs found](#bugs-found-while-establishing-feasibility).

### H2. Finding an order and reading its history · **FILMED** — `find-an-order.mp4`

**Promise** — you can answer any question about one order from its page.
**Length** 14 scenes. **Prerequisites** H1. **Needs**
`seed-demo-data.mjs find-an-order`, which is D0.
**Covers** `/orders` — four filters and one search box — and then
`/orders/[id]` as a READING exercise: the immutable recipient snapshot and the
customer's reputation line beside it, COD against declared value, the item
snapshot and what "reserved" means on a parcel that has already gone, charges
with their visibility column, the parcel and what the courier will no longer
accept, the tracker, the full history with our events and the courier's scans in
ONE column, and the failed delivery drawn on the scan it belongs to. Every
button on the page is taught later and separately, and the closing line says so.

**Filmed against `RSH-LIFE-RESTOCKED`**, the richest order D0 leaves: a whole
forward journey, a failed delivery carrying the courier's own reason code, a
return, a receipt at the bench and a disposition. So every band has something in
it, and the tracker ends on "Back in your stock" — which did not exist until the
ladder learned a parcel can come back (see Bugs found).

**THREE SELECTOR TRAPS, all found in frames rather than by a failing step.**
Each one is a scene that PASSED while filming the wrong thing:

1. **The search box is a FORM, not a debounce.** Typing filters nothing until
   Enter. The first check typed, waited for "a row matching `SD-…`" — which the
   UNFILTERED list is full of, newest first — clicked it, and filmed nine scenes
   about somebody else's parcel. The gate is now the subtitle's count (`1 order`),
   which cannot be true until the filter has applied, and the click is on the
   link INSIDE the row carrying the ref.
2. **`getByLabel('Search')` is the submit MAGNIFIER, not the field.** The input
   carries `aria-label="Search orders"`, which overrides its visible label, and
   the button inside it is labelled "Search". So the click focused a `<button>`
   and `pressSequentially` typed eighteen characters into it — no error, no
   text, and a passing step. Playwright only said so when something asked that
   node for its value. **When a field has a button inside it, check which of the
   two owns the visible word.**
3. **`getByText(…, { exact: true })` means the element's WHOLE text.** A timeline
   rung's label is a text node beside the state word, the owner and the time, so
   the exact form matched ZERO elements while the words were plainly on screen.
   `getByLabel` is the other way round — substring by default — which is what
   makes this pair worth remembering together.

**`ooSection(page, title)` matches an order-page card by its own `<h2>`**, never
by `hasText`: "Payment", "Charges" and "Shipments" all appear inside OTHER
cards' bodies on this page, so a text filter picks whichever card mentions the
word first — a card the narration is not talking about, and a check that passes.

**Observed and deliberately NOT fixed: five event notes on this page name a row
by its uuid.** "RTO finalize on shipment 01a0ef6c-…", and the same shape on pick
start, pick complete, pack complete and the call attempt. It is the third and
fourth place this defect has been found (the seller's order list, then a refund's
ledger note), and it is worse here only in quantity. These are
`order_events.description` strings and the table is append-only, so a fix reaches
future events alone — it wants doing deliberately, at the five write sites, with
the shipment NUMBER that already exists, not inside a filming session.

### H3. Things the system has raised · **FILMED** — `things-the-system-has-raised.mp4`

**Promise** — you can work the system-issue queue and know which to act on
first.
**Length** 14 scenes. **Prerequisites** H1. **Needs**
`seed-demo-data.mjs things-the-system-has-raised`.
**Covers** `/system-issues`: the three counts and the different questions they
answer, worst-first with the severity as a WORD on the chip, the card body as
the thing to read, the "Open the order" deep link, the source and age line,
"I'm on it" (and what it pointedly does not do), a MEDIUM card as the contrast,
the Close dialog's required note — cancelled, because that one clears itself —
"Show closed too", and the "Notify unannounced" confirmation, also cancelled.

**NOTHING IS WRITTEN BY HAND. The seeding runs the REAL sweep** — `POST
/admin/nsa/sweep`, which is `OrderAttentionService.sweep`, the same call the
hourly cron makes, under two seconds. So every card on camera was raised by the
code that raises it in production, in production's words. A row written straight
into `system_issues` would have skipped the notification NOTIF-16 sends on a new
issue and carried whatever severity the seed felt like.

**What the seeding then does is SUBTRACT.** The board here is 37 open and 25 of
them are one issue repeated — `awb-label-missing`, because every parcel on this
box is booked against the local courier SIMULATOR, which has no label endpoint
at all ("The label was asked for again just now and failed: URL must use
https"). That is a dev-box artifact, not a lesson, and left in place it buries
the twelve that teach something — the exact failure the service's own comments
warn about. They are CLOSED with a note rather than deleted, because a closed
row is the record and "Show closed too" is a scene. **The closed history
therefore grows by ~25 a take**; `list()` takes 200, so prune here if it ever
gets near.

**THE HOURLY SWEEP WILL RUIN A TAKE THAT STRADDLES IT, and it did.** The label
leg raises those 25 again on the next tick, as FRESH rows. The second `--check`
ran through minute 10 and its closing frame showed a board of thirty-seven where
the opening frame showed twelve, cards moving under the camera the whole way —
every step passed, and only the frame said so. `refuseNearTheSweep` in the
seeding now REFUSES a run between minute 4 and minute 11 and says how long to
wait, and the flow's `intro` gates on there being no label card at all, so a tick
that lands anyway fails the take instead of filming it. **There is no honest
alternative**: the candidate set is a pre-dispatch shipment with a waybill and no
label, which those parcels genuinely are, and the only ways out are to store a
label that does not exist or to back-date the waybill so the watchdog looks past
it. **Eight minutes an hour is the price; pay it.**

**The acknowledge scene works because the KPIs move and the card does not.**
Pressing "I'm on it" takes "Nobody on it" from 12 to 11 and leaves "Open" at 12,
which is the narration's whole claim — acknowledging is about people not
colliding, closing is a statement about the problem. The gate is the CARD saying
"being looked at", never the button: an `AsyncButton` rolls to "Noted" on its own
timer, so a gate on the control passes whether or not the write landed.

**The closing frame was wrong on the first check and the frame is what said so.**
The history toggle was still on, so the video ended on a screen of CLOSED rows
under a line about an empty page being the good outcome — true, and the wrong
picture. `outro` clicks "Open only" first.

**Cards are picked by their WORDS, never by position** (`issueCard` in
`flows.mjs`). The board sorts by severity then by when each was last seen, and
the sweep the seeding runs immediately beforehand bumps several to the same
second — so which High card is third is a coin toss between runs, and an index
would film a different problem each time while passing perfectly. The
live-waybill card is the protagonist because it is the one kind here that carries
an order link, and `checkLiveWaybills` raises nothing but HIGH, so the "high
means money or parcels are affected now" line cannot be filmed over a Medium
chip.

**Two `Close` traps.** Every card carries a "Close" button AND the dialog's own X
carries `aria-label="Close"`, so an unscoped name matches a dozen elements —
`dialogFoot()` scopes the footer. "Notify unannounced" is both the header button
and the confirm button of the dialog it opens, for the same reason.

**One bug found and fixed** — the `seller-rto-refused` card said "The
cancellation for order 01a0f016-4863-7b76-85f2-df0e319f1a7f was refused", naming
an order by uuid on the one screen whose job is to say which order needs a
person. Sixth instance of that defect. See
[Bugs found](#bugs-found-while-establishing-feasibility). **The row already on
this box predates the fix and still shows the uuid** (it is never bumped, and
`raise` only re-states the detail on a recurrence); it is mid-board and no scene
dwells on it. **Observed and NOT fixed:** `AwbGenerationWorker gave up on a job`
carries a shipment uuid too, but that string is `err.message` from the worker's
own throw and is genuinely engineer-facing.

### H4. The permission model · **FILMED** — `the-permission-model.mp4`

**Promise** — you understand why someone cannot see a screen, and you can fix
it safely.
**Length** 13 scenes. **Prerequisites** H1. **Needs** NOTHING — the only `ready`
admin entry filmed so far, and the cheapest in the library to make.
**Covers** `/roles` as the teaching hook for the whole model: a role is yours to
shape and the permissions are not; what each role covers and how many people
hold it; the locked Super admin row, which holds permissions that do not exist
yet so a new feature is not invisible on the day it ships; then the editor —
the count of what this role holds beside the count of what can move money or
stock, the groups, the SENTENCE every permission carries, the danger triangle,
and the search that covers the name, the explanation AND the key. Ends on the
two things that keep the screen safe: the super-admin row is inert, and the UI
is never the boundary.

**IT SAVES NOTHING.** The editor is opened on a real role and closed with
Cancel. What is being taught is how to READ the catalogue, and a role saved on
camera is a role somebody has to unpick afterwards. `roleRow()` in `flows.mjs`
picks a row by the role's NAME, because every row carries an Edit and a Delete —
a bare `getByRole('button', { name: 'Edit' })` opens whichever is first, which on
this box is Super admin, the one row that cannot be edited at all.

**The curriculum's own illustration did not survive contact with the search.**
This entry used to name "Finalise a return" and "Hand parcels to the courier" as
the pair that both sound like routine warehouse work and both remove stock. The
second does not contain the word "return" and never appears in that search. What
DOES come back is better and is what the video says: **Finalise a return**
("Write-off permanently removes stock and cannot be undone") beside **Act on a
parcel at the courier** ("a cancel turns a moving parcel into a return, and an
NDR action sends a van") — two permissions that differ in what they REACH rather
than in where they sit. Re-derived from `common/auth/permissions.ts`, which also
confirms the figures this entry has always carried: **84 permissions, ten
groups, 32 marked dangerous.** None of them is spoken.

**`getByText` does not see a PLACEHOLDER.** The first check spent thirty seconds
waiting for "Search permissions", which is on screen and in no text node. The
input's handle is its `aria-label`; the catalogue's is `.ac-perms`.

**Two `(test)` roles are on this box** — "No money access (test)" and "Treasury
viewer (test)", left by somebody's treasury work, each held by one staff user.
They are on camera and nothing names them. Deleting a role somebody holds is not
a tidy-up to do inside a filming session; if they are ever cleared, do it with
the people moved off first.

---

## I — The call centre

### I1. Taking calls · **FILMED** — `taking-calls.mp4`

**Promise** — you can work the call queue from your first shift.
**Length** 14 scenes. **Prerequisites** none. **Needs**
`seed-demo-data.mjs taking-calls`.
**Covers** `/call-center` as a whole shift: the station opening on "not taking
calls" and why that is the default, turning availability on, a call arriving by
itself, why-this-call, the customer-risk strip, the recipient and the COD figure,
choosing an outcome and reading what it does before pressing, the note, recording
it, the next call arriving unasked, releasing one, and switching off at the end.

**THE STATION AUTO-ADVANCES, and that is the whole shape of the video.** It
pulls the moment availability turns on and again every fifteen seconds, and once
more immediately after an outcome is recorded — so "pull next" is not a button
the video presses. **Availability IS the control**, which is why
`MyAvailability` sits at the top of the station and why the second, third and
last scenes are all about one switch. "Check for a call now" exists and is the
manual nudge for an empty queue; the video never needs it. This entry used to
say "pull next"; it was wrong, and reading `CallCenterStation` rather than the
sidebar is what corrected it.

**Its seeding PLACES an order, because what is there is the wrong shape.** The
box has 157 orders in `PENDING_CONFIRMATION` and THREE live
`call_queue_entries` — H1's entry explains that split — and two of the three are
`DELIVERY_FAILED` follow-ups, which the station gives a different vocabulary
(one outcome, "Called", and the note is the answer). So a video about a
confirmation call cannot be filmed against whatever sorts first.
`callThisOneFirst` (now exported from `lib/lifecycle.mjs`) puts ours at the
head — ahead of the queue AND in the past, because an entry scheduled forward is
correctly handed back as nothing.

**The customer is a LIFECYCLE one on purpose.** `CustomerRiskStrip` renders
NOTHING for a first-time customer, by design — most calls are first-time
customers and a strip that always says "nothing known" is one nobody reads on
the call where it matters. The order is placed for the phone D0's returned
parcels belong to, so the strip reads "60.0% of this customer's parcels came
back · 2 delivered · 3 returned". The seeding ASSERTS that history exists and
throws naming `--lifecycle` if it has gone, rather than letting the scene film
an empty space under a line about it.

**It SPENDS what it films** — recording CONFIRMED is append-only (CC-1),
reserves stock (ORD-10) and books a waybill (CUR-2b). Nothing is undone: the
spent order is renamed `RSH-CALL-1-SPENT-<n>` and left exactly as it is, a fresh
one follows, and **`RSH-CALL-` had to join `PROTECTED_REF_PREFIXES`** because
CONFIRMED is in `REMOVABLE_STATUSES` — without it the next seed run would try to
delete an order holding a live reservation and a booked waybill. The only reset
is the agent: any entry still ASSIGNED to them goes back to PENDING (released,
not completed — no attempt was made) and availability goes back to OFF.

**THREE SELECTOR TRAPS, and two of them are one lesson from opposite ends.**

1. **`getByText('available', { exact: true })` waited twenty seconds for a word
   plainly on the screen.** The chip is title-cased by CSS and lower-case in the
   DOM — but the real fix was not casing: the chip flips from a query and the
   BUTTON flips from local state, so neither is what "the write landed" means.
   The gate is the sentence beside the chip, "Orders will be assigned to you."
2. **`getByLabel('Outcome', { exact: true })` finds nothing**, because
   `requiredMark` puts a character in the label — the accessible name is
   `Outcome*`. And the plain form is WORSE: `getByLabel` is a case-insensitive
   SUBSTRING, so it also matched the "Record outcome" BUTTON and died on strict
   mode. A REGEX is matched against the whole accessible name and is the only
   form that means "this field and nothing else": `/^Outcome\*?$/`.
   **Together with H2's `getByText(…, { exact: true })` trap, the pair is worth
   holding in mind: `exact` means opposite things on the two, and a required
   field's label is not the word you read.**
3. **The closing gate cannot be the empty state.** "You are marked unavailable"
   belongs to the panel that renders only when the agent holds NOTHING, and the
   auto-advance runs every fifteen seconds — so a call landing between the
   release and the last click makes that text unreachable for ever while the
   screen is perfectly correct. The gate is the availability card's own
   sentence, which does not care what is in hand.

**One bug found, on this screen** — the card head named the order by its uuid
while the panel below it named the same order by its number. See
[Bugs found](#bugs-found-while-establishing-feasibility). **apps/admin had to be
rebuilt and restarted before the take**, or the video would have filmed the
defect that had just been fixed — the README's rule about restarting by the
LISTENING pid, applied to a frontend.

### I2. Supervising the queue · **FILMED** — `supervising-the-queue.mp4`

**Promise** — you can see what is waiting, who holds it, and move it.
**Length** 16 scenes, 3 min 17 s. **Prerequisites** I1. **Needs**
`seed-demo-data.mjs supervising-the-queue`.
**Covers** `/call-center/queue` — the four counts, why the list opens on OPEN
rather than on everything, reading a row, the PICKED-UP column against the
CALLED column, reassigning a stuck call, rescheduling one, and naming
force-outcome as the thing that is not like the other two — then
`/call-center/agents`: who is on, what they are holding against their cap, and
raising a cap. It closes back on the queue, because the closing line is about
the queue's columns and would otherwise be summarising them over a table of
people.

**THE PAIR OF COLUMNS IS THE WHOLE VIDEO.** "Pulls 1, Calls 0/3" is an entry
somebody claimed and never rang, and before this screen existed nobody could see
it at all — the entry sat assigned to whoever went home until CC-7's
fifteen-minute timer noticed. Everything else on the page is in service of that
one reading, which is why the narration spends a scene on it before touching
anything.

**Its seeding builds the world from nothing, because there was none** — see
[Where to pick up](#where-to-pick-up) for what the note that stood there got
wrong and why. Two call agents (`asha.pillai@skydrop.local`, marked OFF and
holding the stuck call; `imran.shaikh@skydrop.local`, on and idle), three
confirmation calls placed and submitted, one written ASSIGNED, and every agent's
`lastSeenAt` stamped NOW so the one-minute presence sweep does not take the
world away before the camera reaches it. `maxActiveCalls` goes back to 1 on every
run, because the video raises it to three on camera and a second take opening on
a cap already at three films a change that changes nothing.

**Back-dated on purpose:** the three queue entries' `createdAt` is moved to 5h,
3h and 39m, which is what the "Waiting since" column is computed from. Everything
placed in one seed run is otherwise the same age, and a column where every row
says "0m" teaches nothing about the column. The ORDERS keep their real
timestamps; only the queue row moves, which is the thing on screen.

**Three selector notes, one of them a general trap.**

1. **Every dialog's header carries an X with `aria-label="Close"`**, so
   `getByRole('button', { name: 'Close' })` inside one matches TWO and dies on
   strict mode. The footer's is `.sk-dialog__foot` scoped. Same shape as I1's
   `getByLabel('Outcome')` matching the "Record outcome" button: **in a dialog,
   assume the word you want is also somewhere you did not think of.**
2. **"Reschedule" and "Reassign" are each TWO buttons once the dialog is open** —
   the row's and the dialog's submit. The row reach happens while the dialog is
   shut; every later one is `getByRole('dialog')`-scoped.
3. **The reschedule preset is "Tomorrow", not "In 1 hour"**, and that is a
   gating decision rather than a story one: the Available column rounds to whole
   minutes below an hour, so a preset of exactly sixty minutes lands on "59m" or
   "1h" depending on where in the minute the click fell. A day out is "in 24h"
   either way.

**Two bugs found, both on the agent detail panel**, and the first was caught by
the frame rather than by the check — see
[Bugs found](#bugs-found-while-establishing-feasibility). apps/admin was rebuilt
and restarted by its LISTENING pid before the take, or the video would have
filmed the defect that had just been fixed.

### I3. Forcing an outcome on a stuck call · **FILMED** — `forcing-an-outcome.mp4` · **dangerous**

**Promise** — you can close a call nobody can complete, and you know exactly
what it writes.
**Length** 14 scenes, 2 min 49 s. **Prerequisites** I2. **Needs**
`seed-demo-data.mjs forcing-an-outcome` — **the SAME world I2 films**
(`SUPERVISE_SLUGS`), because both want a queue with a real roster behind it and
exactly one call assigned to somebody who is not going to make it. I2 moves it;
I3 records what the call would have come to.
**Covers** the force-outcome panel — and what makes it dangerous is precisely
that it is **not** a special case: it runs through the same service an agent
does, so the attempt lands in the append-only ledger **under the supervisor's
id**, moves the order by the ordinary mapping, counts toward the NDR cap, and
reserves stock if the outcome is confirmed. It cannot be undone or edited.
**Cost of getting it wrong:** a permanent record that a call happened when it
did not, and possibly stock held against an order nobody confirmed.

**IT FORCES `CUSTOMER_DECLINED`, AND THAT CHOICE IS THE VIDEO.** Terminal by the
mapping (`REJECTED_BY_CUSTOMER`), so one press permanently rejects a real order —
which is the cost stated as an act rather than as a warning. It also reads the
`Confirmed` helper FIRST and then changes the answer, because nothing is written
until the button at the bottom and the most expensive option is the one worth
reading aloud. And it leaves exactly the world **I4** needs: a
customer-rejected order for a seller to ask us to ring again.

**Its seeding is I2's plus one thing: the retire-forward.** A forced
`CUSTOMER_DECLINED` lands the order in `REJECTED_BY_CUSTOMER`, which is NOT in
`REMOVABLE_STATUSES` — so the shared clearing correctly leaves it alone and the
next run's create would collide on `sellerOrderRef`, which is unique per seller.
`RSH-QUEUE-1` is renamed `RSH-QUEUE-1-SPENT-<n>` and left exactly as the take
left it, and a fresh one follows (the D4 / B7 rule, third instance). The
retire runs for all three seeded orders, not only the one this video spends, so
a later video in the same world can spend any of them.

**The toast is READ in the next scene, and that only works because the pointer
is still on it.** A success toast lives 4.5 s of UNPAUSED time and
`usePausableTimer` stops the clock while it is hovered — a designed behaviour,
so that somebody reading a message is not cut off mid-sentence — and
`stage.point` moves the pointer onto whatever it outlines. So the press scene
and the reading scene both outline the toast itself, and the first scene to
point anywhere else lets it fade. **If a flow needs a toast to survive more than
one scene, keep the halo on it**; there is no other lever.

### I4. Sellers asking us to call again · **FILMED** — `sellers-asking-to-call-again.mp4`

**Promise** — you can decide a re-attempt request.
**Length** 13 scenes, 2 min 31 s. **Needs**
`seed-demo-data.mjs sellers-asking-to-call-again`.
**Covers** `/reattempt-requests`: why a card is mostly its reason, reading two
requests and deciding them opposite ways, and the fact that approving is **the
only way out of a customer-rejected order** — it puts the order back in the
queue. It ends on the filter set to "all", where nothing has been deleted and
both decisions carry what was granted and what was written beside them.

**THE SCENE NOBODY WOULD HAVE WRITTEN FROM THE OUTSIDE is the extra calls.**
Approving does not reset the attempt count, so an approval that grants none puts
the order back ALREADY AT ITS CAP and the first unanswered ring rejects it
again — the approval spent on a customer who simply was not in. The dialog's own
hint says so; the video reads it. `extraAttempts` is 1–5
(`DecideReattemptRequestDto`) and `CallCapService.grantedExtraByOrder` adds it
to the effective cap, which is the same figure `/call-center/queue` shows in its
Calls column.

**Its seeding drives the orders rather than writing their status.** Each is
placed, submitted, and then put through the very endpoint I3 films —
`POST /admin/call-queue/:entryId/force-outcome` with `CUSTOMER_DECLINED` — so a
real `call_attempts` row exists behind the refusal (CC-1) and the order moves by
the ordinary mapping (CC-2). The request itself is raised through the SELLER's
endpoint with a real reason, because the whole point of the screen is that a
person asked and gave one; a row inserted by hand would film a request nobody
made.

**It CLEARS the previous take's requests, and that is not tidiness.** The last
scene switches the filter to "all" and reads the two decisions just made —
nothing in the app deletes a decided request (which is what that scene says), and
the order it points at is retired forward rather than removed, so without the
clear the list grows by one card per take and the second take narrates "both
decisions" over three of them. The seed asserts BOTH counts, waiting and total,
because the video reads both lists.

**One seeding bug found, and it is the MUST #12 shape one level along** — see
[Bugs found](#bugs-found-while-establishing-feasibility).

---

## J — The warehouse floor

Filmed in pipeline order, because that is how the building works and the hub's
own subtitle says so: consignment → receive → print → pick → pack → handover →
dispatch.

### J1. Where things live · **FILMED** — `where-things-live.mp4`

**Promise** — you can build a warehouse's locations and know what the tracking
switch does.
**Length** 14 scenes, 2 min 51 s. **Needs**
`seed-demo-data.mjs where-things-live`.
**Covers** `/warehouse/bins` and the two separate questions it keeps apart:
what locations **exist** (always editable) and whether the system **asks** for
one. Then the sentence the help text makes explicitly and this tutorial
repeats: **turning tracking off stops the system asking; it does not collapse
the bins you have built.** Collapse is a different, destructive act — named
here, taught in P4.

**IT IS FILMED IN THE DHAKA INTAKE WAREHOUSE, and that is a safety decision.**
The video turns location tracking ON, on camera, and that is a real behaviour
change for every flow that receives or picks in the building it is switched in
(BIN-1: on means the system ASKS for a bin). Doing it to `CCU-01` would quietly
change the world sections C, D, E, J, K and L all record against. `BD-DHK-1`
fulfils no orders (CNS-2) and holds nothing, so the switch is visible and
harmless — and an empty building is the honest setting for a video about laying
shelving out in the first place. The take turns it back off itself, and the
seeding does too, because a take that dies in between must not leave the intake
warehouse asking for bins.

**THE PAGE ENFORCES THE ORDER, WHICH IS WHY THE VIDEO FOLLOWS IT.** "Turn
tracking on" is DISABLED while the warehouse has no real bin, and the note
beside it says why — receiving would have nowhere to put anything. So the shelf
is built first and the switch second, which is the sequence a person is forced
through rather than one the tutorial invented. The disabled state is VISIBLE
(`opacity: .55`, checked against the enabled frame two scenes later), so the
narration may say so.

**The bin form needs FOUR inputs, not the three the copy talks about.** "The
code is built from the three coordinates — you never type it" is about aisle,
rack and shelf, but `Add bin` also stays disabled until a ZONE is chosen
(`binForm.zoneId === ''` is in its disabled expression). A flow that fills only
the three waits thirty seconds on a button that is right there — the failure
arrives as a click timeout rather than as a selector miss. **Read a submit
button's whole `disabled` expression before writing the scene that presses it.**

**Selector notes.** `getByLabel('Type')` matches the overview's "Bin **type**"
filter as well as the form's "Type" — `getByLabel` is a case-insensitive
SUBSTRING — so every label here is reached by a whole-name regex. The page
header's warehouse picker and the overview's warehouse FILTER are both named
"Warehouse"; the header one is `.sk-ph`-scoped, and reaching for the wrong one
filters a table instead of choosing the building every panel below belongs to.
And the panels carry no ids at all on a page five thousand pixels tall, so each
is a `.stk-section` / `.stk-card` filtered by the words in its own heading —
`overviewSection`, `trackingPanel`, `addBinSection`, `layoutSection` in
`flows.mjs`.

**One observation, not fixed:** "Apply a list of moves" asks an operator to type
a **seller id, a variant id and a batch id** — three uuids — and no screen in
the admin app offers them to copy. It is the uuid-instead-of-a-readable-thing
shape the rest of this document keeps meeting, in its INPUT form rather than its
output form, and fixing it is adding three pickers rather than changing one
field, which is why it is recorded here instead of done. The bulk panel is the
advanced half of a screen whose ordinary half (move one whole bin into another)
uses proper selects.

### J2. Receiving a consignment · **FILMED** — `receive-a-consignment.mp4` · **dangerous**

**Promise** — you can count goods in and write them to stock.
**Length** 14 scenes, 2 min 43 s. **Needs**
`seed-demo-data.mjs receive-a-consignment`.
**Covers** `/warehouse/receive`: start receiving (which claims it), per-line
received and damaged and bin, then **"Complete and write stock"**.
**Cost of getting it wrong:** completion writes real stock through the one
sanctioned writer, and a wrong count becomes a wrong on-hand that only a
counted adjustment will fix. Also covers the rule that a variance no longer
blocks — the count is recorded, the gap is noted, and the goods carry on.

**IT HAS ITS OWN CONSIGNMENT, AND IT IS `DIRECT_IN`.** Both halves are
decisions rather than convenience. C0's two consignments would BOTH be spent by
this video — the landed one is already counted, and the flying one's Indian leg
is the only thing putting units in the TRANSIT bin, which C2's in-transit column
and J1's "counted somewhere it cannot be sold" scene both read; and
`ensureConsignmentWorld` is build-once, so a flying consignment that is received
is finished for ever and never rebuilt. Receiving it on camera would quietly
take a scene out of two other videos. And DIRECT_IN rather than VIA_BD because
of what the two leave at the door: **a counted VIA_BD dispatch creates its
Indian leg already `ARRIVING`** (`ConsignmentDispatchService` writes PENDING and
updates it in the same transaction), so "Start receiving" — the step that CLAIMS
the receipt and records who is counting — has already happened and cannot be
filmed. A DIRECT_IN consignment's one leg lands PENDING and the whole ritual is
on camera.

**THE COUNT IS THE POINT, SO THE DECLARATION IS ROUND AND THE COUNT IS NOT.**
The seller declares twenty and ten; the video counts eighteen good, one damaged
and ten. One line is short by one and broken by one, the other is exact, because
a receipt whose numbers all match teaches nothing about the column that exists
to hold the difference. `received_qty` counts GOOD units, so a damaged unit is
not also a missing one, and the completed receipt says so in its own words:
"RSH-JAMDANI-IVORY: counted 18 against 20 expected".

**A `--check` SPENDS THIS WORLD, not only a take** — the very first press moves
the receipt PENDING → ARRIVING — so the seeding has to put it back on every run,
and it does two things rather than one. A consignment whose receipt has left
PENDING has its `sellerReference` moved aside and a fresh one declared (the D4 /
B7 retire-forward, fourth instance); and a HALF-COUNTED one is **cancelled**
rather than left as litter, because an abandoned ARRIVING receipt is a real
state with a real way out. A leg cannot be cancelled on its own — the
goods-receipt endpoint refuses one and says to cancel the CONSIGNMENT instead —
and CNS-6 allows that right up to dispatch, which a DIRECT_IN consignment never
reaches. A COMPLETED one is left exactly alone: it has written stock and
unwinding it is an adjustment, not a tidy-up. One still PENDING is REUSED, so a
failed check costs nothing.

**The seed asserts the WHOLE BOX holds exactly one PENDING goods receipt**,
because the list's columns are the receipt number, the consignment, the seller
and the status — **the seller's own reference is not among them**, so there is
nothing stable to name our row by (both numbers are minted per run) and the flow
takes the single pending row.

**One inconsistency found and NOT fixed: a putaway bin is required even where
the warehouse says it is not asked for.** `onRecordAll` refuses any line with
`qty > 0` and no bin, unconditionally, with no reference to
`binTrackingEnabled` — while J1's own tracking panel says, with tracking OFF,
"Receiving can still note one, but it is only a note". CCU-01 has tracking off
and the operator is still made to choose. It is left alone on purpose: the
stricter client produces a TRUER record (BIN-1 says an explicitly supplied real
bin is honoured either way and is "pure upside"), so the video does what an
operator must do and puts both lines into FLOOR. **If anybody does relax it,
relax the COPY instead — "can still note one" is the sentence that is wrong.**

### J3. Labels and the picking sheet · **FILMED** — `print-and-pick.mp4`

**Promise** — you can get a day's parcels printed and picked.
**Length** 13 scenes, 2 min 32 s. **Needs**
`seed-demo-data.mjs print-and-pick`.
**Covers** `/warehouse/printing` as WMS-1 describes it: labels first, then the
picking sheet, and nothing moves until somebody confirms the paper came out.
Selecting a walk rather than the whole queue, the sheet naming anything it could
not print rather than dropping it, confirming labels (which moves those parcels
to the picking tab), printing the picking list, **confirming THAT — which is
what allocates phase-2** — then past batches and marking the batch picked.

**THE ONE THAT BLOCKED IT, AND IT IS NOT A BUG: no parcel on this box can have
a stored label.** `DelhiveryLabelService` puts the courier's
`pdf_download_link` through `assertPublicHttpsUrl` — the same SSRF guard a
seller-supplied webhook URL goes through, because the bytes end up in our bucket
and are later presigned for a seller to open — and `apps/delhivery-sim`'s link
is `http://127.0.0.1`, refused on the scheme before the address is even looked
at. So every confirmation logs "AWB persisted but label upload pending", the
waybill is durable and the label never arrives: **64 shipments carrying a
waybill and 10 carrying a label** when this was measured. Without one the
printing station builds a sheet of ZERO pages and names every parcel
`NO_STORED_LABEL` — the screen behaving perfectly — and the picking tab is
gated on labels having been confirmed, so **the whole of J3 to J6 sits behind
that one file**.

`storeStubLabel` in the seeding writes what the real leg would have written: a
genuine one-page PDF (built with the SAME pdf-lib the sheet merges with —
`LabelSheetService` reports anything it cannot parse as `UNREADABLE_PDF`, so the
`%PDF … %%EOF` string stub mode returns would fail one layer further along and
look like a different problem), into the mock Spaces path, with an ordinary
CUR-6 `awb_labels` row beside it. `lib/deps.mjs` borrows `pdf-lib` from
`apps/api` exactly as it already borrows Prisma, argon2, ioredis and BullMQ.

**Its three parcels are its own, and they are named by the DESTINATION PIN.**
The label queue is genuinely busy — two dozen parcels, because every confirmed
order carries a waybill from the moment it is confirmed (CUR-2b) — and that is
the right picture, but it is also why the video must not select the top rows:
among them sit `RSH-LIFE-CONFIRMED`, D0's parcel for B7 whose whole value is
being at CONFIRMED, and `RSH-CALL-1`, which is I1's. Printing and picking either
moves it and `lifecycleReport` fails the next seed run naming it. The queue's
columns are the order number, the seller, the courier, the waybill, the
destination, the COD and the item count — both numbers are minted per run and
the seller is shared with five other parcels — so the pin is the only stable
handle, and the seeding asserts exactly three live parcels carry it.

**The seeding is REUSE-OR-RETIRE, and the retire CANCELS**, which none of the
earlier ones do. This world is spent progressively — labels confirmed, then the
picking sheet, then the batch marked picked — and a check can stop between any
two. A parcel still CONFIRMED with no label printed is where the video expects
it, so it is reused and a failed check costs nothing; anything else is retired
forward AND cancelled through the ordinary admin cancel, because a retired
parcel carries the same pin for ever and three of them left CONFIRMED means the
next take opens on six rows where the narration says three. The cancel also
releases the reservation, which is what stops three units a take accumulating.
**PICKED is cancellable too, and it has to be**: a full take ends its three
parcels there, which is exactly what the pack bench selects on (WMS-2), so left
alone they pile into J4's queue carrying the same pin as the live ones. The
matrix has `PICKED → CANCELLED_BY_ADMIN` with `RELEASE_STOCK` — "the goods are
off the shelf and in a tote, but nothing has been handed to a courier" — so the
ordinary admin cancel is the right door. Past that, packed or dispatched, stock
has really moved and it is left alone and said out loud.

**`RSH-PICK-` had to join `PROTECTED_REF_PREFIXES`**, for exactly the reason
`RSH-CALL-` did and which I1's entry already states: these end the take
CONFIRMED-or-later holding a LIVE RESERVATION, and CONFIRMED is in
`REMOVABLE_STATUSES` — so the shared clearing tried to delete an order whose
`order_items` are referenced by `stock_reservations` under RESTRICT, and died
there rather than in the video's own seeding. (The catch added for I4 now names
that shape too.)

**One narration correction the frames forced.** A line about serialised units
being left behind for the pick station was written as though it happened; the
catalogue is all NORMAL-mode, so all three parcels went through and the frame
showed nothing of the sort. It now quotes what the confirm dialog says BEFORE
the press — "any with serialised units stay behind for the pick station" — which
is on screen and is the rule stated as a rule.

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

### P5. What we cannot undo · **FILMED** — `what-we-cannot-undo.mp4`

**Promise** — you can name every irreversible act in the admin app and say what
it costs.
**Length** 2 min 36 s of narration over 13 scenes. **Prerequisites** none — it
is deliberately the first admin tutorial anybody watches.
**Needs** `seed-demo-data.mjs what-we-cannot-undo`, which is D0 plus three rows
of its own (below).
**Covers** ten screens and NOT ONE CLICK that changes anything: god mode and the
stock claim beside it, completing a goods receipt, overruling a call, the pack
bench's scan, freeing a pickup day, a return standing at our door, bins,
accepting a top-up, approving a bank change, and closing a month. Each scene
reads that screen's OWN warning copy — written by whoever built it — beside what
the act actually writes.

**Its seeding is `dangerousActsWorldFor` plus one D0 parcel.** Three of the ten
screens read as empty states, and a video whose whole subject is what an act
costs cannot say "Nothing waiting" three times:

- **A return AT OUR DOOR** — `RSH-LIFE-ATDOOR`, the tenth D0 parcel, driven one
  scan past `RSH-LIFE-RETURNING` to `RTO_DELIVERED`. **It is the only parcel in
  the file whose ORDER and SHIPMENT deliberately part company** (TRK-6 keeps the
  order at RTO_IN_TRANSIT), so it carries `wantShipment` and both the skip test
  and the report read it — otherwise a run that died between the last two scans
  would report green on a parcel that never reached the bench.
- **A bank change waiting** — `pendingBankChange` puts an account on file and
  then changes it, through `PATCH /seller/profile/bank-details` twice, because
  the FIRST set writes straight through and only a change raises a request. Not
  through Prisma: the account number is encrypted and carries its own mask and
  key version.
- **A month closed** — `closeAnEndedMonth` closes **July**, not August. The
  month list runs from the earliest CLOSED period to today, so with nothing ever
  closed the dropdown holds only the open month and there is no close to point
  at. July closed puts three on one page: July frozen, August "has ended and is
  not closed yet" with its amber warning and the Close button, and September
  live. **Closing is itself irreversible and PNL-CF-1 refuses any month earlier
  than a closed one for ever**, so on this box June and before can never be
  closed now; the function runs only when nothing is closed already.

**Two things the survey got wrong, both found by the frames:**

- **`/warehouse/receive` opens on PENDING, and a PENDING receipt has no
  Complete button** — it offers "Start receiving" and "Cancel receipt". The
  Complete button exists only at ARRIVING. So the seeding takes every ARRIVING
  receipt as far as it can WITHOUT writing stock (started, every line counted at
  what was declared) and the flow switches the list's Status filter. The first
  attempt staged one receipt and the list handed the flow a DIFFERENT one that
  an earlier run had left half-started, which filmed "recorded: 0" under a line
  about stock being written for what was counted.
- **THE BIN COLLAPSE HAS NO SCREEN AT ALL.** The survey said "the collapse
  control is below the fold"; it is not. `/warehouse/bins` ends at "Move stock
  between bins", and `BinCollapseService`'s four endpoints
  (`collapse/request`, `collapse/confirm`, `snapshots`, `snapshots/:id/restore`)
  have no caller outside the e2e suite. The narration says so — it is the one
  act on the list you cannot do from the console — which is more useful than
  pretending otherwise, and it also makes **P4 more impractical than its entry
  records**: there is no read-only "what a collapse would move" half to film.

**And one product bug, which is why this entry could not simply be filmed.**
The "At our door" worklist could never fill from a real courier scan: the
webhook processor's INFORMATIONAL branch never synced `shipments.status`, and
`RTO_DELIVERED` is the only thing that puts a row in that list. See
[Bugs found](#bugs-found-while-establishing-feasibility).

**Film it with NO clicks.** The only gestures are navigation, one list filter
and one month picker. Every scene gates on the SENTENCE the narration quotes
rather than on the panel that would hold it, because three of these screens
render an identical page when their world is missing.

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

There are **two accounts of 121,000 credits, 242,000 in total** — though this
machine currently has **only one of them in `~/.config/skydrop/elevenlabs-keys`**
(`generate-voice.mjs --quota` says "1 key(s)"), which is worth knowing before
planning against 242,000. `generate-voice.mjs` moves between them: it spends the first until it answers
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
its own and the other forty-seven are not.

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

**One from filming P5 (2026-09-30), and it is the reason P5 could not simply be
filmed: A WORKLIST THAT COULD NEVER FILL.** The RTO station's "At our door" tab
exists because a return the courier had handed back and nobody had received
appeared on NO screen at all, and one sat that way for five days —
`listAwaitingReceipt`'s own docblock says so. It classifies a row AT OUR DOOR on
exactly one test: `shipments.status === RTO_DELIVERED`. **Nothing in the product
ever wrote that status.** TRK-6 is right and unchanged — an `RTO_DELIVERED` scan
must not move the ORDER — but it was implemented as "write nothing", and the
shipment row is not the order: it is where the parcel physically IS, and the two
branches of the webhook processor that DO transition both sync it, one of them
saying so at length ("the shipment row follows the parcel, not just the order").
The INFORMATIONAL branch returned without touching it. So the only rows that had
ever reached RTO_DELIVERED were written by a seeding script, and the production
row the docblock cites (SD-TEST-524086) is one of those: **the list built to
catch the gap was structurally unable to see a real one.** The fix is narrow —
`RTO_DELIVERED` only (`DAMAGED` is the other INFORMATIONAL scan and describes a
parcel's condition rather than where it is; the public tracking page projects
from this column, so a damage scan after a delivery would tell a customer their
delivered parcel was damaged in transit), forward-only, and guarded IN THE WHERE
so a receive landing first cannot be overwritten. The spec's Prisma fake now
APPLIES the where clause on a shipment write — the `pnl-fake-db.ts` lesson, a
second time: a fake that answers every write alike cannot tell a guarded write
from an unguarded one, and the guards ARE the behaviour under test. Proved red.

**One from filming H2 (2026-09-30): A PARCEL THAT CAME BACK WAS STILL OUT FOR
DELIVERY.** The order tracker had nine forward rungs and no idea a return leg
exists. So an order whose goods were back on our shelf and whose seller had
already been refunded read, on the SELLER's own order page, two inches under a
chip saying "RTO restocked",

>     Current step:  Out for delivery   Courier
>     Still to come: Delivered          Courier

and the Delivered rung fell back to the courier's ETA, so it printed a delivery
DATE for a delivery that was never going to happen. **It is the third time this
one ladder has said something confident that was not so** — after the AWB-time
fallback that told every confirmed seller picking was "not needed", and the
DELIVERED order carrying an "Out for delivery" heading. A parcel that never
reached the customer now gets no Delivered rung at all; the return rungs say what
happened and "Back in your stock" becomes the current step. One DELIVERED and
then sent back keeps its delivery, because that delivery happened. A LOST parcel
says so. "Back in our warehouse" is deliberately allowed to sit PENDING while the
courier's own handed-back scan is already on the timeline below it — only a
person at the bench writes RTO_RECEIVED (TRK-6), and the gap between those two is
a real one somebody has to close. Five cases pinned, including the two that must
NOT change. Proved red.

**One from filming H1 (2026-09-30), found by COUNTING THE TILES IN A FRAME.**
The admin dashboard's attention band said **"4 queues need staff attention"**
over FIVE lit tiles. `needingAttention` was a bare array of six counts in the
same order the seven tiles render, with `toPick` simply absent — a skipped line,
not a decision, since the array otherwise followed the render order exactly. So
a warehouse holding twenty parcels ready for a picking sheet, and nothing else
wrong anywhere, read **"Nothing is waiting on a person"** directly above a lit
tile saying twenty. It undercounted by one on every morning picking was
outstanding, which is most of them, and was only VISIBLE on the morning picking
was the ONLY thing outstanding — the morning the note exists for. The recurring
shape again. It is now `countNeedingAttention`, taking a NAMED FIELD PER TILE
rather than an array: a missing key is a hole with a name where a missing array
element is nothing at all. `dashboard-attention-count.test.ts` asserts the
arithmetic AND compares the counted set against the `<AttentionCard>`s the view
actually renders, because proving the arithmetic was never the problem — the old
code counted its six perfectly. Proved red.

**And one capability with no screen, found by the same video: THE BIN COLLAPSE.**
BIN-4 is a designed, guarded, destructive operation — SUPER_ADMIN, the warehouse
code typed exactly, a thirty-character reason, a six-digit code emailed to the
actor, a snapshot taken before the merge and a restore path after it — and
`BinCollapseService`'s four endpoints (`collapse/request`, `collapse/confirm`,
`snapshots`, `snapshots/:id/restore`) have **no caller anywhere outside the e2e
suite.** `/warehouse/bins` ends at "Move stock between bins". This entry's own
survey said "the collapse control is below the fold", which is the shape the
curriculum has already named: *a capability with an endpoint and no screen is
invisible to every roadmap doc.* Not fixed — a request/confirm/snapshot/restore
UI is a feature, not a filming task — and P5's narration says the honest thing
instead: it is the one act on the list you cannot do from the console.
**It also makes P4 more impractical than its entry records**: there is no
read-only "what a collapse would move" half to film either.

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

**THE SIXTH PLACE AN ORDER IS NAMED BY ITS UUID, found by filming the issue
board (2026-10-01).** `/system-issues` carried "A seller asked to return a parcel
and the courier refused — The cancellation for order
01a0f016-4863-7b76-85f2-df0e319f1a7f was refused: waybill not found", on the ONE
screen whose entire job is to say which order needs a person. Not a rendering
slip: `DeliveryActionService.executeRto` had `who.orderId` and nothing else, so
the id went into the prose while the card's own "Open the order" link — which
reads the same id out of `metadata` — sat two lines below it, unused by anybody
reading the sentence. A uuid cannot be typed into a search box or read down a
phone. Fixed by reading the order NUMBER on the refusal path (one query, and it
falls back to the id rather than losing the issue), with the id left in
`metadata` where the link wants it. Proved red on the old code first, and the
spec covers both branches. **The row already on this box predates the fix and
still shows the uuid**: the dedupe key is the request, nothing bumps it, and
`raise` re-states a detail only on a recurrence — so this one will read the old
way until a seller's send-back is refused again.

**Observed and NOT fixed, same screen:** `AwbGenerationWorker gave up on a job`
also carries a shipment uuid, but that string is `err.message` from the worker's
own throw rather than prose written for a reader, and it is one of the few
places on the board that is genuinely addressed to an engineer.

**THE SEVENTH PLACE, one day later, found by filming the call station
(2026-10-01).** The card an agent reads with the phone already ringing opened

    Assignment 01a0ef64 · Order 01a0f2a6-4f66-7bb0-9657-872a6237734b · pull #1

while the recipient panel a few centimetres below it said SD-2026-26-000365 —
two identifiers for one order on one card, and the unreadable one on top, where
the number is what the agent would say to the seller, type into a search box or
write on a pad. `assignment.order.orderNumber` was already on the payload and
already rendered lower down; the head simply read `assignment.orderId` because
that is what the queue entry carries. It falls back to the id only for the case
the type documents — the order vanished under the entry. Structural spec, like
the rest of `call-station-recovers-held-call.test.ts`: what is wrong is WHICH
field the head reads, and a rendered assertion passes on either.

**apps/admin had to be REBUILT AND RESTARTED before the take**, or the video
would have filmed the defect that had just been fixed — the README's rule about
restarting by the LISTENING pid, applied to a frontend rather than to the API.

**THE EIGHTH AND NINTH, on the agent detail panel, found by filming I2
(2026-10-01).** One root, and the first of them is the interesting one because
the CHECK PASSED and only the FRAME said so.

The capacity field rendered
`value={maxActiveCalls === '' ? String(agent.settings.maxActiveCalls) : maxActiveCalls}`,
using the empty string as a sentinel for "not edited" — so **the field could not
be EMPTIED.** Clearing it put the current cap straight back on the next render,
and the next keystroke landed BESIDE that value rather than replacing it. The
recorder cleared "1", typed "3", pressed Save capacity, and the row behind the
panel read **"1 of 13"**. No error, no refusal, button perfectly enabled — a
number nobody typed, saved. A supervisor raising a cap from 1 to 10 by
backspacing first would have written 110.

And the panel held the agent row it was OPENED with in `useState`, so after a
successful save it still showed the old cap with its Save button enabled;
pressing again re-sent the same value. Reading the live row out of the list
(`openAgentId` + a `find`, rather than the row itself) fixes both: the field owns
its own value, seeded by an effect keyed on the agent id so a background refetch
cannot overwrite what somebody is typing, and the comparison the button is
disabled on is made against what the server now holds.

**`agent-capacity-field.test.tsx` pins both, and both were proved red first.**
The tell for the first one is a single line — `expect(field).toHaveValue(null)`
after `user.clear()` — which is the whole defect stated as an assertion.

**This is the "a value that is CLOSE ENOUGH most of the time" shape again.** A
one-digit cap edited by select-all-and-type works perfectly; it is only clearing
first, or going past nine, that writes the wrong number. And a gate on "the save
succeeded" would have passed: the PATCH really did succeed, with 13 in it.
**A check proves a step was REACHED. Only the frame says what it reached.**


**AND AN EIGHTH SEEDING BUG, which is MUST #12 one level along (2026-10-01).**
`clearPreviousOrders` removes a previous take's pre-dispatch orders in one
transaction, deleting the child rows it knows about first — charges, queue
entries, items, events. `order_reattempt_requests` FKs `orders` with RESTRICT
and was not among them, and **approving a re-attempt puts its order back to
`PENDING_CONFIRMATION`** — the first entry in `REMOVABLE_STATUSES`. So I4's take
left an order this function would try to delete and a row that refused to let
it, and the failure landed on the NEXT run, in the shared clearing, as a wall of
Prisma text about a constraint name, nowhere near the video that caused it.

The rule CLAUDE.md states for the e2e reset — "when a new table FKs
`sellers`/`orders` with RESTRICT, add it to the reset helper in the same commit"
— holds here word for word, and the seed is the reset. **When a take creates a
row that FKs `orders`, add its `deleteMany` to `clearPreviousOrders` in the same
commit.** There is now a catch around that transaction that reads the constraint
name out of the error and says which table is blocking and what to do, because
the next instance of this is a matter of time: Prisma defaults a required
relation to RESTRICT, and roughly twenty tables carry an `orderId`.
