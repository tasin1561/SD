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

## What was wrong before any of this was sent

Five defects, found by attacking the path rather than confirming it, all
silent. Recorded because the shape repeats: **not one of them threw
anywhere we were watching.**

1. **Every real document push was refused.** Express defaults to a 100kb
   body; an EPOD is a photo, base64, a third bigger again. It came back
   as a 500, not a 413, so a courier would have retried forever while we
   chased a phantom fault. The 12MB allowance is scoped to the three
   document routes — granting it globally is a cheap way to exhaust a
   4GB box, because the body is buffered before any guard runs.
2. **The rate limit was a ceiling on our whole tracking throughput.**
   100/min per IP, and Delhivery pushes every one of our scans from a
   handful of fixed IPs. Measured: exactly 100 through, then 429.
3. **Every webhook scan was 5h30m in the future.** Their timestamps
   carry no offset and are IST; unzoned means LOCAL, and our servers are
   UTC. The poller already corrected this and the webhook path did not,
   so one scan had two times depending on how it arrived.
4. **The document controller wrote the shared secret into the database**
   on every push, against CUR-1.
5. **…and the full base64 into `raw_body`**, which on a 10GB managed
   disk is a few weeks of runway for bytes already in Spaces.

A second pass, after those five, found three more — by reading a stored
row and by asking what each guard actually depends on, rather than by
re-reading the code:

6. **The scan webhook persisted the shared secret on every push.** It
   stored the request headers verbatim, and under SHARED_SECRET the
   header VALUE is the credential. The column is called `headers`, the
   value looks like a signature, and nothing about the row says a secret
   is in it. The redaction is now one shared function used by both
   controllers — two copies is how one gets fixed and the other does not.
7. **The document routes never checked the courier registry.** An
   unknown code was refused anyway, but only because the GLOBAL auth
   scheme is HMAC and a static secret fails that format check. That
   evaporates the day someone flips the global setting or onboards a
   second SHARED_SECRET courier. A guard that works by accident is not a
   guard.
8. **The ingest service promised never to throw and did not keep it.**
   Its own comment explains that a 500 makes the courier retry — then it
   wrapped the Spaces upload and left both database calls bare.

Two things were checked and found already correct, which is worth
recording so nobody re-opens them: ten concurrent pushes for one AWB
produce exactly one row (Prisma issues a native upsert, so the
read-then-write race does not exist here), and a real-format scan for an
AWB we do not hold lands `IGNORED` / `NO_MATCHING_SHIPMENT` in 20ms with
no event and no retry.

`main.ts` is the reason the first one survived: the unit suite builds
services directly and the e2e harness builds its own Nest app, so
**nothing in CI executes that file.** `bootstrap-body-limits.spec.ts` is
a structural spec covering it — the only kind of gate that can.

## Response time

Measured 2026-08-25 against production.

- **Scan push**, 300 samples over the public internet: P50 66 ms, P99
  270 ms end-to-end; server-side P99 22 ms. The margin is almost
  entirely network, so if it ever tightens the lever is the region, not
  the handler.
- **Document push**, a realistic 2 MB EPOD, 15 samples: P50 112 ms, max
  161 ms server-side — decode and Spaces upload included. The upload is
  synchronous on purpose: it fits the budget four times over, and
  deferring it would mean holding megabytes in a job payload to save
  nothing.

Their budget is 500 ms, after which they time out and the scan is lost.
**It is not lost for long:** `TrackingPollService` runs every 20 minutes
against their tracking API and fills any gap, so a missed push is a
delay rather than a hole. That backstop does NOT cover documents, which
arrive only by push — a missed one is re-fetched by hand through
courier-ops.

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

## The test that was missing

Every webhook e2e drove flat `DLV-*` stub codes. That exercises our
machinery and says nothing about the payload Delhivery actually sends —
a different shape, a different vocabulary, timestamps in a different
timezone. Precisely the three things that were wrong, and the three
nothing was looking at.

`tracking-flow.e2e-spec.ts` now drives their documented envelope end to
end: the forward lifecycle (In Transit / Dispatched / Delivered on their
real legs, with stock asserted unchanged at DELIVERED), and an `EOD-*`
NSL on a forward leg — where the status itself is an unremarkable
"Pending" and the NSL is the only thing saying a delivery was attempted
and failed. It asserts a 17:10 IST scan stores as 11:40Z, so reverting
the timezone fix fails a test rather than a customer's timeline.

## Still open

- **The escalation matrix** in all four documents carries `<FILL: name>`
  and `<FILL: phone>` markers. The email (`support@skydrop.online`) is
  real; the names and numbers are not ours to invent.
- **No admin screen shows a stored document yet.** We keep EPODs and QC
  images and there is nowhere to look at one. Worth a link on the order
  detail panel once the first real document arrives — until then there is
  nothing to render.
- **Rotate `TRACKING_WEBHOOK_SECRET_DELHIVERY` before sending it.** It
  was being written into `courier_webhooks.headers` in plaintext until
  the fix above, and it was read out of a stored row during that
  investigation. Nothing has used it yet, so rotating costs nothing —
  and the value Delhivery is given should be one that has never sat in a
  database column.
- **The scan payload's field naming is still theirs to confirm.** Two
  `TODO(delhivery-api)` markers remain on exactly this: the webhook
  payload field/header naming and the NDR `failureReason` vocabulary.
  Delhivery settles both when they provision from these documents.
