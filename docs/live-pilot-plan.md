# Live pilot plan — real parcels before the 1 Oct 2026 cutover

Written 12 Sep 2026 (a Saturday). Production state was checked read-only
the same day: the deployed commit is `8dac72f8`, and every figure marked
**(prod 12 Sep)** was measured then. This is a plan. Nothing in it has been
run yet.

**Goal.** From Thursday 1 Oct every parcel the business sends goes through
Skydrop. Before then, put about seven real parcels through every courier
and money path that has never carried a real parcel. By Tuesday 29 Sep, be
able to say go or no-go with evidence.

**Who runs it.** The owner and the warehouse and call team, with Claude
alongside to run the read-only SQL checks and interpret the results. Every
check below is either a read-only `SELECT` (no `WITH`, no writes) or an
admin page. Run the SQL through the droplet's read-only runner:

```
ssh skydrop 'cd ~/app/packages/db && set -a && . ~/app/.env && set +a && node ~/verify/verify-run.cjs ~/verify/<file>.json'
```

Here `<file>.json` has the form `[{"label":"…","sql":"SELECT …"}]`. The runner
stops at the first failing query, so put one query per file when you are
exploring.

In the SQL below, `:ORD` stands for an order number such as
`'SD-2026-26-000011'`, and `:AWB` for a waybill number. Substitute the real
value before running.

---

## 0. Findings that block or shape the pilot (prod 12 Sep)

| # | Finding | Evidence | What to do |
|---|---|---|---|
| B1 | **The Shiprocket courier account has no payout bank account.** Recording any Shiprocket COD payout will be refused with `SETTLEMENT_NO_RECEIVING_ACCOUNT` (`courier-settlement.service.ts:370`). An Instant Pay delivery on Shiprocket also has nowhere to put its front (WAL-9). | `courier_accounts` "Shiprocket - primary": `payout_bank_account_id = NULL`. Delhivery's links to "HDFC — COD receiving" (INR). | **Hard precondition.** Link the INR account Shiprocket actually remits COD into (ask the owner which one) on `/courier-accounts` (or Network → Bank accounts). |
| B2 | **Three fixes the pilot relies on are committed locally but not pushed or deployed.** They are `4ad66e3e` (a label whose fetch failed is fetched again hourly, with a HIGH `awb-label-missing:*` issue and the MIME type read from the bytes — CUR-6b) and `201d5d03` (a packed box that gets no van raises a HIGH `auto-pickup:*` issue, the pickup location resolves the same way booking does, and a late box asks for tomorrow's van). | `git status`: `main…origin/main [ahead 3]`. Droplet `~/app` is at `8dac72f8`. | Push, and let CI and Deploy go green, **before** the first booking. Without these, a failed label or a missing van stays silent. |
| B3 | **The warehouse floor is not clean.** Four earlier Menev Store orders are still in the pick, pack and handover queues. Two of them hold **live, charged Delhivery waybills**. | SD-2026-26-000002 (PICKED; SH-…-000011 carries a pack stamp; AWB `38061110518534`; COD ₹10 — looks like a test). SD-2026-26-000003 (PENDING_PICK; manual AWB `15610994`). SD-2026-26-000004 (PICKED; AWB `38061110544961`; COD ₹1,250). SD-2026-26-000005 (PACKED; manual AWB `15610995`). | The owner decides, order by order, whether it is real. **Real:** ship it before or with the pilot (000004 would then raise the first real auto-pickup). **Test:** use admin cancel, then use courier-ops cancel on the voided shipment's waybill (CUR-10 #4) so Delhivery credits the charge back. Otherwise these parcels print and pick alongside the pilot and muddy every check. |
| B4 | **The issue board is too noisy to notice a new problem.** 30 issues are open: 26 HIGH `money` (unrecorded courier-wallet recharges on both accounts, and Delhivery's wallet at ₹9,134 against its ₹10,000 alert line), a HIGH `awb-stalled` on the cancelled SD-2026-26-000001 (117 occurrences), a HIGH `tracking_stalled` on the test parcel SD-TEST-SR-9901094775, and a MEDIUM "only 7 days of ledger came back for Delhivery". | `system_issues WHERE resolved_at IS NULL`. | Before day 1: record the recharges on `/courier-wallet`, top up Delhivery to at least ₹10,000 and record that too, and resolve the two stale parcel issues with a note. **The pilot's stop rule reads this board, so it has to start close to empty.** |
| B5 | **No CRITICAL or HIGH issue email has ever been delivered.** Three `system_issue.money` email rows have sat `queued` since 7 Sep. In-app delivery works: 232 sent in the last 14 days to 5 super-admins. Ordinary email works too: 106 sent. | `notification_logs WHERE event_id LIKE 'system_issue:%' AND channel = 'email'`, all `queued`. | Not a blocker, since in-app works. But until it is explained, do not rely on an email reaching someone out of hours. For the pilot, somebody opens `/system-issues` at 10:00, 16:00 and 22:00 IST. |
| B6 | **No product has a barcode.** Every scan will use the SKU code (LBL-2). Only two variants have stock: `AVIATO-BLAC-BLAC` (102 units) and `AVIATO-GREE-BLAC` (197 units, 1 reserved), both in CCU-01 / FLOOR. Variant weights are NULL; the product default is 500 g with a declared value of ₹1,050. | `stock_levels`, `product_variants`, `products`. | Pilot orders use only those two SKUs. Before packing, print SKU stickers for the pilot units (Printing, `POST admin/warehouse/printing/sku-labels/variants`). Otherwise the pack box cannot verify contents and you are pushed to force-complete, which does not exercise the real path (LBL-4). |
| B7 | **Menev Store is not on the default accrual tier.** It has a per-seller override `wallet.accrual_timing_tier = INSTANT`, plus `wallet.auto_withdraw_enabled = true`. | `seller_setting_overrides`. | To pilot T+N, **delete** the INSTANT tier override. Decide on auto-withdraw (see §1). |
| B8 | **Delhivery has never sent a webhook, and it will not.** Delhivery B2C accounts push no webhooks; polling every 20 minutes is the designed path (`docs/delhivery-tracking.md`, decision of 26 Aug). | `courier_webhooks`: 0 Delhivery rows. Shiprocket: 709 (7 processed, 702 ignored). | Out of scope, stated in §6. The poll is what the pilot verifies. |

What is already correct (prod 12 Sep): Delhivery and Shiprocket are both
live (`*_live_writes_enabled = true`, real base URLs in `system_settings`;
`couriers.api_base_url` is NULL for both and is **not** the switch).
`Courier.isActive` is true for delhivery, shiprocket and manual. Both
couriers have auto-pickup ON, and the pickup time is 18:00 IST. The
Delhivery pickup location is `MSEXPORT`, taken from the setting because the
account column is NULL; the origin PIN is `700128`. The Shiprocket account
has `pickup_location_name = 'warehouse'`. The NDR runner is OFF with no auto
categories. Both webhook secrets are set in env. Seller-held cash equals
the wallet balance for both sellers that have one (Menev ₹111.40 / ₹111.40;
QA ₹695.00 / ₹695.00). The nightly syncs ran on 11 Sep (Delhivery ledger
21:10 UTC; Shiprocket wallet 22:24 UTC). The P&L's courier-adjustments
cutover is set to 1 Oct IST.

---

## 1. Scope

### Sellers

| Seller | Role in the pilot | Settings during the pilot |
|---|---|---|
| **A — Menev Store** (the business, `019fd096-…`) | Every Delhivery parcel. SETTLEMENT COD mode, **default T+N** (7 days), fee charged at delivery. | Delete the `wallet.accrual_timing_tier` override. Leave `wallet.cod_credit_mode` at the global SETTLEMENT. Auto-withdraw: **leave ON** — it is how 1 Oct will behave, and it produces the withdrawal request for the taka payout on its own once the balance passes ₹500. Switch it off only if the owner wants to choose the payout day by hand. |
| **B — a second seller account for the same business** ("Menev Store — Pilot B", invited and approved) | The Instant Pay seller, and the only seller routed to Shiprocket. | Overrides: `wallet.cod_credit_mode = INSTANT_PAY`, `wallet.accrual_timing_tier = INSTANT` (**both are needed**: the Instant Pay credit is written inside the delivered accrual, so on T+N it would wait seven days — `accrual-execution.service.ts:122`), and `ops.default_courier_code = shiprocket` (CUR-19). |

**Why a second seller (decision D1 — the owner confirms).** COD mode,
accrual tier and default courier are all resolved **per seller**, at
delivery or confirmation time. With one seller, flipping to Instant Pay
mid-pilot would silently move every parcel that happened to be delivered
during the flip. A separate seller keeps the two paths apart by
construction. Seller B's stock is three real sunglasses moved from A:

- an `ADJUSTMENT_DECREASE` on A (reason OTHER, note "moved to Pilot B") at `/inventory/adjustments`, and
- a direct-to-India inbound for B received at CCU-01 (`/warehouse/receive`).

Physically they are the same goods.

Fallbacks, in order of preference:

- (a) Use the existing **QA Test Traders** account as B. Its test history (wallet ₹695) makes the money checks read as "before → after" rather than from zero.
- (b) Run B's parcels **after** A's have all been delivered, using time-boxed overrides on Menev.

### Parcels

| # | Seller | Courier | Payment | Destination | Designed outcome | Proves |
|---|---|---|---|---|---|---|
| P1 | A | Delhivery | COD ₹1,050 | a real customer **outside** West Bengal (e.g. Bengaluru or Delhi) | delivered | long-haul booking → label → auto pickup → handover → poll → delivered → cost sync → COD remittance CSV → SETTLEMENT credit → T+N accrual |
| P2 | A | Delhivery | COD ₹1,050 | Kolkata or West Bengal (a cooperating recipient) | delivered | the same flow, fast; the first T+N accrual to mature |
| P3 | A | Delhivery | **Prepaid** | anywhere | delivered | a prepaid order: no COD credit, charges only |
| P4 | A | Delhivery | COD | West Bengal (cooperating recipient) | **NDR, then re-attempt** — the recipient is deliberately unavailable on the first attempt and answers on the second | NSL capture → `ndr-readiness` → operator `ndr-action` after 21:00 IST → UPL poll → new attempt seen → delivered |
| P5 | A | Delhivery | COD | West Bengal (cooperating recipient, close to PIN 700128) | **refused at the door → RTO → received back** | RTO scans → `RTO_IN_TRANSIT` → warehouse receive → inspect → finalize RESTOCK → putaway → RTO fee ₹30 plus the delivery fee swept → **no COD credit, no reversal** |
| P6 | B | Shiprocket (default policy; Shiprocket picks the carrier) | COD | anywhere | delivered | Shiprocket create + assign → label URL stored → Shiprocket auto pickup → handover → poll and webhook → delivered → **Instant Pay credit at delivery** (front from capital, WAL-9) → Shiprocket `.xls` remittance → advance cleared |
| P7 (optional) | B | Shiprocket | Prepaid | anywhere | delivered | a second Shiprocket carrier/lane; Instant Pay charges with no COD |
| — | A | — | — | — | **BD payout in taka** at the end | withdrawal request → remittance in BDT from "Tasin City" (BDT) while A's cash sits at HDFC (INR) (TRE-8(d)) |

**Recipients.** Every order carries a real full name, a real phone number,
and an address whose line 2 holds the landmark (ORD-5). **Never use
test-looking consignee data.** Delhivery refuses it as a suspicious
consignee (`ER0005`), and that refusal would send the parcel into failover
and confuse the pilot. For P4 and P5 the recipient is briefed by phone
beforehand. For P5, "refused" means refusing at the door ("customer
refused"), not a no-show, so it becomes an RTO rather than an NDR.

**Why Shiprocket is reached through the per-seller override (CUR-19), not
a deliberate refusal failover (decision D2).**

- The override is deterministic and reversible: delete one row. It exercises exactly the path failover ends in — the same `CourierAwbDispatchService` booking, the same label, pickup and tracking.
- Forcing a failover means getting Delhivery to refuse. The only reliable way to do that is data their fraud check rejects. That leaves a refused and superseded shipment, may mark the account, and still does not let us choose the moment.
- Failover in both directions stays covered by `awb-generation.service.spec.ts`, and it would be observed incidentally if Delhivery refuses anything during the pilot.
- The override takes effect at confirmation, when the shipment is provisioned. Because seller B has only pilot orders, there is no window in which a non-pilot order could be caught.

---

## 2. Preconditions checklist (complete by Sunday 13 Sep evening)

Tick each item only when its evidence is in hand. "Page" means the admin
app at `admin.skydrop.online`.

| # | Check | Expected | How to verify |
|---|---|---|---|
| C1 | B2 is deployed | droplet at a commit that contains `201d5d03` and `4ad66e3e` | `ssh skydrop 'cd ~/app && git log --oneline -5'`; CI and Deploy green for that SHA |
| C2 | Courier write posture | as in table §2.1 | SQL Q-C2 |
| C3 | Couriers accepting parcels | delhivery, shiprocket and manual are `is_active = true` | Page `/courier-accounts` (master switches); SQL Q-C3 |
| C4 | Courier accounts and payout links | Delhivery → HDFC (INR); **Shiprocket → an INR account (B1 fixed)**; both `is_active`, `has_cred` | SQL Q-C4 |
| C5 | Pickup location names match the couriers' own records exactly | Delhivery One lists a pickup location named `MSEXPORT` at the CCU-01 address, PIN 700128. The Shiprocket panel (Settings → Pickup Addresses) lists `warehouse` with the same address. **Byte-identical, case included.** | Owner, in each courier's panel. Shiprocket also answers `GET /v1/external/settings/company/pickup`. |
| C6 | Seller overrides | A: **no** `wallet.accrual_timing_tier` override. B: `wallet.cod_credit_mode = INSTANT_PAY`, `wallet.accrual_timing_tier = INSTANT`, `ops.default_courier_code = shiprocket` | Page `/sellers/[id]` → Settings; SQL Q-C6 |
| C7 | No seller courier-account links, so routing uses the default account | 0 rows (prod 12 Sep: 0) | SQL Q-C7 |
| C8 | Stock for the pilot SKUs is on a pickable bin, and SKU stickers are printed | A: BLAC-BLAC ≥ 3 and GREE-BLAC ≥ 3 in CCU-01/FLOOR (`storage`). B: 3 units received. Stickers printed for every pilot unit. | SQL Q-C8; Printing → SKU labels |
| C9 | Floor clean (B3) | no pre-pilot order in `confirmed / pending_pick / picked / packed / pending_dispatch` | SQL Q-C9 |
| C10 | Issue board triaged (B4) | 0 open HIGH/CRITICAL issues, apart from ones written down as known | Page `/system-issues`; SQL Q-C10 |
| C11 | Courier wallets funded and recorded | Delhivery ≥ ₹10,000 and above the low-balance alert; Shiprocket ≥ ₹1,000; every recharge recorded, so `courier-recharge-unrecorded:*` issues are 0 | Page `/courier-wallet` |
| C12 | Webhook secrets present | `TRACKING_WEBHOOK_SECRET_DELHIVERY` and `_SHIPROCKET` set (prod 12 Sep: both set) | `ssh skydrop` env check that prints lengths, never values |
| C13 | Nightly syncs ran last night | audit `courier.wallet_ledger.synced` (Delhivery, 02:40 IST); `courier.shiprocket_wallet.synced` (03:50 IST); `courier.shiprocket_cost.synced` (21:40 IST) — all within 26 h | Page `/cost-sync`; SQL Q-C13 |
| C14 | Tracking poll alive | `courier.tracking_poll_last_run_at` less than 25 minutes old | SQL Q-C14 |
| C15 | Issues reach a person | ≥1 staff member with `system.settings.view` or super-admin who will check the board 3× a day; `ops.alert_email` set (prod: tasin.sti@gmail.com). B5 is understood or accepted. | Page `/staff`; SQL Q-C15 |
| C16 | FX rate for the taka payout is current | the `inr → bdt` row updated within 7 days (prod 12 Sep: 1.23, dated 24 Aug) | Page `/fx`; SQL Q-C16 |
| C17 | Seller A's payout bank details on file | City Bank ••••4001 (present) | Page `/sellers/[id]` |
| C18 | Staff trained and roles work | one call agent (`callcenter.work`), one picker/packer (`warehouse.pick`, `warehouse.pack`), one supervisor (`warehouse.pick.supervise`, `courier.dispatch.handoff`, `warehouse.rto.*`), one ops person (`courier.ops.write`), one money person (`money.settlements.record`, `money.remittances.manage`) | Page `/roles` |
| C19 | Delhivery COD remittance day and Shiprocket remittance cycle known | written dates for "COD delivered in week of 14 Sep is paid on …" for each courier | Owner asks the account managers on Monday 14 Sep |
| C20 | Dress rehearsal on the MANUAL courier | one order for seller B with a temporary `ops.default_courier_code = manual` override runs create → confirm → print → pick → pack box → handover without error; then cancel it and restore the override | Pages as in §3 |

### 2.1 Settings that must hold (Q-C2)

```sql
SELECT key, coalesce(value_string, value_boolean::text, value_int::text, value_decimal::text, value_json::text, value_date::text) AS v FROM system_settings WHERE key IN ('courier.delhivery_live_writes_enabled','courier.delhivery_api_base_url','courier.shiprocket_live_writes_enabled','courier.shiprocket_api_base_url','courier.delhivery_auto_pickup_enabled','courier.shiprocket_auto_pickup_enabled','courier.default_pickup_time','courier.delhivery_pickup_location','courier.delhivery_origin_pincode','courier.selection_policy','courier.ndr_runner_enabled','courier.ndr_auto_categories','courier.wallet_sync_enabled','courier.wallet_sync_writes_enabled','courier.shiprocket_wallet_sync_enabled','courier.shiprocket_cost_sync_enabled','ops.default_courier_code','ops.handover_scan_dispatches','ops.default_warehouse_id','wallet.cod_credit_mode','wallet.accrual_timing_tier','wallet.accrual_delay_days','wallet.courier_fee_deduction_timing','wallet.instant_pay_fee_percent','wallet.cod_gst_percent','wallet.cod_collection_fee_percent','wallet.settlement_shortfall_alert_percent','pricing.flat_delivery_fee_inr','pricing.flat_rto_fee_inr','pricing.flat_fee_gst_percent','pnl.courier_adjustments_from') ORDER BY key
```

| Key | Must be | Prod 12 Sep |
|---|---|---|
| `courier.delhivery_live_writes_enabled` / `courier.shiprocket_live_writes_enabled` | true / true | true / true |
| `courier.delhivery_api_base_url` / `courier.shiprocket_api_base_url` | `https://track.delhivery.com` / `https://apiv2.shiprocket.in` | ✓ |
| `courier.delhivery_auto_pickup_enabled` / `courier.shiprocket_auto_pickup_enabled` | true / true | ✓ |
| `courier.default_pickup_time` | `18:00:00` (a box packed after this asks for tomorrow's van) | ✓ |
| `courier.delhivery_pickup_location` / `courier.delhivery_origin_pincode` | `MSEXPORT` / `700128` | ✓ |
| `courier.selection_policy` | `SHIPROCKET_DEFAULT` | ✓ |
| `courier.ndr_runner_enabled` / `courier.ndr_auto_categories` | **false / `[]`** — the re-attempt stays an operator action | ✓ |
| `ops.default_courier_code` (global) | `delhivery` | ✓ |
| `ops.handover_scan_dispatches` | true | ✓ |
| `wallet.cod_credit_mode` (global) | `SETTLEMENT` | ✓ |
| `wallet.accrual_timing_tier` / `wallet.accrual_delay_days` | `T_PLUS_N` / 7 | ✓ |
| `wallet.courier_fee_deduction_timing` | `AT_DELIVERY` | ✓ |
| `wallet.instant_pay_fee_percent` / `wallet.cod_gst_percent` / `wallet.cod_collection_fee_percent` | 2.5 / 18 / 0 | ✓ |
| `pricing.flat_delivery_fee_inr` / `pricing.flat_rto_fee_inr` / `pricing.flat_fee_gst_percent` | 200 / 30 / 0 | ✓ |
| `pnl.courier_adjustments_from` | 2026-09-30 18:30 UTC (1 Oct IST) | ✓ |

### 2.2 The other precondition queries

- **Q-C3** — `SELECT code, is_active, deleted_at FROM couriers ORDER BY code`
- **Q-C4** — `SELECT c.code, ca.label, ca.is_default, ca.is_active, ca.pickup_location_name, ca.credential_id IS NOT NULL AS has_cred, pba.label AS payout_account, pba.currency::text AS payout_ccy FROM courier_accounts ca JOIN couriers c ON c.id = ca.courier_id LEFT JOIN platform_bank_accounts pba ON pba.id = ca.payout_bank_account_id WHERE ca.deleted_at IS NULL ORDER BY c.code`
- **Q-C6** — `SELECT s.company_name, o.key, coalesce(o.value_string, o.value_boolean::text, o.value_int::text, o.value_decimal::text) AS v FROM seller_setting_overrides o JOIN sellers s ON s.id = o.seller_id ORDER BY s.company_name, o.key`
- **Q-C7** — `SELECT s.company_name, ca.label, l.distribution_weight, l.is_active FROM seller_courier_account_links l JOIN sellers s ON s.id = l.seller_id JOIN courier_accounts ca ON ca.id = l.courier_account_id`
- **Q-C8** — `SELECT s.company_name, v.sku_code, w.code AS wh, b.code AS bin, b.type::text AS bin_type, sl.qty_on_hand, sl.qty_reserved FROM stock_levels sl JOIN sellers s ON s.id = sl.seller_id JOIN product_variants v ON v.id = sl.variant_id JOIN warehouse_bins b ON b.id = sl.bin_id JOIN warehouses w ON w.id = b.warehouse_id WHERE sl.qty_on_hand <> 0 ORDER BY s.company_name, v.sku_code`
- **Q-C9** — `SELECT o.order_number, s.company_name, o.status::text AS st FROM orders o JOIN sellers s ON s.id = o.seller_id WHERE o.status::text IN ('confirmed','awaiting_courier','pending_pick','picked','packed','pending_dispatch','pending_manual_placement') AND o.deleted_at IS NULL ORDER BY o.created_at`
- **Q-C10** — `SELECT kind::text AS kind, severity::text AS sev, dedupe_key, title, occurrence_count, last_seen_at FROM system_issues WHERE resolved_at IS NULL ORDER BY severity DESC, last_seen_at DESC`
- **Q-C13** — `SELECT action, max(created_at)::text AS latest FROM audit_logs WHERE action IN ('courier.wallet_ledger.synced','courier.shiprocket_wallet.synced','courier.shiprocket_cost.synced','courier.shiprocket_wallet.sync_failed') GROUP BY action`
- **Q-C14** — `SELECT value_date::text AS last_poll, now()::text AS now FROM system_settings WHERE key = 'courier.tracking_poll_last_run_at'`
- **Q-C15** — `SELECT u.email, r.key AS role, r.is_super_admin, u.last_login_at::date::text AS last_login FROM staff_users u JOIN staff_roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL ORDER BY r.key`
- **Q-C16** — `SELECT from_currency::text AS f, to_currency::text AS t, rate::text AS rate, updated_at::text AS updated FROM fx_rates`

---

## 3. Runbook: one parcel, stage by stage

Run the stages in order. After each stage, run its checks **before**
moving on. The SQL named `Q-…` is in §3.2. Record every order number, AWB
and timestamp in a shared sheet with one row per parcel and one column per
stage.

### 3.1 Stages

| # | Stage | Who / where | Action | Check (expected) |
|---|---|---|---|---|
| S1 | **Create** | Seller app `app.skydrop.online/orders/new` (A or B) | Choose a pilot SKU, quantity 1. Set `paymentMode` COD with `codAmountInr`, or PREPAID. Fill line 2 with the landmark. Submit. | Q-ORDER: `pending_confirmation`, **no shipment yet**, no reservation (ORD-10). Q-WALLET: no entry. Q-CHARGES: order charges exist (delivery ₹200, GST ₹0; status ESTIMATED). The order is in `/call-center/queue`. |
| S2 | **Call confirm** | Agent at `/call-center` | Next call → call the recipient → outcome CONFIRMED | Q-ORDER: `confirmed`, one shipment `created` on the expected courier (A: delhivery; B: shiprocket). A phase-1 reservation exists (Q-STOCK: active reservations +1). |
| S3 | **Waybill at confirmation** (CUR-2b) | automatic, within seconds | — | Q-ORDER: `awb_number` set, `awb_generated_at` set, shipment status **still `created`** (it must not become `awb_generated`). `courier_account_id` set. B: `courier_order_id` set. Q-LABEL: one `awb_labels` row, `is_current = true`, a non-empty `mime_type`, `file_size_bytes > 0` (Delhivery: PDF; Shiprocket: fetched from their URL). Q-AUDIT: `awb.generated` (or similar) plus `courier.delhivery.live_write_to_production` for Delhivery. `/system-issues`: no new `awb-label-missing:*` after 60 minutes. **Stop** if two shipments carry waybills (CUR-9). |
| S4 | **Label print** | `/warehouse/printing` → Labels | Select the pilot parcels → print → **confirm printed** | Q-ORDER: `label_printed_at` set. The courier label on paper shows the same AWB, the recipient, and the COD amount (COD parcels) or "prepaid". |
| S5 | **Picking sheet** | `/warehouse/printing` → Pick | Select the labelled parcels → build one sheet → **confirm printed** (this allocates phase 2) | Q-ORDER: order `pending_pick`. Q-STOCK: `qty_reserved` on the FLOOR bin +1 per parcel. A shortfall would route to `pending_manual_placement`, which is a stop for a pilot parcel. |
| S6 | **Walk and mark picked** | picker; then Printing → batch → **Mark picked** | — | Q-ORDER: `picked`. |
| S7 | **Pack box** (PACK-1, LBL-4) | `/warehouse/pack` | Scan the courier label (opens the box) → scan the SKU sticker → scan the label again (closes the box) | Q-ORDER: `packed`, `pack_completed_at` set. Q-PACKBOX: one `closed` box. Q-STOCK: **on-hand −1, reserved −1** (the `PACK_CONFIRM` movement, CUR-3 — the one and only decrement). **Never use force-complete for a pilot parcel**; needing it is a finding. |
| S8 | **Auto pickup** (CUR-10 #3) | automatic, when the box closes | — | Q-PICKUP: **exactly one** row for (courier, CCU-01, today) — or tomorrow if packed after 18:00 IST — `status = requested`, a non-empty `courier_pickup_id`, and `pickup_location_name = MSEXPORT` (Delhivery) or `warehouse` (Shiprocket). The second box that day adds no new row. `/system-issues`: no `auto-pickup:*`. Owner confirms in the courier panel that a pickup is scheduled. |
| S9 | **Van arrives: handover scan** (CUR-4, SCAN-1) | `/warehouse/handover` | Scan each pilot label as the box goes into the van | Q-ORDER: order `dispatched`, shipment `handed_to_courier`, `handover_scanned_at` set. The manifest closes itself when its last live parcel has gone (`/warehouse/manifests`). Stock is unchanged (dispatch moves no stock). **A repeat scan stops the operator until the issue is resolved — that is the design, not a bug.** |
| S10 | **Courier tracking** | automatic poll every 20 min (+ Shiprocket webhook) | — | Within about 1 h of the courier's first scan, Q-TRACK shows the scans in `event_at` order and the order moves to `in_transit`. Public page `https://track.skydrop.online/<AWB>` shows the timeline in English and Hindi, and no PII. B: `courier_webhooks` rows for the AWB are `processed`. `/system-issues`: no `TRACKING_STALLED` for the parcel. |
| S11a | **Delivered** | automatic | — | Q-ORDER: `out_for_delivery` → `delivered`. Stock unchanged (TRK-7). **A (T+N):** Q-ACCRUAL: a `pending_accruals` row with `eligible_at = delivered + 7 days` and `processed_at` NULL; **no** wallet entry yet. **B (Instant Pay, tier INSTANT):** Q-WALLET right away, per ₹1,000 COD: `cod_collection` +1,000.00, GST withholding −152.54, Instant Pay fee −21.19 (2.5% of 847.46), `order_charges` −200.00, net **+626.27**. Q-BANK: a capital → seller front pair in B's courier payout account (`reference` = order id). Page `/liabilities/instant-pay` lists the order. |
| S11b | **NDR** (P4) | see §4.2 | | |
| S11c | **RTO** (P5) | see §4.3 | | |
| S12 | **Courier cost** | nightly: Delhivery 02:40 IST, Shiprocket wallet 03:50 IST, Shiprocket cost sync 21:40 IST | — | The next morning, Q-COST: `actual_courier_cost_inr` set (the net of that AWB's ledger rows, never the latest debit — COST-1). Q-CWT: the AWB's transactions, none with `missing_from_export_at`. Page `/cost-sync` shows the run. An RTO parcel's whole net goes on `actual_rto_cost_inr`, and forward is ₹0 once a return-leg row exists. |
| S13 | **T+N matures** (A only) | hourly sweep | — | Delivered + 7 days: Q-ACCRUAL `processed_at` set. Q-WALLET: `order_charges` −200.00 once. Q-BANK: a seller → capital pair of −200 / +200, clamped to what A holds (TRE-8). Q-INV passes. |
| S14 | **COD remittance file** | `/settlements` → **Record a courier payout** | Upload the courier's file (Delhivery: the remittance-transactions CSV from Delhivery One; Shiprocket: their `.xls` with AWB and CRF sheets) → **Preview** → check the matched lines → enter the reference (UTR), the received date and any early-COD fee or freight kept back → **Record** | Preview: every pilot COD AWB matched, nothing unexplained, `amount + early COD fee + freight = allocated`. After recording, Q-SETL shows lines with `expected_inr = settled_inr` and shortfall 0. **A (SETTLEMENT):** Q-WALLET: `cod_collection` +1,050.00 and GST −160.17 per P1/P2/P4 order (cash is posted before the credit). **B (Instant Pay):** no new wallet entry — the whole COD goes to capital and clears the advance (`/liabilities/instant-pay` empties). Q-BANK: the settlement's entries sum to the bank credit on the HDFC statement. Q-INV passes. A payout short by more than 1% audits CRITICAL (a stop). |
| S15 | **P&L and float** | `/pnl` (the IST window covering the pilot), `/liabilities` | — | Delivery line: revenue ₹200 per delivered parcel, cost = the synced courier cost, coverage "fully priced". Returns line: P5 with ₹230 revenue. COD tax line: the GST withheld. COD handling fees: B's Instant Pay fee. Each drill-down's rows sum to its line. The courier float shows the parts for Instant Pay and settlement. |
| S16 | **BD payout in taka** | see §4.5 | | |

### 3.2 The per-stage query library

Replace `:ORD` and `:AWB`. All of these are read-only.

**Q-ORDER — order and shipments**
```sql
SELECT o.order_number, o.status::text AS order_status, o.payment_mode::text AS pm, o.cod_amount_inr::text AS cod, sh.shipment_number, sh.courier_code, sh.status::text AS shp_status, sh.awb_number, sh.courier_order_id, sh.courier_account_id IS NOT NULL AS has_acct, sh.awb_generated_at::text AS awb_at, sh.label_printed_at::text AS label_at, sh.pack_completed_at::text AS packed_at, sh.handover_scanned_at::text AS handover_at, sh.delivered_at::text AS delivered_at, sh.rto_received_at::text AS rto_rcv_at, sh.superseded_at::text AS superseded, sh.deleted_at::text AS voided FROM orders o JOIN order_shipments os ON os.order_id = o.id JOIN shipments sh ON sh.id = os.shipment_id WHERE o.order_number = :ORD ORDER BY sh.created_at
```

**Q-EVENTS — lifecycle timeline**
```sql
SELECT e.created_at::text AS at, e.type::text AS type, e.from_status::text AS from_st, e.to_status::text AS to_st, e.actor_type::text AS actor, e.description FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.order_number = :ORD ORDER BY e.created_at
```

**Q-CHARGES**
```sql
SELECT c.type::text AS type, c.status::text AS status, c.amount_inr::text AS amt, c.tax_amount_inr::text AS tax, c.total_amount_inr::text AS total FROM order_charges c JOIN orders o ON o.id = c.order_id WHERE o.order_number = :ORD AND c.deleted_at IS NULL ORDER BY c.display_order
```

**Q-WALLET — the order's wallet entries**
```sql
SELECT w.created_at::text AS at, w.direction::text AS dir, w.amount::text AS amt, w.running_balance_after::text AS bal, w.note FROM seller_wallet_entries w JOIN orders o ON o.id = w.linked_order_id WHERE o.order_number = :ORD ORDER BY w.id
```

**Q-INV — the money invariants for every seller: seller-held cash = max(0, wallet), and the cached balance = the ledger's last entry.** Run it after every money stage.
```sql
SELECT s.company_name, b.balance::text AS wallet_cached, (SELECT w.running_balance_after FROM seller_wallet_entries w WHERE w.seller_id = s.id AND w.currency = b.currency ORDER BY w.id DESC LIMIT 1)::text AS wallet_ledger, greatest(b.balance, 0)::text AS expected_held, (SELECT coalesce(sum(e.signed_amount), 0) FROM bank_entries e JOIN platform_bank_accounts a ON a.id = e.account_id WHERE e.seller_id = s.id AND e.owner_kind::text = 'seller' AND a.currency::text = 'inr')::text AS held_inr, (SELECT coalesce(sum(e.signed_amount), 0) FROM bank_entries e JOIN platform_bank_accounts a ON a.id = e.account_id WHERE e.seller_id = s.id AND e.owner_kind::text = 'seller' AND a.currency::text = 'bdt')::text AS held_bdt FROM seller_wallet_balances b JOIN sellers s ON s.id = b.seller_id WHERE b.currency::text = 'inr' ORDER BY s.company_name
```
Expected: `wallet_cached = wallet_ledger`, and `held_inr` (plus `held_bdt` valued at the rate it was credited at) `= expected_held`. The admin cross-check is `/seller-wallets/[id]` → Reconcile.

**Q-BANK — bank entries a pilot event wrote (last 2 hours)**
```sql
SELECT e.created_at::text AS at, a.label AS account, e.type::text AS type, e.owner_kind::text AS owner, s.company_name AS seller, e.signed_amount::text AS amt, e.currency::text AS ccy, e.reference, e.note FROM bank_entries e JOIN platform_bank_accounts a ON a.id = e.account_id LEFT JOIN sellers s ON s.id = e.seller_id WHERE e.created_at > now() - interval '2 hours' ORDER BY e.created_at
```

**Q-STOCK — stock for the pilot SKUs**
```sql
SELECT s.company_name, v.sku_code, sum(sl.qty_on_hand) AS on_hand, sum(sl.qty_reserved) AS reserved_phase2, (SELECT coalesce(sum(r.qty_reserved), 0) FROM stock_reservations r WHERE r.variant_id = v.id AND r.status::text = 'active') AS active_reserved FROM stock_levels sl JOIN product_variants v ON v.id = sl.variant_id JOIN sellers s ON s.id = v.seller_id WHERE v.sku_code IN ('AVIATO-BLAC-BLAC','AVIATO-GREE-BLAC') GROUP BY s.company_name, v.id, v.sku_code
```
Also compare against a physical shelf count at S7 and at P5's finalize.

**Q-MOVES — stock movements for one order**
```sql
SELECT m.* FROM stock_movements m JOIN orders o ON o.id = m.order_id WHERE o.order_number = :ORD ORDER BY m.created_at
```
Expected over a delivered parcel's whole life: exactly one `pack_confirm`. For P5: one `pack_confirm`, then one `return_restock`.

**Q-LABEL**
```sql
SELECT sh.shipment_number, l.is_current, l.mime_type, l.file_size_bytes, l.generated_at::text AS at FROM awb_labels l JOIN shipments sh ON sh.id = l.shipment_id JOIN order_shipments os ON os.shipment_id = sh.id JOIN orders o ON o.id = os.order_id WHERE o.order_number = :ORD
```

**Q-PACKBOX**
```sql
SELECT pb.* FROM pack_boxes pb JOIN order_shipments os ON os.shipment_id = pb.shipment_id JOIN orders o ON o.id = os.order_id WHERE o.order_number = :ORD
```

**Q-PICKUP**
```sql
SELECT courier_code, pickup_location_name, pickup_date::text AS d, pickup_time, expected_package_count AS pkgs, status::text AS st, courier_pickup_id, courier_message, created_at::text AS at FROM courier_pickup_requests ORDER BY created_at DESC LIMIT 5
```

**Q-TRACK**
```sql
SELECT t.event_at::text AS scan_at, t.courier_code, t.event_type::text AS type, t.raw_courier_status AS raw, t.nsl_code, t.location_city, t.webhook_id IS NOT NULL AS via_webhook FROM tracking_events t JOIN order_shipments os ON os.shipment_id = t.shipment_id JOIN orders o ON o.id = os.order_id WHERE o.order_number = :ORD ORDER BY t.event_at DESC LIMIT 25
```

**Q-WEBHOOK (Shiprocket)**
```sql
SELECT status::text AS st, count(*) AS n, max(created_at)::text AS latest FROM courier_webhooks WHERE courier_code = 'shiprocket' AND shipment_id = (SELECT id FROM shipments WHERE awb_number = :AWB) GROUP BY status
```

**Q-ACCRUAL**
```sql
SELECT o.order_number, pa.eligible_at::text AS eligible, pa.processed_at::text AS processed FROM pending_accruals pa JOIN orders o ON o.id = pa.order_id WHERE o.order_number = :ORD
```

**Q-COST**
```sql
SELECT sh.awb_number, sh.actual_courier_cost_inr::text AS fwd, sh.actual_rto_cost_inr::text AS rto, sh.actual_courier_cost_at::text AS fwd_at, sh.actual_rto_cost_at::text AS rto_at FROM shipments sh WHERE sh.awb_number = :AWB
```

**Q-CWT — courier wallet ledger for the AWB**
```sql
SELECT w.txn_id, w.kind::text AS kind, w.category::text AS cat, w.amount_inr::text AS amt, w.occurred_at::text AS at, w.missing_from_export_at::text AS vanished FROM courier_wallet_transactions w WHERE w.awb_number = :AWB ORDER BY w.occurred_at
```

**Q-SETL — one payout and its lines**
```sql
SELECT cs.reference, cs.amount_inr::text AS amt, cs.allocated_inr::text AS alloc, cs.early_cod_fee_inr::text AS early_fee, cs.freight_deducted_inr::text AS freight, cs.rto_reversal_inr::text AS rto_rev, o.order_number, l.expected_inr::text AS expected, l.settled_inr::text AS settled, l.shortfall_inr::text AS shortfall FROM courier_settlements cs JOIN courier_settlement_lines l ON l.settlement_id = cs.id JOIN orders o ON o.id = l.order_id WHERE cs.reference = '<UTR>' ORDER BY o.order_number
```
Bank side of the same payout:
```sql
SELECT e.type::text AS type, e.owner_kind::text AS owner, s.company_name, e.signed_amount::text AS amt, e.note FROM bank_entries e LEFT JOIN sellers s ON s.id = e.seller_id WHERE e.settlement_id = (SELECT id FROM courier_settlements WHERE reference = '<UTR>') ORDER BY e.created_at
```

**Q-NDR**
```sql
SELECT awb_number, action, status::text AS st, nsl_code_at_submit AS nsl, attempt_count_at_submit AS attempts, upl_id, courier_message, submitted_at::text AS sub, polled_at::text AS polled, new_attempt_seen FROM ndr_action_requests ORDER BY created_at DESC LIMIT 5
```
Delivery attempts for one parcel:
```sql
SELECT d.attempt_number, d.attempted_at::text AS at, d.outcome::text AS outcome, d.failure_reason::text AS reason, d.courier_nsl_code AS nsl, d.source::text AS src FROM delivery_attempts d JOIN order_shipments os ON os.shipment_id = d.shipment_id JOIN orders o ON o.id = os.order_id WHERE o.order_number = :ORD ORDER BY d.attempt_number
```

**Q-AUDIT — courier writes in the last day** (every cancel, NDR, pickup and booking must appear here)
```sql
SELECT action, actor_type::text AS actor, created_at::text AS at, metadata::text AS meta FROM audit_logs WHERE (action LIKE 'courier.%' OR action LIKE 'awb.%') AND created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 40
```

**Q-ISSUES — open issues raised since the pilot began**
```sql
SELECT kind::text AS kind, severity::text AS sev, dedupe_key, title, occurrence_count AS n, first_seen_at::text AS first FROM system_issues WHERE resolved_at IS NULL AND first_seen_at > '2026-09-14' ORDER BY severity DESC, first_seen_at
```

---

## 4. Parcel-specific procedures

### 4.1 P1–P3 (Delhivery, delivered)

Run S1–S11a, then S12–S15.

- P3 is prepaid: at S14 it has no COD line. After T+N it shows only `order_charges` −200.
- Expected wallet for A per COD parcel of ₹1,050, across the pilot:
  - at the payout: `cod_collection` +1,050.00, GST −160.17 (1,050 × 18 / 118);
  - at T+7: `order_charges` −200.00;
  - net **+689.83**.
- Which of the two lands first depends on the dates. Either order is correct.

### 4.2 P4 — NDR with an operator re-attempt

1. Brief the recipient to be unreachable on the first attempt (a phone call with no answer, or "not at home"). Delhivery then records `EOD-74`, customer unavailable, which is re-attemptable. Only the first or second failure is eligible.
2. After the courier's failed-attempt scan, confirm the poll captured it:
   - Q-TRACK shows an `nsl_code`;
   - Q-NDR (delivery attempts) shows attempt 1 with outcome failed and an NSL;
   - the order is `delivery_failed`;
   - the seller receives the NDR email with a reason (NOTIF);
   - the order appears on `/nsa`.
3. **After 21:00 IST that evening.** Delhivery advises re-attempt requests only after the day's dispatches have closed, and earlier ones can be silently ineffective. Open `/orders/[id]` → Courier-ops panel:
   - **NDR readiness** must say eligible;
   - then **Request re-attempt** (`POST admin/courier-ops/shipments/:id/ndr-action`, permission `courier.ops.write`).
4. Checks:
   - Q-NDR: one row with `status` submitted and a `upl_id`. The UPL poll runs every 20 minutes and moves it to accepted or refused, with `courier_message`.
   - Q-AUDIT: the NDR write is recorded with a staff actor.
   - The order does **not** change status because of the request (CUR-11).
5. Next day:
   - the courier's out-for-delivery scan moves the order `delivery_failed → out_for_delivery → delivered`;
   - the NDR reconciliation (12:00) sets `new_attempt_seen = true`.
6. Then S12–S15 as for P1.

**Stop if** the NDR row stays submitted for more than 4 hours, a refusal arrives
with no reason, or a re-attempt is fired without an operator. The runner must
stay OFF.

### 4.3 P5 — refused, RTO, received back

1. Pick a recipient in greater Kolkata so the return leg is days, not a week.
2. At the door the recipient refuses. Delhivery scans RTO initiated, then RTO in transit.
   - Check: the order is `rto_in_transit` (TRK-6 — webhook and poll drive it **no further**).
   - Q-WALLET: nothing yet.
   - Q-STOCK: unchanged (the unit is still out of the building).
   - The watchdog `ops.rto_receipt_alert_hours` (48) will raise an issue if the carton is not received within 48 hours of the return scan. That is the reminder to go and look.
3. When the carton arrives, go to `/warehouse/rto`:
   - **Awaiting** → **Receive** (scan the AWB; `warehouse.rto.receive`).
   - Check: the order is `rto_received`; `rto_received_at` and `rto_received_warehouse_id = CCU-01` are set.
   - Q-WALLET: `rto_fee` −30.00, **and** `order_charges` −200.00 (swept at receive because it was unpaid). **Each appears exactly once.**
4. **Inspect** the item (`warehouse.rto.inspect`) as GOOD → **Finalize** as RESTOCK (`warehouse.rto.finalize`).
   - Check: the order is `rto_restocked`.
   - Q-MOVES: one `return_restock` +1.
   - Q-STOCK: on-hand back where it started. The unit lands in an RTO_HOLD bin if CCU-01 has one, otherwise the picked bin (FLOOR) (BIN-3).
   - If it went to RTO_HOLD, **Putaway** to FLOOR (`warehouse.rto.putaway`). Only then is it sellable again (BIN-2).
5. Money checks:
   - **No** `cod_collection` for P5, ever.
   - P5 must **not** appear on any payout. If a courier file lists it with a COD amount, that is a finding, not something to fix by hand.
   - Its cost: `actual_rto_cost_inr` carries the net and forward is ₹0 once the courier's RTO rows are synced.
   - P&L returns line: revenue ₹230, cost as synced.
   - Q-INV passes.

### 4.4 P6/P7 — Shiprocket (seller B)

1. **Book P6 a day after P1–P5** (see §5). A Shiprocket problem must not be mistaken for a Delhivery one, and Delhivery's first pickup should already be proven.
2. S2–S3 checks, specifically:
   - `courier_code = shiprocket`, `courier_order_id` and `courier_shipment_id` set;
   - the carrier Shiprocket chose is recorded (the `courier_options` column stays NULL under `SHIPROCKET_DEFAULT`, which is correct);
   - `awb_labels` holds their label;
   - Q-AUDIT shows a live Shiprocket write, **not** a stub. If the waybill looks derived from the shipment id, stop (CUR-15).
3. S8: a Shiprocket pickup row for `warehouse`. Confirm in the Shiprocket panel that the pickup is scheduled.
4. S10: both the poll and the webhook. Q-WEBHOOK should show `processed` rows for the AWB.
5. At delivery (Instant Pay):
   - the S11a figures for B;
   - `/liabilities/instant-pay` lists P6;
   - Q-BANK shows a front pair in the Shiprocket payout account (B1 must be fixed first, or this step fails).
6. At the Shiprocket remittance (S14, `.xls`):
   - no new wallet entry for B;
   - the advance clears;
   - an early-COD fee and any freight kept back are recorded by kind. The freight becomes a `COURIER_WALLET_RECHARGE` with a matched `courier_wallet_recharges` row (COST-2).
   - The next night's Shiprocket wallet sync pairs the passbook's COD top-up with it. `/system-issues` should show no `shiprocket-cod-topup-*`.
7. The next nights:
   - Shiprocket cost sync: no `shiprocket-bill-vs-ledger:*` and no `shiprocket-awb-swapped:*` for the pilot AWB;
   - invoice check (04:30 IST): nothing for it.

### 4.5 BD payout in taka (seller A)

1. Once A's withdrawable balance is at least ₹500:
   - either auto-withdraw creates a request at 10:00 Dhaka (once a day),
   - or the owner requests it in the seller app `/wallet`.
2. `/withdrawals` → review.
3. `/remittances` → **new remittance** (`money.remittances.manage`):
   - seller A; currency **BDT**; paid from **Tasin City (BDT)**;
   - the amount in taka and in rupees exactly as on the two statements, with the quoted rate;
   - the bank reference (UTR) and the proof;
   - **link it to the withdrawal request**.
   - The form is idempotent (IDEM-1): a retry of the same modal creates nothing twice.
4. Checks:
   - Q-WALLET for A: a `remittance_out` equal to the INR value, plus `remittance_fx` if one applies. The balance falls by exactly that.
   - Q-BANK: Tasin City's capital falls by the taka amount. Because A holds its money at HDFC and not at Tasin City, A's HDFC-held rupees are reclassified to capital for the same value (TRE-8(d)).
   - The withdrawal request is `paid`, with `linked_remittance_id` set.
   - Q-INV: held = max(0, wallet).
   - `/pnl` FX line: the spread against the quoted rate, if any (TRE-5).

---

## 5. Timeline (Saturday 12 Sep → Thursday 1 Oct)

| Day | Date | Work | Gate at end of day |
|---|---|---|---|
| Sat–Sun | 12–13 Sep | Deploy B2. Clean the floor (B3). Triage the board and record recharges (B4, C11). Link the Shiprocket payout account (B1). Create seller B, move 3 units, receive them. Set overrides. Print SKU stickers. MANUAL dress rehearsal (C20). All of §2. | Every C-row ticked |
| Mon | 14 Sep | Owner gets the remittance dates from both couriers (C19). Morning: create P1–P5; call-confirm by 12:00 IST. Print labels and the sheet, pick and pack **by 16:00 IST** (well before the 18:00 cut-off) → the Delhivery auto pickup for today. Evening: handover scan when the van comes. | P1–P5 `dispatched`, one pickup row, labels stored |
| Tue | 15 Sep | Check first scans (S10). Create P6 (and P7), confirm, pack by 16:00, Shiprocket pickup and handover. Night: the first Delhivery cost sync (02:40 IST Wed). | P6 `dispatched`; P1–P5 `in_transit`; no issues |
| Wed–Fri | 16–18 Sep | Local deliveries (P2). P4's first attempt fails → the re-attempt goes in **after 21:00 IST** that day → delivered on the second attempt. P5 refused → `rto_in_transit`. Costs stamp nightly (S12). Instant Pay credit for P6 at delivery. | P2 and P4 delivered; P5 returning; Q-INV clean daily |
| Sat–Wed | 19–23 Sep | Long-haul deliveries (P1, P3, P6/P7). P5 carton back at CCU-01 → receive, inspect, finalize, putaway. **About 23 Sep: P2's T+N accrual matures** (delivered + 7 days). | All delivered or restocked; the first accrual processed |
| Mon–Fri | 21–25 Sep | **Delhivery COD remittance** for the week's deliveries (on the date from C19) → record it (S14). T+N for P4, P1 and P3 matures as their 7 days pass. | The Delhivery payout is fully explained; A credited |
| Thu–Tue | 24–29 Sep | **Shiprocket COD remittance** (their cycle is typically about 7 days after delivery; confirm the date) → record the `.xls`. Once A's balance is at least ₹500: withdrawal → **taka remittance** (§4.5). | Instant Pay advance cleared; BD payout recorded |
| Tue | 29 Sep | **Go / no-go review** against §6.1 with this sheet and a fresh Q-INV, Q-ISSUES and `/pnl`. | Decision recorded |
| Wed | 30 Sep | Buffer: fixes and re-verification. Delete seller B's overrides (or keep B dormant). Decide the 1 Oct settings for A (T+N vs INSTANT, auto-withdraw). | — |
| Thu | 1 Oct | Cutover. Keep the three-times-a-day `/system-issues` check for the first two weeks. | — |

Lead times to respect:

- The pickup van comes the same day only if the request goes before 18:00 IST.
- An NDR re-attempt goes after 21:00 IST.
- The courier cost appears the night after the courier debits.
- COD money moves only on the courier's remittance cycle, which Skydrop does not control.
- If the Shiprocket payout has not landed by 29 Sep, see §6.1 (G8b).

---

## 6. Decision rules

### 6.1 Go / no-go criteria for 1 Oct

**GO requires all of G1–G7, G8a, G9 and G10.** G8b can be a watch item.

| # | Criterion | Evidence |
|---|---|---|
| G1 | Every pilot parcel reached its designed outcome **without god mode, force-complete, or a manual status fix** | Q-ORDER / Q-EVENTS per parcel; `orders.has_admin_override = false` |
| G2 | The money invariants held at every checkpoint: Q-INV clean, the cached balance equals the ledger, every charge and credit appears exactly once | the daily Q-INV log |
| G3 | Stock conserved: exactly one `pack_confirm` per shipped unit, P5 restocked +1, on-hand matches the shelf count | Q-MOVES, Q-STOCK, a physical count |
| G4 | Labels: every booking (Delhivery and Shiprocket) has a current `awb_labels` row with a real MIME type within 1 hour | Q-LABEL |
| G5 | Pickups: exactly one request per courier / warehouse / day, a van actually came, and no `auto-pickup:*` issue | Q-PICKUP, the courier panels |
| G6 | Tracking: every status change reached the order within about 1 hour of the courier's own; no `TRACKING_STALLED` on a pilot parcel; the Shiprocket webhook was processed | Q-TRACK, Q-WEBHOOK, Q-ISSUES |
| G7 | NDR: the re-attempt was accepted (UPL), the new attempt was seen, and the parcel was delivered | Q-NDR |
| G8a | The Delhivery COD remittance was imported and fully explained, and A was credited correctly | Q-SETL + Q-WALLET + the HDFC statement |
| G8b | The Shiprocket remittance was imported and the Instant Pay advance cleared. **If it has not landed by 29 Sep:** GO is allowed with B's Instant Pay advance on `/liabilities/instant-pay` as a named watch item, recorded in the first October payout. | Q-SETL, `/liabilities/instant-pay` |
| G9 | Courier cost stamped on every pilot parcel; the P&L drill-downs add up to their lines | Q-COST, `/pnl` |
| G10 | The BD taka payout was recorded, the withdrawal was linked, and Q-INV is clean afterwards | §4.5 |
| G11 | No open HIGH or CRITICAL issue that is not understood and written down | Q-ISSUES |

If G1–G7 are green but the courier cycles have not come round (G8), a
partial GO is reasonable. Anything red in G1–G7 or G2/G3 is NO-GO until it is
fixed and re-verified on a fresh parcel.

### 6.2 Stop rule: halt new bookings at once

**Halt new bookings if any one of these happens:**

1. A charge, credit, fee or refund is applied twice, or Q-INV is off and cannot be explained within the hour.
2. A shipment carries two waybills, or a second booking is made for one shipment (CUR-9).
3. A parcel is booked or dispatched with a waybill the courier does not recognise (stub answering for live — CUR-15).
4. On-hand or reserved stock disagrees with the shelf after pack or RTO.
5. More than one pickup request for a courier, warehouse and day; or a van summoned when nothing was packed.
6. A courier write (cancel, NDR, edit) happened with no audit row, or was fired by something other than an operator (auto pickup excepted).
7. A payout cannot be fully explained, or an audit shortfall is CRITICAL.
8. An order status contradicts the courier for more than 6 hours on a pilot parcel.

**What to do:**

1. Stop creating or confirming pilot orders. In-flight parcels continue — the courier already has them.
2. Snapshot the evidence (the Q-queries).
3. Fix the code, deploy, and re-verify the stage on the **next** parcel.
4. Then resume.

If the fault is in booking, also switch that courier's intake off (see below).

### 6.3 Escape hatches

| Risky step | Escape hatch | Where | Notes |
|---|---|---|---|
| A waybill booked but the parcel should not go | Courier-ops **Cancel** | `/orders/[id]` → Courier-ops panel (`POST admin/courier-ops/shipments/:id/cancel`, `courier.ops.write`) | A cancel on a parcel **already moving** turns it into a return. |
| An order should not proceed | Admin **Cancel** (matrix-guarded; after pack it uses `UNPACK_STOCK`, which gives the stock back) | `/orders/[id]` (`orders.cancel`) | The voided shipment keeps its live waybill. Then use courier-ops cancel on it (CUR-10 #4), otherwise HIGH `LIVE_WAYBILL` after 2 hours. |
| The seller wants their own parcel back | Seller "send it back" | seller app order page | Calls the courier cancel at once, audited as the SELLER (CUR-10 #2). |
| A wrong or failed pickup day | **Release day** / retry | `/warehouse/pickups` (`courier.pickups.manage`) | Refused if the courier returned a pickup id. A FAILED day is never auto-retried. |
| Auto pickup misbehaving | `courier.<code>_auto_pickup_enabled = false` | `/settings` | No deploy needed. Raise pickups by hand on `/warehouse/pickups`. |
| A courier misbehaving for new parcels | **Courier.isActive off** (reason ≥ 10 characters, audited HIGH) | `/courier-accounts` master switches | In-flight parcels keep being tracked (CUR-16). The Delhivery-off fallback is seller B's or the global override set to `manual` (manual placement). |
| All writes to a courier must stop | `courier.<code>_live_writes_enabled = false` | `/settings` | **Also blocks cancels and NDRs**, so use it only as the last switch. |
| Pack refuses (no stickers) | Supervisor **force-complete** (reason ≥ 20 characters, audited HIGH) | `/warehouse/pack` | Counts against G1. |
| Scan block after a repeat scan | Resolve the `WAREHOUSE_SCAN` issue with a note | `/system-issues` | This is the design (SCAN-1). |
| Tracking missed a status | **Manual scan** with the real scan time | `/orders/[id]` → Manual scan (`orders.tracking.manual_scan`) | Same mapping and guards as the poll (TRK-9). |
| A payout recorded wrongly | An adjusting settlement, never an edit | `/settlements` | Always **Preview** first. The import `dryRun` exists for the wallet file. |
| A remittance double-submitted | Idempotent key | `/remittances` | A retry returns the original (IDEM-1). |
| Everything else fails | **God mode** (`orders.override`, reason ≥ 30 characters, typed confirmation, `hasAdminOverride` permanent) | `/orders/[id]` → Force mutation | Last resort. It opts out of stock compensation but **does bill** (WAL-8). Its use fails G1. |

---

## 7. What the pilot will not cover

- **Delhivery webhooks.** Delhivery B2C pushes none. The pilot proves the poll, which is the production path.
- **A real COD reversal.** A reversal needs a courier to claw back COD it had already paid out. An RTO parcel never collected COD, so P5 proves only that a return gets **no** credit. The reversal path (`deductions.rtoReversals`, `COD_REVERSAL`, the deduction refunds) stays proven only by tests and the 12 Sep QA run.
- **Automatic NDR** (the nightly runner and its auto categories). It stays OFF; only the operator re-attempt is exercised.
- **Courier failover.** It is not triggered on purpose (§1, D2). It stays covered by unit tests.
- **Carrier-selection policies other than `SHIPROCKET_DEFAULT`** (MANUAL / CHEAPEST / FASTEST / the `/courier-decisions` queue).
- **Charge-at-waybill (`AT_AWB`)** for seller A. It was proven by the 12 Sep QA run, not here.
- **STRICT-mode serials**, BD→India two-leg consignments, and inbound freight billing and amortisation. Pilot stock is already in India, NORMAL mode.
- **Taka top-ups, customer-return fees, damage/scrap tickets, lost parcels, weight disputes, MPS, reverse pickup (RVP).**
- **Delhivery invoices checked against its wallet.** This is not built; only Shiprocket's are checked.
- **Volume.** Seven parcels prove the paths, not throughput: call-queue round-robin under load, parallel packers, database connections (SCALE-2).
- **The Shiprocket remittance**, if their cycle lands after 29 Sep (G8b).
- **Portal automation** (tickets, canary). It stays OFF (CUR-18).
- **CRITICAL-issue email delivery (B5).** It is unproven until the three stuck `system_issue.money` emails are explained.

Once 1 Oct volume starts, each of these will first happen for real. Treat
the first occurrence of each as a mini-pilot: watch it on the day and run
the matching Q-checks.
