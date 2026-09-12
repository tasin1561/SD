# Delhivery vs Shiprocket — what actually works, per capability

Re-audited **2026-09-12** against the PRODUCTION database and the live
settings (deployed commit `654f241b`), replacing the 2026-09-11 audit.
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
| Serviceability check | ✅ | ✅ verified live | reactive only (CUR-5) |
| Request pickup | ✅ built, auto ON — not yet reached | ✅ built, auto ON (unexercised) | `courier_pickup_requests` is EMPTY because no Delhivery or Shiprocket box has been PACKED since auto-pickup existed (3 Sep): the 22 Delhivery rows were seeded straight to DISPATCHED and every box packed since was a manual parcel (skipped on purpose). SD-2026-26-000004 (PICKED since 8 Sep, real Delhivery waybill) will be the first. Hardened 12 Sep: a box left without a van raises HIGH `auto-pickup:<courier>:<warehouse>`, the location resolves as booking does, a late box asks for tomorrow |
| Tracking — poll | ✅ live | ✅ live — 7 test parcels polled | every Delhivery status in production came from the poll (582 scans, 11 Sep) |
| Tracking — webhook | ⚠️ built, secret set — **Delhivery has never sent one** | ✅ **receiving** — 706 authenticated | Delhivery: 0 webhooks ever. Shiprocket: 706 — 7 `processed` (the test parcels now match), 699 `ignored` (parcels that aren't ours) |
| NDR re-attempt | ✅ built, operator-only | ✅ synchronous (unexercised) | `ndr_action_requests` is still EMPTY; `ndr_runner_enabled` = false, auto categories `[]` (11 Sep) |
| NDR list | n/a — read off the NSL scan | ✅ `/v1/external/ndr/all` | |
| Edit consignee on a live parcel | ✅ | ⚠️ consignee yes, description no | their `update/adhoc` refuses a description change once a waybill exists |
| Register pickup location | ✅ | ⚠️ add only, no edit | |
| List pickup locations | ❌ none | ✅ | |
| POD / documents | ✅ four | ⚠️ one (POD only) | a signature or RVP-QC request is refused by name |
| Support tickets | ⚠️ **manual only** | ⚠️ **manual only** (12 Sep) | Neither courier takes tickets from software, so a person raises each one on the courier's own desk (Delhivery One / the Shiprocket panel) and records their ticket number, both sides' messages and the outcome here. Both channels are `write_mode` MANUAL, `portal_mode` OFF (CUR-18), and both adapters report `postComment`/`raiseTicket` false. An escalation is filed under the courier that carried the parcel, and one queue holds both. A message left unsent raises HIGH after `ops.courier_outbox_stall_alert_hours` (24). Support emails are the editable `courier.<code>_support_email`, **both empty until filled in** |
| Wallet sync — real parcel cost | ✅ live — transaction ledger, 90 days nightly | ✅ live — passbook read off their panel, 90 days nightly (COST-2) | Delhivery: 23,490 transactions stored, latest 11 Sep 19:47 UTC. Shiprocket: 7,137 stored, latest 11 Sep 18:03 UTC. Both netted through the same importer; parcels costed as the net of their debits and credits (COST-1) |
| Courier expenses in the P&L | ✅ live | ✅ live | "Courier account adjustments", dated by transaction (IST), counted from 1 Oct 2026 — before that only an adjustment naming one of OUR parcels counts (12 Sep); 57 others (net credit ₹4,386.80) are left out |
| Wallet reconcile (recharges) | ✅ live | ✅ live — Recharge History, matched on the bank reference | recharges not yet recorded in our bank book are the owner's to enter (11 Sep: Delhivery 7, ₹1,15,000) |
| Courier invoices checked against the wallet | ❌ not built | ✅ nightly (04:30 IST) | every Freight and VAS invoice's itemized file compared line by line, per ORDER; an invoice that disagrees is HIGH while their 15-day dispute window is open |
| COD remittance file → payout allocation | ✅ CSV ("remittance transactions export") | ✅ their `.xls` (AWB + CRF sheets) | both matched on waybill in "Record a courier payout"; early-COD fee and freight kept back are recorded by kind |
| Portal ticket sync | ⏸ OFF | ❌ not built | `courier_portal_runs` is EMPTY — never ran in production |
| Portal session / canary | ⏸ OFF | ⚠️ session only — used by the wallet and invoice syncs | `courier.portal_canary_awb` is empty; Shiprocket's panel session runs nightly through the Bangalore tunnel for COST-2 only |
| Waybill pool | ⚠️ refill OFF | n/a — AWB issued at assign | `delhivery_waybill_pool_refill_enabled` = false; each booking gets its AWB directly |

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
5. **Delhivery's invoices are not checked against its wallet.**
   Shiprocket's are, nightly; on Shiprocket that check found VAS charges
   taken and never invoiced, so the same gap may exist unseen here.
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
- **Amend a registered pickup location.** They have add, no edit.
- **Signature / RVP-QC documents.** They hold one document, the POD.

Those three are refused BY NAME rather than silently degraded, which is
the rule: answering an RVP-QC request with a POD would be worse than
refusing it.

**Not built, and expensive:**

- **Portal ticket sync and canary** for Shiprocket. Both are Playwright
  driving Delhivery's *panel*. The wallet sync and recharge reconcile
  were in this list until 11 Sep: their API's statement endpoint returns
  nothing, so they now run against Shiprocket's panel from India through
  the Bangalore tunnel (`ShiprocketWalletSyncService`, COST-2), and the
  recharge matching is shared with Delhivery's.
