# Load and capacity — can we take full load?

Measured 2026-10-09. Target volume for every calculation: the figure in CLAUDE.md — **30,000 orders a month**
(1,000/day) at a 15–25% return rate.

**Short answer: yes, serving the traffic is not the problem. Storing it is.** At 30,000 orders/month the
database fills in about **nine months** and then stops accepting writes. Nothing else is within 3× of its limit.

Numbers are marked **MEASURED** (I ran it) or **CALCULATED** (arithmetic on measured inputs). Latency and
throughput come from the **local filming stack** (8-CPU laptop running API + Postgres + Redis + 5 web apps) —
never from production, which has live Delhivery writes. Row widths, row counts, connection and scan statistics
are **read-only SELECTs against production**. The droplet is **2 vCPU / 3.9 GB RAM, 1.9 GB free, 7 Node
processes**, roughly a quarter of the laptop; HTTP figures are scaled accordingly and flagged as estimates.

---

## What breaks first

| # | Limit | Headroom at 30k/month | Basis |
|---|---|---|---|
| 1 | **Database disk** — 10 GB, compression impossible | **~9 months, then writes stop** | CALCULATED |
| 2 | **Droplet RAM** — 1.9 GB free | ~1 extra API process | MEASURED |
| 3 | **`courier_wallet_transactions` scans** — O(table), nightly, forever | Fine now; 110 M tuples/night at 10× | MEASURED |
| 4 | **Tracking poll cap** — 10,000 parcels/cycle | Cap reached; degrades gracefully | CALCULATED |
| 5 | **HTTP throughput** — ~25–40 req/s on the droplet | ~5–9× over peak need | MEASURED, scaled |
| 6 | **Per-user rate limit** — 100 req/min | ~2.5× for a fast packer | MEASURED |
| 7 | **Email** — Resend paces at 2/s | ~20×; a broadcast takes 36 min | MEASURED |
| 8 | **DB connections** — 50, 11 used | ~7 more API instances | MEASURED |
| 9 | **Per-seller wallet lock** | ~700× | MEASURED |

Two CLAUDE.md premises were wrong: the connection limit is **50, not 25**, and `stock_movements` is **not** a
fast-growing table.

---

## 1. Database disk — the only thing that runs out

**MEASURED: 36.8 KB of database per order**, from real production rows (`pg_column_size` + 24-byte tuple header
+ each table's own measured index:heap ratio) — not table size ÷ rows, which is inflated up to 500× while tables
are small.

| | rows/order | bytes/order |
|---|---|---|
| `tracking_events` (courier scans) | **29 per parcel** | 10,005 |
| `notification_logs` | ~5 | 10,815 |
| `courier_webhooks` (ours) | 1.2 | 5,608 |
| `audit_logs` (order-related only) | 9.4 | 5,632 |
| orders, items, events, charges, shipments, movements | | 5,646 |

**CALCULATED: 1.07 GB/month** at 30,000 orders (1.05 GB order-driven + a measured 15.7 MB/month independent of
our volume). Production holds **83 MB today**; against 10 GB that is **~9 months**.

**Two rows dominate and both are unbounded.** `notification_logs` keeps the full rendered `body` and `html_body`
of every message ever sent — **1.3 KB a row, under 17 indexes, with no retention or deletion path anywhere in
the codebase.** `tracking_events` is 29 rows per parcel, and that is genuine courier volume, not our own
duplication: count ÷ distinct `(shipment, event_type, event_at)` = **1.02**, a clean negative result.

**Compression cannot help.** CONFIRMED: both hypertables report `compression_enabled = false`, 0 of 5 chunks
compressed. DigitalOcean ships TimescaleDB under the Apache licence and compression is a Community feature.
Growth is linear and permanent.

**Correction:** CLAUDE.md names `tracking_events` and `stock_movements` as "the two fastest-growing tables per
order". Measured, `stock_movements` is **0.7 rows per order** against tracking's 29 — **25× slower**, and not a
concern.

**Symptom:** no warning. The database works perfectly, then refuses every write. Orders cannot be placed and
money cannot be recorded.

**Remedies, cheapest first.**
- **Give `notification_logs` a retention window** — blank `body`/`html_body` past 90 days, keep the row (it is the
   NOTIF-2 dedup gate; only the text needs to go). Exactly what `WebhookPayloadRetentionService` already does for
   courier payloads. Saves ~10.8 KB/order — about **30% of all growth** — for a day's work and no recurring cost.
- **Resize the disk** in the DO panel: in place, brief failover, grows only, so step up rather than jump. Then
   update `capacity.db_storage_gb` — the gauge is only as honest as that number.
- Drop the 680 KB of `audit_logs` indexes that have never been read (§10).

---

## 2. Droplet RAM — the tightest physical constraint

**MEASURED: 3.9 GB total, 1.9 GB available.** Seven pm2 Node processes use 1.6 GB (`skydrop-api` 341 MB,
`skydrop-portal` 282 MB, five web apps ~195 MB each), plus Redis and Caddy on the same box.

The documented way to scale out is a second API process with `WORKERS_ENABLED=false` (SCALE-1). That costs ~350
MB, which fits **once**. A third does not. **Horizontal scaling is capped by droplet RAM, not by database
connections** — the opposite of what SCALE-2 implies.

**Symptom:** swapping, then the OOM killer takes whichever process it picks — possibly the one holding the
BullMQ workers, which stops every sweep in the estate silently.

**Remedy:** resize the droplet (only the API needs duplicating, not the web apps). Moving Redis off-box buys
headroom too — and it holds every delayed job, so losing it costs correctness, not just throughput.

---

## 3. Nightly full table scans that grow forever

**MEASURED**, lifetime counters (never reset, so trustworthy):

| table | rows | seq scans | tuples read |
|---|---|---|---|
| `courier_wallet_transactions` | 43,085 | 293 | **11.1 M** |
| `courier_webhooks` | 2,596 | 1,542 | 3.5 M |
| `audit_logs` | 9,076 | 291 | 2.4 M |

`courier_wallet_transactions` is read end-to-end ~293 times — 37,980 rows per scan on a 43,085-row table. That
is COST-1's "net from the TABLE, not the file", which is correct behaviour; the problem is the table **never
ages out** while the scan is O(table). At 10× courier volume that is 110 M tuples a night.

It is cheap today only because the whole 83 MB database fits in 391 MB of `shared_buffers` — **MEASURED cache
hit rate 100.00%** (330 M hits, 8,810 reads). That stops being true past a few GB, and these scans are where it
shows first.

**Remedy:** index the predicates these sweeps filter on, or give the wallet ledger a rolling window for netting
(the nightly job needs recent transactions; the history is evidence, not input). Not urgent — do it before the
database outgrows RAM.

---

## 4. Tracking poll cap

**MEASURED:** `MAX_SHIPMENTS_PER_CYCLE = 10,000`, every 20 minutes, 50 waybills per courier call.
**CALCULATED:** at 30,000 orders/month with ~7 days forward and ~20% returning over ~3 weeks, about **11,200
parcels are live** — just past the cap.

**It degrades well and does not break.** The query is `orderBy: updatedAt asc` — stalest first — so attention
rotates and parcels above the cap are *delayed*, not skipped (~22 min effective interval at 11,200, ~40 at
20,000). An earlier version had no ordering and polled one arbitrary subset forever; that was found and fixed.
One caveat: `updatedAt` is reset by *any* write to the row, including the nightly cost sync, so unrelated jobs
perturb the rotation — the trap rule 4b already warns about.

**Remedy:** raise the cap and shorten the cron. Both are settings; the real constraint is Delhivery's 750
requests per 5 minutes, of which we use ~7%.

---

## 5. HTTP throughput — not the problem

**MEASURED on the laptop**, counting response codes properly:

| endpoint | queries/req | p50 @ c=1 | p50 @ c=20 | p95 @ c=20 | req/s @ c=20 |
|---|---|---|---|---|---|
| `GET /seller/orders` (50/page) | 7 | 18.6 ms | 167 ms | 215 ms | 106 |
| `GET /admin/orders` (20/page) | 6 | 18.5 ms | 107 ms | 129 ms | 165 |
| `GET /seller/orders/:id` | 20 | 24 ms | — | — | — |
| `GET /public/tracking/:awb` | 8 | 4 ms | — | — | — |

**No N+1 on the lists:** query count is **flat** from `pageSize=20` to `50` (9 → 7). Order detail is a constant
20 queries for one order.

**CALCULATED need.** At 1,000 orders/day and ~43 API calls per order (placement, ~10 call-centre, ~20 warehouse
pick/pack/scan, seller views, customer tracking views, 1.2 courier webhooks — measured): ~43,000 requests/day,
or over an 8-hour day **~1.5 req/s average and ~4.5 req/s at a 3× peak.**

Scaled to 2 droplet cores against the laptop's 8 shared: **~25–40 req/s**, roughly **5–9× the peak need**.
Comfortable, but not the order of magnitude the raw laptop figures first suggested.

**A correction worth recording.** My first sweep reported ~600 req/s. It was wrong: the script's `awk` field
index for ab's "Non-2xx responses" line was off by one, so the error column printed `0` unconditionally and most
of those "requests" were cheap 429s from the rate limiter. The table above is the honest figure. It also
explains an anomaly I nearly reported as a finding — `/health` looking *slower* than the data endpoints, because
`/health` was doing real work while the others were being rejected.

**The database side, separately.** A Prisma pool of **5** (the droplet's `cpus × 2 + 1`) and one of **17**
perform the same on the real order-list query — peaks of 278 and 214 operations/s respectively, both degrading
past c=20. **The connection pool is not a bottleneck**, and sizing it down to the droplet's 5 costs nothing.

---

## 6. Rate limits — correct, with one gap

**MEASURED:** the global default is **100 requests/minute**, reset 60 s, 429 on request #101 exactly.

**It is genuinely keyed per user, not per IP** — verified by exhausting the demo seller's budget and then
succeeding 15/15 as a staff user from the same IP. This mattered to check: the global throttler guard runs
*before* the JWT guard, so `auth-user` silently degrading to the IP was a real possibility, and would have meant
the whole warehouse sharing one bucket. It does not.

**MEASURED coverage:** 730 of 790 routes (92%) keyed per user, 15 explicitly per IP or email, **45 (6%) falling
back to the shared `ip:` bucket**. Among those 45 is `store-api-order.controller.ts` — the reseller store **API-
key order placement** endpoint. A store integrating server-to-server sends everything from one IP and shares 100
req/min with every other caller behind it. Worth a `@ThrottleKey('auth-user')` (the strategy already falls back
to the API key's id) before any store is onboarded at volume.

Both public endpoints are already sized deliberately: courier webhooks at **3,000/min per IP**, with an explicit
comment that a 429 to a courier is a silently missed scan — correct, and ample against ~7/min at target volume;
and public tracking at **30/min per IP**, whose one risk is customers behind a large mobile-carrier NAT sharing
a bucket.

**Per-user headroom.** 100/min is 1.67 req/s, so a packer doing ~20 calls per parcel can manage ~5
parcels/minute against a target need of ~2. About **2.5×** — the thinnest margin after storage, and the one most
likely to surprise someone during a catch-up push.

---

## 7. Email, workers and locks — comfortable

**Email: Resend is paced at 2 sends/second** (`RESEND_MAX_PER_SECOND = 2`, Redis-backed so it holds across
instances) — ~172,000/day against a need of 3,000–9,000. The visible consequence is burst shape, not capacity: a
NOTIF-12 broadcast to 4,312 sellers takes **36 minutes** to drain. Configuring SES raises the ceiling to its
rate.

**Workers: 31 of them, all in one process, and 29 at `concurrency: 1`.** CLAUDE.md says 17 — that count is
stale. Serial execution is deliberate and mostly right, but two sit in front of network calls: `awb-generation`
(a live Delhivery booking) and `tracking-webhook-processing`. At 1,000 bookings/day against a ~2 s courier call,
one worker gives ~0.5/s ≈ 43,000/day. Comfortable — but it is a single serial queue on 2 shared cores, and it is
where a courier slowdown becomes a backlog.

**Locks: not a constraint.** MEASURED on `pg_advisory_xact_lock` — **same key** (one seller's wallet, serialised
per WAL-7): **268 tx/s** peak against a need of ~0.35/s, about **700×**. **Distinct keys** (different sellers):
**522 tx/s** and still scaling. One behaviour to know: at 50 concurrent writers on a *single* wallet, throughput
collapses to 94 tx/s with a p99 of 746 ms — a thundering herd. It needs 50 simultaneous money writes against one
seller, which will not happen, but that is the shape if it ever does.

**Connections: 50, not 25.** MEASURED `max_connections = 50`, `superuser_reserved = 3`. Of 24 rows in
`pg_stat_activity` only **11 are client backends** (5 `skydrop-api`, 5 `skydrop-portal`, 1 DO agent); the other
13 are Postgres and TimescaleDB background workers, which do **not** consume connection slots. So **11 of 47
usable — room for ~7 more API instances**, and RAM (§2) binds long before connections do. Also **0 idle-in-
transaction** and **0 deadlocks** lifetime: no transaction leaks.

Note `CapacityService.databaseMetrics()` counts all of `pg_stat_activity` against `max_connections`, so it over-
reports — it would show 24/50 today rather than 11/47.

---

## 8. Already a problem today, at 26 real orders

Not capacity issues — things already broken that volume will multiply.

1. **7 courier webhooks have sat unprocessed for 27 days.** Status `received`, all Shiprocket, 12–13 September —
   exactly the rows TRK-11 was written about. The watchdog works: `webhooks-unprocessed` is open, HIGH, **251
   occurrences**. Nobody has acted in 251 hourly sweeps. Seven customer scans were received, authenticated, durably
   stored and never applied.
2. **40 open system issues, 22 of them HIGH money** — 16 `courier-recharge-unrecorded` on one Delhivery account, 2
   Delhivery invoice disagreements, and `pnl-close-provisional:2026-09`, which means September's carry-forward
   detection is skipped until someone locks the month.
3. **`fee-fx-rate-stale` has fired 466 times over 19 days.** Nothing fetches FX automatically, so BDT fees convert
   at a rate nearly three weeks old — and PRC-8 makes that a money problem, not a display one.
4. **The 90-day webhook retention sweep has never blanked a row.** The oldest `courier_webhooks` row is 30 days
   old, so it has had nothing to do and will not act until ~2026-12-08. Given this codebase's history with
   machinery that had never executed (TRK-11, LBL-1, LBL-4), treat "retention works" as **untested** — especially
   as it is the model for the `notification_logs` fix in §1.
5. **97% of `courier_webhooks` are not ours** — 2,515 of 2,596 are Shiprocket scans for parcels we do not carry,
   ~13 MB/month regardless of our volume.
6. **Write amplification:** `shipments` carries **23 indexes**, `orders` 20, `notification_logs` 17 — one shipment
   insert is 24 writes. Several `shipments` indexes are on overwhelmingly-NULL columns (`pick_expires_at`,
   `label_printed_at`, `rto_initiated_at`, `supersedes_shipment_id`): partial indexes would cut write cost and disk
   together.
7. **43% of `audit_logs` index space is never read** (680 KB of 1.6 MB — `pkey`, `severity_created_at`,
   `actor_type_actor_id`, `staff_user_id` all at `idx_scan = 0`), on the table with the largest fixed growth rate.
   And `audit_logs` is **95% not order-driven**: `courier.credential.decrypted` alone is 47.5% of 30 days' rows,
   making CUR-1's audit-per-decrypt the largest audit producer in the system.
8. **`work_mem` is 2 MB.** Zero temp files so far only because every result set is tiny; at target volume the P&L
   aggregations and any unindexed sort will spill to disk.
9. **A 2% duplicate-write race on the poll path** — 22 of 941 `tracking_events` are the same scan written twice ~80
   ms apart from one source. Small defect, not capacity.

---

## What I could not measure

- **Actual disk free, and whether the disk is really 10 GB.** Invisible from inside Postgres: `pg_database_size`
   says 83 MB but DO's quota also covers WAL, temp and replica state. **Every runway number in §1 rests on
   `capacity.db_storage_gb = 10`, an admin-maintained guess.** Confirm it in the panel. Relatedly
   `capacity.db_plan_label` says "1 GB RAM / 1 vCPU", while measured `shared_buffers` (391 MB) and
   `effective_cache_size` (1,172 MB) both imply **1.5–2 GB** — a stale label, which is exactly the failure SCALE-3
   warns about, currently applying to its own settings.
- **Droplet HTTP throughput directly.** I will not load-test production, so §5's droplet range is the laptop's
   figures scaled by core count: an estimate.
- **Per-order `notification_logs` rows** — the **largest error term** in the 36.8 KB figure (±8 KB/order).
   Production shows 32.5 rows per order over 30 days, but most is system-issue alerting rather than order
   lifecycle; I used 5. A join on `notification_logs.order_id` would settle it.
- **Anything resting on order volume is a weak sample.** Production has **53 orders total, 26 real**, over 72
   days. The *byte widths* are strong (real rows; `courier_wallet_transactions` at 43,085 rows is the most
   trustworthy figure here). The *rows-per-order multipliers* are weak-to-moderate and will move as the business
   grows.

---

## If you do three things

1. **Give `notification_logs` the retention treatment courier payloads get** — removes ~30% of all growth for a
   day's work and no recurring cost.
2. **Confirm the real disk size and plan in the DO panel**, then fix `capacity.db_storage_gb` and
   `capacity.db_plan_label`. The nine-month runway is only as good as that number.
3. **Clear the 40 open system issues, starting with the 7 dropped scans.** The watchdogs are doing their job and
   nobody is reading them — the failure volume makes worse fastest, and it costs no infrastructure to fix.
