# Delhivery webhooks — what we asked for and what we answer with

Status as of 2026-08-25: the four requirement documents are filled and
ready to send. **Nothing has been provisioned at Delhivery's end yet**,
so the only thing arriving today is nothing: production has received zero
webhooks since the endpoint was built.

Delhivery provisions each push SEPARATELY and will not accept one URL
with a type in the body, so there are four documents and four endpoints.

## The four endpoints

| Push | Endpoint | Handler |
|---|---|---|
| Scan (status) | `POST /public/tracking/webhooks/delhivery` | M10 `WebhookIngestService` → BullMQ processor |
| EPOD | `POST /public/tracking/documents/epod/delhivery` | `CourierDocumentIngestService` |
| Sorter image | `POST /public/tracking/documents/sorter-image/delhivery` | same |
| QC image | `POST /public/tracking/documents/qc-image/delhivery` | same |

All four are `@Public()`, IP-throttled, and authenticated identically.

## Authentication: SHARED_SECRET, not HMAC

`tracking.webhook_auth_scheme.delhivery = SHARED_SECRET`, so the header
value is compared to the secret in constant time rather than verified as
an HMAC over the body.

This is a deliberate accommodation, not the default — the default is
`HMAC_SHA256`, and the code falls back to it whenever the setting is
absent, so a missing row cannot silently weaken authentication. Delhivery
configures a STATIC key/value header per client; they do not compute a
signature over the payload. A scheme we specify and they cannot implement
is a scheme that ends with the endpoint being opened up under time
pressure on go-live day.

- Header: `X-Skydrop-Signature`
- Secret: env `TRACKING_WEBHOOK_SECRET_DELHIVERY`, referenced from
  `tracking.webhook_secret_ref.delhivery` (CUR-1 discipline — the secret
  in env, the pointer in the database)
- `Bearer ` / `Token ` prefixes are tolerated, because we dictate the
  header in the requirement document and an operator may well write it
  either way.

**The secret is sent to Delhivery out of band, never in the document.**
The filled forms carry the header KEY and a placeholder for the value.

## Why we did not ask them to whitelist our IP

Their form offers it. We declined: the endpoint is public and
authenticates on the header, and pinning their source IPs at our edge
buys defence in depth at the cost of every scan silently failing the day
they add a PoP. Their published production ranges are recorded in the
documents if we ever change our mind.

## Response time

Measured 2026-08-25, 300 samples over the public internet:
P50 66 ms, P99 270 ms end-to-end; server-side processing P99 22 ms.
Their budget is 500 ms, after which they time out and we lose the scan.
The margin is almost entirely network, so if it ever tightens the lever
is the region, not the handler.

## What the document push does with what arrives

The point is CUSTODY. Delhivery serves these images from URLs that
expire, and an EPOD chased six months after a dispute may simply be gone
— which is exactly when it is wanted. So the bytes are copied into our
own bucket at the moment they exist.

- Verify FIRST, store second (TRK-1). An unauthenticated payload is
  refused and never written: a table anyone can append to is not
  evidence.
- Never throws at the courier. A 500 gets retried, and a retry storm
  because our Spaces credentials expired is worse than a missing image —
  the raw payload is in `courier_webhooks` either way, so a failed store
  replays from the ledger.
- The row is written even when the file cannot be, carrying the reason.
  "They sent an EPOD and we failed to keep it" and "they never sent one"
  are different facts and only one is somebody's job.
- A payload that is a URL rather than bytes is RECORDED, not fetched.
  Fetching a courier-supplied URL from inside a webhook handler is an
  outbound request to whatever they name — the SSRF shape
  `common/net/ssrf-guard.ts` exists for. Their own sorter spec calls the
  field "base64 URL", so this is not hypothetical.
- Field names are theirs and inconsistent even within their own
  documentation (`waybill` / `Waybill` / `waybillId` across the three),
  so they are read case-insensitively across the known aliases. The MIME
  is sniffed from the bytes rather than trusted: a wrong extension makes
  the file unopenable exactly when it is needed.
- Upsert on `(courierCode, awbNumber, docType)` — a re-send updates the
  row it already has.

## Still open

- **The escalation matrix** in all four documents carries `<FILL: name>`
  and `<FILL: phone>` markers. The email (`support@skydrop.online`) is
  real; the names and numbers are not ours to invent.
- **No admin screen shows a stored document yet.** We keep EPODs and QC
  images and there is nowhere to look at one. Worth a link on the order
  detail panel once the first real document arrives — until then there is
  nothing to render.
- **The scan payload's field naming is still theirs to confirm.** Two
  `TODO(delhivery-api)` markers remain on exactly this: the webhook
  payload field/header naming and the NDR `failureReason` vocabulary.
  Delhivery settles both when they provision from these documents.
