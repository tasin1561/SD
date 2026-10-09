# What we could add next, cheaply

Written 9 Oct 2026. Every figure marked **(prod)** was measured read-only
against production the same day through `~/verify/verify-run.cjs`. Every
file reference was checked in the code, not inherited from another
document.

**The question is not "what is missing from the plan".** Phase 1A, R0–R9,
reseller stores and associates are all built. The question is what is already
80% built — or already has its column, its service, its switch — and would be
cheap to finish. The top of that list is not a feature at all: it is a channel
we never built, against a customer base that cannot receive email.

**None of the top five needs `@skydrop/workers` deployed** — that boundary is
still "available but not in effect" (all 17 workers run in-process inside
`skydrop-api`) and nothing below depends on it. Where an invariant *is* in the
way it is named.

---

## The ten, ranked by value per unit of effort

| # | What it is | Effort | What it unlocks |
|---|---|---|---|
| 1 | **Text the customer.** SMS (then WhatsApp) for confirmed / out-for-delivery / delivery-failed | a week | 48 of 53 orders have no customer email **(prod)**. 117 customer notices were never sent, 27 of them delivery failures. Fewer NDRs, so fewer RTOs |
| 2 | **Put the GSTIN on the invoice** | minutes | 17 tax invoices have already gone out with no GSTIN **(prod)**. An Indian tax invoice must carry it. Pure settings change |
| 3 | **Make the seller API key do something** | a day | The key sellers can already mint authenticates **no endpoint**. Lets a seller push orders from Shopify/Woo instead of typing or uploading CSV |
| 4 | **Keep the proof of delivery** | a day | 0 of 69 shipments hold a POD **(prod)**, and Delhivery deletes theirs over time. It is what settles "I never got it" — and who absorbs the loss |
| 5 | **Enforce the notification throttle** | hours | A documented CLAUDE.md rule with a `THROTTLED` enum value, two template columns, and no implementation. Today one looping sweep can mail somebody unboundedly |
| 6 | **Decide the COD collection fee** | minutes | `wallet.cod_collection_fee_percent` is **0%** **(prod)**. Fully built: own wallet direction, own P&L line, reversal handling, a 100% cap. Revenue on every COD order |
| 7 | **"Test this courier login"** | hours | `courier_credentials.lastTestedAt` / `lastTestResult` exist and nothing writes them. Today a dead courier login is discovered by a sync failing at 02:40 |
| 8 | **Count label prints** | hours | `awb_labels.printedCount` / `lastPrintedAt`, 0 of 3 stamped **(prod)**. Catches a duplicate shipping label at the print, where SCAN-1 catches it at the second scan |
| 9 | **Switch reseller orders on for a real seller** | a controlled run | Built, deployed, and `false` for everyone but the QA seller **(prod)**. This is a rollout gate, not unfinished work |
| 10 | **Order ageing / SLA** | a day | `orders.slaDeadline` exists and nothing reads it. "Which orders are late, and at which step" has no answer today |

Below the line, named so they are not mistaken for cheap:

- **ChatWoot live chat** — a project: the droplet install, then the real-mode
  wiring behind the `TODO(chatwoot-api)` seams. `chat.chatwoot_base_url` is
  empty **(prod)**, which is what keeps the stub answering.
- **Multi-piece shipments** — a project, *and it has an invariant in the way.*
  `DelhiveryMpsService` is written and has zero callers, and the planning logic
  (one waybill per box, the master repeated as `master_id`, `mps_amount` as a
  consignment total rather than per box) is the subtle part and is already
  done. But it needs a `shipment_boxes` model, N-waybill claiming from the
  pool, and an AWB saga that breaks **CUR-9's once-only gate** — and
  `courier.delhivery_waybill_pool_refill_enabled` is `false` **(prod)**, so
  there are no pre-fetched waybills to claim either. Do not treat the finished
  service as a head start on a small job. **RVP QC** is the same shape:
  `DelhiveryRvpQcService` has zero callers and needs a reverse-pickup creation
  flow, where RTO today is entirely courier-initiated.
- **A seller-facing agent-productivity report** — a day, but build it from
  `call_attempts`, never from the two unread counters on
  `agent_call_settings` (see "Worth deleting").

---

## 1. Text the customer — the one that is costing money today

**In plain terms:** when a parcel is out for delivery, or the courier could
not deliver it, nobody tells the customer. We think we do. We send an email,
and nine customers in ten never gave us an email address.

**Measured in production:**

- 48 of 53 orders carry no `recipient_email`. All 53 carry a phone.
- 117 customer notifications sit in `notification_logs` as `skipped` — the
  NOTIF-8 "no resolvable address" row. Every one is a `customer.*` template:
  45 out-for-delivery, **27 delivery-failed**, 17 delivered, 17 confirmed,
  6 dispatched, 5 cancelled.

The 27 is the expensive number. A delivery failure the customer never hears
about becomes a second failed attempt, then an NDR, then an RTO — and an RTO
costs the delivery fee, the return fee, the return freight and the sale. For
Indian COD buyers the phone number *is* the address.

**What already exists.** Almost all of it:

- `NotificationChannel` already has `SMS` and `WHATSAPP`;
  `notification_logs.toPhoneE164` (schema:5148) and `costMicros`
  (schema:5193) are already columns. SMS was designed and never built.
- `NotificationLedgerService` is already channel-parameterised
  (`input.channel`) and its own comment says so: *"Currently EMAIL is the
  only channel"* (`notification-ledger.service.ts:133`).
- `NotificationPolicyService.policyFor` is the F2-exhaustive switch deciding
  which channels a category may use (lines 152–174). Adding SMS is adding it
  to two `allowed` arrays.
- Everything around it is channel-agnostic already: the NOTIF-2 dedup gate,
  the audience resolver, quiet hours, the mute catalogue, the store-then-send
  ledger, NOTIF-22's undelivered watchdog. And
  `email-provider-router.service.ts` + `provider-pacer.ts` are the shape an
  SMS provider router copies — there are already two email providers.

**What is actually missing.** A Twilio client in the M18 stub-mode pattern
(empty credential ⇒ log, don't send), an `SmsDispatchService` mirroring
`EmailDispatchService`'s create-then-update ledger path, SMS added to the
`OPERATIONAL` and `INFORMATIONAL` channel lists, and short bodies for the
three templates that matter. `seller_notification_preferences.smsEnabled`
already exists and defaults `false` — NOTIF-15 pulled the control off the
screen because nothing read it; this is what makes it real again.

**Effort: a week** done properly — per-message cost is real money, so the
throttle in §5 lands with it, not after. **Three days** for a narrow first
version: out-for-delivery and delivery-failed only, English only, no customer
preference.

WhatsApp is probably the better channel for both markets and the enum value is
there — but it needs template approval from Meta, which is a lead time rather
than an effort. Ship SMS, then add WhatsApp behind the same `allowed` list.

---

## 2. Put the GSTIN on the invoice

**In plain terms:** we have issued 17 tax invoices with the GSTIN field
blank. An Indian GST invoice must carry the supplier's GSTIN.

`InvoiceService` reads it at `invoice.service.ts:524` —
`gstin: map.get('invoice.gstin') ?? null` — and
`system_settings.invoice.gstin` is `''` in production **(prod)**. The `??`
does not catch an empty string, so the invoice renders with nothing where the
number belongs. 17 invoices exist **(prod)**.

There is no code to write; the field is admin-editable on `/settings`.
Whether the 17 already issued need reissuing is a question for whoever files.
While on that screen: `invoice.company_name`, `invoice.address` and
`invoice.state` all fall back to hard-coded defaults in the same method
("Skydrop Logistics Pvt Ltd", "Bengaluru, Karnataka, India") — check they are
the real ones.

**Effort: minutes.**

---

## 3. Make the seller API key do something

**In plain terms:** a seller can go to their settings, mint an API key, copy
it — and there is nothing they can call with it.

`ApiKeyGuard` (`apps/api/src/common/guards/api-key.guard.ts:66`) is written,
hardened and correct. It was audited on 30 Sep 2026 and given a scope system
(`common/auth/seller-api-key-scopes.ts`) whose *ceiling is the absence of a
scope* — none reaches the wallet, the bank account, the team or the keys
themselves. Its own docblock states the position: *"nothing in the codebase
carries `@UseGuards(ApiKeyGuard)`"* (lines 13 and 62).

**The store twin is already live and is the template.** `StoreApiKeyGuard`
guards `POST /store-api/v1/orders`
(`reseller-order/controllers/store-api-order.controller.ts:52` — the whole
controller is 94 lines). A reseller store can integrate programmatically;
the seller who owns the stock cannot.

**What is missing:** a `/seller-api/v1/*` controller carrying
`@UseGuards(ApiKeyGuard)` over the order-create, order-read and stock-read
paths that already exist for the JWT. The scopes (`orders:read`,
`orders:write`, and so on) are already declared and already resolve to
permissions through one function.

**Commercially** this is the difference between onboarding a seller who runs
a Shopify store in an afternoon and onboarding one over a week of CSV
uploads. It is also a dead-end workflow today — a seller mints a credential
and nothing happens — which is the same shape as the stock-adjustment
approval queue that had a writer and no reader.

**Effort: a day.** Zero production keys exist **(prod)**, so there is no
migration and nobody to break.

---

## 4. Keep the proof of delivery

**In plain terms:** when a customer says the parcel never arrived and the
courier says it did, the signature and the delivery photo settle it. We can
fetch them. We never keep them, and Delhivery eventually deletes theirs.

`DelhiveryDocumentService` exists and already fetches four document types —
EPOD, signature, RVP-QC photos, seller-return image. Its docblock makes the
argument for this item better than I can:

> This is the evidence layer. ... settling it decides who absorbs the loss,
> the seller or Skydrop. ... an EPOD chased six months later may simply be
> gone. That is an argument for pulling and storing them on our side ...
> **which is the natural follow-up once a dispute workflow exists.**

That prerequisite has landed. TKT-1 tickets, the scrap/damage flow and RS-7
store disputes are all built.

**Already there:** the fetch service; the three columns —
`shipments.podSignatureSpacesKey`, `podPhotoSpacesKeys`, `podRecipientName`
(schema:4142–4144); and CUR-6's AWB-label pattern, which is exactly this shape
(fetch from the courier, upload to Spaces, record a row, judge the file by its
bytes not its Content-Type). **Missing:** a post-commit hook on the DELIVERED
transition that fetches and uploads, plus an hourly catch-up sweep for the ones
that fail — the pair CUR-6b already built for labels, reusable wholesale.
**Measured:** 0 of 69 shipments hold any POD **(prod)**; 19 orders are
delivered and 8 tickets are open.

Mind the courier asymmetry `docs/courier-parity.md` records: Delhivery holds
four documents, Shiprocket one (the POD), and a signature request to
Shiprocket is refused by name rather than answered with the POD. Store what
each courier actually has.

**Effort: a day.**

---

## 5. Enforce the notification throttle

**In plain terms:** CLAUDE.md says we throttle messages per recipient. We do
not.

The rule is written down under "Notification rules (general)" #2: *"Throttle
per (recipient, template). Check `notification_logs` before send; mark
THROTTLED if limit exceeded."* The scaffolding is all there and none of it is
wired:

- `NotificationStatus.THROTTLED` exists in the enum. `grep` finds **zero**
  uses anywhere in `apps/` or `packages/`.
- `notification_templates.maxPerRecipientPerHour` and `maxPerRecipientPerDay`
  (schema:5117–5118). Zero readers.

This is the RBAC-1 shape again — a documented rule, scaffolding that looks
like enforcement, nothing checking. It has not bitten yet because volume is
low (**prod**: 572 in-app and 284 emails ever sent). It becomes load-bearing
the moment SMS lands and each message costs money, or a sweep starts looping
— ATT-1 records one that cycled on a seven-hour loop for two days.

**Missing:** a count query in `NotificationLedgerService.enqueue` before the
row is written — it is already the single gate, where the retired-template and
no-address checks sit — and a `THROTTLED` row instead of a send. Default both
columns to NULL (no limit), so nothing changes until somebody sets one.

**Effort: hours.** Do it with §1, not after it.

---

## Cheap wins — under a day each

Each is a column, a service or a switch that already exists.

- **`invoice.gstin`** and the three other invoice identity settings (§2).
  Minutes.
- **`wallet.cod_collection_fee_percent` is 0%** **(prod)** — a priced product
  lever sitting at zero. WAL-5 was amended so the COD fee and the Instant Pay
  fee are independent charges, each with its own wallet direction, P&L line
  and refund-on-reversal, and a combined cap refused at 100%.
  `pricing.flat_fee_gst_percent` is 0 too, but that one is a tax decision.
- **"Test this courier login"** — `courier_credentials.lastTestedAt` /
  `lastTestResult` (schema:4750) have no writer, though
  `ShiprocketApiProbeService`, COST-2b's credential-free egress preflight and
  the `/courier-accounts` screen all exist. Today a stale courier password is
  found by the 02:40 sync failing.
- **Label print count** — `awb_labels.printedCount` / `lastPrintedAt`
  (schema:4482–4483), 0 of 3 stamped **(prod)**. SCAN-1 catches a duplicate
  label at the *second scan*, with a blocked operator; a counter catches it at
  the printer.
- **`shipments.firstScanAt`** (schema:4057) has no writer. "We handed it over
  and the courier never scanned it" is the gap between CUR-4's handover scan
  and TRK-10's stalled-tracking sweep — and TRK-10 ages off `updatedAt`, which
  rule 4b warns is reset by any write to the row (the nightly cost sync, for
  one). `firstScanAt` is the honest column.
- **`notification_templates.preferredProvider`** (schema:5114) has no reader
  and there are now two email providers behind
  `email-provider-router.service.ts`. One line to honour it.
- **Cancel a broadcast mid-send** — `notification_broadcasts.cancelledByStaffId`
  has no writer and `NotificationStatus.CANCELLED` exists. NOTIF-12 made the
  preview honest about who a broadcast will reach; there is still no stop
  button on a send to four thousand people.
- **`seller_bank_change_requests.requestedBySellerUserId`** has no reader. Who
  asked for a bank-account change belongs on the row that authorised it.
- **Switch reseller orders on for one real seller.** `reseller.orders_enabled`
  is global-`false` with one override, on the QA seller **(prod)**. The gate is
  deliberate ("after one clean end-to-end run") — so do the run.
- **Decide about at-placement stock holds.** R5's early reservation is fully
  built, seller `/holds` screen included, and
  `inventory.early_reservation_enabled` is `false` globally with no overrides
  **(prod)**. A product decision, not a build.

---

## Worth deleting

Deleting is a feature. Each of these is live code or live rows that nothing
reads, and every one is a thing a future reader will believe.

**The zone/slab pricing estate.** Pricing went flat on 2026-08-01 and
CLAUDE.md says so: *"The rate-card / zone-matrix / surcharge tables still
exist and are no longer read by anything."* Production still holds **1 rate
card, 180 rate-card items, 3 surcharge rules, 12 zone-matrix entries,
27 pin codes** and 0 seller-pricing rows **(prod)**. Worse,
`apps/api/src/modules/pricing/services/zone-resolver.service.ts` is still in
the tree and is still the only reader of `zone_matrix_entries` — while
`pricing.module.ts:25` says *"`ZoneResolverService` is gone with the
zone/slab pricing it served."* The comment describing the deletion outlived
the file, which is the failure shape `phase-1a-debt.md` opens with. Delete
the service, the models and the seed rows in one change.

**Retry columns that duplicate BullMQ.** `outbound_webhook_deliveries`'
`nextRetryAt`, `scheduledAt`, `parentDeliveryId` and `responseHeaders`, plus
`courier_webhooks.nextRetryAt` — no readers. The schedule lives in BullMQ,
which is right; a second copy is a source of truth waiting to disagree.

**`agent_call_settings.totalCallsToday` / `confirmedTodayCount`.** No reader
and — more importantly — **no writer either**, so a per-agent productivity
report must be derived from `call_attempts`. Filling these in would create the
second source of truth the rest of this codebase works to avoid.

**`couriers.api_base_url`.** No reader. The real switch is the
`courier.<code>_api_base_url` setting, and `docs/live-pilot-plan.md` already
has to say out loud that *"`couriers.api_base_url` is NULL for both and is
**not** the switch"* — a column needing a disclaimer will be read by mistake.
Same for `supportsRto`, `supportsWeightDispute`, `defaultServiceTypes` and
`logoSpacesKey`; `maxDeclaredValueInr` is the one of the six worth keeping, as
a cheap pre-booking guard.

**`shipments.hasIssue`** — superseded by `system_issues`, which is addressed,
severity-ranked and self-clearing. A boolean nobody maintains reads as "no
problem". **`ops.call_max_attempts`** — dead since Module 7 replaced it with
`ops.call_max_attempts_before_ndr`; documented as dead, still in the seed.
**`packages/types` / `i18n` / `utils`** — README-only, nothing imports them,
and `phase-1a-debt.md` already says "They are not a plan"; the one real
translation table lives in `apps/track/src/lib/i18n.ts` and belongs there.

**One stale comment to fix rather than delete:** `schema.prisma:6095`, above
`RtoItemCondition`, still reads "disposition is RESTOCK/WRITE_OFF only".
There are four dispositions.

Low-value unread columns, listed rather than argued: `orders.confirmedById`,
`gst_withholdings.withheldAt`, `pack_box_scans.scannedAt`,
`pin_codes.lastVerifiedAt`, `stock_batches.sellerBatchRef`, the six
`latitude`/`longitude` pairs on addresses, tracking events and delivery
attempts (deliberate — TRK-8 keeps coordinates out of the public projection,
live GPS is Phase 2), and `call_queue_entries.previousAgentIds` / `priority` /
`assignmentMethod` (documented FIFO deferrals, set on all 47 rows by their
defaults and read by nothing).

---

## One thing to look at that is not a feature

**22 HIGH `money` system issues and 11 MEDIUM are open right now (prod)**,
plus 3 integration, 2 courier-cost-sync, 1 HIGH integration and 1 courier
portal challenge. `docs/live-pilot-plan.md` finding B4 makes the point
already: *"The issue board is too noisy to notice a new problem. ... The
pilot's stop rule reads this board, so it has to start close to empty."* Most
of what is in this document is worth less than clearing that board, because
every watchdog in the system reports into it.
