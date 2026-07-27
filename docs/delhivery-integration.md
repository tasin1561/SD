# Delhivery B2C — integration contract + gap analysis

Working document for the real-mode Delhivery integration. The raw captured
portal text lives in [`vendor/delhivery-b2c-api-raw.md`](./vendor/delhivery-b2c-api-raw.md);
this file is the distilled contract plus what Skydrop still has to build.

Captured 2026-07-27 from <https://one.delhivery.com/developer-portal/documents/b2c>.

---

## 1. Transport basics

| Thing | Value |
|---|---|
| Staging host | `https://staging-express.delhivery.com` |
| Production host | `https://track.delhivery.com` |
| Auth header | `Authorization: Token <token>` |
| Token lifetime | **Static, never expires.** Separate token per environment. |
| Content type | `application/json` except shipment-create (see the quirk below) |

**The create-payload quirk.** Shipment creation does *not* take a plain JSON
body. It takes a form-style body:

```
format=json&data={"shipments":[...],"pickup_location":{"name":"..."}}
```

**Forbidden characters** in the raw JSON body: `&`, `#`, `%`, `;`, `\`. Use a
URL-encoded payload when any field could contain them — recipient addresses
routinely do (`#` in flat numbers, `&` in company names). This is a real
data-loss risk for us: Indian addresses commonly contain `#`.

## 2. Rate limits (enforced by AWS WAF — breach returns **403**, not 429)

| API | Limit / 5 min / IP |
|---|---|
| Pincode serviceability | 4 500 |
| Heavy-pincode serviceability | 3 000 |
| **Bulk waybill fetch** | **5** |
| Single waybill fetch | 750 |
| Shipment create | 20 000 |
| Shipment edit / cancel | 12 200 |
| **Tracking** | **750** |
| Shipping label | 3 000 |
| E-waybill update | 250 |

Two of these bite immediately: **tracking at 750/5min** (our poll worker must
batch — the API takes up to 50 waybills per call) and **bulk waybill at 5
requests/5min** (so the waybill pool must be filled in large infrequent
batches, not on demand). A 403 requires backing off ~30s before the WAF
re-evaluates.

## 3. Endpoint map

| Capability | Method | Path |
|---|---|---|
| Pincode serviceability | GET | `/c/api/pin-codes/json/?filter_codes={pin}` |
| Expected TAT | GET | `/api/dc/expected_tat` (origin_pin, destination_pin, mot, pdt, expected_pickup_date) |
| Bulk waybill fetch | GET | `/waybill/api/bulk/json/?count={n}` (≤10 000; ≤50 000 per 5 min) |
| Single waybill fetch | GET | `/waybill/api/fetch/json/?token={token}` |
| **Shipment create** | POST | `/api/cmu/create.json` (body `format=json&data={…}`) |
| Shipment edit | POST | `/api/p/edit` |
| Shipment cancel | POST | `/api/p/edit` with `{"waybill":"…","cancellation":"true"}` |
| E-waybill update | PUT | `/api/rest/ewaybill/{waybill}/` |
| Tracking | GET | `/api/v1/packages/json/?waybill={awb}&ref_ids={orderId}` (≤50 AWBs) |
| Shipping cost | GET | `/api/kinko/v1/invoice/charges/.json?md=&ss=&d_pin=&o_pin=&cgm=&pt=` |
| Shipping label | GET | `/api/p/packing_slip?wbns={awb}&pdf=true&pdf_size=4R\|A4` |
| Pickup request | POST | `/fm/request/new/` (pickup_time, pickup_date, pickup_location, expected_package_count) |
| Warehouse create | POST | `/api/backend/clientwarehouse/create/` |
| Warehouse edit | POST | `/api/backend/clientwarehouse/edit/` |
| NDR action | POST | `/api/p/update` — `{"data":[{"waybill":"…","act":"RE-ATTEMPT"}]}` |
| NDR action status | GET | `/api/cmu/get_bulk_upl/{UPL_ID}?verbose=true` |
| Document download | GET | `/api/rest/fetch/pkg/document/?doc_type={t}&waybill={awb}` |

## 4. Status vocabulary (what tracking + webhooks actually emit)

Delhivery reports a **StatusType** (the journey leg) and a **Status** (the
stage). The pair is what must be mapped, never the Status alone — `In Transit`
means opposite things under `UD` and `RT`.

| StatusType | Meaning |
|---|---|
| `UD` | Undelivered — forward leg in progress |
| `DL` | Delivered — a terminal (`Delivered`, `RTO`, `DTO`) |
| `RT` | Return to origin leg |
| `PP` | Reverse **pickup pending** (before collection) |
| `PU` | Reverse **picked up**, moving to the client |
| `CN` | Cancellation |

| StatusType | Status | Meaning |
|---|---|---|
| UD | Manifested | Soft data pushed; not yet collected |
| UD | Not Picked | Not physically collected from our warehouse |
| UD | In Transit | Moving to the destination city |
| UD | Pending | At destination DC, not yet out for delivery |
| UD | Dispatched | Out for delivery to the customer |
| DL | Delivered | Accepted by the customer |
| RT | In Transit | Converted to a return, moving back |
| RT | Pending | At the DC nearest origin |
| RT | Dispatched | Out for delivery back to us |
| DL | RTO | Returned to origin |
| PP | Open / Scheduled / Dispatched | Reverse pickup lifecycle before collection |
| PU | In Transit / Pending / Dispatched | Reverse shipment moving back to us |
| DL | DTO | Delivered to origin (reverse complete) |
| CN | Canceled / Closed | Reverse request cancelled / closed |

**NSL codes** (`NSLCode`, e.g. `X-UCI`, `EOD-74`) are a finer-grained reason
code under each status. Delhivery's own advice: *do not* expose them raw —
many NSLs map to one customer-visible state. They matter to us for NDR
eligibility (below).

## 5. Webhooks — what the docs actually say

- Configured by emailing a **Webhook Requirement Document** to
  `lastmile-integration@delhivery.com` with our **endpoint URL and
  authorization details**.
- **Scan push and document push are separate webhooks** and cannot share one
  endpoint.
- Payload (default shape):

```json
{
  "Shipment": {
    "Status": {
      "Status": "Manifested",
      "StatusDateTime": "2019-01-09T17:10:42.767",
      "StatusType": "UD",
      "StatusLocation": "Chandigarh_Raiprkln_C (Chandigarh)",
      "Instructions": "Manifest uploaded"
    },
    "PickUpDate": "2019-01-09 17:10:42.543",
    "NSLCode": "X-UCI",
    "Sortcode": "IXC/MDP",
    "ReferenceNo": "28",
    "AWB": "XXXXXXXXXXXX"
  }
}
```

- **A failed scan push is retried once, immediately, and then dropped
  forever.** There is no manual re-push. The Track API is the only recovery
  path for a missed scan.

> ### ⚠️ This broke an assumption in the M10 build — FIXED in D5
> `TRK-1` verified webhook auth as **HMAC-SHA256 over the raw bytes**, failing
> closed. Delhivery does not sign payloads — *we* nominate the authorization in
> the requirement document. Against the real Delhivery **every webhook would
> have 401'd**, and silently: a rejected webhook is indistinguishable from one
> that never arrived.
>
> Now: the scheme is per-courier (`tracking.webhook_auth_scheme[.<courier>]`),
> SHARED_SECRET for Delhivery, HMAC still the default so a missing setting
> cannot weaken auth, both still failing closed. And because a failed scan push
> is dropped forever, the poller is no longer a nice-to-have — it is the
> correctness backstop, so it now treats an in-body `Success: false` as the
> failure it is.
>
> **Action required from us:** the authorization written in the requirement
> document must match the value in `TRACKING_WEBHOOK_SECRET_DELHIVERY`, and
> the header name must match what the public webhook controller reads.

## 6. NDR actions

`POST /api/p/update` with `act` = `RE-ATTEMPT` or `PICKUP_RESCHEDULE`.
Asynchronous — returns a **UPL ID**, whose outcome is then polled via
`/api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`. Max 1 000 waybills per call.

Eligibility is strict and NSL-gated:

- `RE-ATTEMPT` — current NSL must be one of
  `EOD-74, EOD-15, EOD-104, EOD-43, EOD-86, EOD-11, EOD-69, EOD-6`,
  the package must be in `Pending`, and the attempt count must be 1 or 2.
- `PICKUP_RESCHEDULE` — current NSL must be `EOD-777` (RVP QC fail) or
  `EOD-21` (pickup cancelled, non-OTP), status `Canceled` (`CN`).
- Both should be fired **after 21:00 IST**, once the day's dispatches close.

So an NDR retry is not "call the API and hope" — we must read the current NSL
first and only act when the shipment is genuinely eligible, or we generate
noise and failures.

## 7. Serviceability — the docs contradict our CUR-5

Delhivery's FAQ: *"Do we need to check serviceability before order creation?
**Yes, this is mandatory and recommended for every shipment.** If the pincode
is not serviceable there is no point creating the order — it will be marked
NSZ and returned."*

Our `CUR-5` deliberately made serviceability **reactive** (let the AWB
rejection be the signal). That was the right call against a stub; against the
real network it means knowingly manifesting parcels that will bounce, at our
cost. Serviceability should become a **pre-flight check at order confirm**,
with the reactive path kept as the fallback for races.

## 8. Build status (D1–D7 complete, 2026-07-27)

| Capability | State |
|---|---|
| Transport, auth, rate limiting | ✅ verified against production |
| **Live-write guard** | ✅ `courier.delhivery_live_writes_enabled`, default OFF |
| Serviceability | ✅ embargo + per-payment-mode + COD cap + ODA |
| Expected TAT | ✅ verified (Delhi→Bangalore surface = 5 days) |
| Shipping cost | ✅ verified (₹176.29 for 1500g COD on that lane) |
| Tracking + poller | ✅ incl. the HTTP-200-with-`Success:false` trap |
| Webhook auth | ✅ per-courier; SHARED_SECRET for Delhivery |
| Scan mapping | ✅ keyed on the (StatusType, Status) pair + EOD-* NDR |
| Waybill pool | ✅ bulk pre-fetch, settle delay, SKIP LOCKED claim |
| Warehouse registration | ✅ create/edit, exact-name guard |
| Shipment create | ✅ full documented payload, pooled waybill |
| Shipment edit / cancel | ✅ with the conversion + status rules |
| Label | ✅ 4R/A4 |
| Pre-flight serviceability | ✅ replaces CUR-5's reactive posture |
| Pickup requests | ✅ per warehouse per day |
| NDR actions | ✅ NSL-gated, async UPL + status poll |
| Document download | ✅ EPOD / signature / QC / seller-return |
| E-waybill | ✅ + the ₹50k threshold predicate |
| MPS multi-box | ✅ master/child planning |
| RVP QC 3.0 | ✅ payload builder; refuses the silent-downgrade limits |
| Real-cost margin check | ✅ margin vs what Delhivery actually charges |

**Not yet wired into the order flow:** these are capabilities on the
adapter. Deciding *when* the system calls pickup/NDR/e-waybill/MPS/QC —
and surfacing them in the admin UI — is orchestration work on top.

**Still genuinely unknown** (needs Delhivery, not code): the exact
`failureReason` vocabulary behind NDR codes, and whatever custom payload
shape they configure if we ask for one.

## 9. Open items that need Delhivery, not code

1. **Staging token + client ID** from the BD/SPOC contact.
2. **Webhook requirement documents** (scan push, and separately EPOD / sorter
   image / QC image) emailed to `lastmile-integration@delhivery.com` — this is
   what turns webhooks on, and it fixes our auth scheme, so it should be
   filled in with the header we intend to verify.
3. **Pickup-location registration** for the Indian warehouse(s) — either via
   the warehouse API or by BD; the exact registered name is then load-bearing
   in every create call.
4. **RVP QC question mapping** (client question ID ↔ Delhivery question ID) if
   doorstep quality checks are wanted.
5. **Production token**, issued only after staging testing is signed off.
