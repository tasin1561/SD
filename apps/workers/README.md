# @skydrop/workers

Two processes live here, and they are not the same shape.

**Neither is deployed today.** pm2 on the droplet runs `skydrop-api`,
`skydrop-admin`, `skydrop-seller` and `skydrop-track` — nothing else — so
everything below is code that exists and does not run.

---

## `start` — the BullMQ workers

```
node ../api/dist/workers-main.js
```

Boots the **same `AppModule`** as the API, without an HTTP listener. That
is deliberate: the BullMQ workers are registered as providers inside that
module, and re-implementing the wiring in a second package would invite
drift. Compiling apps/api once produces `dist/main.js` and
`dist/workers-main.js` side by side.

### Enabling it means disabling them in the API

Every worker currently starts inside `skydrop-api` under SCALE-1's
`WORKERS_ENABLED` (env, default **true**), checked via
`WorkerRoleService.shouldStart()`.

**Deploying this process without setting `WORKERS_ENABLED=false` on the
API gives every cron two owners.** BullMQ's `BRPOP` semantics stop two
workers from processing the same *job*, but they do not stop two
*processes* from each registering the same repeatable schedule and each
firing it — the NDR runner would submit every eligible parcel to Delhivery
twice.

(An earlier version of this file claimed 2× consumption was "fine, no
double-execution risk", and named the flag `WORKERS_DISABLED`. Both were
wrong: the flag is `WORKERS_ENABLED`, and the risk is real for scheduled
work.)

---

## `start:portal` — the courier portal worker

```
node ../api/dist/portal-worker-main.js
```

Boots `CourierPortalModule` and **nothing else** — its own small root
module of Config + Prisma + Redis + the portal. It does **not** boot
`AppModule`.

### Why it is a separate process

A long-lived Chromium must not run inside the process serving customer
HTTP:

- it holds a **decrypted portal login** for the life of the process;
- it is the heaviest thing in the system by memory;
- if it crashes it must not take the API down.

`CourierPortalModule` is unreachable from `AppModule`, so the API never
constructs a browser, never loads Playwright and never decrypts a portal
credential. `apps/api/test/unit/portal-worker-isolation.spec.ts` asserts
that by walking the real import graph — the failure it guards against is
somebody adding the module to `AppModule` "to expose a trigger endpoint",
which would compile, boot, and pass every other test.

### Why it does NOT boot AppModule

`workers-main.js` is right to: those workers *are* the application's
background half. This process is not. Booting `AppModule` here would hand
it every other queue and cron as well — the two-owners problem again, and
this time inside a process whose whole purpose is to stay alive for hours.

### Before starting it

1. **Chromium binaries** — `pnpm --filter @skydrop/api exec playwright
   install chromium` on the host. The npm package does not include the
   browser.
2. **`PORTAL_STATE_DIR`** — where the logged-in `storageState` is kept
   between runs (default `/home/skydrop/portal-state`). Must be writable,
   and should **not** be in a backup archive: it is a live session.
3. **The credential** — `courier_credentials` needs `portalUsername` and
   `portalPassword` for `delhivery` / PRODUCTION. Env is not an option:
   CUR-1 governs courier secrets and there is no second path.
4. **`courier.portal_canary_awb`** — an AWB **we own**. The canary raises
   and resolves tickets against it nightly; pointed at a real customer's
   shipment, that is worse than having no canary at all.

### What it does once started

`portal_mode` defaults to **SHADOW**, and shadow is not a no-op: the
worker logs in, navigates to the real ticket, reads the real thread,
resolves the real category and composes the action — then stops before the
click and records what it would have done in `courier_portal_runs`.

That is the point. Every selector and every eligibility read is exercised
against production before anything is written into a thread a customer
reads. Going LIVE is a separate, 2FA'd, audited change, and it is
independent of `write_mode` — so shadow runs while humans keep clearing
the ops queue.

---

## Scripts

| Command             | What                                          |
| ------------------- | --------------------------------------------- |
| `pnpm start`        | BullMQ workers (`workers-main.js`)            |
| `pnpm dev`          | Same, with source maps                        |
| `pnpm start:portal` | Portal worker (`portal-worker-main.js`)       |
| `pnpm dev:portal`   | Same, with source maps                        |

Build is delegated to `@skydrop/api`; run
`pnpm --filter @skydrop/api build` first.
