# Delhivery vs Shiprocket — what actually works, per capability

Re-audited **2026-09-12** against the PRODUCTION database and the live
settings (deployed commit `654f241b`), replacing the 2026-09-11 audit.
**Amended 2026-09-19** after a code audit of every per-courier path —
eight places where ONE courier's integration answered for a parcel
another courier was carrying. Those rows are marked **(19 Sep)** below;
nothing in them was re-measured against production.
"Built" and "working in production" are kept apart on purpose: several
capabilities that read ✅ have never once run for real. A figure marked
**(11 Sep)** was not re-measured today.

---

## The one thing to read first

**Delhivery carries every real Skydrop booking — but only 2 waybills were
booked through Skydrop's own saga** (SH-2026-08-000011, SH-2026-09-000019);
the other 20 Delhivery shipments carrying a waybill are `SH-TEST-*` rows
written straight at DISPATCHED by `scripts/seed-tracking-test-orders.mjs`
for tracking tests (`awb_generated_at` NULL, no `awb.generated` audit). No order has been booked on Shiprocket through Skydrop. But
**Shiprocket is no longer switched off**: `Courier.isActive` is true, the
base URL is `https://apiv2.shiprocket.in` and live writes are ON. New
orders still default to Delhivery (`ops.default_courier_code` =
`delhivery`, no seller has a courier link or override), so today
Shiprocket is reached by **failover** — a parcel Delhivery refuses is
booked on Shiprocket for real (CUR-14). The 7 Shiprocket shipments in
production are test parcels copied from real Shiprocket orders on 11 Sep
(`SD-TEST-SR-*`) for tracking and cost tests, not Skydrop bookings.

## Capability matrix

| Capability | Delhivery | Shiprocket | Production evidence (2026-09-12) |
|---|---|---|---|
| Book AWB at order confirmation | ✅ live — 2 booked through Skydrop (+20 seeded test rows) | ✅ proven 9 Sep — **intake ON**, 0 booked through Skydrop | 39 Delhivery shipments, 22 with an AWB — 2 booked by the saga, 20 seeded `SH-TEST-*`; 7 Shiprocket shipments = the 11 Sep `SD-TEST-SR-*` test parcels; 10 manual shipments, 6 with a typed waybill (4 from the 12 Sep QA money-flow test). Shiprocket takes two calls (create, assign), Delhivery one |
| Default courier per seller | ✅ built 12 Sep (CUR-19) | ✅ same | `ops.default_courier_code` is seller-overridable; resolved per seller at provisioning, fails CLOSED. No seller has an override today. Used on 12 Sep to send QA Test Traders' test orders to the manual courier with no real booking |
| Failover when a courier refuses | ✅ both directions (CUR-14) | ✅ both directions — **now live** | a refusal from one is booked on the other; a MANUAL parcel never fails over, even with the manual courier switched off (CUR-19) |
| Choose the carrier (aggregator) | n/a — Delhivery is the carrier | ✅ built — policy `SHIPROCKET_DEFAULT` | `courier.selection_policy` = SHIPROCKET_DEFAULT (Shiprocket ranks). Never exercised: nothing has been booked on Shiprocket (CUR-17) |
| Store courier's parcel id | ✅ | ✅ | |
| Store courier's ORDER id | n/a — one number | ✅ `courierOrderId` — and charges follow it (12 Sep) | a charge under a waybill Shiprocket replaced is netted into the parcel by its order id (COST-2) |
| Courier swaps a parcel's waybill | n/a | ✅ detected nightly (12 Sep) | the cost sync raises HIGH `shiprocket-awb-swapped:<shipment>` when their order shows a different waybill; 0 raised so far |
| Fetch and store label | ✅ PDF — 2 of 2 saga bookings stored | ✅ URL (unexercised) | the "20 missing" were seeded test rows that never went through the label leg. Fixed 12 Sep anyway (CUR-6b): a label that fails is re-fetched hourly and raises HIGH `awb-label-missing:*` after an hour; the stored type is read from the bytes (Delhivery sends an empty Content-Type, so both stored labels have an empty `mime_type`); `POST /admin/courier/awb-labels/backfill` catches up |
| Cancel a shipment | ✅ | ✅ verified live 9 Sep | |
| Cancel the waybill of a CANCELLED order | ✅ built 12 Sep | ✅ built 12 Sep | courier-ops cancel now accepts a voided shipment that holds a waybill; `shipments.courier_cancelled_at` records the courier's acceptance; HIGH `LIVE_WAYBILL` issue after 2 h if not done (CUR-10 #4). 0 cancelled orders hold a waybill today; a manual waybill is refused and excluded |
| Book a customer RETURN (reverse pickup) | ✅ `payment_mode: 'Pickup'` | ✅ **built 19 Sep** — `/orders/create/return` | was `REVERSE_NOT_SUPPORTED`, so a Shiprocket parcel's return could never be collected: the booking raised a HIGH issue and the goods stayed with the customer. Their return create spells out BOTH ends (`pickup_*` is the CUSTOMER, `shipping_*` is US) and so needs `courier.shiprocket_return_address`, seeded EMPTY and refused by name when unset. **NOT proven on the wire** — no return has been booked on this account |
| Serviceability check | ✅ | ✅ verified live | reactive only (CUR-5) |
| Request pickup | ✅ built, auto ON — not yet reached | ✅ built, auto ON (unexercised) — **fixed 19 Sep** | `courier_pickup_requests` is EMPTY because no Delhivery or Shiprocket box has been PACKED since auto-pickup existed (3 Sep): the 22 Delhivery rows were seeded straight to DISPATCHED and every box packed since was a manual parcel (skipped on purpose). SD-2026-26-000004 (PICKED since 8 Sep, real Delhivery waybill) will be the first. Hardened 12 Sep: a box left without a van raises HIGH `auto-pickup:<courier>:<warehouse>`, the location resolves as booking does, a late box asks for tomorrow |
| Tracking — poll | ✅ live | ✅ live — 7 test parcels polled | every Delhivery status in production came from the poll (582 scans, 11 Sep). **The manual `POST /admin/tracking/poll/lookup` was blind to Shiprocket until 29 Sep** — see the audit below |
| Tracking — webhook | ⚠️ built, secret set — **Delhivery has never sent one** | ✅ **receiving** — 2,162 authenticated (29 Sep) | Delhivery: 0 webhooks ever. Shiprocket: 2,162, every one with a valid signature — 74 `processed`, 2,081 `ignored` (parcels that aren't ours), and **7 stuck at `received` since 12–13 Sep**: scans that were dropped and which nothing looked at again until the watchdog added 29 Sep |
| NDR re-attempt | ✅ built, operator-only | ✅ synchronous (unexercised) | `ndr_action_requests` is still EMPTY; `ndr_runner_enabled` = false, auto categories `[]` (11 Sep) |
| NDR list | n/a — read off the NSL scan | ✅ `/v1/external/ndr/all` | |
| Edit consignee on a live parcel | ✅ | ⚠️ consignee yes, description no | their `update/adhoc` refuses a description change once a waybill exists |
| Register pickup location | ✅ | ⚠️ add only, no edit | |
| List pickup locations | ❌ none | ✅ `GET /v1/external/settings/company/pickup` | |
| POD / documents | ✅ four | ⚠️ one (POD only) | a signature or RVP-QC request is refused by name. **(19 Sep)** A MANUAL parcel is refused too — `document()` resolves the shipment directly rather than through `requireAwb`, so everything that was not Shiprocket used to fall through to DELHIVERY'S endpoint, asking them for the paperwork of a waybill they never issued |
| Support tickets | ⚠️ **manual only** | ⚠️ **manual only** (12 Sep) | Neither courier takes tickets from software, so a person raises each one on the courier's own desk (Delhivery One / the Shiprocket panel) and records their ticket number, both sides' messages and the outcome here. Both channels are `write_mode` MANUAL, `portal_mode` OFF (CUR-18), and both adapters report `postComment`/`raiseTicket` false. An escalation is filed under the courier that carried the parcel, and one queue holds both. A message left unsent raises HIGH after `ops.courier_outbox_stall_alert_hours` (24). Support emails are the editable `courier.<code>_support_email`, **both empty until filled in** |
| Wallet sync — real parcel cost | ✅ live — transaction ledger, 90 days nightly | ✅ live — passbook read off their panel, 90 days nightly (COST-2) | Delhivery: 23,490 transactions stored, latest 11 Sep 19:47 UTC. Shiprocket: 7,137 stored, latest 11 Sep 18:03 UTC. Both netted through the same importer; parcels costed as the net of their debits and credits (COST-1) |
| Courier expenses in the P&L | ✅ live | ✅ live | "Courier account adjustments", dated by transaction (IST), counted from 1 Oct 2026 — before that only an adjustment naming one of OUR parcels counts (12 Sep); 57 others (net credit ₹4,386.80) are left out |
| Wallet reconcile (recharges) | ✅ live | ✅ live — Recharge History, matched on the bank reference | recharges not yet recorded in our bank book are the owner's to enter (11 Sep: Delhivery 7, ₹1,15,000) |
| Courier invoices checked against the wallet | ✅ nightly (04:10 IST) — **corrected 19 Sep, this row said "not built"** | ✅ nightly (04:30 IST) | every Freight and VAS invoice's itemized file compared line by line, per ORDER; an invoice that disagrees is HIGH while their 15-day dispute window is open |
| COD remittance file → payout allocation | ✅ CSV ("remittance transactions export") | ✅ their `.xls` (AWB + CRF sheets) | both matched on waybill in "Record a courier payout"; early-COD fee and freight kept back are recorded by kind |
| Portal ticket sync | ⏸ OFF | ❌ not built | `courier_portal_runs` is EMPTY — never ran in production |
| Portal session / canary | ⏸ OFF | ⚠️ session only — used by the wallet and invoice syncs | `courier.portal_canary_awb` is empty; Shiprocket's panel session runs nightly through the Bangalore tunnel for COST-2 only |
| Waybill pool | ⚠️ refill OFF | n/a — AWB issued at assign | `delhivery_waybill_pool_refill_enabled` = false; each booking gets its AWB directly |

## What the 2026-09-29 verification found

A surface-by-surface check of everything Shiprocket-shaped, after the
panel egress and User-Agent fixes landed. Both nightly panel jobs now
work — the invoice check ran for the first time through the new route and
every itemized Freight and VAS invoice matched the wallet to the paisa —
and the API side had never stopped. Two real defects, both of the same
family: something reported silence as an answer.

1. **`POST /admin/tracking/poll/lookup` could never ask Shiprocket, and
   said so as "unknown waybill".** It passed a NULL account to every
   tracking source. Shiprocket's token belongs to ONE account, so its
   `fetchTracking` refuses a null outright — and lookup's catch, written
   for the ordinary "that waybill is not mine", swallowed the refusal.
   Measured: three Shiprocket waybills their own webhooks were reporting
   on that hour came back `known: false` with zero scans, from a call
   that never happened. The account is resolved before the call now (the
   one that booked the parcel when it is ours, the courier's first active
   account otherwise), and a courier that could not be asked at all is
   NAMED in the response and on the panel rather than counted as a miss.
   The panel still lives on `/delhivery`, which is its own small lie.

2. **A webhook accepted and never processed was invisible.** TRK-2's
   master gate is `status !== RECEIVED`, so only a webhook's own BullMQ
   job moves it out of RECEIVED; when that job dies for good the row sits
   there and nothing looks at it again — a courier scan dropped in
   silence, which is the one thing the ingest ledger exists to prevent.
   Production held seven, Shiprocket, since 12–13 September, from TRK-3's
   Invalid-Date window. The parser was fixed; those seven were never
   applied and nothing said so. Found by counting rows.
   `OrderAttentionService.checkUnprocessedWebhooks` raises ONE HIGH issue
   for the estate (`webhooks-unprocessed`) naming the count, the couriers
   and the oldest few, and clears itself. It deliberately does NOT
   re-queue: a payload the processor cannot handle is a parser bug, and
   retrying it on a timer is how one bad body becomes a job that fails
   for ever.

What was verified working, by a live read rather than by reading a doc:
the API's auth and token cache, serviceability and rate options (5
carriers, cheapest ₹46.02 on 700128 → 110001, `reachedLiveApi: true`),
the pickup-location list, per-shipment insight (live TAT and cost),
`document` (POD answered, and a SIGNATURE_URL request refused BY NAME as
this file says it should be), the e-way-bill threshold check, NDR
readiness, the nightly API cost sync, webhook authentication (every one
of 2,162 rows `signature_valid`), and COST-1 netting — all seven parcels'
stored cost equals the net of their transactions to the paisa, no
negatives, no `missing_from_export_at` stamps, no mutated rows. The
egress health check is pinned by unit tests for a VPN that is down and
for one that is healthy in the wrong country, and `/cost-sync` reports
the route and the address truthfully.

Still owner-shaped, not engineering: `courier.shiprocket_return_address`
and `courier.shiprocket_support_email` are both empty (a customer return
and a support escalation are refused by name until they are filled), and
four Shiprocket money items are open — an unrecorded ₹5,000 recharge, an
unrecorded COD top-up, a ₹1,600 ledger credit note the passbook never
saw, and 59 VAS charges (₹348.10) on no invoice.

## What the 2026-09-19 code audit found

Eight places where ONE courier's integration answered for a parcel
ANOTHER courier was carrying. None of them threw; every one of them was
recorded on our side as a success, which is what made them invisible.

1. **An e-way bill always went to Delhivery**, whatever the courier — a
   live write on Delhivery's account under a waybill they never issued.
   Now routed through `CourierOpsDispatchService.attachEwaybill` and
   refused by name for anyone else. The admin control is DELISTED:
   the threshold is ₹50,000 and nothing Skydrop ships reaches it.
2. **Shiprocket pickups were blocked by a Delhivery setting.** The
   pickup service read `courier.delhivery_pickup_location` for EVERY
   courier, so a Shiprocket pickup either carried Delhivery's warehouse
   name or was refused quoting a key that has nothing to do with it.
   Per courier now, and a courier whose own call does not use a location
   is not asked for one. The manual Pickups screen gained a courier
   picker — until then it could only ever raise a Delhivery van.
3. **A STUBBED courier could confirm a real address change.** Both
   adapters answer `{success: true}` before the write guard, so with one
   courier stubbed in production a seller's or store's correction was
   reported ACCEPTED and written to the change row, the shipment AND the
   order — while the courier had never heard of it. Refused by name now,
   before anything is written (the cancel path already did this).
4. **A Shiprocket parcel's customer return could never be collected**
   (see the row above).
5. **Which carrier Shiprocket actually used was dropped.** Their assign
   reply names it and their own client already parsed it; the dispatch
   result had nowhere to put it. `shipments.carrier_name` now records it.
6. **Every tracking row the poller wrote said "delhivery"**, for every
   courier it polled, including the transition reason — while the
   webhook processor and manual tracking stamped the real one, so the
   two halves of a parcel's history disagreed.
7. **The NDR reconciliation alert always blamed Delhivery** (a literal
   in a CRITICAL audit row), the UPL poller asked Delhivery about every
   SUBMITTED row including Shiprocket's synchronous ones, and the NDR
   runner spent rate-limited Delhivery reads on manual parcels.
8. **There was no Shiprocket ops screen** — `/delhivery` has been a full
   console for months while the courier that failover reaches without
   anybody choosing it had none. `/shiprocket` now shows stub-vs-live
   (CUR-15's question), the live-write guard, the intake switch, each
   account's pickup name and wallet balance, the last nightly runs,
   recent parcels and a read-only reachability check.

Also fixed: the global courier split weighted on a courier CODE rather
than on which setting named the account (a third courier would have
doubled everyone else's share), and `ticket-handling` listed Delhivery
as ticket-automated while Delhivery's own adapter reports
`raiseTicket: false` (CUR-20).

## What changed since 2026-09-11

- **Shiprocket is switched on** (active, live writes on, real base URL), so
  failover to it is real. Nothing has been booked on it through Skydrop.
- **Default courier per seller** (CUR-19), and a manual-courier parcel can
  never fail over to a live courier.
- **A cancelled order's waybill** can be cancelled with the courier from
  courier-ops, and is chased by the `LIVE_WAYBILL` watchdog until it is.
- **Shiprocket waybill swaps** are detected, and a parcel's charges follow
  its Shiprocket order id.
- **Pre-October courier adjustments** on our own parcels are now counted in
  the P&L.

## Gaps production shows, most urgent first

1. ~~Labels: 20 of 22 Delhivery AWBs have no stored label.~~ **Not a gap:** the 20 were seeded test rows; both saga bookings have their label. The retry and alert added 12 Sep close the real hole (a failed label was never asked for again).
2. ~~Pickups have never been requested through the system.~~ **Not a failure:** no courier box has been packed since auto-pickup existed. The trigger now announces any box it cannot get a van for (12 Sep).
3. **Wallet recharges are unrecorded** in our bank book (the owner enters
   these).
4. **Delhivery has never sent a webhook** — tracking depends entirely on
   the poll.
5. ~~Delhivery's invoices are not checked against its wallet.~~
   **CLOSED — this was already stale when written.** `DelhiveryInvoiceCheckService`
   has run nightly at 04:10 IST since 2026-09-12 (COST-3): every Domestic
   and Communication VAS invoice's transaction list compared per waybill
   against the stored ledger, credit and debit notes matched, and
   `delhivery-uninvoiced:` raised for charges two later invoices have
   passed by. Corrected 19 Sep.
6. **Shiprocket is live for failover but has never carried a Skydrop
   parcel.** Its booking was proven once (9 Sep); the first real failover
   will be the first end-to-end run.

## What is Delhivery-only for a REASON, versus merely not built

**Structural — Shiprocket cannot do these:**

- **Edit a product description on a live parcel.** Not "no such field" —
  measured: `update/adhoc` accepts it happily until a waybill exists and
  answers `400 "Order update not allowed"` afterwards. Since a parcel we
  would edit always has one, the effect is the same, but the reason is
  different and the earlier wording would have sent somebody looking for
  a field that does exist.
- **Amend a registered pickup location.** They have add, no edit. (They
  CAN list them, unlike Delhivery — so a wrong name is checkable even
  though it is not editable.)
- **Signature / RVP-QC documents.** They hold one document, the POD.
- **An e-way bill.** Not built, and deliberately not being built
  (19 Sep): the threshold is ₹50,000 and nothing Skydrop ships reaches
  it. Refused by name in the ops dispatcher rather than sent to
  Delhivery, which is what used to happen.

Those are refused BY NAME rather than silently degraded, which is the
rule: answering an RVP-QC request with a POD would be worse than
refusing it.

**No longer on this list:** the customer RETURN leg, built 19 Sep — see
the capability table. Its wire shape is their documented one and has NOT
been exercised against the live account.

**Not built, and expensive:**

- **Portal ticket sync and canary** for Shiprocket. Both are Playwright
  driving Delhivery's *panel*. The wallet sync and recharge reconcile
  were in this list until 11 Sep: their API has no wallet ledger, so
  they now run against Shiprocket's panel from India through the
  Bangalore tunnel (`ShiprocketWalletSyncService`, COST-2), and the
  recharge matching is shared with Delhivery's.

  **RE-MEASURED 2026-09-28, and the earlier wording was wrong in a way
  that mattered.** "Their statement endpoint returns nothing" suggests
  an empty list. `GET /v1/external/account/details/statement` answers
  **200 with ONE row** — the full statement row shape, every field the
  empty string, `description: "Wallet Balance"` and the current balance
  in `balance_amount`. It is the wallet-balance endpoint wearing a
  ledger row's clothes. Their own published sample
  (apidocs.shiprocket.in) shows exactly the same row, so it has never
  returned transactions for anybody: not a permissions problem, not an
  API-user problem, and not a missing date range — their documented
  `page` / `per_page` / `from` / `to` are all accepted and change
  nothing. **An importer that trusted the row count would have stored a
  transaction with an empty id.** Their whole public surface is 93
  requests, 31 of them GET, and the only money-shaped ones are
  `account/details/wallet-balance` (which the nightly Shiprocket cost
  sync already uses and which works), this one, and
  `billing/discrepancy` (weight disputes; `{"data": []}` today).
  `/v1/external/shipments` carries a per-parcel `charges` block —
  freight, COD charge, applied and charged weight — which is a QUOTE,
  not the ledger: COST-1's whole point is that a cost is the net of its
  debits and credits, and a reversal is invisible there. **So the panel
  read stays.** `POST /admin/shiprocket/api-probe` re-asks this whole
  list on demand, so the next person deciding does not have to take this
  paragraph's word for it.

  Their official MCP server (`shiprocket-mcp.shiprocket.in/mcp`,
  `mcp-multichannel` 1.0.0) is live and lists **13 tools** — tracking,
  RTO performance, COD remittance, rate calculator, order list, pickup
  addresses — and **none of them is a wallet, passbook or ledger**, so
  it is not a route to this either. Worth knowing before anybody
  suggests it: four of the thirteen (`order_ship`, `order_cancel`,
  `order_edit`, `order_schedule_pickup`) are WRITES against a live
  account, and an unauthenticated call returns `TOKEN_EXPIRED` as
  ordinary tool *content* rather than as an error — an agent reading it
  would see a successful call.
