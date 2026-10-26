# Integrate Solustation Address into Skydrop: new order page (brief for Skydrop's Claude Code)

Goal: a **new copy of the order creation page** with live address checking from
**Solustation Address**. The existing order page is **not modified at all**. When the
new page is proven, it replaces the old one by a flag flip, and the old one stays
available for instant rollback.

Targets: new page usable by Talha/ops on production (behind a flag) by **Thu
2026-10-29**; flip for everyone by **Sun 2026-11-01**.

Solustation Address is our own service (same company) but a separate product with its
own API. Treat it like an external API: call it only over HTTPS, never import its
code, never read its database, never touch its files or services on the server.

---

## 1. How to build it (non-negotiable)

- **Copy, don't edit.** Create the new page as a copy of the current order creation
  page: new route (for example `/orders/new-v2`), new components/controller/handler
  copied from the old ones, then change only the copy. The old page's files, routes
  and handlers stay byte-for-byte unchanged.
- Shared backend code that both pages use (order model, order service, validators):
  do not change its behaviour for the old page. Add new things (columns, functions,
  a job) alongside; don't alter existing ones.
- **Feature flag `ORDER_PAGE_V2`**, stored where Skydrop keeps flags or settings:
  - `off`: the new route returns 404 / is hidden (default on first deploy);
  - `staff`: visible only to admin/ops accounts (Talha tests here);
  - `all`: everyone who could use the old page is sent to the new one (the old
    route redirects to the new one; the old page code remains, unused).
- Rollback is setting the flag back. Keep the old page code for at least 2 weeks
  after `all`, then remove it in a separate PR.
- Orders created on the new page are marked with `created_via = "order_page_v2"` (new
  column) so they can be compared with old-page orders.
- Ship through Skydrop's normal PR/CI/deploy flow, with tests. Database changes are
  additive only (new nullable columns / new table), so the old page keeps working.

## 2. Connection

- Base URL: `https://address-api.solustation.site` (behind Cloudflare). Always this
  public URL, even though both run on the same server.
- Header: `Authorization: Bearer <key>` from env `SOLADDR_API_KEY`.
  - Production: the `sa_live_…` key. Talha sets it in Skydrop's production env;
    never commit it, log it or send it to the browser.
  - Development/tests: the `sa_test_…` key (never billed, same responses).
- **All calls go from Skydrop's backend.** The browser talks only to Skydrop's own
  endpoints (add small proxy endpoints for the page). The key never reaches the
  browser.
- Timeout **3 s** per call. Rate limit 20 requests/second per key (`429` with
  `Retry-After`). Log `X-Request-Id` from responses together with Skydrop's order id
  on errors.

## 3. What the new page does

### 3a. Pincode typed → instant autofill (free)

`GET /v1/pincode/{pincode}` → `valid`, `district`, `state`, `sub_districts`,
`post_offices[]`, `serviceable` per courier. Not billed.

- Invalid pincode (`"valid": false`): show it at once on the field.
- Fill district and state (read-only, "from pincode").
- Offer the post offices as a dropdown (optional for the operator).
- Debounce: call only when 6 digits are entered; cache per pincode for the session.

### 3b. "Check address" (one billable call per order)

When the address and pincode are filled in (a "Check address" button, or on blur of
the address field, debounced), call `POST /v1/validate`:

```json
{
  "reference_id": "<see below>",
  "address": "<full written address, 3-500 chars>",
  "pincode": "743383",
  "landmark": "<landmark if entered separately; omit otherwise>",
  "payment_type": "cod"
}
```

- `payment_type`: `cod` or `prepaid`.
- **Only these fields.** Unknown fields are rejected (`422`). **Never send the
  customer's name, phone, email or anything else.**
- `reference_id`: a draft id generated when the page opens (e.g. `draft-<uuid>`),
  stored with the order when it is saved. One draft id per order form: billing is
  one unit per `reference_id` per month, so do not generate a new id per check.

Show on the page:

| Field | Show as |
|---|---|
| `validity_score` | 0–100 badge (always present) |
| `recommended_action` | `approve` (green), `confirm_with_customer` (amber), `reject` (red) |
| `status` | `valid` / `needs_review` / `invalid` |
| `issues[]` | list of `{code, message}` under the address |
| `suggestions[]` | `{field, candidates, reason}`; each candidate one click to apply |
| `extracted` + `field_source` | the filled-in parts (post office, police station, district…), marked "from customer" / "from pincode" / "inferred" |
| `post_office_confidence` | `high` / `medium` / `null` (only `high` is safe for the label) |
| `completed_address` | "Suggested label address", shown only when `post_office_confidence == "high"` |
| `rto_risk` | **only when `rto_risk_status == "shown"`**; otherwise show nothing or "Return risk: not enough data yet". Today it is always `model_not_ready`. Never compute or guess a number. |

### 3c. Address edited after a check → `POST /v1/corrections` (free)

The same `reference_id` within a month returns the **stored** result, so re-sending
`/v1/validate` after an edit would show the old answer. After the first check, every
re-check of an edited address goes to:

```json
{
  "validation_id": "<from the first check>",
  "source": "operator_fixed",
  "address": "<edited address>",
  "pincode": "<pincode>",
  "landmark": "<optional>"
}
```

The response is the re-validated result (not billed). Show it like 3b. Use
`"source": "customer_confirmed"` when the operator ticks "Confirmed with customer"
(below).

### 3d. Saving the order

- Save exactly as the old page does, plus new nullable columns on the order (or a
  separate table keyed by order id): `soladdr_validation_id`, `soladdr_reference_id`,
  `soladdr_status`, `soladdr_action`, `soladdr_score`, `soladdr_po_confidence`,
  `soladdr_result` (JSONB, the full last response), `soladdr_checked_at`,
  `created_via`.
- **Never block saving because of the API.** If it is down, timed out or errored,
  save the order anyway with `soladdr_status = "unavailable"`; a background job
  retries the check (with backoff, max ~6 tries over an hour) using the same
  `reference_id`.
- Behaviour by `SOLADDR_MODE` (env, default `shadow`):
  - `shadow`: show everything, but saving behaves exactly like the old page.
  - `enforce`:
    - `reject` (invalid pincode / not serviceable): saving needs an ops override
      with a reason;
    - `confirm_with_customer`: saving needs the "Confirmed with customer" box ticked
      (which sends a correction with `source: "customer_confirmed"`), or the order
      goes to an "Address check" queue;
    - `approve`: save normally.

  Ops can always override; store who overrode and why.

### 3e. Courier label

Use `completed_address` on the label only when `post_office_confidence == "high"`;
otherwise keep the customer's own address. Never drop the customer's original text
from the order.

## 4. Errors

- Timeout, network error, `5xx` → "Address check unavailable" on the page, order still
  saveable, background retry. Never treat an error as `approve`.
- `422` → our request is wrong: log as a bug, don't retry.
- `401`/`403` → key problem: alert, don't retry in a loop.
- `429` → wait `Retry-After` seconds, retry.

## 5. Courier status feedback (trains the model)

For every courier status event on an order that has a `soladdr_validation_id` (only
orders from the new page, so the old flow is unaffected), send from a background job
with retries:

```json
POST /v1/feedback
{
  "validation_id": "<soladdr_validation_id>",
  "courier": "delhivery",
  "awb": "<AWB>",
  "status": "delivered",
  "ndr_reasons": ["<courier's NDR text, if any>"],
  "event_time": "2026-10-28T11:04:00+05:30"
}
```

- `status`: delivered → `delivered`; NDR / failed attempt → `ndr`; RTO initiated or
  returned → `rto`; picked up / in transit / out for delivery → `in_transit`;
  cancelled → `cancelled`; lost/damaged → `lost`.
- `event_time` must include a timezone offset. Returns `202`; duplicates are ignored,
  so resending is safe. Never block the status update on this call.
- No names or phone numbers in `ndr_reasons`.

## 6. Tests and done-criteria

- Unit tests with a mocked HTTP client: approve, confirm_with_customer, reject,
  timeout (→ unavailable + retry), 5xx, 422, 429 with `Retry-After`, an edited address
  going to `/v1/corrections`, and an assertion that the request body sent to
  `/v1/validate` has **exactly** the allowed keys (no name/phone/email).
- A test that the old order page's route/handler is unchanged (or at least still
  passes its existing tests untouched).
- One manual end-to-end check with the **test** key on a dev machine.
- Done for Thursday: `ORDER_PAGE_V2=staff` on production; Talha creates real orders
  on the new page; score, issues and suggestions show within a second or two; edits
  re-check via corrections; saving works when the API is unreachable; courier status
  changes of those orders produce `202` feedback calls; the old page behaves exactly
  as before.

## 7. Flip plan

1. Deploy with `ORDER_PAGE_V2=off`, `SOLADDR_MODE=shadow`.
2. `staff`: Talha and ops use it for real orders for 1–2 days.
3. `all` with `SOLADDR_MODE=shadow`: everyone on the new page; nothing is blocked.
4. `SOLADDR_MODE=enforce` when Talha decides (target Sun 2026-11-01).
5. Rollback at any step: set the flag back (`staff` or `off`).
6. Two weeks after a stable `all`: separate PR removing the old page.
