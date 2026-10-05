# Role permission sets — audit and proposal

Reviewed 2026-10-05, against `feat/multi-role-rbac` at `9a5265fd`.
Analysis only; no application code was changed by this document.

**What is being checked.** The three staff access tiers drafted in
`apps/api/src/common/auth/staff-role-presets.ts` (Admin, Support,
Read-only), and whether the seller and store sides need equivalents.
The decision to keep job-function roles AND add a tier axis is taken; it
is not revisited here.

---

## Method, and what it can and cannot see

I read the three catalogues
(`apps/api/src/common/auth/permissions.ts` — 84 keys;
`seller-permissions.ts` — 40; `store-permissions.ts` — 30), the six
seeded seller roles and five seeded store roles in those same files, the
drafted presets, and
`packages/db/prisma/migrations/20261005000100_staff_access_tier_roles/migration.sql`.

Then I built the thing that actually answers the question: **a map from
every permission key to every HTTP handler that key opens.** Judging a
key by its name is how `customer-lookup` came to be reachable by every
seller login on the platform (RBAC-1), so every claim below is made
against a handler, and where the handler's consequence was not obvious I
read its service.

The map was produced by parsing every `*.controller.ts` under
`apps/api/src`, stripping comments first (the `@SellerRoles` lesson —
prose about a rule reads exactly like the rule to a regex), resolving
handler-level `@Require*Permissions` over class-level, and treating
`@*SelfService` as a short-circuit the way each guard does. It found
**401 staff handlers** (excluding self-service), **213 seller**, **76
store**, and every one of the 84 staff keys is declared on at least one
handler — nothing in the catalogue is dead, and no handler declares a
key the catalogue does not define.

**Reach of each drafted tier, measured rather than assumed:**

| Tier | Keys | Staff handlers reachable | Of which writes |
|---|---:|---:|---:|
| Admin | 73 / 84 | 368 / 401 | 210 |
| Support | 9 / 84 | 69 / 401 | **5** |
| Read-only | 20 / 84 | 136 / 401 | **1** |

**What I could not determine, and what it would take.** (a) Live role
membership and the real seller/store role rows — there is no local
database and production is read-only through a runner I did not use, so
statements about what any particular seller's Viewer role holds *today*
come from the brief, not from me; one `SELECT key, count(*) FROM
seller_role_permissions GROUP BY 1` would settle it. (b) Whether any
`system_settings` row is marked `is_sensitive` in production — the seed
sets none (`grep -c "isSensitive: true" packages/db/prisma/seed.ts` → 0)
and no migration sets it true, but the column is writable, so only a
query proves it. (c) Whether `tickets.resolve`'s uncapped branch has
ever been used — needs an `audit_logs` query. Each of these changes a
severity below, not a conclusion.

---

## Part 1 — The drafted sets, key by key

### 1.1 Admin — the exclusions are right in shape; two are leakier than they read, and one key should probably join them

The two exclusion lists are well chosen and the reasoning in the file is
sound. The problems are not in the lists; they are in keys Admin *does*
hold that reach the same place by another route. Those are Part 5. Three
things belong here.

**(a) `money.pnl.close` should be reconsidered as a fourth
invariant-bypass exclusion — the sharpest finding in this section.**

`money.pnl.close` guards three handlers:

```
POST /admin/treasury/pnl-periods/:month/close
POST /admin/treasury/pnl-periods/:month/lock-permanently
POST /admin/treasury/pnl-periods/backfill-close
```

The argument is not that closing a month is dangerous — PNL-CF-1 is
built so that late data is carried forward and a close is routine. It is
that **`lock-permanently` and `backfill-close` create a state only
`money.pnl.god_mode` can undo, and Admin is deliberately denied
`money.pnl.god_mode`.** CLAUDE.md is explicit that lock-permanently "is
allowed even when the gate still fails (the owner decides; the audit
says `lockedDespiteNightlyJobs`)", and that `backfill-close` "closes
every month from the first with P&L activity through `throughMonth`" —
one call that freezes the entire reported history as FINAL.

So an Admin can permanently lock a month whose nightly cost syncs are
known to have failed, and the only route back is a permission the owner
holds. That is the definition of an invariant bypass: a one-way door
whose key is withheld from the person who can walk through it.

Two ways to fix, and I prefer the second:

- Add `money.pnl.close` to `ADMIN_EXCLUDES_INVARIANT_BYPASSES`. Cheap,
  but it takes the routine monthly close away from the people who run
  the platform, which is the wrong trade.
- **Split the key.** `money.pnl.close` keeps the ordinary
  `:month/close`; a new `money.pnl.lock_permanently` covers
  `lock-permanently` and `backfill-close`, and joins the five
  exclusions. That matches what the permissions file already says its
  rule of thumb is — "if you cannot write its label without saying
  'and', it is two permissions" — and the current label needs an "and":
  "Close a P&L month ... **Also** closes the months that existed before
  carry-forward did."

This is an owner call because it is about who signs off a reported
month, not about code.

**(b) `sellers.bank_change.approve` also guards a READ, and excluding it
blinds Admin to a queue it needs.**

```
GET  /admin/bank-change-requests          ← a read
POST /admin/bank-change-requests/:id/approve
POST /admin/bank-change-requests/:id/reject
```

Admin holds `money.withdrawals.review` and `money.remittances.manage` —
it approves withdrawals and records the money actually sent. It cannot
see that a seller has a bank-account change pending. So an Admin can
remit to an account a seller has asked to stop using, with nothing on
screen to say so.

The exclusion of the *decision* is right (it is the company's financial
identity, exactly as the file argues). The exclusion of the *queue* is
collateral. **Proposal: split into `sellers.bank_change.view` (the
queue; goes to Admin and to Read-only) and
`sellers.bank_change.approve` (the decision; stays withheld).** Note
that the masked path is already correct and needs no change —
`GET /admin/sellers/:id` under `sellers.view` returns
`bankAccountNumberMasked`, with the full number only behind
`sellers.bank_account.reveal` (`admin-seller.service.ts:82` vs `:161`).

**(c) Everything else Admin holds, I checked and would keep.** Admin
holds 21 of the catalogue's 31 `dangerous: true` keys. I went through
them against what the handler does, and each is the job the tier is
named for:

`orders.tracking.manual_scan`, `warehouse.manifest.close`,
`warehouse.rto.finalize`, `inventory.adjustments.approve`,
`courier.dispatch.handoff`, `courier.manual_placement`,
`courier.accounts.manage`, `courier.ops.write`, `sellers.suspend`,
`reseller.stores.pause`, `money.wallets.bill_unbilled`,
`money.topups.review`, `money.withdrawals.review`,
`money.remittances.manage`, `money.settlements.record`,
`money.freight.manage`, `money.treasury.manage`, `fx.manage`,
`tickets.resolve`, `system.settings.manage` — plus `money.pnl.close`,
discussed above.

The file's own line is the right one and worth keeping in the commit
message: *dangerous means "confirm twice", not "nobody but the owner".*
Two of these have consequences their labels understate — see Part 3 —
but that is a labelling and splitting problem, not a reason to withhold
them from Admin.

**Nothing to remove from Admin on grounds of consequence. One
consideration on grounds of reach:** `fx.manage` sets the single rate
every BDT figure in the estate is converted through (PRC-8: a flat fee
agreed in taka is converted at charge time through it; TRE-6: the P&L
converts through its history). A wrong rate mis-bills every Bangladeshi
seller at once and the charge records its own `fxRate`, so past charges
do not self-correct. I would not withhold it — somebody operational has
to be able to set it — but it is the key I would most want a second
pair of eyes on in the UI, and it is already `dangerous`.

### 1.2 Support — one contradiction in its own description, one hard functional gap, four keys I would add

**(a) The description says "Changes nothing operational". The set
contains five writes, and one of them moves money.**

Support's nine keys reach five write handlers:

```
POST  /admin/system-issues/:id/acknowledge            ← harmless
POST  /admin/tickets/:ticketId/notes                  ← replying to a seller
POST  /admin/tickets/:ticketId/events/:eventId/relayed
PATCH /admin/tickets/:ticketId                        ← resolve, WITH a wallet refund
POST  /admin/tickets/:ticketId/store-dispute-settlement ← moves money store ↔ seller
```

This is not an error in the preset — it is forced by the catalogue.
`tickets.resolve` is the *only* ticket write key, so **there is no way
to let somebody answer a ticket without also letting them refund one.**
See Part 3.1; the fix is a catalogue split, not a change to this preset.

Meanwhile the description should say what is true. Suggested: *"Answers
for what went wrong: reads orders, parcels, sellers and stores, and
works the ticket queue — including resolving a ticket with a refund.
Changes nothing about how the platform runs."*

**(b) Support can see a system issue and cannot clear one. For SCAN-1
that is the whole point of the page.**

`system.settings.view` opens `GET /admin/system-issues` and the
acknowledge. **`POST /admin/system-issues/:id/resolve` is behind
`system.settings.manage`**, which Support does not hold.

SCAN-1 is explicit that a duplicate-scan block on a warehouse operator
is cleared by "an admin resolving the issue with a note on
`/system-issues`". Support is exactly the desk a blocked packer rings.
So the tier that exists to answer "something is broken" can read the
list, write "I'm on it", and not unblock the person.

I am **not** proposing Support get `system.settings.manage` — that key
changes every seller's behaviour (Part 3.2). The fix is the Part 3.2
split: `system.issues.resolve` as its own key, which Support holds. If
that split is not done now, this gap should be written down as a known
limitation of the tier rather than discovered by a blocked packer.

**(c) Four keys I would add to Support, in descending confidence.**

1. **`orders.tracking.run_poll`.** The cheapest useful act in the
   catalogue for "where is my parcel" — the catalogue's own description
   says "Safe to press repeatedly — a cycle only applies scans newer
   than what each parcel already has". A support desk that must escalate
   to get a tracking refresh is a support desk that escalates all day.
   Not dangerous, single handler, idempotent. Add it.
2. **`orders.charges.view`.** "Why was I charged ₹162.60?" is a support
   question (PRC-8 exists because it is unanswerable a month later
   without this). Read-only, one handler. Add it.
3. **`inventory.view`.** "Where is my stock, and did you receive my
   consignment?" — 14 read handlers across consignments, receipts,
   movements and unit discrepancies. Add it.
4. **`money.view`.** "Where is my payout?" — this is the one I would
   ask the owner about rather than decide. It is read-only, but it is 22
   handlers across every wallet, settlement and freight surface, **and
   it includes the top-up proof images, which are unmasked bank
   documents** (Part 5.2). If Part 5.2 is fixed, add it. If not, leave
   it out and accept that Support escalates money questions.

I would **not** add `reports.view` or `webhooks.view` — nothing about
the support job needs them, and `webhooks.view` shows a seller's
delivery payloads.

**(d) Keys Support holds that I checked and would keep.**
`courier.ops.view` is correct even though each call spends a live
courier API call (EPOD, expected TAT, e-waybill status) — that *is* the
job, and the catalogue says so. `callcenter.queue.view`,
`warehouse.view`, `sellers.view`, `reseller.stores.view` and
`orders.view` are all pure reads and all defensible.

### 1.3 Read-only — one write, one key it holds that Admin does not, two data exposures

**(a) It is not read-only. `isViewKey` is a name test, and exactly one
`.view` key guards a write.**

```
POST /admin/system-issues/:id/acknowledge   ← @RequirePermissions('system.settings.view')
```

(`apps/api/src/modules/system-issues/controllers/admin-system-issue.controller.ts:90`)

One write out of 136 reachable handlers, and a harmless one — it records
that somebody is on it and explicitly does not close anything. But the
role's description is *"Sees everything and changes nothing — every read
in the catalogue and no write at all"*, and that is now false in a way
the derivation cannot notice, because the derivation tests the key's
name and the hole is in the handler.

Three options:

- Accept it and change the description. Cheapest. But it leaves the
  derivation's one assumption silently untrue, which is how it stops
  being one harmless write.
- Move acknowledge to its own key (`system.issues.acknowledge`) as part
  of the Part 3.2 split. **Preferred** — it falls out of a split that is
  worth doing anyway.
- Add a `readonly` exclusion list. Worst: a hand-maintained list is
  exactly what the file's "derived, not transcribed" argument rejects.

Whichever is chosen, **add a spec that asserts no key in the Read-only
set guards a non-GET handler.** That is mechanical, it is the assertion
the name test is standing in for, and it would have caught this. It also
catches the next one, which is the real value — a new `.view` key on a
POST is an easy and invisible mistake.

**(b) Read-only holds `staff.view`. Admin does not. That is the only key
in Read-only and not in Admin, and it inverts the ladder.**

Admin's exclusion is argued on principle: *"An Admin runs the platform;
it does not decide who else may"* — the staff list is "a different kind
of trust". Read-only then gets the staff list by the name test, because
`staff.view` ends in `.view`.

Both positions are defensible in isolation and they contradict each
other. If who-has-access is a different kind of trust, an auditor does
not get it by spelling. If an auditor needs it, so does the person
running operations.

**My recommendation: give `staff.view` to Admin and keep it in
Read-only.** Reasons: (i) the courier-panel posture the file cites
("cannot ... view and create users") is about creating users, and
`staff.manage` already covers that; (ii) Admin cannot usefully be
refused the *list* while holding `notifications.broadcast`, which
enumerates staff email addresses five at a time (Part 5.1); (iii) an
Admin who cannot see who holds a permission cannot answer "who should I
ask" — the question the tier exists to stop escalating.

The alternative — drop `staff.view` from Read-only — is also coherent,
and if the owner prefers it the derivation needs its first exclusion and
the "no write" spec above becomes the natural place to also pin "and
these keys are withheld, with the reason".

**(c) Two things Read-only reads that an auditor arguably should not.**
Both are Part 5 (side doors), listed there: unmasked bank documents via
`money.view`, and courier-portal screenshots via
`courier.accounts.view`.

**(d) One read it is denied that it probably needs.**
`courier.waybills.manage` guards `GET /admin/delhivery/status`,
`GET /admin/delhivery/connectivity` and `GET /admin/shiprocket/status`
alongside `POST /admin/delhivery/waybill-pool/refill`. So Read-only
cannot see waybill pool depth or courier connectivity — two of the more
useful things to put in front of an analyst. See Part 3.4.

---

## Part 2 — `system.settings.view` for Support: settled

**Decision: yes, Support keeps it. I optimised for the issue page.**

The key opens two doors:

```
GET  /admin/system-issues              ← the problem list (NOTIF-16)
POST /admin/system-issues/:id/acknowledge
GET  /admin/system-settings            ← the whole runtime configuration, read-only
GET  /admin/system-settings/:key
```

**Why the issue page wins.** NOTIF-16 puts `system.settings.view` on
*every* system-issue audience for a stated reason — "a notification
pointing at a page the reader cannot open is a dead end". Support is the
audience for "something broke". Withholding this key makes every
HIGH/CRITICAL notification Support receives a dead link. That is a
defect in the product, visible on the first incident.

**What the other door costs, stated plainly.** Support reads every
runtime setting: fee amounts, the courier live-write flags, accrual
timing, NDR gates, the P&L cutover date. It is a **read**; changing any
of them is `system.settings.manage`, which Support does not hold. Two
real costs:

1. **Commercial configuration is visible.** `pricing.flat_delivery_fee`,
   `wallet.cod_collection_fee_percent`,
   `wallet.instant_pay_fee_percent`, `courier.selection_policy` — the
   platform's pricing posture, legible to anyone on the support desk. I
   judge this acceptable: these are figures Support has to discuss with
   sellers anyway, and the per-seller overrides (`sellers.view` →
   `GET /admin/sellers/:sellerId/settings`) are already in Support's set
   through a key nobody questioned.

2. **A latent secret-read, and it is worth being precise about.**
   `GET /admin/system-settings/:key` returns the **raw** value even for a
   row marked `is_sensitive`; only the list response masks
   (`system-settings.service.ts:215` masks `valueDisplay`; the
   `SystemSettingFull.value` doc comment says *"Sensitive settings still
   return the raw value here; the UI gates reveal"*). **A UI-gated
   reveal is precisely the shape FE-2 forbids** — the UI is reading
   material, the server is the boundary. Today the exposure is nil
   because nothing is marked sensitive, and the preset file flags this
   honestly. But the day somebody seeds a sensitive setting, Support and
   Read-only read it, and nothing will fail.

   **This should be fixed in the server, independently of the presets,
   and before anything is marked sensitive.** Either mask in `getByKey`
   and add a separate audited reveal endpoint behind
   `system.settings.manage` (the `sellers.bank_account.reveal` pattern,
   which already exists and is already audited), or stop using
   `is_sensitive` and keep secrets in env with a ref in the DB, which is
   the CUR-1 discipline the estate already follows for courier
   credentials and the tracking webhook secret. The second is less work
   and more consistent.

**If the owner would rather Support not read the settings page**, the
clean route is the Part 3.2 split: `system.issues.view` +
`system.issues.resolve` for the issue page, `system.settings.view` for
the configuration. Support then holds the first two and not the third,
and NOTIF-16's audience list changes from `system.settings.view` to
`system.issues.view`. That is the better end state; it is a slightly
larger change because it touches `permissionsFor(kind)` in the notifier.

---

## Part 3 — Keys that open two doors of very different consequence

This is the shape the brief asked me to hunt, and it is the most
valuable output of the audit: a tier looks reasonable and quietly
carries something nobody intended. Ranked by what the second door
actually does.

### 3.1 `tickets.resolve` — "reply to a seller" and "credit a seller's wallet, sometimes without a cap"

```
POST  /admin/tickets/:ticketId/notes                    ← add a note = REPLY to the seller
POST  /admin/tickets/:ticketId/events/:eventId/relayed
PATCH /admin/tickets/:ticketId                          ← transition, incl. a SCRAP_REFUND credit
POST  /admin/tickets/:ticketId/store-dispute-settlement ← RS-7, moves money store ↔ seller
```

**Adding a note is how you answer a seller.** There is no reply key. So
the catalogue cannot express "this person answers tickets" — the
narrowest grant that permits a reply also permits a wallet credit and a
store-dispute settlement.

The refund is mostly bounded, and I checked: `ticket.service.ts:864`
refuses above the reseller transfer price
(`REFUND_ABOVE_TRANSFER_PRICE`), and `:884` refuses above the goods
value (`REFUND_ABOVE_GOODS_VALUE`) computed from the line's declared
value, the order's lines, or `orders.declaredValueInr`. **The cap
returns `null` — no bound at all — exactly when the ticket names no
order**, and the code says so deliberately:

> *"Returns null only when the ticket names NO order — a receipt
> shortfall against a consignment has no order value to be capped
> against ... That is a deliberate hole, not an oversight."*
> (`ticket.service.ts:1505`)

`RECEIPT_SHORTFALL` tickets are auto-raised on **every** short or
damaged goods-receipt count (TKT-3), so unbounded-refund tickets are
routine, not exotic. The conclusion: **`tickets.resolve` is an arbitrary
credit into a seller's wallet, on a ticket type the system raises by
itself** — while `money.wallet.transfer` is withheld from Admin on the
grounds that it "moves real money between the seller and us — not a
correction".

**Proposal:** split into `tickets.reply` (notes + relayed) and
`tickets.resolve` (the transition and the settlement). Support gets
`tickets.reply` and — this is the owner's call — probably
`tickets.resolve` too, since a support desk that cannot close anything
is a queue. But the split makes the choice *sayable*, which it is not
today, and it is what lets a future "Support (no refunds)" role exist.

Separately, and regardless of the split: the uncapped branch deserves a
bound of its own. The honest one is the consignment's declared value
from the goods receipt, which exists; failing that, a settings-driven
ceiling. Right now a typo in a rupee field on a receipt-shortfall ticket
is an unbounded credit with nothing between it and the ledger.

### 3.2 `system.settings.manage` — "close a system issue" and "change behaviour for every seller at once"

```
POST  /admin/system-issues/announce-unnotified
POST  /admin/system-issues/:id/resolve       ← routine; clears a SCAN-1 operator block
PATCH /admin/system-settings/:key            ← every runtime switch in the estate
```

The second door is the broadest single key in the catalogue. Through it:
`courier.<code>_live_writes_enabled` (whether real parcels are booked),
`handover_scan_dispatches`, `courier.ndr_runner_enabled` and
`courier.ndr_auto_categories` (whether vans are dispatched),
`wallet.cod_credit_mode`, `pricing.flat_delivery_fee`,
`pnl.courier_adjustments_from`, `wallet.accrual_timing_tier`. The
catalogue's own description is accurate: *"A single value here changes
behaviour for every seller at once."*

The first door is clerical and frequent, and it is the one the warehouse
depends on: SCAN-1's duplicate-scan block is cleared by resolving an
issue.

**Proposal: `system.issues.view`, `system.issues.acknowledge` and
`system.issues.resolve` as their own keys**, leaving
`system.settings.view` / `.manage` to mean the configuration page and
nothing else. This single split resolves four separate findings in this
document: Part 1.3(a) (the one write in Read-only), Part 1.2(b)
(Support cannot unblock a packer), Part 2 (Support reads the settings
page as a side effect of needing the issue page), and this one. It also
needs `permissionsFor(kind)` in `SystemIssueNotifier` updated, since
NOTIF-16 relies on every audience holding the key that opens the page.

### 3.3 `orders.cancel` — "the ordinary cancel" and "turn a delivered parcel around at the courier"

```
POST /admin/orders/:id/cancel
POST /admin/orders/:id/retry-stock
POST /admin/orders/:id/return-to-pick
POST /admin/orders/:id/return        ← customer-return: books a REVERSE PICKUP at the courier
```

`AdminCustomerReturnController` is class-gated on `orders.cancel`
(`admin-customer-return.controller.ts:34`) and its service calls
`CourierAwbDispatchService.generate`
(`reverse-pickup-booking.service.ts:198`) — a live courier booking,
whose own comment reads *"there is no second call, and no undo beyond a
cancel"*. It also charges the seller a `CUSTOMER_RETURN_FEE`.

Two mismatches worth naming:

- The label — "The ordinary cancel, which the lifecycle state machine
  still has to allow. Releases stock." — describes one of four handlers.
- **`orders.cancel` is not marked `dangerous`**, while
  `courier.ops.write` is, explicitly because *"a cancel turns a moving
  parcel into a return"*. The same physical act is behind a dangerous
  key on one route and a plain one on another.

**Proposal:** at minimum mark `orders.cancel` dangerous and extend the
description. Better: `orders.customer_return` as its own key — it bills
the seller, it books a courier job, and it applies to *delivered*
orders, which is a different act from calling off an unpacked one.

### 3.4 `courier.waybills.manage` — "see what's left" and "spend the account's real allocation"

```
GET  /admin/delhivery/status
GET  /admin/delhivery/connectivity
GET  /admin/shiprocket/status
GET  /admin/shiprocket/connectivity
POST /admin/delhivery/waybill-pool/refill   ← spends the account's real allocation
```

Four reads and one spend. The read half is useful to anyone watching the
platform; the write half is not. **Proposal: `courier.waybills.view` for
the four reads (goes to Read-only and Support), `courier.waybills.manage`
for the refill.** The catalogue's own description already needs an "and".

### 3.5 `orders.tracking.manual_scan` — "record one scan" and "run the whole attention sweep"

```
POST /admin/tracking/shipments/:shipmentId/manual-scan   ← the named act
POST /admin/nsa/:orderId/acknowledge
POST /admin/nsa/sweep                                     ← the entire hourly sweep, now
```

`POST /admin/nsa/sweep` calls `OrderAttentionService.sweep()`
(`admin-nsa.controller.ts:75`), which runs the whole thing — not just
the NSA half. Reading `order-attention.service.ts:308-360`:
`checkStalledReturns`, `checkAwblessConfirmed`, `checkShipmentlessConfirmed`,
`checkStrandedTracking` and the rest all run **unconditionally**, before
and regardless of the NSA enable flag.

Per ATT-1, `checkAwblessConfirmed` **retries a waybill-less order, which
supersedes its shipment and makes a live courier AWB booking** (capped
at `MAX_AWB_RETRY_SUPERSEDES` = 3); per CUR-19,
`checkShipmentlessConfirmed` re-provisions shipments through
`OrderWriteService.reprovisionShipment`. So a button labelled "record a
tracking scan by hand" also means "book real waybills across the
estate, and advance the retry cap by one".

The key is already `dangerous` and Admin holding it is right. **The
label and description are the problem** — they describe one of three
handlers, and this is the one where a UI button gets pressed twice
because the first press looked like it did nothing. Worth a sentence in
the description and worth the admin UI stating the consequence at the
press.

### 3.6 `courier.accounts.manage` — credentials, a platform-wide kill switch, and a browser robot

16 writes across 7 modules. Three distinct consequences:

- **Credentials**: `POST /admin/courier-accounts/:accountId/credential-fields`
  (CUR-1 — replacing what the estate books parcels with).
- **A platform-wide intake switch**: `PATCH /admin/couriers/:courierCode`
  (CUR-16 — OFF means no new parcels for that courier, estate-wide).
- **Driving the portal robot at a real courier login**:
  `POST /admin/courier-portal/wallet-sync/run`,
  `.../delhivery-billing-probe`, `.../delhivery-invoice-check`,
  `POST /admin/courier-cost/shiprocket/wallet-sync` and three more.
  COST-2b is a standing warning that hammering one of these is how an
  account gets locked — and the Shiprocket account also handles COD
  remittance.

I am **not** proposing a split here. All three are "manage the courier
relationship", all three are correctly `dangerous`, and splitting them
three ways produces keys nobody can tell apart on a settings screen. But
it should be known that this key turns a courier off for everybody, and
the description does not say so.

### 3.7 Two non-dangerous keys that reach destructive stock operations

Both are in the Inventory group, both are unmarked, and both reach
consignment operations that CNS-6 treats as irreversible:

- **`inventory.goods_receipts.manage`** → `POST /admin/consignments/:id/cancel`
  (CNS-6: removes the stock as `ADJUSTMENT_DECREASE` /
  `RETURNED_TO_SELLER`) and `POST /admin/consignments/:id/labels/print`
  (LBL-5/CNS-5: prints serials **once** and locks the labelling station
  — a second sheet is refused thereafter).
- **`inventory.transfers.manage`** → `POST /admin/consignments/:id/dispatch`
  (CNS-4 moves stock into TRANSIT; CNS-6 closes the cancel window for
  good, and FRT-5 makes it the point a PAY_ADVANCE bill must already
  exist).

The receiving clerk's key cancels consignments and burns the one serial
print; the bin-transfer key dispatches a consignment to another country.
Neither is marked `dangerous`, so neither gets the second confirmation
the UI gives `warehouse.rto.finalize`. **Proposal: mark both
`dangerous`, and consider `inventory.consignments.dispatch` and
`inventory.consignments.cancel` as their own keys.** This affects no
tier (Admin holds all of them either way); it affects whether the UI
asks twice.

### 3.8 Lower-consequence pairings, recorded for completeness

- **`warehouse.pick`** → the picker's four station endpoints *and* all 15
  `/admin/warehouse/printing/*` handlers, which under WMS-1 include
  `pick-batches/:id/confirm-printed` (what **allocates** phase-2
  reservations) and `mark-picked` (one of only two writers of
  `OrderStatus.PICKED`). Consistent with WMS-1's print-first design;
  noted because "Pick" sounds narrower than it is.
- **`callcenter.work`** → also `GET /admin/serviceability`, a live
  courier lookup. Harmless; also reachable via `orders.view`.
- **`sellers.settings.manage`** → also the four `/admin/seller-stores/*`
  channel-store writes. Coherent but unmentioned in the description.
- **`notifications.broadcast`** is physically declared inside the
  Warehouse block of `permissions.ts` (between `warehouse.pick.supervise`
  and `warehouse.labels.reprint`). It renders correctly because grouping
  is by the `group` field, but it reads as a mistake to the next person
  editing the file.

---

## Part 4 — The seller and store equivalents

### 4.1 Is a Support role missing? No — but a Read-only one is, on both sides

A seller's team and a store's team have no support desk; they *are* the
customer. The role the seller side is missing is the one the staff side
just gained: **a genuine read-only login.** `viewer` is sold as that and
is not — see 4.2.

Concretely, I would propose:

- **Seller `viewer` (replacing today's):** `orders.view`, `catalog.view`,
  `inventory.view`, `inbound.view`, `tickets.view`, `profile.view`. Six
  keys, all reads, no money, no customers. Today's single key is both
  narrower (no catalogue, no stock) and broader (see 4.2) than anybody
  would expect.
- **Store `viewer` (replacing today's):** `store.profile.view`,
  `catalogue.view`, `terms.view`, `tickets.view` — and **not**
  `orders.view`. See 4.3.

Both are additive: existing roles are data, so this is a proposal about
what a *newly created* seller or store gets, and a migration decision
about existing ones that is the owner's.

### 4.2 Is the seller `viewer` genuinely read-only? Yes — but "1 permission" is deeply misleading

The production observation in the brief is correct and it is by design:
`DEFAULT_SELLER_ROLES` gives `viewer` exactly `['orders.view']`, with
the comment *"Read-only, and only the orders. The narrowest login there
is."* It is not an accident.

**It is also not narrow.** `orders.view` on the seller side opens **19
handlers across 11 modules**, every one of them a GET:

```
GET /seller/orders                        GET /seller/orders/:id/journey
GET /seller/orders/summary                GET /seller/orders/:id/events
GET /seller/orders/:id                    GET /seller/orders/:orderId/call-history
GET /seller/orders/money-in-flight        GET /seller/orders/:orderId/delivery-actions
GET /seller/orders/:id/reseller-money     GET /seller/orders/:orderId/reattempt-requests
GET /seller/orders/:orderId/consignee     GET /seller/orders/:orderId/consignee/history
GET /seller/order-defaults/customer-delivery-fee
GET /seller/pricing/fees                  GET /seller/nsa
GET /seller/stores                        GET /seller/serviceability
GET /seller/tracking                      GET /seller/tracking/:shipmentId
```

Three of those are not "the orders":

- **`GET /seller/pricing/fees`** — what Skydrop charges this seller.
- **`GET /seller/orders/:id/reseller-money`** — the reseller money plan
  for an order: fee shares, transfer price, who is credited what.
- **`GET /seller/serviceability`** — a live courier API call, spending
  rate budget, from the narrowest login the platform offers.

Plus `money-in-flight`, which is a money figure under an orders key.

**No write.** I checked every non-GET handler on every seller
controller: exactly one is behind a `.view`-named key, and it is not
`orders.view` — it is `POST /seller/orders/:id/invoice` behind
`charges.view` (`invoice` module), which **generates** a GST invoice
(allocating an invoice number and writing a Spaces object). So:

- **Seller `viewer` is a true read-only role.** The brief's worry is
  unfounded on the write axis.
- **Seller `charges.view` is not a read key.** The seeded `finance` role
  holds it, which is probably right, but a seller-side read-only tier
  must not be derived by a name test — the staff-side `isViewKey`
  approach would hand out invoice generation. Either split
  `charges.generate_invoice` out, or enumerate the seller read tier by
  hand (which is what I did above).

### 4.3 The store `viewer` has a real contradiction, and it is in the role's own comment

`DEFAULT_STORE_ROLES` → `viewer` holds `store.profile.view`,
`catalogue.view`, `terms.view`, `orders.view`, `tickets.view`, with this
reasoning (`store-permissions.ts`):

> *"Orders too (RS-5) — but not the customer list, which is a list of
> people, not work."*

But `orders.view`'s own description, three screens earlier in the same
file, is:

> *"This store's orders, their contents, **customers' delivery details**
> and progress."*

Withholding `customers.view` from `viewer` therefore achieves nothing:
`GET /store/orders/:id` carries the customer's name, phone and address
per order. The role is marketed as not seeing a list of people and sees
every one of them, one order at a time. `orders.view` is correctly
marked `sensitive`; the viewer comment is the part that is wrong.

`orders.view` also opens **`GET /store/orders/:id/money`** — the order's
fee shares and transfer price, i.e. the store's commercial terms per
order, to its narrowest login.

**Proposal: drop `orders.view` from the store `viewer`** and leave it
`store.profile.view` + `catalogue.view` + `terms.view` + `tickets.view`.
The one real argument for keeping it — that the portal's "new terms to
accept" banner needs to read something — is served by `terms.view`,
which the comment already says is why terms are visible to everyone.
Store `viewer` has **zero** writes either way; I verified no store
handler sits behind a `.view`-named key with a non-GET method.

### 4.4 Store `orders.actions` is the worst-labelled key in any of the three catalogues

```
GET   /store/orders/:orderId/actions
POST  /store/orders/:orderId/actions          ← recall / re-attempt / send back
GET   /store/call-reviews
PATCH /store/call-reviews/:reviewId
GET   /store/orders/:orderId/address-changes
PATCH /store/orders/:orderId/recipient        ← ⚠ changes the ORDER, including the money
```

The label is *"Act on live orders — ask for the customer to be called
again, for another delivery attempt, or for a parcel to be sent back."*

`PATCH /store/orders/:orderId/recipient` is the store's **whole-order
edit**. From the controller's own summary
(`store-order-edit.controller.ts:57-64`):

> *"Change this order — the customer's details, **what is in it, the
> money the customer pays**."*

and its doc comment: *"The DTO extends the SELLER's `UpdateOrderDto` on
purpose ... the store may reach every field on it except the two in
`STORE_FORBIDDEN_KEYS`"* (`internalNotes`, `storeId`).

Changing `codAmountInr` re-prices the order through
`ResellerOrderMoneyService.recalculateAfterEdit` (ORD-2, amended
2026-09-19) and moves what both the store and the seller are credited.
**A key labelled "ask for the customer to be called again" changes the
money.** The route name (`/recipient`) makes it worse: it reads as an
address fix, which is what it was before the 2026-09-18 widening, and
the key was not revisited when the scope was.

**Proposal: `orders.edit` as its own store key**, covering
`PATCH :orderId/recipient` and `GET :orderId/address-changes`.
`orders.actions` keeps the asks and the call reviews. The seeded `ops`
role gets both, so nothing changes in practice — but the catalogue
becomes able to say "this person may chase a parcel and may not change
what it costs", which is an ordinary thing a shopfront would want.

Note the honest half, which I initially got wrong and corrected:
**`orders.actions` does not itself decide whether a send-back fires the
courier.** That is `reseller_store_action_policy`, the seller's setting
per store — the permission says who at the store may ask. The key is
truthful about that; it is the order-edit door that it is silent on.

### 4.5 Smaller seller/store findings

- **Seller `orders.create` is four doors.** Besides `POST /seller/orders`
  and `PATCH /seller/orders/:id`, it opens
  `GET /seller/orders/customer-lookup` (platform-wide customer
  reputation — the RBAC-1 incident, now deliberate and documented),
  `POST /seller/orders/:orderId/delivery-actions` and
  `.../reattempt-request` (requests an operator approves — **not** a
  direct courier write; I checked `delivery-action.dto.ts` and
  `POST /admin/delivery-actions/:requestId/approve` under
  `courier.ops.write`), `POST /seller/orders/:orderId/consignee` (which
  **does** ask the courier directly to change a live parcel's address),
  and `PATCH /seller/order-defaults/customer-delivery-fee` (a money
  default). The description mentions placing, editing and the customer
  check. The seeded `ops` role holds it. Worth extending the
  description at minimum; `orders.consignee` would be a reasonable
  split.
- **Seller `orders.cancel` → `POST /seller/orders/:id/return`**, which
  per CUR-10 amendment #2 calls Delhivery's cancel with no operator in
  the loop. This is explicitly sanctioned and well argued ("whose goods,
  whose money"), so no change — but it is the one place a seller key
  reaches the physical world directly, and it is not flagged
  `sensitive`.
- **Seller `roles.manage` guards the role *reads***
  (`GET /seller/roles`, `GET /seller/roles/catalogue`), while
  `team.view`'s description promises "Who has a login for this company
  **and what they may do**". A company member with `team.view` sees
  names and cannot see what any role covers. Either add
  `GET /seller/roles` to `team.view`'s surface or fix the description.
- **Seller `recipient_addresses.manage` has no create or update** — only
  `GET`, `GET :id`, `DELETE :id`. The label is "Keep a customer address
  book". Addresses are presumably created implicitly at order create.
  Not a security issue; a label that promises a capability that does not
  exist.
- **Seller `profile.manage` → `PATCH /seller/profile/bank-details`** is
  safe: I verified it creates a `SellerBankChangeRequest` in PENDING
  (`seller-profile.service.ts:568`) rather than writing the account, so
  the staff approval gate holds. The seeded `finance` role holding
  `profile.manage` is fine.
- **Store `store.profile.manage` → `PUT /store/notification-preferences`**.
  Notification preferences under "Edit the store profile" is a stretch
  but harmless.
- **Store has no role editor** (`store-permissions.ts` says phase 1 has
  none), so any change to the five store roles is a migration, not an
  admin action. That raises the cost of getting 4.3 right now rather
  than later.

---

## Part 5 — Dangerous things reachable from a non-obvious role

I checked each of the eleven withheld keys for an alternative route.
Four have one.

### 5.1 `staff.view` is withheld from Admin and `notifications.broadcast` enumerates staff

`notifications.broadcast` (Admin holds it) opens
`POST /admin/notifications/broadcasts/preview`, and
`BroadcastPreview.sample` is built as:

```ts
sample: people.slice(0, 5).map((p) => p.email)
// notification-broadcast.service.ts:70
```

`AudienceSelector` includes `{ kind: 'STAFF_ROLE', roleKey }` and
`{ kind: 'STAFF_PERMISSION', permission }`
(`notification-audience.service.ts:36-37`). So an Admin can preview a
broadcast to any staff role or any permission and get back **the count
of people holding it plus five of their email addresses** — repeatedly,
per role and per permission. That maps the staff list and the access
structure, which is exactly what withholding `staff.view` was meant to
prevent.

The preview is the right design (NOTIF-12: "send to 4,312 people,
starting with these five" is checkable, "send to all sellers" is not).
The conclusion is not to weaken it. **It is that withholding
`staff.view` from Admin does not achieve what it is for** — which is the
main reason I recommend granting it in Part 1.3(b).

### 5.2 `money.view` reads unmasked bank documents, with no audit row

```
GET /admin/wallet/topups/:topupId/proof-url          ← presigned URL to the seller's upload
GET /admin/reseller-store-wallets/topups/:topupId/proof
```

A top-up proof is whatever the seller uploaded to evidence a bank
transfer (`wallet-topup.dto.ts:61` — `proofSpacesKey`); in practice a
transfer slip or banking screenshot, which carries the account number.

Compare the design the estate has for the same data:
`POST /admin/sellers/:id/bank-account/reveal` is its own key
(`sellers.bank_account.reveal`), is `dangerous`, and **every reveal is
audited** — the preset file's own comment is right that it "is the key
that puts a seller's account number on a screen". The structured field
is masked everywhere else (`bankAccountNumberMasked`).

So the masked path is airtight and **the image path is wide open**:
`money.view` is a plain read key, held by Admin and by Read-only, and
nothing records who looked.

**Proposal (server-side, independent of the presets):** put the proof
URL behind its own key or behind `money.topups.review`, and audit the
presign the way the reveal is audited. Until that is done, this is the
reason I would not add `money.view` to Support (Part 1.2(c)), and it is
a live reason to think about whether Read-only should hold it.

### 5.3 `warehouse.manage` reaches BIN-4's end state without BIN-4's guardrails

`warehouse.bins.collapse` is excluded from Admin and is correctly a
two-step, SUPER_ADMIN, snapshot-first operation with an emailed
challenge code (`admin-bin-ops.controller.ts:99-131`). But the same
controller offers, under `warehouse.manage`:

```
POST /admin/warehouses/:warehouseId/bin-ops/move-bin/:sourceBinId
     "Move everything currently in one bin to another."
POST /admin/warehouses/:warehouseId/bin-ops/bulk-transfer
     "Apply a list of bin-to-bin moves as ONE transaction"
```

Repeating `move-bin` per bin reaches the same end state as a collapse:
no snapshot, no challenge code, no two-step. That alone makes the Admin
exclusion largely cosmetic.

**The sharper problem is that neither validates bin TYPE.** Reading
`bin-bulk-transfer.service.ts:95-141`, the validation is: non-empty
lines, positive integer quantity, source ≠ destination, bin exists, bin
belongs to this warehouse. There is no `BinType` check — and
`grep -n "BinType\|NON_PICKABLE" apps/api/src/modules/inventory-transfer/services/*.ts`
returns nothing either, so `POST /admin/stock-transfers` is the same.

Against that, `RtoPutawayService` explicitly refuses a non-pickable
destination:

```ts
if (NON_PICKABLE_BIN_TYPES.includes(destBin.type)) {
  code: 'DEST_BIN_NOT_PICKABLE'        // rto-putaway.service.ts:268
}
```

So the rule "non-pickable means not sellable" (BIN-2) is enforced on the
putaway path and not on the transfer paths. **A `warehouse.manage`
holder can move a DAMAGED, QUARANTINE or RTO_HOLD bin's whole contents
into FLOOR, making damaged or untriaged goods sellable** — the precise
outcome BIN-4 excludes hold/damaged/quarantine bins from a collapse to
prevent, and which `bin-collapse.service.ts:523` spells out ("sweeping
them into FLOOR would put broken and untriaged goods..."). CNS-1's
TRANSIT bins are in the same position: BIN-4's collapse was deliberately
taught to leave them alone; a bulk transfer has not been.

**This is pre-existing and not introduced by the presets.** It is the
most serious thing this audit found that is not about roles at all, and
I would report it to the owner separately from the RBAC work. The fix is
one shared check — `NON_PICKABLE_BIN_TYPES` is already exported from
`bin-policy.service.ts` for exactly this (BIN-2 keeps availability and
the allocator sharing it by construction) — applied in
`BinBulkTransferService.moveLines`, which both bin-ops routes funnel
through, and in `inventory-transfer`.

### 5.4 Admin can create a P&L state only a super-admin can undo

Covered in Part 1.1(a): `money.pnl.close` →
`lock-permanently` / `backfill-close` is one-way, and the way back is
`money.pnl.god_mode`, which Admin is denied.

### 5.5 Checked and clear

- **`money.bank_accounts.manage`** does not overlap
  `money.treasury.manage`. The former is exactly three handlers on
  `/admin/platform-bank-accounts` (the accounts sellers top up into);
  treasury manages a different set. Admin reads platform bank accounts
  via `money.view` (`GET /admin/platform-bank-accounts`) and cannot
  edit them. The exclusion holds.
- **`orders.override`** is three handlers (`force-mutation`,
  `restore-reservations`, `release-reservations`), all in the `order`
  module, all behind that key. No side route found.
- **`rbac.manage` / `staff.manage`** — no other handler touches roles or
  staff accounts. Clean.
- **`reseller.credit_after_confirmation.enable`** is one write; the
  matching read is under `reseller.stores.view`, which is the right
  split. Clean.
- **`tickets.resolve`'s refund** is capped on every order-bearing
  ticket; only the no-order branch is unbounded (3.1).
- **`courier.accounts.view`** → `GET /admin/courier-portal/delhivery-billing-probe`
  returns "short-lived links to the files and screenshots it saved"
  (`admin-delhivery-billing-probe.controller.ts:84`). COST-3 scrubs
  session material from the *audit row*; the screenshots are raw
  captures of a signed-in courier portal. Read-only holds this key.
  Low severity — the probe is operator-triggered and rare — but worth
  knowing that a read-only auditor can retrieve screenshots of a courier
  account's billing pages.

---

## Part 6 — Recommendations

### Change with the presets, now

| # | Change | Why |
|---|---|---|
| 1 | Add `orders.tracking.run_poll` and `orders.charges.view` to Support | The two cheapest reads a support desk needs; both single-handler, neither dangerous |
| 2 | Add `inventory.view` to Support | "Where is my stock / did you receive my consignment" |
| 3 | Grant `staff.view` to Admin (keep it in Read-only) | Resolves the only key Read-only holds and Admin does not; Part 5.1 shows the exclusion buys nothing |
| 4 | Fix the Support description to say it resolves tickets with refunds | It does; the description says it changes nothing |
| 5 | Fix the Read-only description, or move `acknowledge` (rec. 8) | "no write at all" is false by one handler |
| 6 | Add a spec: no key in the Read-only set guards a non-GET handler | The assertion the `isViewKey` name test is standing in for; catches the next one |
| 7 | Drop `orders.view` from the store `viewer` role | Its own comment withholds the customer list; `orders.view` carries every customer's details and the per-order money |

### Catalogue splits — do these next, in this order

| # | Split | Buys |
|---|---|---|
| 8 | `system.settings.view/.manage` → + `system.issues.view` / `.acknowledge` / `.resolve` | Resolves four findings at once: Part 1.2(b), 1.3(a), 2 and 3.2. Needs `permissionsFor(kind)` in `SystemIssueNotifier` updated |
| 9 | `tickets.resolve` → `tickets.reply` + `tickets.resolve` | Makes "answers tickets, does not issue refunds" expressible at all |
| 10 | `money.pnl.close` → + `money.pnl.lock_permanently`, excluded from Admin | Stops Admin creating a state only the owner can undo |
| 11 | `courier.waybills.manage` → + `courier.waybills.view` | Four reads Read-only and Support should have; one spend they should not |
| 12 | `sellers.bank_change.approve` → + `sellers.bank_change.view` | Admin pays sellers and cannot see a pending account change |
| 13 | Store `orders.actions` → + `orders.edit` | A key labelled "ask for a call-back" currently changes the COD amount |
| 14 | Seller `charges.view` → + `charges.generate_invoice` | `charges.view` is not a read key; a seller read-only tier derived by name would hand out invoice generation |

### Server-side fixes, independent of roles

| # | Fix | Severity |
|---|---|---|
| 15 | Enforce `NON_PICKABLE_BIN_TYPES` in `BinBulkTransferService.moveLines` and `inventory-transfer` | **High.** Damaged / quarantine / RTO-hold / TRANSIT stock can be moved to FLOOR and sold; BIN-4 excludes exactly these bins from a collapse |
| 16 | Mask in `SystemSettingsService.getByKey`; move reveal to an audited endpoint — or drop `is_sensitive` for the CUR-1 env-ref pattern | **Medium (latent).** Nothing is sensitive today; a UI-gated reveal is the shape FE-2 forbids. Fix **before** anything is marked sensitive |
| 17 | Gate and audit the top-up proof presign | **Medium.** Unmasked bank documents behind a plain read key, with no audit row, while the structured field has a dangerous audited key of its own |
| 18 | Bound the no-order `tickets.resolve` refund (consignment declared value, or a settings ceiling) | **Medium.** `RECEIPT_SHORTFALL` tickets are auto-raised routinely and have no cap |
| 19 | Mark `orders.cancel`, `inventory.goods_receipts.manage`, `inventory.transfers.manage` as `dangerous`; extend the descriptions of `orders.tracking.manual_scan` and `courier.accounts.manage` | **Low.** Changes no access, only whether the UI asks twice and whether the label is true |

### New default roles — owner's call

| # | Proposal |
|---|---|
| 20 | Seller `viewer` becomes `orders.view`, `catalog.view`, `inventory.view`, `inbound.view`, `tickets.view`, `profile.view`. Today's single key is both narrower than expected (no catalogue, no stock) and broader (fees, reseller money, a live serviceability call) |
| 21 | Store `viewer` becomes `store.profile.view`, `catalogue.view`, `terms.view`, `tickets.view` (rec. 7) |
| 22 | Whether recs. 20–21 apply to **existing** sellers and stores, or only to newly created ones. Narrowing an existing role takes access away from somebody who has it today — and the store side has no role editor, so a store cannot put it back itself |

### Needs an owner decision, not an engineering one

1. **Does Admin close P&L months permanently?** (rec. 10) — about who
   signs off a reported month.
2. **Does Support resolve tickets with refunds?** (rec. 9) — the split
   makes the question askable; the answer is a policy.
3. **Does Support see wallets?** (Part 1.2(c), `money.view`) — my
   recommendation is no until rec. 17 lands, then yes.
4. **Does a read-only auditor see who has access?** (rec. 3) — my
   recommendation is yes for both tiers, consistently.
5. **Do recs. 20–21 apply retroactively?** (rec. 22)

---

## What this audit did not cover

- **Live role membership.** Who holds what in production. Everything
  above is about what a role *can* reach, not who has it.
- **The seller/store role editors' own guardrails.** `roles.manage` and
  the "roles can only be handed out up to what the person granting them
  already holds" rule are described in both catalogues; I read the
  descriptions, not the enforcement. That rule is the one thing standing
  between a seller `admin` and a seller `owner`, and it deserves its own
  pass.
- **`ApiKeyGuard`'s scope map** (`seller-api-key-scopes.ts`). RBAC-1's
  2026-09-30 amendment covers it and it is not wired to a controller
  yet; a machine key's reach is a different question from a role's.
- **The `<self-service>` surfaces** (7 staff, 9 seller, 8 store
  decorators). I excluded them from every count: they bypass the
  permission gate by design, and NOTIF-11 argues the case.
- **Whether every handler's class-level key is the one somebody
  decided.** `seller-read-surface.spec.ts` does this for the seller side
  by enumerating each GET by name. **There is no staff equivalent**, and
  the staff side has the broader keys: `orders.view` is 11 handlers
  across 7 modules, `money.view` 22 across 7, `inventory.view` 14 across
  6. A new GET on any of those controllers joins that key's surface by
  inheritance and nobody decides — which is exactly the failure the
  seller spec exists to stop. **A `staff-read-surface.spec.ts` is the
  single highest-value test to add after this review**, and it would
  have caught Part 5.2 on the day the proof endpoint landed.
