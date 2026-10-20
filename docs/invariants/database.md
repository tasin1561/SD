# Database, schema conventions, general data rules

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 199-233 · Database -->
## Database

**Status: IMPLEMENTED.** Schema lives in `packages/db/`.

**Canonical reference:** `docs/db-schema.md`. When the schema and this doc diverge, the doc wins; update Prisma to match.

**Migrations applied:** Through Module 9 — M7 call-center reconcile + reject terminals + call-queue partial unique index; M8 warehouse-ops schema additions; M9 courier integration schema (`supersede_reason` enum, `manifest_status` += confirmed/dispatched/failed, shipment supersede columns, manifest awb-job/handoff columns).

**TimescaleDB hypertables:** `tracking_events` and `stock_movements` (composite PK, monthly chunks).

**Compression is NOT active in production, and cannot be.** The init migration configures 7d/30d compression policies, but wraps them in `EXCEPTION WHEN feature_not_supported` — DigitalOcean's managed Postgres ships TimescaleDB under the **Apache** licence and compression is a **Community** feature. Local Docker (timescaledb-ha) has Community, so it works in dev and is silently skipped on production. This doc claimed active compression for months; it never ran there. **Do NOT write a migration that sets `timescaledb.compress` or calls `add_compression_policy` without that exception guard — it will FAIL THE PRODUCTION DEPLOY** (this was nearly shipped on 2026-08-03). The planning consequence: the two fastest-growing tables per order grow linearly and permanently, so archival is the only lever unless we move to Timescale Cloud or self-host. `/system/capacity` reports this as a first-class metric.

**Consumption pattern:**

```ts
import { prisma, OrderStatus, ShipmentStatus } from '@skydrop/db';

const order = await prisma.order.findUnique({
  where: { id },
  include: { items: true, events: true },
});
```

The package exports a singleton `prisma` client (configured logging, graceful shutdown) and re-exports every enum.

**Hypertable schema convention:** Any future hypertable needs explicit `@@index([createdAt], map: "<table>_created_at_idx")` declared in Prisma so the index name matches what TimescaleDB's `create_hypertable()` would auto-create. The migration's explicit `CREATE INDEX` must run BEFORE `create_hypertable()`. This prevents Prisma drift detection from breaking on hypertable conversions.

**Workspace pattern:** `@skydrop/db` builds to `dist/` and consumers import compiled output. `turbo.json` wires `^build` as a dep of `dev`, `typecheck`, `lint`, `test`, `test:e2e` so apps/api always sees a built db package.

**Critical: build script auto-runs `prisma generate` first.** `pnpm --filter @skydrop/db build` is `prisma generate && tsc`. Turbo's `^build` does NOT imply `generate`, so the build script chains them explicitly. Fresh clones and CI runs depend on this. When adding a new enum to schema.prisma, also add it to `packages/db/src/enums.ts` (hand-maintained re-export list).

### Service-Layer Rules (MUST enforce in code — schema cannot)

The schema gives you the shape; these rules give you correctness. Violating them creates data corruption that's expensive to detect and harder to fix.


<!-- from CLAUDE.md lines 694-704 · Database -->
**General:**
1. All money stored as `Decimal`, INR canonical. BDT for display only via FX.
2. All phone numbers E.164 (+91xxx, +880xxx). Validate at app boundary.
3. All timestamps UTC. Display timezone is a per-user preference.
4. Soft delete via `deletedAt` for user-facing data. Hard delete for tokens, sessions, transient/immutable rows.
4b. **`@updatedAt` is NOT "when this reached its current state", and using it that way fails silently.** Any write to the row resets it — a nightly cost sync, an attribution backfill, a supersede touching a sibling field — so "how long has this been waiting" computed from `updatedAt` reports a long wait as no wait, and does so while looking precise. It shipped twice in one change: the returns worklist showed `0h` for every row, and its watchdog filtered on the same column IN SQL, so its alert could never fire. **The authority on when a parcel reached a courier status is `tracking_events.eventAt` (TRK-3)**, read for a whole set at once via `TrackingEventAppendService.reachedStatusAt` — a per-row lookup against that hypertable is how a page that opens instantly with three rows times out with three hundred. A shipment with no matching scan is OMITTED rather than defaulted to now; the caller falls back to its own row timestamp explicitly, which is honest for a status somebody set by hand. **Before computing an age from a timestamp, ask what else writes to that row.**

5. Audit log every sensitive action via `audit_logs` (auth, admin actions, sensitive data access). Severity scale: LOW / MEDIUM / HIGH / CRITICAL — CRITICAL reserved for god-mode and similar invariant-breach actions.

6. **`audit_logs.entity_id` is a UUID column, and anything else silently loses the WHOLE ROW.** Postgres rejects the insert with P2023, `AuditLogService` swallows it by design (an audit write must never fail the operation it describes), and the action ends up with no trail while having succeeded — the only evidence one ERROR line nobody reads. It has happened twice: ten courier services passing the literal `'delhivery'`, and later three passing `input.courierCode` and a pickup-location `name`. **When the audit is about a thing that is not a row — a courier, a warehouse name — pass `entityId: null` and put the identifier in `metadata`.** `audit-entity-id-is-a-uuid.spec.ts` scans for both fingerprints (a literal string, and an expression whose last segment ends in `Code`/`Name` or is a bare `name`), and the service now diverts a non-UUID into `metadata.entityRef` rather than losing the row — the scan is the early warning, that is the backstop.
