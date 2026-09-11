# Delhivery vs Shiprocket — what actually works, per capability

Re-audited **2026-09-11** against the PRODUCTION database and the live
settings (deployed commit `401411b1`), replacing the 2026-09-09 audit.
"Built" and "working in production" are kept apart on purpose: several
capabilities that read ✅ in the last audit have never once run for real.

---

## The one thing to read first

**Delhivery carries every real parcel: 22 with a real AWB, on 39
shipments.** Shiprocket carries none — `Courier.isActive` is false, its
base URL is empty and live writes are off (CUR-16) — though its account
and login are stored, its booking contract was proven on 2026-09-09, and
its tracking webhooks are now arriving authenticated.

## Capability matrix

| Capability | Delhivery | Shiprocket | Production evidence (2026-09-11) |
|---|---|---|---|
| Book AWB at order confirmation | ✅ live — 22 real AWBs | ✅ proven 9 Sep, intake OFF | 39 Delhivery shipments, 22 with an AWB; 0 on Shiprocket; 2 by manual placement. Shiprocket takes two calls (create, assign), Delhivery one |
| Choose the carrier (aggregator) | n/a — Delhivery is the carrier | ✅ built — policy `SHIPROCKET_DEFAULT` | `courier.selection_policy` = SHIPROCKET_DEFAULT (Shiprocket ranks). Never exercised: intake is off (CUR-17) |
| Store courier's parcel id | ✅ | ✅ | |
| Store courier's ORDER id | n/a — one number | ✅ `courierOrderId` | |
| Fetch and store label | ⚠️ PDF — **only 2 of 22 stored** | ✅ URL (unexercised) | `awb_labels` holds 2 of 22 Delhivery AWBs; the 20 missing span 27 Aug–7 Sep, so this is a live gap, not history (CUR-6) |
| Cancel a shipment | ✅ | ✅ verified live 9 Sep | |
| Serviceability check | ✅ | ✅ verified live | reactive only (CUR-5) |
| Request pickup | ⚠️ built, auto ON — **never raised** | ✅ built (unexercised) | `courier_pickup_requests` is EMPTY although `delhivery_auto_pickup_enabled` = true: every van so far was arranged outside the system |
| Tracking — poll | ✅ live — 582 scans | ✅ registered, nothing of ours to poll | every Delhivery status in production came from the poll (plus 3 entered by hand) |
| Tracking — webhook | ⚠️ built, secret set — **Delhivery has never sent one** | ✅ **receiving** — 493 authenticated | Delhivery: 0 webhooks ever (they provision from our requirement document). Shiprocket: 493, all signature-valid; 489 `NO_MATCHING_SHIPMENT` (none of ours ride Shiprocket), 4 `PARSE_FAILED` |
| NDR re-attempt | ✅ built, operator-only | ✅ synchronous (unexercised) | `ndr_action_requests` is EMPTY; `ndr_runner_enabled` = false, auto categories `[]` |
| NDR list | n/a — read off the NSL scan | ✅ `/v1/external/ndr/all` | |
| Edit consignee on a live parcel | ✅ | ⚠️ consignee yes, description no | their `update/adhoc` refuses a description change once a waybill exists |
| Register pickup location | ✅ | ⚠️ add only, no edit | |
| List pickup locations | ❌ none | ✅ | |
| POD / documents | ✅ four | ⚠️ one (POD only) | a signature or RVP-QC request is refused by name |
| Support tickets | ⚠️ **manual only** | ❌ all capabilities false | Delhivery channel `write_mode` = MANUAL, `portal_mode` = OFF (CUR-18), `ticket_automation_enabled` = false; 1 escalation (2 Sep), 0 messages |
| Wallet sync — real parcel cost | ✅ live — transaction ledger, 90 days nightly | ✅ built 11 Sep — passbook read off their panel, 90 days nightly (COST-2) | Delhivery: 23,343 transactions stored, 0 duplicates; all 22 AWB parcels costed as the net of their debits and credits (COST-1). Shiprocket: first 90-day read 7,138 movements, balance chain unbroken end to end; netted through the same importer; the API sync now only CHECKS their final bill against it |
| Courier expenses in the P&L | ✅ live — 37 adjustments, −₹1,268.76 net | ✅ built 11 Sep — 22 adjustments in 90 days | "Courier account adjustments", dated by transaction (IST). Shiprocket's are lost-shipment credit notes, invoice and subscription credits, the ShipSure premium and refund; recharges are kept OUT |
| Wallet reconcile (recharges) | ✅ live | ✅ built 11 Sep — Recharge History, matched on the bank reference | Delhivery: 11 recharges seen: 7 (₹1,15,000) **not yet recorded on our side**, 4 (₹80,000) not applicable. Shiprocket: 27 in 90 days, 9 of them failed top-ups (not applicable by construction) |
| COD remittance file → payout allocation | ✅ CSV ("remittance transactions export") | ✅ their `.xls` (AWB + CRF sheets), built 11 Sep | Both matched on waybill in "Record a courier payout". Shiprocket's file is refused when its parcels do not add up to the CRF's "COD Available"; deductions are reported per remittance, never split per parcel. Verified against real CRF 13449838: 10 parcels, ₹15,700, UTR IN22625415423299 |
| Portal ticket sync | ⏸ OFF | ❌ | `courier_portal_runs` is EMPTY — never ran in production |
| Portal session / canary | ⏸ OFF | ❌ | same; `courier.portal_canary_awb` is empty. (The wallet sync signs in separately and runs nightly) |
| Waybill pool | ⚠️ refill OFF — 1 waybill held | n/a — AWB issued at assign | `delhivery_waybill_pool_refill_enabled` = false; each booking gets its AWB directly |

## What changed since 2026-09-09

- **Shiprocket webhooks work.** `TRACKING_WEBHOOK_SECRET_SHIPROCKET` is set
  and the scheme is seeded, so they are authenticated and stored — the
  last audit's "401s" is gone. They are ignored only because no parcel
  of ours travels on Shiprocket.
- **Real cost is a ledger, not a latest debit** (COST-1): every Delhivery
  wallet transaction is stored once by its id, 90 days are re-read
  nightly, and a parcel's cost is its net.
- **Portal automation is OFF and Delhivery support is manual** (CUR-18).
- **Carrier choice exists** for Shiprocket (CUR-17), on its default.

## Gaps production shows, most urgent first

1. **Labels: 20 of 22 Delhivery AWBs have no stored label.** Recent, so
   the label leg is failing now, not historically.
2. **Pickups have never been requested through the system**, with the
   automatic switch on. Either nothing reached the trigger or it is not
   firing.
3. **7 wallet recharges (₹1,15,000) are unrecorded** in our bank book.
4. **Delhivery has never sent a webhook** — tracking depends entirely on
   the poll.
5. ~~Shiprocket has no real-cost source.~~ **Closed 11 Sep (COST-2):** its
   passbook is read nightly off their panel through the Bangalore tunnel
   and netted exactly as Delhivery's ledger is. A parcel with no movement
   yet still shows as UNCOVERED in the P&L (TRE-6), never guessed.

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
