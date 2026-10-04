# High availability — what fails, what the code already survives, and what to buy

Written 2026-09-27, against production as it stood that day. Every number
below was read from the running system or from the code, not from another
document; where something could not be checked it says **UNVERIFIED** and
says what would settle it.

Companion docs: `docs/disaster-recovery.md` (recovery after a loss, not restated here), `docs/infrastructure.md`, `docs/cloudflare-proxy.md`.

**Two corrections to `docs/infrastructure.md` found while writing this.**
The droplet and the database are in **SGP1 (Singapore)**, not Bangalore —
`curl 169.254.169.254/metadata/v1/region` returns `sgp1`. And that doc's
"Cloudflare — DNS ONLY" paragraph is stale; the proxy went on 2026-08-07
(`docs/cloudflare-proxy.md`) and `ufw` confirms it: 80/443 are open to
Cloudflare ranges only.

---

## 0. What production actually is, measured

| | |
|---|---|
| Droplet | `skydrop-app-prod`, SGP1, 2 vCPU / 3.8 GB RAM + 4 GB swap, 116 GB disk at 16 %, up 26 days, load 0.06 |
| Public IP | `68.183.190.55`, **not a reserved IP** (`metadata/v1/floating_ip/ipv4/active` → `false`) |
| pm2 | six processes, all `online`: `skydrop-api` (4000), `skydrop-portal`, `skydrop-admin` (3002), `skydrop-seller` (3003), `skydrop-track` (3004), `skydrop-reseller` (3005). All bind `127.0.0.1` |
| Caddy | `active`, six site blocks, marketing file-served from `/var/www/skydrop-marketing` |
| Redis | Docker `redis:7-alpine`, `127.0.0.1:6379`, AOF **on**, 22.3 MB used, 692 keys, `maxmemory 0` + `noeviction`, volume `/home/skydrop/redis-data` (3.8 MB), restart `unless-stopped` |
| Postgres | DO managed 18.6, basic tier, **private** VPC endpoint, `max_connections = 25`, `superuser_reserved_connections = 3`, `shared_buffers` 190 MB, **database size 76 MB** |
| Connections now | 22 of 25. **8 are ours** (`doadmin`: 7 idle + 1 active); 14 are DigitalOcean's (`pghoard`, `pg_cron`, two TimescaleDB launchers, `pg_failover_slots`, `management-agent`, 7 unattributed) |
| Prisma pool | `DATABASE_URL` carries **no `connection_limit`**, so Prisma computes `num_cpus × 2 + 1 = 5` per process; two processes hold pools (`skydrop-api`, `skydrop-portal`) |
| Volume | 50 orders ever, 33 in the last 30 days |
| Backups | 24 `system.backup.completed` audit rows in 24 h, latest 11:11 UTC. Cron at `10 * * * *` |

**The system is nowhere near a capacity limit** — 76 MB of data, 0.06
load, 8 of 25 connections. Everything below is about *resilience*, not
load, which is the right time to do it: every step is reversible while
nothing depends on it.

One count in `CLAUDE.md` is stale: there are **36 files constructing a
BullMQ `Worker`** and 38 constructing a `Queue`, not "17 workers".

---

## 1. Single points of failure, ranked

Ranked by likelihood × blast radius. "Recovers" means what happens today
with nobody watching.

### 1. A bad deploy — **most likely, whole estate**
`scripts/deploy.sh` runs on the droplet, in this order: pull → install →
build packages → **`prisma migrate deploy`** → build seven apps → `pm2
restart` → health smoke. The app build has been measured past 10 minutes
(the deploy workflow's `command_timeout` was raised to 14 m on 2026-09-27
for exactly that). So **the new schema is live against the old running
code for the length of the app build**, ~5–12 minutes.

That is safe for an *additive* migration — Prisma generates explicit
column lists, so a column the old client does not know about is simply not
selected. It is **not** safe for `DROP COLUMN` / `RENAME COLUMN` / a new
`NOT NULL` on a column the old code writes as null: every query touching
that table fails for the whole window. 18 of the 206 migrations contain
destructive DDL, so this is a live pattern, not a hypothetical.

Recovers: the health smoke catches a process that will not bind, and exits
non-zero — but it runs *after* the restart, so a migration-shaped
breakage is already several minutes old by then. There is no automatic
rollback. The `.last-deployed-sha` marker (written last, after health)
means a re-run rebuilds rather than falsely reporting success.

### 2. The droplet — **everything, and no automatic recovery**
One box runs Caddy, all six app processes and Redis. Losing it takes every
hostname down. No reserved IP, so restoring onto a *new* droplet needs a
Cloudflare A-record change on six records plus its TTL; restoring the
*same* droplet from a backup keeps the IP. `docs/disaster-recovery.md`
scenario B estimates 15–30 min from a droplet backup, 2–4 h by hand.

Recovers: nothing automatic. pm2 resurrects processes on reboot
(`pm2-skydrop.service` + `~/.pm2/dump.pm2`); the droplet itself does not
resurrect.

### 3. Redis — **whole API, and probably as a hang rather than an error**
Everything BullMQ, every throttle counter, and the lifecycle event
channel. `RedisService` sets `maxRetriesPerRequest: null` (BullMQ requires
it) and leaves ioredis's offline queue at its default, so commands issued
while Redis is unreachable **queue rather than reject**. `AppThrottlerGuard`
is an `APP_GUARD`, i.e. it runs before every non-`@SkipThrottle` handler
and its storage is Redis. The likely symptom of Redis dying is therefore
that **every throttled request hangs** until Redis returns, not that it
500s. That is worse than failing fast: hung requests hold connections and
the load balancer of the future would still see the socket accepted.

**UNVERIFIED** — this is read off the ioredis configuration, not observed.
Settle it by stopping the Redis container on a `local-prod-copy` and
curling an ordinary endpoint; `/health` is `@SkipThrottle()` so it will
answer either way, which is itself part of the problem (see §5).

Recovers: `unless-stopped` restarts the container if it exits, and AOF
means queued jobs survive. Nothing recovers a Redis that is up but wedged.

### 4. The managed database — **whole API, single node**
Basic tier, **primary only, no standby**. A node failure is a DigitalOcean
recovery, not a failover. PITR to any transaction in the last 7 days is
available on this tier (checked in the panel 2026-09-15), so *data* loss
is near zero; *availability* loss is however long DO takes.

Recovers: nothing in the app. Every in-flight HTTP request fails; BullMQ
jobs retry. There is no connection-level retry wrapper — `runWithRetry` in
the stock layer retries a version-CAS conflict, not a dropped connection.

### 5. Caddy — **whole estate, TLS included**
One process, one config file. `caddy validate` before reload is the only
guard and it is a manual step in a runbook. Certificate renewal behind
Cloudflare has still **never been observed** (`docs/cloudflare-proxy.md`
says so, and that is still true): Caddy prefers TLS-ALPN-01, which cannot
complete behind a terminating proxy, and is expected to fall back to
HTTP-01. If that assumption is wrong the site loses TLS at the *next*
renewal with no warning.

Recovers: systemd restarts Caddy. Nothing recovers a failed renewal.

### 6. Cloudflare — **whole estate, by design**
`ufw` allows 80/443 from Cloudflare ranges only, so Cloudflare being down
is Skydrop being down and there is no bypass. That is the accepted price
of the 2026-08-07 decision and it is the right trade — but the rollback
(`/etc/caddy/Caddyfile.bak-precf` + re-opening 80/443) should be in
someone's head, because re-opening the origin also re-opens
`CF-Connecting-IP` forgery against the login throttle.

### 7. The portal worker's Chromium session — **one nightly job**
`skydrop-portal` holds a long-lived Chromium and a decrypted Delhivery
login. Blast radius is small and contained by design: no HTTP, its own
root module, `PORTAL_WORKERS_ENABLED` fail-closed. A crash-loop would be
invisible to users; the deploy script's `pm2 jlist` status check is the
only thing that notices.

### 8. GitHub Actions — **deploys only, and there is a bypass**
`Deploy` runs on `workflow_run` after `CI`, and on `workflow_dispatch`. If
Actions is down, `ssh skydrop bash ~/app/scripts/deploy.sh` still works —
the droplet holds the script. A delay, not an outage.

---

## 2. What the codebase already supports, and what it does not

### 2.1 Survives N API instances — verified

**Postgres advisory locks are transaction-scoped.**
`apps/api/src/common/db/advisory-lock.ts` uses `pg_advisory_xact_lock`
exclusively (`takeAdvisoryLock`, the only helper), which is held to
commit-or-rollback and released by the server. Every one of the 23
namespaces — `WALLET`, `SETTLEMENT_ORDER`, `SHIPMENT_PROVISION`,
`INBOUND_FREIGHT_BILL`, `RESELLER_SET_ASIDE`, `PNL_PERIOD`,
`CUSTOMER_IDENTITY`, the rest — therefore serialises across *processes*,
not just within one. The documented lock order (WALLET → account keys →
`ATTRIBUTION_RECONCILE_KEY`) is a property of the transactions, not of the
process, so it holds unchanged. **This is the single biggest reason
multi-instance is tractable here.**

**The money guards are `updateMany`-claim shaped.** Every one read for
this document claims on the state it read:
`RefreshTokenService.revokeGuarded` (`where { id, revokedAt: null }`,
`.count > 0`), god-mode's `updateMany where { id, status: from }`,
`ManifestService.close` on `status = DRAFT`, the pick/pack expiry CAS on
an exact timestamp. None of these is a read-then-write.

**Rate limiting is Redis-backed.**
`apps/api/src/common/throttler/throttler.module.ts:31` —
`storage: new ThrottlerStorageRedisService(redis.client)`. Counters are
shared; the guard holds no counter state (it stashes the key strategy on
the request object, which is request-scoped).

**Sessions are stateless.** JWT access tokens in browser memory
(`packages/api-client/src/auth/token-store.ts` — per tab, not server
state), refresh tokens as hashed DB rows with a guarded revoke. **No
sticky sessions are needed for auth.**

**There is no Nest scheduler at all.** No `@Cron`, no `@Interval`, no
`SchedulerRegistry`, no `ScheduleModule`. Every `setTimeout` in the tree is
a one-shot abort deadline or a backoff sleep. All recurring work is BullMQ
repeatables, which is the right substrate for this.

**The lifecycle bus is ALREADY Redis pub/sub — `CLAUDE.md`'s NOTIF-5 note
is out of date.** `order-lifecycle-event-bus.service.ts` does not just hold
an rxjs `Subject`. `emit()` checks `handlesEvents` (`= this.role.enabled`,
i.e. `WORKERS_ENABLED`): the worker-owning instance delivers in-process,
and an HTTP-only instance **publishes to the Redis channel
`skydrop:order-lifecycle`** which the worker instance subscribes to. So
the "future Phase-2 swap at this exact seam" described in `CLAUDE.md` has
already been made. Publisher and subscriber do **not** need to be
co-located, and a second HTTP-only instance is correct by construction.

### 2.2 Does NOT survive N instances — verified

**(a) Repeatable-job REGISTRATION is not gated; only consumption is.**
`WorkerRoleService.shouldStart()` is called before every one of the 36
`new Worker(` sites — that part is solid, and `worker-role.spec.ts`
enforces it structurally. But the spec's glob is *content-derived*
(`src/modules/**/*.ts` filtered to files containing `new Worker(`), so it
is blind to the ~13 `*.queue.ts` files that register a cron and start no
worker. Those run `queue.add(..., { repeat })` unconditionally in
`onModuleInit` on every instance. Most are idempotent — BullMQ keys a
repeatable on (name, pattern, tz, jobId) — so a duplicate registration
collapses to one entry. Production confirms it: every queue's `repeat` key
holds exactly the expected count (`reseller-reports` 5, `courier-ndr` 3,
`courier-portal` 3, the rest 1–2), no duplicates.

Three of them are **destructive and ungated**, and that is the real hazard:

- `modules/courier-escalation/queue/courier-outbox.queue.ts:44` — wipes
  *every* repeatable on the queue, then re-adds two; the `shouldStart`
  gate is at `:62`, eighteen lines too late.
- `modules/courier-portal/queue/portal.queue.ts:63` — same shape, gate at
  `:99`.
- `modules/courier-ndr-runner/queue/ndr.queue.ts:53` — `clearRepeatables()`
  with **no gate anywhere in the file**, and its three jobs are the only
  repeatables in the tree with **no `jobId`**.

With two instances, B's boot deletes the schedule A just registered and
re-adds it. Usually that resolves to the same schedule a second later.
Under a racing boot, or if the two read different cron values from
`system_settings` (`tracking-poll.queue.ts:50` and all three NDR crons are
DB-configurable), it either drops a schedule or creates two. **The NDR
nightly run dispatches real vans; two of it is money.**

**(b) `WORKERS_ENABLED` defaults to `true`** — `config/env.schema.ts:24`,
`z.string().default('true').transform(v => v !== 'false')`. Only the exact
string `'false'` disables it. So a second instance brought up without the
flag runs every worker, every listener, and both sides of the lifecycle
bus (both subscribe to the Redis channel *and* deliver locally ⇒ every
listener fires twice). **Scaling out is fail-double, not fail-safe.** The
flag is not in `~/app/.env` today; `skydrop-api` gets the default and
`skydrop-portal` gets an explicit `'false'` from `ecosystem.config.cjs`.

**(c) The email provider pacer is in-process.**
`modules/email/services/provider-pacer.ts:31` — a `Map` of "earliest next
send" per provider. Its own docblock names the failure: "a second worker
process… each instance would pace to the full rate on its own. The fix at
that point is a Redis counter keyed on the provider name." Two email
workers means 2× the provider rate and 429s on password-reset mail.

**(d) Two per-process TTL caches whose invalidation is process-local.**
`CourierCredentialService` holds decrypted plaintext for 5 minutes and
`clearCache()` (`:371`, "for credential rotation") clears one process — so
after a rotation the other instance keeps using the old secret for up to
five minutes. `AddressValidationService.invalidateStatesCache()` (`:69`)
has the same shape over `ops.allowed_indian_states`, 5-minute TTL.
`ThrottleLimitCacheService` is the benign case: 60 s on a *limit value*,
counters still shared.

**(e) Next.js build IDs.** None of the four apps sets `generateBuildId` or
`assetPrefix`. Two droplets building the same commit independently produce
different build IDs, so a browser that loaded HTML from droplet A will
404 on `/_next/static/<buildId>/…` from droplet B. This is the one place
that genuinely argues for either sticky sessions or a shared build
artefact — see Stage 3.

### 2.3 What two worker-owning instances would actually break

Concretely, not abstractly: every cron fires twice, so the hourly
`OrderAttentionService` sweep, the 15-minute courier-decision TTL sweep
and the nightly NDR run all double. The NDR run makes **real courier
calls** (CUR-10's runner amendment), and the auto-pickup path asks a
courier for a van. Emails double at the pacer level (the NOTIF-2 partial
unique still dedups the *ledger* row, so the second send is refused — but
the pacer has already been outrun). The lifecycle bus delivers each event
twice, and the downstream gates (NOTIF-2's composite key, CUR-9's
`awbNumber !== null`, the WALLET-lock accrual gates) would absorb most of
it — which is exactly the "usually absorbed is not a foundation" argument
`WorkerRoleService`'s own docblock makes.

### 2.4 The portal worker must stay singular

`PortalSessionService` holds a `Map<string, BrowserContext>` of logged-in
Playwright contexts and a shared `storageState` file. Two portal processes
would log in twice against the same Delhivery account, race that file, and
trip an OTP/captcha challenge which the code deliberately refuses to
retry — plus `ProbeBudget`'s page and download counters are per process,
so a read-only probe would spend 2× its budget against the courier's
panel.

What enforces singularity: `PORTAL_WORKERS_ENABLED` is **fail-closed**
(`=== 'true'`, absent from the zod schema, so absent means off) and is set
in exactly one place — the `skydrop-portal` pm2 entry.
`portal-worker-isolation.spec.ts` separately proves `AppModule` cannot
reach `CourierPortalModule` or `playwright` at all, so no API instance can
start a browser even by accident. **This is already correct. Do not
duplicate the portal process at any stage below.**

---

## 3. The target architecture, in stages

Costs are DigitalOcean list price at the time of writing — **confirm each
in the panel before committing**, they move.

### Stage 0 — cheap headroom, today, no new spend

**Set `connection_limit` explicitly, per role, in `~/app/.env`.** Today
both pool-holding processes take Prisma's default of 5 and nothing says
so. The portal worker is a nightly batch that runs four jobs; it does not
need the same pool as the process serving every HTTP request.

Prisma reads the parameter from the URL, so this is two separate URLs:

```
DATABASE_URL=postgresql://…/defaultdb?sslmode=require&connection_limit=8&pool_timeout=20
PORTAL_DATABASE_URL=postgresql://…/defaultdb?sslmode=require&connection_limit=3&pool_timeout=20
```

`packages/db/src/client.ts` reads `DATABASE_URL` only, so a second URL
needs a small change there (`datasources.db.url`) plus the env entry in
`ecosystem.config.cjs`'s portal block. Until that lands, setting
`connection_limit=6` on the single `DATABASE_URL` still beats the
undeclared default: **8 + 3 = 11 named** is a budget someone can reason
about; 5 + 5 that nobody chose is not.

Also worth doing while nothing depends on it, in rough order of value:

- **Reserved IP on the droplet.** Free while attached. Without it, every
  recovery path that lands on a *new* droplet needs six Cloudflare record
  edits under pressure; with it, it is one detach/attach. This is the
  single cheapest reduction in recovery time in this whole document.
- **`maxmemory` on Redis.** `capacity.redis_max_memory_mb` is set to 512
  as a *gauge ceiling* while the server's actual `maxmemory` is `0` —
  `/system/capacity` is measuring against a limit nothing enforces.
  Setting `--maxmemory 512mb` makes the gauge true. Keep `noeviction`:
  evicting a BullMQ key silently loses a job, and refusing a write is the
  failure you can see.
- **Move the three destructive repeatable wipes behind their gate**
  (§2.2a) and give the NDR jobs a `jobId`. This is a five-line change and
  it is the prerequisite for Stage 3 being safe.
- **Flip `WORKERS_ENABLED`'s default to `'false'`** and set it explicitly
  `true` in the `skydrop-api` pm2 entry. Fail-safe beats fail-double, and
  the explicit line is self-documenting for whoever adds instance two.
- **Fix `workers-main.ts:17-22`**, which tells a future operator that
  co-hosting workers is safe. It was true before `WORKERS_ENABLED`
  existed; it is now actively misleading.

Verify: `SELECT count(*) FROM pg_stat_activity WHERE usename='doadmin'`
before and after; the number should move to the sum you chose.

### Stage 1 — the database

**Buy connections and RAM, and buy the standby.** What the upgrade is
actually for, in order:

*Connections.* DO scales `max_connections` with plan RAM — ours is 25 at
1 GB. **UNVERIFIED for the target plan**; read the new cluster's
`max_connections` from `pg_settings` after the resize rather than trusting
a formula. The arithmetic that matters: 14 of the current 25 are
DigitalOcean's own, and that overhead does not shrink. A second app
droplet adds a whole second set of pools, so budget `(instances × api
pool) + portal pool + 14 + headroom`.

*RAM.* 76 MB of data in 190 MB of `shared_buffers` — the whole database
fits in cache today. This is not urgent and will not be for a long time.

*The standby node.* Roughly doubles the database line. What it buys: DO
promotes the standby automatically on primary failure and the connection
**hostname does not change**, so no config edit and no deploy. The
failover window is a DigitalOcean-side number — **UNVERIFIED**; ask
support or watch a manual failover on a throwaway cluster before relying
on a figure. What it does *not* buy: a clean experience during the window.
Prisma will re-establish its pool afterwards, but **every in-flight query
fails** and there is no connection-level retry anywhere in this codebase,
so users see 500s and `AllExceptionsFilter` will raise an `API_ERROR`
issue per request. BullMQ jobs retry and recover on their own.

If you want the window to be quiet as well as short, the change is a
narrow retry on Prisma's connection-class errors (P1001/P1017) at the
`PrismaService` boundary — explicitly **not** a blanket retry, which would
re-run non-idempotent writes.

*PgBouncer after the upgrade?* Probably not, and not yet. It buys
connection multiplexing, which matters when instance count × pool size
exceeds the ceiling — with two app droplets at 8 each that is 16 + 14 =
30, which a 2 GB plan likely covers. If it is ever wanted, it goes **on
each app droplet** (transaction pooling, `pgbouncer=true` in the Prisma
URL) rather than as a shared box, because a shared PgBouncer is a new
single point of failure in front of the database you just made redundant.
One property is already in our favour: every advisory lock here is
`pg_advisory_xact_lock`, which survives transaction pooling. A
session-scoped lock would not have.

Verify: after the resize, re-read `max_connections`, re-check
`pg_stat_activity`, and update `capacity.db_plan_label` and
`capacity.db_storage_gb` — `/system/capacity`'s ceilings are settings an
admin maintains, and a stale one is worse than none.

### Stage 2 — Redis off the droplet

**Only worth doing as the prerequisite for Stage 3.** While there is one
app droplet, moving Redis off it adds a network hop and a second thing to
lose without removing anything. The moment there are two app droplets they
must share one Redis, and it cannot live on either of them.

What needs it: BullMQ (36 workers, 38 queues), the throttler storage, the
`skydrop:order-lifecycle` pub/sub channel, and `StockCacheService`'s
display cache. Nothing else — there is no session store in Redis.

*Managed (DO Valkey/Redis) vs a second droplet.* Managed, for the same
reason the database is managed: patching, backups and failover are not
work anyone here wants to own, and a self-managed Redis on a second
droplet is the same single point of failure with more of your time in it.
The one thing to check is **`maxmemory-policy`: it must be `noeviction`**,
and some managed defaults are `allkeys-lru`, which would silently evict
BullMQ keys — i.e. lose jobs. Verify with `CONFIG GET maxmemory-policy`
on the new instance before cutting over.

*Cutting over without losing jobs.* The queues hold very little — 692 keys,
22 MB, and almost all of it is repeatable-job schedules that every
`onModuleInit` re-registers on boot. So: stop `skydrop-api` and
`skydrop-portal` (which stops all consumption), let in-flight jobs finish
or fail into their retry state, point `REDIS_URL` at the new instance,
restart through `ecosystem.config.cjs` (not by process name — `pm2 restart
<name> --update-env` does **not** re-read `.env`, per the comment in
`deploy.sh`), and confirm the repeat sets rebuild:

```bash
for k in $(docker exec … redis-cli --scan --pattern 'bull:*:repeat'); do … ZCARD "$k"; done
```

The counts to expect are the ones in §2.2a. Anything genuinely in flight
at cutover — a delayed pick-expiry, a scheduled accrual — is lost, which
is why this is done at a quiet hour; all of those are also reconstructed
by an hourly sweep, which is the design working.

### Stage 3 — a second app droplet behind a load balancer

**What goes where.** Droplet A: `skydrop-api` with `WORKERS_ENABLED=true`,
plus `skydrop-portal` (which stays singular, §2.4), plus the four Next
apps. Droplet B: `skydrop-api` with `WORKERS_ENABLED=false`, plus the four
Next apps. **No portal on B, ever.**

Do Stage 0's repeatable-registration fix first. Without it, B's boot wipes
A's cron schedule.

**Health checks.** There is a readiness endpoint — `/health/ready`, which
checks Postgres and Redis — but **it returns HTTP 200 when degraded.**
Verified in `health.controller.ts`: `@HttpCode(HttpStatus.OK)` on both
`@Get()` and `@Get('ready')`, with the failure expressed only as
`{"status":"degraded"}` in the body. A load balancer checking for a 2xx
would keep routing traffic to an instance with no database. Either make
`/health/ready` answer 503 when `status !== 'ok'` — `/health/tracking`
already sets the precedent and explains the reasoning — or configure the
LB to match on the body, which most cannot do well. **Fix the endpoint.**
`/health/live` should stay 200-always; it is the restart signal, not the
routing signal, and an instance that has lost its database should be taken
out of rotation, not killed.

**Sticky sessions: not for auth, yes for static assets — or avoid the
problem.** Auth needs no stickiness (§2.1). The `__Host-` refresh cookie
is set by the Next app on its own origin and every instance reads it
identically. The real issue is Next.js build IDs (§2.2e). Three options,
best first: (1) set a deterministic `generateBuildId` from the git SHA in
all four `next.config`s, so two independent builds of one commit produce
identical asset paths — this removes the problem rather than routing
around it; (2) build once in CI and ship the artefact to both droplets,
which also halves the deploy's CPU cost; (3) sticky sessions, which only
narrows the window and breaks the moment an instance is drained.

**Deploys with two droplets.** Rolling, and the migration moves. Today
`deploy.sh` does migrate-then-build-then-restart on one box. With two, the
migration must run **once**, not per droplet, and the safe order is:
migrate (from either droplet, or a dedicated step) → deploy B → verify →
deploy A. That makes the old-code-on-new-schema window *longer*, not
shorter — which is precisely why the expand/contract discipline stops
being optional:

> **A migration must be backward-compatible with the currently-running
> code.** Add a column, backfill it, ship code that writes both, and only
> drop the old one in a *later* deploy. Never add a column and drop
> another in the same migration. 18 of 206 migrations here contain
> destructive DDL, so this rule is changing existing practice, not
> confirming it.

This is worth writing into `CLAUDE.md` as a MUST at the same time as the
second droplet, because it is a discipline nothing can check automatically.

**Cost, roughly:** a matching droplet ~$32/mo plus a DO load balancer
~$12/mo. Note the load balancer replaces Cloudflare's role as the thing
that picks an origin, and `ufw` will need the LB's address range added —
**and Cloudflare's ranges removed only after** the LB is serving, exactly
as `docs/cloudflare-proxy.md` step 2 argues. The `CF-Connecting-IP`
rewrite in Caddy stays; the chain becomes Cloudflare → LB → Caddy → app,
which is three hops, and `app.set('trust proxy', 1)` is still correct
*because* Caddy overwrites XFF from `CF-Connecting-IP` rather than
counting hops. That decision pays off here.

Before this stage, also fix the two process-local caches (§2.2d) and the
email pacer (§2.2c) — the pacer only matters if B ever runs workers, but
the credential cache matters immediately, because a rotation must take
effect everywhere.

### Stage 4 — beyond

Nothing in the reading argues for more than Stage 3 at present volume, and
a few things argue against reaching for it:

- **A second region** doubles every line and buys protection against a
  DigitalOcean regional failure — which `docs/disaster-recovery.md`
  scenario D already covers at 4–6 h. Not worth it until revenue says so.
- **A read replica** answers the P&L and reconciliation reports competing
  with order traffic. At 76 MB that is not a problem yet;
  `/system/capacity`'s growth figures are where it will show up first.
- **Deploying `@skydrop/workers`** as its own process is the step that
  makes "background work runs somewhere that serves no HTTP" true rather
  than merely available (the `CLAUDE.md` repo-structure note). It is *not*
  an HA measure — it is a blast-radius measure, and it needs
  `WORKERS_ENABLED=false` on every API process first or it double-fires
  everything.

---

## 4. What "never fail" cannot mean

It cannot mean zero downtime. After every stage above, these remain:

| Still single | Realistic recovery | Covered by |
|---|---|---|
| The SGP1 region | 4–6 h at another provider | `docs/disaster-recovery.md` scenario D |
| Cloudflare | Their outage is our outage; the rollback re-opens the origin and re-opens `CF-Connecting-IP` forgery | `docs/cloudflare-proxy.md` |
| A bad migration | Minutes to hours; PITR restores data but not availability, and the restore lands on a **new cluster** needing a `DATABASE_URL` change | `docs/disaster-recovery.md` scenario A |
| A bad deploy that passes CI | Until someone notices, then one revert + deploy cycle (~15 min) | nothing automatic |
| Delhivery / Shiprocket / Resend | Theirs. Our side degrades rather than fails: CUR-13 routes a refusal to manual placement, NOTIF-22's watchdog re-queues unsent email | CUR-13, NOTIF-22 |
| The DigitalOcean account itself | 4–6 h, and it is the whole reason the hourly Drive copy exists | `docs/disaster-recovery.md` scenario D |
| The backup passphrase | **Unrecoverable.** Two copies exist (droplet + owner). There is no third | `docs/disaster-recovery.md` |

The honest framing for the owner: **Stage 0 through 3 turn "a failure means
an outage of unknown length that nobody is watching" into "a failure means
seconds to minutes, and something tells us."** That is a different
business, and it is achievable. "Never fail" is not, and chasing it past
Stage 3 spends money on the wrong risks — the most likely outage remains a
deploy we shipped, and no amount of redundancy fixes that.

---

## 5. Noticing before the customer does

### What exists

- `/system/capacity` (`modules/system-capacity`, SUPER_ADMIN) — DB storage,
  connections, hypertable growth, Redis memory, queue depth, each with a
  written consequence and remedy. **Pull, not push: it tells nobody.**
- `SystemIssueService` + the hourly sweeps — `OrderAttentionService`,
  `checkStrandedTracking`, `checkLabellessAwbs`, `backup-watch`, the
  courier-outbox stall watch. These catch *business* failures well.
- `SystemIssueNotifier` — in-app for HIGH, in-app **plus email** for
  CRITICAL. 10 HIGH `money` issues are open right now, so the mechanism
  is demonstrably alive.
- `/health/tracking` — returns **503** when no poll cycle has completed in
  45 minutes. Its docblock says plainly why it exists: *"something with no
  dependency on the droplet — a scheduled job elsewhere — can ask 'is
  tracking still moving?' and shout if it is not."*
- `deploy.sh`'s health smoke — catches a process that will not bind, at
  deploy time only.

### The gap, concretely

**Nothing outside the droplet watches the droplet.** Every alarm above
runs *inside* `skydrop-api`. If that process dies, or the droplet dies, or
Caddy dies, or Redis wedges and every request hangs — **no sweep runs, no
issue is raised, no email is sent, and the admin page that would show it
is also down.** At 3 a.m. the first signal is a seller ringing in the
morning.

Three specific holes:

1. **`/health/tracking` was built for an external prober and has none.**
   Verified: no `@sentry/*` package is installed anywhere; no
   UptimeRobot / Better Stack / healthchecks.io / Cronitor / PagerDuty
   reference exists in the repo. `docs/infrastructure.md` lists Sentry
   under "Monitoring" and again on the pre-launch checklist — it was
   planned and never installed. The endpoint is a prober-shaped hole with
   no prober in it.
2. **`/health/ready` cannot be probed usefully** — it is 200 when degraded
   (§ Stage 3). Even an external prober pointed at it would report green
   with the database gone.
3. **HIGH issues reach only an in-app inbox.** The one channel that leaves
   the building is CRITICAL email, and CRITICAL is reserved for god-mode-
   class events. An API that has been down for six hours produces no issue
   at all, of any severity, because nothing is running to raise one.

### What closes it, cheapest first

- **An external uptime probe** on `https://api.skydrop.global/health/ready`
  and `/health/tracking`, alerting to a phone. Free tiers are adequate at
  this size. This is the single highest-value item in the whole document —
  it is the difference between finding out at 03:05 and finding out at
  09:00, and it costs nothing.
- **Make `/health/ready` answer 503 when degraded** so that probe means
  something. One line.
- **DigitalOcean's own alert policies** (droplet CPU/memory/disk, DB
  CPU/connections/disk) — already in the pre-launch checklist in
  `docs/infrastructure.md`, unticked. They are free, they are outside the
  droplet, and they notify by email. **UNVERIFIED whether any are
  configured**; it cannot be read from the droplet and needs the panel.
- **Sentry**, or any error aggregator, so an `API_ERROR` flood reads as a
  spike rather than as rows in a table someone has to open.

