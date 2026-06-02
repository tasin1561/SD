# @skydrop/workers

BullMQ workers process for Skydrop.

This package is a **thin pm2 entry-point wrapper** — the actual code
lives in [`apps/api/src/workers-main.ts`](../api/src/workers-main.ts).
The reasoning:

- BullMQ workers are registered as NestJS providers inside the same
  `AppModule` that `apps/api` uses. Re-implementing the module wiring
  in a second package would invite drift.
- Compiling apps/api once produces `dist/main.js` AND
  `dist/workers-main.js` side-by-side. apps/workers just runs the
  second one.

## What runs here

Every `OnApplicationBootstrap` hook + every BullMQ `Worker(...)`
registered in any module under `apps/api/src/modules` — currently:

- `email` — Resend dispatch
- `image-thumbnail` / `image-orphan-cleanup` — Sharp processing
- `csv-import-processor` — catalog CSV ingest
- `reservation-cleanup` — phase-1 reservation expiry
- `adjustment-executor` — threshold-gated stock adjustments
- `order-csv-import` — order CSV ingest
- `call-assignment-expiration` — CC-7 idempotent timer
- `warehouse-pick-expiration` — WMS-5 idempotent timer
- `courier-awb-generation` — CUR-2 per-manifest AWB saga
- `tracking-webhook-processing` — M10 webhook saga
- Notifications listener (M11) — lifecycle event subscriber

## Distribution semantics

BullMQ distributes jobs across all live workers regardless of process.
Running this AND `@skydrop/api` (which still hosts workers in-process)
gives 2× parallel consumption per queue — fine, no double-execution
risk because BullMQ uses `BRPOP` semantics.

For Phase-1B horizontal scaling: introduce `WORKERS_DISABLED=true` on
the api process and run workers only here.

## Scripts

| Command          | What                                               |
| ---------------- | -------------------------------------------------- |
| `pnpm start`     | Run `node ../api/dist/workers-main.js`             |
| `pnpm dev`       | Same with source maps                              |

Build is delegated to `@skydrop/api`. Ensure `pnpm --filter @skydrop/api build`
ran before `pnpm --filter @skydrop/workers start`.
