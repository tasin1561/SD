# Skydrop — Courier Escalation System (Delhivery first)

**Status:** verification complete (2026-08-05), no implementation started.
**Amended:** 2026-08-05, from the verification findings. Amendments are marked
`[AMENDED 2026-08-05]` so the difference between what was assumed and what was
verified stays visible rather than being quietly absorbed.

---

## Goal

Sellers report shipment problems in the Skydrop app and converse with Delhivery
support **without a human relaying messages**. Delhivery's replies come back into
the same thread. The system fixes what it can via official API, files/answers
support tickets for the rest, and falls back to a human ops queue when needed.

Message text is **passed through verbatim in both directions**. Sellers write
English. No rewriting, no translation. The seller should feel they are chatting
directly with a Delhivery agent.

---

## Verification findings (2026-08-05)

The four items that gated this build. Three could not be verified live; the
blockers are recorded here rather than left as assumptions.

### ① Tracking API shape — NOT VERIFIED, two independent blockers

- **No `D1_REST_TOKEN`** exists in the repo or the droplet `.env` (which holds
  only `COURIER_CREDENTIALS_KEY_V1` and `TRACKING_WEBHOOK_SECRET_DELHIVERY`).
  One live `courier_credentials` row does exist — PRODUCTION, `fieldNames:
  ["apiToken"]`, key version 1 — and that key IS in the droplet env, so the
  token is recoverable via `CourierCredentialService`.
- **Even with the token, the item is only half-answerable.** Production holds
  **zero shipments carrying an AWB** and **zero pooled waybills**. The `Scans`
  array shape and any attempt-count field only materialise on a consignment that
  exists in Delhivery's system with scan history. A bogus AWB confirms auth and
  the documented HTTP-200-with-`Success:false` trap and nothing more.

Known from `docs/delhivery-integration.md` (captured 2026-07-27 from the live
developer portal, NOT readme.io): `GET /api/v1/packages/json/?waybill={awb}
&ref_ids={orderId}`, ≤50 AWBs/call, 750 calls/5 min, `Authorization: Token
<token>`. NSL is `NSLCode` (`EOD-74`, `X-UCI`) — a sub-code beneath the
`(StatusType, Status)` pair.

**On the attempt count — the most consequential finding of the four.** We do not
read an attempt count from Delhivery anywhere. `CourierShipmentActionService
.latestAttempt()` derives it from **our own** `delivery_attempts.attemptNumber`,
and takes the NSL from our own stored `delivery_attempts.courierNslCode`. So the
answer to "does the field exist, or must it be derived by counting failed-delivery
scans" is: **today it is derived, from webhook-built rows.** That is a cached
value — see the fresh-NSL rule below.

**Resolution:** step 2 of the sequence. The operator runs the decrypt and the
tracking call by hand and pastes the JSON back. **Do not route around the sandbox
classifier that blocks an automated decrypt-and-call.**

### ② NDR API — matches the assumption, from a 2026-07-27 capture

Only `RE-ATTEMPT` and `PICKUP_RESCHEDULE`. Asynchronous — returns a UPL ID,
polled at `/api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`. ≤1000 waybills/call.
After 21:00 IST. The NSL gates are already encoded in `delhivery-ndr.service.ts`
(8 EOD codes for re-attempt; `EOD-777`/`EOD-21` for pickup reschedule).

Rate limits captured, with the detail that matters: **the limiter is AWS WAF and
returns 403, not 429** — back off ~30s. NDR is not named in that table; its
neighbours are shipment edit/cancel at 12,200 and e-waybill at 250 per 5 min,
tracking at 750, and bulk waybill fetch at **5 per 5 min**.

Not re-fetched today — the portal page needs an interactive login.

### ③ Consignee edits — VERIFIED, and already implemented

Name/phone/address are the Shipment Updation API: `POST /api/p/edit`, fields
`name` / `phone` / `add`. Cancel is the same endpoint with `cancellation:
"true"`. `DelhiveryShipmentEditService` implements both, with the state gate
(never on Dispatched / Delivered / DTO / RTO / LOST / Closed).

**`DEFER_DLV` has NO REST equivalent.** `[AMENDED 2026-08-05]` It is absent from
the captured contract and from the code. It may simply not exist in the REST
surface. **Deferred delivery routes to the ticket path. Do not keep hunting for
an API for it.**

### ④ MCP — NOT re-tested, blocked external dependency

No `D1_MCP_URL`, no Keycloak client id or secret anywhere: repo, droplet env, or
session. The `404 Realm does not exist` for realm `ucp-V6IMWCLJOOFT` cannot be
re-checked from here.

`[AMENDED 2026-08-05]` **Treat this as a blocked external dependency, not a
task.** Build the MCP reader behind the adapter so it activates when provisioning
lands, and degrade cleanly while it does not. Do not block any phase on it.

### Production state found while verifying

| Fact | Value | Consequence |
|---|---|---|
| `courier.delhivery_api_base_url` | `https://track.delhivery.com` | **REAL MODE**, not stub |
| `courier.delhivery_live_writes_enabled` | `false` | writes shut — this is what holds production safe |
| `courier.delhivery_waybill_pool_refill_enabled` | `false` | pool cannot refill |
| `courier.delhivery_origin_pincode` | `""` (empty) | TAT + cost lookups have no origin |
| `courier_accounts` | 0 rows | CACC-1 routing has nothing to route to |
| shipments with an AWB | 0 | nothing to track, nothing to re-attempt |
| pooled waybills | 0 | no consignment can be created |
| `docs/delhivery-go-live-test.md` | "not yet performed" | no real write has ever happened |
| droplet timezone | **UTC** | see the scheduling rule below |
| `apps/workers` | built, **NOT deployed** | workers run inside `skydrop-api` |

---

## Known constraints (verified)

- **No ticketing write API exists.** Delhivery One MCP is read-only ("write and
  update operations will be available in a future release"). There is no
  ticketing endpoint in the Express REST API. Ticket notification emails do not
  accept inbound replies.
- Therefore ticket **creation and replies** happen only via (a) a human in the
  ops console, or (b) browser automation of `one.delhivery.com`.
- **NDR API rules:** package must be in pending status; NSL code must be in the
  allowed set; **attempt count must be 1 or 2**; apply **after 21:00 IST**
  (= 21:30 Asia/Dhaka) so NDR AWBs are back in facility and dispatches closed.
  Asynchronous — returns a UPL ID that must be polled.
  `[AMENDED 2026-08-05]` The original brief said "attempt count ≤ 2". The code's
  `1–2` is correct and stays: a zero-attempt parcel has nothing to re-attempt.
- **Portal rules:** ticket dedup is roughly per `(awb, category)`; max 10 AWBs
  manual or 500 via CSV; creation may be async (results land in Tasks); Resolved
  tickets can be reopened by commenting within **48 hours**, then Closed forever.
- **Nine issue categories** exist (Reattempt/Delay, Shipment not delivered (need
  POD)/Fake remark, Self collect/drop, Damage/Missing/Mismatch, Update shipment
  details, Cancel delivery/pickup, Claims/Finance, Protect VAS, Behaviour
  complaint against staff). Available categories vary per shipment state.

---

## Architecture

```
Problem detected (seller report | tracking webhook)
  ├─ eligible for official API  → NDR / cancel / shipment-update  → done
  └─ otherwise                  → Escalation (ticket)
                                    → outbox → router → AUTO or HUMAN
```

Three write modes, switchable at runtime:

| Mode | Behaviour |
|---|---|
| `MANUAL` | All writes to ops queue. Portal worker idle. |
| `SUPERVISED` | Worker prepares action, holds for one-click approval, then executes. |
| `AUTO` | Worker executes unattended, except locked categories. |

`Claims / Finance` and `Protect VAS` are **hardcoded human-only** and cannot be
added to the auto list.

`[AMENDED 2026-08-05]` That lock is enforced **by category ID, never by label
string** — and the IDs are unknown until the taxonomy has been fetched once
(blocked with ④). **Until then `auto_categories` ships EMPTY**, which is the only
safe initial state: an empty auto list means nothing executes unattended, so the
unenforceable lock cannot be violated.

### Where an escalation lives `[AMENDED 2026-08-05]`

**An escalation hangs off an existing `Ticket` (R7). Do not create a parallel
seller-facing entity.** `TicketType.SELLER_RAISED_ISSUE` already IS "seller
reports a parcel problem, ops works one queue", with append-only `ticket_events`,
a state machine, and wallet-linked refunds via `SCRAP_REFUND` (TKT-1). The
escalation is the **courier-facing half of that same conversation** — a new
`courier_escalations` row with an FK to `tickets`, not a second inbox for the
seller to check.

---

## Build phases

Build one phase at a time. Stop and report at each checkpoint. Do not scaffold
later phases early.

### Phase 1 — Official API tier (no browser, zero ToS risk)

Highest value, lowest risk, ~60% of ticket volume.

`[AMENDED 2026-08-05]` **The REST client is already ~90% built** — 21 services in
`courier-delhivery` cover tracking, NDR + the NSL gate, edit/cancel, rate
limiting, the write guard, the waybill pool, labels, serviceability, TAT, cost,
documents, e-waybill, MPS and RVP QC. **Phase 1 is orchestration only.** Do not
rebuild the client.

What is genuinely missing:

- **Nightly batch runner at 21:35 Asia/Dhaka** — collects eligible AWBs, submits
  NDR actions, stores UPL IDs.
- **UPL poller** — every unpolled UPL is treated as failed. Failures requeue to
  the ticket path next morning.
- **Reconciliation job** — compare "reattempt requested" against "new attempt
  scan appeared in tracking". Alert if the delta exceeds a threshold; this is
  what catches Delhivery accepting calls and silently not acting.

**NDR eligibility filter**: NSL in allowed set AND attempt count 1–2 AND pending
status.

**Fresh-NSL rule `[AMENDED 2026-08-05]` — scoped, not global:**

- **The nightly runner re-fetches tracking per AWB immediately before
  submitting.** A stale NSL means submitting actions Delhivery rejects, which
  pollutes the UPL results and leaves the reconciliation job unable to
  distinguish *"Delhivery ignored a valid request"* from *"we sent an invalid
  one"* — and that distinction is the only thing that detects silent failure.
  At ≤50 AWBs per call and 750 calls per 5 min, the refetch is free.
- **Interactive operator-triggered actions keep reading the cached
  `delivery_attempts` row.** A human just looked at the shipment; a second
  network round-trip buys nothing.

This is a change to EXISTING code (`CourierShipmentActionService.latestAttempt`
is the current, cached-only path), not purely new code.

**Scheduling — the one thing not to get wrong.** The droplet is **UTC** and no
existing queue passes `tz`. The nightly runner **must** set `tz: 'Asia/Dhaka'`
explicitly, or it fires at 03:35 Dhaka instead of 21:35 — which would present as
"Delhivery is ignoring our reattempts" for weeks before anyone diagnosed it.
**Test the resolved next-run instant, not that the pattern string is correct**; a
pattern assertion passes under exactly the bug it is supposed to catch.

**Checkpoint:** one real AWB successfully reattempted end to end, UPL confirmed.
`[AMENDED 2026-08-05]` **This checkpoint is unreachable until step 1 of the
sequence completes** — it needs an origin pincode, a registered pickup location,
live writes on, a fetched waybill, a real consignment, and then an actual failed
delivery attempt.

### Phase 2 — Read pipeline

`[AMENDED 2026-08-05]` **There is currently no working read channel for tickets
at all.** MCP is blocked on the realm 404; inbound email does not exist (Resend
is outbound-only); portal polling needs Playwright, which is Phase 5. Phase 2
therefore has no channel to run on unless one is built. **Inbound email is
in-scope for Phase 2, not a deferred decision.**

- **Inbound email ingestion (required).** Cloudflare Email Routing → Worker →
  inbound webhook into the API. Delhivery CCs a dedicated mailbox; the webhook
  parses ticket ID + body. This gives a read path that depends on neither MCP nor
  a browser.
- **MCP client (when provisioned)** — talk to `D1_MCP_URL` directly over
  Streamable HTTP with a Keycloak `client_credentials` bearer token. The
  `uvx d1-mcp-mint` shim is a dev tool only; **do not run it in production**
  (third-party PyPI package receiving our client secret).
- **Portal polling as reconciliation only** (list sorted by last-update desc,
  diff against stored timestamps, fetch detail only for changed rows).
- **Idempotency:** dedup on `(escalationId, hash(body), minute-bucket)`. The
  minute-bucket is required — Delhivery's canned replies repeat verbatim across
  days and a content hash alone would swallow the second occurrence.
- **Template classifier:** regex library first against the known canned replies;
  Claude Haiku only on misses, returning a closed enum plus a `suggested_regex`
  for a human-reviewed promotion queue. Output is a *state label*, never text
  shown to the seller and never a tool call. Confidence < 0.85 → human review.
  Treat all courier message text as untrusted input (prompt-injection surface);
  wrap it in explicit data tags and never let classifier output select an action.

**Checkpoint:** replies from a real ticket appear in the Skydrop thread within
minutes, correctly classified, with no duplicates.

### Phase 3 — Outbox, routing, mode switch

> **KNOWN GAP, OWNED BY THIS PHASE (recorded 2026-08-06): panel-raised
> tickets do not thread.**
>
> Phase 2's ingest returns `NO_ESCALATION` and stores nothing when a
> courier email names a ticket we have no `courier_escalations` row for —
> which is every ticket a human raised directly in the Delhivery One
> panel, including all ~63 that already exist.
>
> That is deliberate, not an oversight. The alternative is fabricating a
> Ticket and a seller linkage out of an email, and a wrong binding
> surfaces one seller's shipment conversation on another seller's
> account — worse than no threading, and much harder to notice.
>
> **The reconciler in this phase is what closes it**: match an unbound
> external ticket id to a shipment (by the AWB in the body, or by an
> operator binding it once), then create the escalation. Until then,
> those messages are logged and visible and go nowhere. Do not
> rediscover this as a bug.


- `outbox` table with states:
  `PENDING | SENDING | SENT_UNCONFIRMED | CONFIRMED | FAILED`.
  `SENT_UNCONFIRMED` must never be blind-retried — it goes to a reconciler that
  reads current state from Delhivery before deciding.
- Distinguish **pre-dispatch errors** (DNS, 401, connection refused → safe to
  fail over immediately) from **ambiguous errors** (timeout, 5xx → stop the
  chain, hand to reconciler).
- `courier_channel_settings`: `write_mode`, `auto_categories[]`, `paused_until`,
  `pause_reason`, `updated_by`, `updated_at`.
- **Route at pickup time, never at enqueue time**, so flipping the mode does not
  leave a mis-stamped backlog.
- **Auto-pause is a separate field from the operator's chosen mode.** Canary
  failure or circuit-breaker open sets `paused_until`; it must not overwrite
  `write_mode`. On recovery the system returns to the chosen mode.
- **Audit `[AMENDED 2026-08-05]`: there is no `courier_action_log`.** Two partial
  trails are worse than one, and every courier action already writes to
  `audit_logs`. Add a **`request_fingerprint`** column to `audit_logs` and record
  actor / channel / op / awb / external_id / outcome in the existing metadata.
  Log the fingerprint, **not** the payload. Redact `Authorization` in every HTTP
  logger and error reporter.

**Checkpoint:** mode toggle works; jobs route correctly; no double-sends under
induced timeouts.

### Phase 4 — Ops console (the `MANUAL` consumer)

Must make a queue item ~20 seconds of work:

- AWB, order, seller, category
- Exact message text with a copy button
- Deep link to `one.delhivery.com/support/<ticketId>` (or the order page for new
  tickets)
- "Mark sent" → sets `SENT_UNCONFIRMED`, **not** `CONFIRMED`
- Paste-back field to bind a newly created ticket ID to the escalation
- `[AMENDED 2026-08-05]` **Operator notification goes through the M11
  notification ledger.** No Telegram — it was imported from an unrelated project
  and there is no Telegram surface anywhere in this codebase. A new outbound
  channel would mean a new secret and a delivery path beside the ledger rather
  than through it.
- Short claim lease (~10 min) so a human and the worker cannot both act

**The tick is set by read-back, never by a human or the worker asserting
success.** If "Mark sent" is clicked but nothing was pasted, the next poll must
return the item to the queue.

### Phase 5 — Portal worker (the `AUTO` consumer)

Only after Phases 1–4 are stable, and only with separate explicit approval.
`[AMENDED 2026-08-05]` Playwright is currently a **dev/test dependency only**; a
long-lived production Chromium is a new runtime dependency and a new process
class.

> **PHASE 5 GATE — the process split must land first.** `@skydrop/workers`
> deployed, `WORKERS_ENABLED=false` on the API (SCALE-1), verified by the
> `worker-role.spec.ts` discipline plus a live check that exactly one process
> owns the queues. A long-lived Chromium holding a decrypted portal login must
> not run inside the process serving customer HTTP. Scheduled between Phase 3
> and Phase 5; Phase 5 does not start until it is done.

- Long-lived Playwright process, persistent `storageState`, real Chromium.
- **Serial execution, one job at a time.** Randomised 20–90s human-shaped gaps.
  There is no throughput pressure (~30 items/day) — spend it on looking normal.
- Page objects: `TicketList`, `TicketDetail`, `RaiseTicketModal`.
- **Read the thread before writing.** If the message is already present, return
  `ALREADY_PRESENT` and do not post. This is what makes timeouts safe.
- After writing, read back and confirm before returning `CONFIRMED`.
- Raise-ticket modal is **schema-driven**, not nine hardcoded flows. Fetch and
  cache Delhivery's category/subcategory taxonomy as JSON, keyed on stable IDs
  (never label strings), diff it nightly, alert on change. Handle all four
  outcomes as normal (not errors): new ticket, already exists, not eligible,
  task pending.
- Handle attachments — damage and fake-remark cases depend on photos.
- On login challenge (OTP/captcha): freeze the queue, alert via the ledger, do
  not attempt to defeat it.
- **Nightly canary at 03:00 Asia/Dhaka** (set `tz` explicitly): full round trip
  on a real AWB (raise → read → comment → verify → resolve). Any failure
  auto-disables the write channel and falls back to the ops queue.
- **Kill switch**: DB-backed, admin page, one click, no deploy, 2FA.

**Rollout within Phase 5:** shadow mode (prepares and logs, executes nothing) →
`SUPERVISED` on reattempt only → widen `auto_categories` one at a time → `AUTO`.

---

## Layout and reuse `[AMENDED 2026-08-05]`

Reuse, do not introduce:

| Need | Reuse | Note |
|---|---|---|
| Queue + cron | BullMQ (18 queues, 17 workers), `repeat: { pattern }` | must pass `tz`; every new worker calls `WorkerRoleService.shouldStart()` (SCALE-1) |
| Delhivery REST | `courier-delhivery` (21 services) | ~90% of Phase 1's client already exists |
| Credentials | `CourierCredentialService` (CUR-1, decrypt-with-audit) | no second secret path |
| Seller entry point | R7 `tickets` + `SELLER_RAISED_ISSUE` | escalation FKs a ticket |
| Admin RBAC | `courier.ops.view/write`, `tickets.view/resolve` | ops console inherits page gating + the CI permission audit |
| Audit | `audit_logs` + a new `request_fingerprint` column | not a second log table |
| Operator notification | M11 notification ledger | not Telegram |

New, kept as small as it can be: a leaf `courier-escalation` module holding
`courier_escalations` (FK ticket, awb, category **id**, external ticket id,
channel state), `courier_escalation_messages` (append-only, both directions,
carrying the `(escalationId, hash(body), minute-bucket)` key),
`courier_outbox` (the five states), `courier_channel_settings`, and
`courier_issue_taxonomy` (cached, ID-keyed).

`CourierSupportAdapter` goes in **`courier-shared`** so `courier-delhivery` can
implement it without a module cycle — the R3 shape this codebase already uses
four times.

### Adapter interface

Write `CourierSupportAdapter` now, with one Delhivery implementation. Delhivery
has committed to shipping MCP write operations; when they land, swapping one
channel implementation must take the manual queue to zero with no other rework.

```ts
interface CourierSupportAdapter {
  capabilities(): CapabilityFlags;
  getTaxonomy(ctx?: { awb: string }): Promise<IssueCategory[]>;
  raiseTicket(req: RaiseTicketRequest):
    Promise<TicketRef | AlreadyExists | NotEligible | TaskPending>;
  getThread(ticketId: string): Promise<Message[]>;
  postComment(ticketId: string, body: string, attachments?: Attachment[]): Promise<void>;
  listUpdatedSince(ts: Date): Promise<TicketSummary[]>;
  reattempt(awb: string): Promise<ActionRef>;
  editConsignee(awb: string, patch: ConsigneePatch): Promise<ActionRef>;
}
```

---

## Cross-cutting rules

**Secrets `[AMENDED 2026-08-05, RESOLVED]`.** Every **courier** secret goes into
`courier_credentials` under **CUR-1** — AES-256-GCM envelope encryption, the key
in env as `COURIER_CREDENTIALS_KEY_<version>`, decrypt only via
`CourierCredentialService`, and an `audit_logs` row written BEFORE plaintext is
returned. Plaintext is never logged, never serialized into a response, never
cached beyond 5 minutes.

The brief originally said *"courier credentials live only in the worker process
env — never in the DB."* **That is superseded: CUR-1 wins, and it extends to new
secrets rather than being grandfathered.** Envelope encryption is strictly better
than raw env for this class of secret — it has a rotation path (versioned keys,
two live simultaneously), a per-use audit trail, and no plaintext sitting in a
process dump or a crash report. So:

| Secret | Home | Why |
|---|---|---|
| Delhivery API token | `courier_credentials` (CUR-1) | courier credential |
| Portal login (Phase 5) | `courier_credentials` (CUR-1) | courier credential |
| MCP client secret | `courier_credentials` (CUR-1) | courier credential |
| Inbound-email webhook secret | **env** | app infra, not a courier credential — same class as `TRACKING_WEBHOOK_SECRET_DELHIVERY` |

No migration is required; the existing token is already correct.

The unchanged half of the original rule still holds: **no courier secret is
reachable from any Next.js app or a Next.js server action**, and secrets are
excluded from backup archives.

**Process separation `[AMENDED 2026-08-05, RESOLVED]`.** `apps/workers` is built
(`apps/api/src/workers-main.ts` boots the same `AppModule` with no HTTP listener)
but **not deployed** — pm2 runs only `skydrop-api`, `skydrop-admin`,
`skydrop-seller`, `skydrop-track`, so all 17 workers run inside the HTTP-serving
API process.

- **NOT a Phase 1 blocker.** Credentials already live in the HTTP process today.
  That is the status quo, not a regression this project introduces.
- **HARD PREREQUISITE FOR PHASE 5.** A long-lived Chromium must not run inside
  the HTTP process. Deploying `@skydrop/workers` with `WORKERS_ENABLED=false` on
  the API (SCALE-1) is a **Phase 5 gate**, scheduled between Phase 3 and Phase 5.

**No LLM in the tool-call path.** Claude classifies and labels. TypeScript
decides and acts. Model output must never select a tool or an argument.

**CUR-10 as amended (2026-08-05).** A physical-world courier call is
operator-triggered, **or fired by a runner whose write channel an operator
explicitly enabled** — behind the live-write guard, the per-category auto list,
and the kill switch. A lifecycle transition and a customer-facing handler remain
forbidden triggers. **CUR-11 is untouched:** whatever a runner fires, the
courier's own scans remain the sole authority on order status.

**Deliverables.** Complete, ready-to-run files only — never diffs or partial
snippets. Do not remove or regress existing features; only add or fix.

---

## Do not

- Do not build the portal worker before Phases 1–4 work.
- Do not use `d1-mcp-mint@latest` in production, or any floating version.
- Do not hardcode Delhivery category label strings — use their IDs.
- Do not auto-file Claims/Finance or Protect VAS tickets under any mode.
- Do not blind-retry a `SENT_UNCONFIRMED` write on any channel.
- Do not set `CONFIRMED` without a read-back from Delhivery.
- Do not attempt to defeat captchas or bot detection.
- Do not translate or rewrite seller or courier message text.
- `[AMENDED 2026-08-05]` Do not route around the sandbox classifier that blocks
  an automated credential decrypt + outbound call. The operator runs it by hand.
- `[AMENDED 2026-08-05]` Do not schedule any Dhaka/IST-relative job without an
  explicit `tz` — the droplet is UTC.
- `[AMENDED 2026-08-05]` Do not add a Telegram channel, a second audit table, or
  a parallel seller-facing escalation entity.

---

## Sequence

Work in this order. Stop and report at each numbered step.

0. **Fix `CLAUDE.md`** — stub-vs-real mode, `apps/workers` status, wire-contract
   validation date. First, because a stale `CLAUDE.md` corrupts every future
   session. Then apply these brief amendments and the CUR-10 change. ✅ **DONE
   2026-08-05.**
1. **Go-live readiness** — `courier.delhivery_origin_pincode`, a registered
   pickup location, `courier_accounts`, waybill pool refill. Run
   `docs/delhivery-go-live-test.md`. Worth doing on its own merits: the API base
   URL already points at production while none of this is configured.
2. **One real consignment with scan history**, then the read-only tracking call.
   The operator runs the decrypt and the call and pastes the JSON back. This is
   what finally closes verification item ①.
3. **Phase 1 orchestration** — nightly runner, UPL poller, reconciliation job.
4. **Phase 2** — inbound email ingestion, read pipeline, classifier.
5. **Phases 3 and 4** — outbox, mode switch, ops console.
6. **Process split** — deploy `@skydrop/workers`, set `WORKERS_ENABLED=false` on
   the API. Worth doing on its own merits (SCALE-1 horizontal headroom); a hard
   gate for step 7.
7. **Phase 5** — Playwright. Separate explicit approval, after 1–6 are stable.
