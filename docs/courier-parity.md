# Delhivery vs Shiprocket — what actually works, per capability

Audited 2026-09-09 by reading the dispatchers (which are the per-courier
switchboard, CUR-12) and the production database, not by reading older
docs. Every "✅ live" below was exercised against the real API.

---

## The one thing to read first

**Delhivery is carrying real parcels. Shiprocket is not carrying
anything.** Its account is provisioned and its booking contract is
proven — a real AWB was issued and cancelled on 2026-09-09 — but
`Courier.isActive` is FALSE, the base URL is empty and live writes are
off, so under CUR-16 no new parcel can route to it.

Everything below is about what WOULD work the day those switches flip.

## Capability matrix

| Capability | Delhivery | Shiprocket | Notes |
|---|---|---|---|
| Book AWB at order confirmation | ✅ live, 11+ real AWBs | ✅ contract proven, intake off | Shiprocket takes TWO calls (create order, then assign); Delhivery one |
| Store courier's parcel id | ✅ `courierShipmentId` | ✅ `courierShipmentId` | |
| Store courier's ORDER id | n/a — one number | ✅ `courierOrderId` | added 2026-09-09; their portal searches on it |
| Fetch label | ✅ | ✅ | Shiprocket returns a URL, Delhivery a PDF; the dispatcher hides the difference |
| Cancel a shipment | ✅ | ✅ **verified live** | |
| Serviceability check | ✅ | ✅ **verified live** | reactive only (CUR-5); not on the critical path |
| Edit consignee on a live parcel | ✅ | ⚠️ partial — consignee yes, description no | MEASURED 2026-09-09: their `update/adhoc` changes the description fine BEFORE a waybill (partial update, other fields preserved) and answers `400 "Order update not allowed"` after one. Our edit path is always post-waybill, so the description genuinely cannot change — but the consignee half is applied and the description reported as unapplied, rather than the whole edit being refused |
| Request pickup | ✅ | ✅ | per (courier, warehouse, day), CUR-10 amendment #3 |
| Register pickup location | ✅ | ⚠️ add only | they have no EDIT; routing an update to `addpickup` makes a SECOND location with the same name, and the name is what every manifest matches on |
| **List** pickup locations | ❌ none | ✅ | `GET /v1/external/settings/company/pickup` — CLAUDE.md said neither had one; that was true of Delhivery and got generalised |
| NDR re-attempt | ✅ async, UPL-polled | ✅ **synchronous** | Shiprocket's reply IS the outcome; leaving it SUBMITTED sent it to a poller that read the missing handle as "the submit produced nothing" |
| NDR list ("who is in NDR") | n/a — read off the NSL scan code | ✅ `/v1/external/ndr/all` | path was wrong until 2026-09-09; the bare `/ndr` 404s |
| Tracking — **poll** | ✅ registered | ✅ registered | both in `COURIER_TRACKING_SOURCES` |
| Tracking — **webhook** | ✅ HMAC | ❌ **NONE** | `TRACKING_WEBHOOK_SECRET_DELHIVERY` is the only secret in the env schema, so a Shiprocket webhook fails closed at 401 |
| POD / documents | ✅ four documents | ⚠️ one | they hold only the POD; a signature or RVP-QC request is refused by name rather than answered with the POD |
| Support tickets (raise/thread/comment) | ✅ via the portal | ❌ all capabilities FALSE | `ShiprocketSupportAdapterService` declares every flag false and throws `CourierCapabilityUnsupportedError` — deliberately, so AUTO mode cannot claim an item and dispatch it into a method that throws |
| Wallet sync (real invoiced cost) | ✅ portal automation | ❌ | `wallet-sync.service.ts` is hardcoded `courier: { code: 'delhivery' }` |
| Wallet reconcile | ✅ | ❌ | `reconcile(courierCode = 'delhivery')` |
| Portal ticket sync | ✅ | ❌ | `sync(courierCode = 'delhivery')` |
| Portal session / canary | ✅ | ❌ | Playwright drives Delhivery's panel only |
| Waybill pool pre-fetch | ✅ | n/a | Shiprocket issues the AWB at assign time; there is no pool to keep full |

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

**Not built, and cheap-ish to build:**

- **Inbound tracking webhooks.** Needs a
  `TRACKING_WEBHOOK_SECRET_SHIPROCKET` env var, a seeded
  `tracking.webhook_secret_ref.shiprocket`, and Shiprocket's own webhook
  configuration pointed at us. Until then Shiprocket tracking is
  POLL-ONLY, which is slower but not broken.
- **Support tickets.** Their API has a ticket surface; our adapter
  declares every capability false. Doing it means implementing the
  interface, not changing anything upstream (CUR-12).

**Not built, and expensive:**

- **Wallet sync, wallet reconcile, portal ticket sync, canary.** All four
  are Playwright driving Delhivery's *panel*, hardcoded to `'delhivery'`.
  Shiprocket's panel is geo-restricted (`docs/shiprocket-integration.md`),
  so any equivalent must run ON the India droplet, not tunnelled — and
  their API may cover some of it without a browser at all. Worth checking
  the API first.

## The consequence worth stating

If Shiprocket were switched on today, a parcel routed to it would be
booked, labelled, picked up, tracked (by polling), cancellable, and its
NDR re-attempts would work. What it would NOT have is a **real cost
figure**: the wallet sync that gives Delhivery its actual invoiced cost
per parcel is Delhivery-only, so the P&L's measured-cost coverage
(TRE-6) would report those orders as uncovered rather than guess.

That is the honest gap to close before volume moves, and TRE-6 already
reports it rather than defaulting to zero — so it fails loudly, which is
the right shape.
