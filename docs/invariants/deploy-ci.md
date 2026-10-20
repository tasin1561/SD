# CI/CD, gates, schema-drift traps, session hygiene

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 1390-1436 · Current State (2026-07-26) -->
**CI/CD state (2026-08-03):** GitHub Actions `CI` has FOUR jobs, all in parallel: `static` (typecheck + lint + **`format:check`** + the frontend-route check; no service containers, because tsc and eslint never run the app), `unit` (API/admin/seller/package unit), `e2e` (**the full 29-suite API e2e against its own Postgres service**), and `browser` (boots the API and all FIVE server-rendered frontends — admin / seller / reseller / associate / track — plus marketing — and runs the **37 Playwright tests**).

It was two jobs until 2026-08-03, with everything but the browser specs running SEQUENTIALLY in one 12-minute `checks` job — for no reason, since lint does not depend on the e2e suite. Splitting it put the critical path on the longest single job (the e2e suite) and roughly halved CI. **Two properties to preserve:** (a) each job rebuilds the workspace packages rather than receiving them as artifacts — that costs runner-minutes and saves wall clock, and artifact-passing reintroduces a serial dependency longer than the rebuild it avoids; the shared preamble lives in the `.github/actions/setup-workspace` composite so four copies cannot drift apart, and its `packages` input exists so the e2e job builds `@skydrop/db` ALONE (apps/api's only workspace dependency — the `@skydrop/ui` mention in the notification listener is a comment). (b) **`browser` is the ONLY job that builds the Next apps, and that build IS the build check** — it used to happen in both, and the `checks` copy was actively wrong because that job set `NODE_ENV: test` job-wide and therefore built test-env frontends. Removing an app from the browser job's build list stops its build being checked anywhere. `browser` is also the only thing in CI that exercises a browser, which makes it the check that catches a CSP or hydration regression — it was a manual-only smoke until 2026-07-27 and is now a real gate. `Deploy` then SSHes to the droplet, runs `prisma migrate deploy` and restarts pm2. Both were repaired on 2026-07-27: CI had been red for ~14h on a floating `timescaledb-ha:pg18` tag that stopped provisioning a default `postgres` role (fixed by health-checking `pg_isready -U skydrop -d skydrop_test`), the e2e suite had never been wired into CI at all, and Deploy was failing on a pm2 target (`skydrop-workers`) that does not exist (Phase-1A workers run in-process inside apps/api). **Before claiming any invariant is verified, check that the e2e step actually ran in the CI log — that gap is exactly how "the conservation specs passed" was asserted on 2026-07-27 when they had never executed.**

**Fonts are COMMITTED. Do not put `next/font/google` back (2026-08-13).**
It self-hosts at RUNTIME — which is the part everyone checks, and the
reason this looked fine for months — but it downloads the file during
`next build`, so every build and every deploy depended on
fonts.gstatic.com answering. It failed three CI runs in one day, each on
a different family, each with nothing wrong in the diff; the same outage
during a deploy fails the deploy for a reason nobody changed. The five
faces now live as latin-subset woff2 under `apps/<app>/src/app/fonts/`
(172KB total) behind `next/font/local`. **Keep the `declarations:
unicode-range`** — the CDN's own @font-face carried it and it is silently
lost when self-hosting, after which the browser fetches a face for text
it cannot render. Adding a new family means committing the file, not
adding an import.

**`scripts/check-frontend-routes.py` now runs BOTH directions
(2026-08-13).** `call → route` is exact and GATES the build. `route →
call` — an endpoint nothing reaches — only PRINTS, and the asymmetry is
deliberate: to say "nothing calls this" you must find EVERY caller, and a
path composed from a builder, a prop or a helper cannot be seen by a
static string scan however hard it is chased. A gate that fails on a call
it could not see is a gate people learn to skip. Treat the list as a
place to LOOK; it is how the unmanageable platform-bank-accounts screen
was found. Two blind spots are already closed and worth not
reintroducing: a bare **`@Controller()`** (legal Nest, empty prefix, full
paths on the methods) used to drop an entire controller from the route
table, and a call resolving to more than one route used to credit only
the first.

**It also checks the e2e specs now (2026-09-20), and that half GATES.** `inbound-freight-rebill.e2e-spec.ts` wrote `PATCH /admin/settings/:key` where the controller is `@Controller('admin/system-settings')`; four tests died in `beforeEach` on a 404 and the only signal was a red e2e shard fifteen minutes into CI — on the money change those tests WERE the proof of. A supertest path is a literal string, checkable in milliseconds, and this checker was already doing exactly that for the frontends; it simply scanned the app directories and not `apps/api/test`. 577 literal calls against 767 routes, currently zero unmatched. Anything carrying a `${...}` is SKIPPED rather than guessed at, for the same reason the route→call direction only prints: a gate that fails on a path it could not resolve is one people learn to route around.

**The list is at ZERO as of 2026-08-14 — every route has a caller.** That
is the baseline, so anything appearing there is NEW and worth looking at
rather than part of a standing backlog. Getting there was mostly fixing
the checker, not writing screens: its loose scan had a quote inside the
character class, so a match swallowed the closing one and ten endpoints
with obvious callers read as dead. Exactly two entries are uncalled on
purpose and sit in `EXPECTED_ORPHANS` with their reason —
`outbox/counts` (superseded by `/channel`, which returns the same
numbers) and `auth/*/refresh` (the single-flight refresh uses the raw
`fetchImpl`, because a 401 from inside `request()` would recurse).
**When an endpoint should stay uncalled, add it there with the reason
rather than leaving it to be re-triaged every time.**


<!-- from CLAUDE.md lines 1467-1569 · Current State (2026-07-26) -->
**What `pnpm gate` does NOT prove (2026-08-06).** It runs typecheck, lint,
`format:check` and the unit suite. **None of those four builds the Nest
container.** Typecheck resolves imports and checks types; it does not ask whether
a provider is registered. The unit tests construct their subjects DIRECTLY —
`new Service(mockPrisma, mockAudit)` — so they never resolve a dependency
through DI either. A service can be imported, typed, fully unit-tested, and
absent from its module's `providers`, and all four gates stay green on an
application that cannot start. That happened: Phases 3/4 shipped with
`DelhiverySupportAdapterService` unregistered, 1796 unit tests passed, and CI's
e2e and browser jobs — the only two that START the app — found it.

**`test/unit/app-module-boots.spec.ts` closes that gap.** It compiles the real
`AppModule`; `compile()` resolves every provider without running
`onModuleInit`, so it needs no Postgres and no Redis and belongs in the unit
suite rather than fifteen minutes away in e2e. It catches a missing provider, a
missing `exports` entry, a circular module dependency, and an unresolvable
token — the entire class of defect invisible to the other gates.

**A red boot test presents as a HUNG SUITE, not a failing test.** Nest's
exception zone calls `process.exit(1)` on an unresolvable dependency, so under
jest the run dies or stalls instead of reporting a named failure; CI logged it
as `process.exit called with "1"`. **Do not kill a stalled run assuming it is
stuck** — search the output for `UnknownDependenciesException`, which names the
service and the argument index that could not be resolved. That one line is the
whole diagnosis.

**When a module cycle is the underlying cause, extract — never `forwardRef`.**
The same incident had `courier-delhivery` importing a service from
`courier-escalation`, which imports `courier-delhivery`. A `forwardRef` would
have made the boot test pass while leaving the cycle in place; moving the
dependency-free service into `courier-shared` removed it (the R3 rule, seventh
application).

**`pnpm gate` can be OOM-killed on the dev machine (exit 137). That is a local
memory constraint, NOT a failure — and NOT something to optimise (2026-08-06).**
The composed script runs typecheck, lint and ~1770 jest tests in one process
tree; on a machine with less headroom the kernel kills it. CI runs the same
script on a dedicated runner and passes.

**The workaround is to run the four stages individually** — `npx prettier
--check .`, `pnpm typecheck`, `pnpm lint`, then `npx jest --config
jest.config.ts` in `apps/api` plus `npx vitest run` in apps/admin, apps/seller,
packages/api-client and packages/auth. That is the SAME coverage, just not in
one process.

**Do not "fix" this by capping jest workers or sharding the gate.** It would
slow CI — which has no problem — to accommodate one laptop, and a slower gate
is a gate people skip. An exit 137 with no test failures above it is the OOM,
not a red suite; check for `Tests:` output before assuming otherwise.

**A one-sided Prisma relation is an invented COLUMN, and `prisma validate`
passes on it (2026-08-19).** Leave a relation field pointing at a model that
does not point back, and `prisma format` makes it legal the only way it can: it
adds the missing back-relation, and on the side needing a foreign key it INVENTS
a scalar. The schema is then internally consistent — it just describes a column
no migration ever created. The client asks for it, Postgres refuses, and the
symptom is dozens of e2e failures with a stack trace pointing at whatever insert
happened to run first, nowhere near the relation. It happened three times in one
afternoon while the freight bill moved from the goods receipt to the
consignment, and twice the two sides REGENERATED EACH OTHER, so deleting one
alone did nothing.

**Unit tests cannot see it** — a mocked Prisma has no columns to be missing —
and neither can typecheck. Two gates now do: `schema-relation-hygiene.spec.ts`
in the unit suite (the fingerprint is a scalar `*Id` with NO `@map`, because
every FK written on purpose carries one, plus a check that every relation LIST
is pointed back at), and CI's `Schema matches migrations (no drift)` step, which
runs `prisma migrate diff --exit-code` against a shadow database BEFORE the e2e
suite so drift is reported as one line naming the column rather than as eighty
failures. **After ANY relation change, run the unit suite — not just
`prisma validate`, which is asking a different question.**

**Watch the count on a schema `str.replace(...)`.** The misplaced relation that
started this was a single-occurrence replace anchored on
`goodsReceipts GoodsReceipt[]`, which appears on BOTH `Seller` and `Warehouse`.
It landed on the wrong model, and everything after was `prisma format` being
helpful.

**A raw INSERT in a migration must supply `updated_at`, and forgetting it looks like the whole system is broken (2026-09-20).** Prisma's `@updatedAt` is applied by the CLIENT, so the column is created `TIMESTAMPTZ NOT NULL` with **no database default** — every table in this schema is like this. A hand-written `INSERT` that omits it throws a not-null violation, `migrate deploy` stops, and because the e2e global setup runs migrations before anything else, **all four e2e shards fail at once** alongside anything else that touches a database. The signal reads as a catastrophic regression and is one missing column. `prisma migrate dev` never catches it because generated DDL never hand-writes an INSERT. **Before committing a migration that inserts a row, list the table's NOT NULL columns that have no DEFAULT** (`grep -A25 'CREATE TABLE "<table>"' …/migration.sql | grep 'NOT NULL' | grep -v DEFAULT`) and check every one is in the column list — for most tables that is `key`-like columns, a display name, and `updated_at`.

**A Prisma enum with no `@@map` names a PascalCase Postgres type, and ONLY the
drift gate ever finds out (2026-09-16).** Every enum in this schema is written
`UPPER_SNAKE_CASE` values `@map`ped to snake_case inside a type `@@map`ped to
snake_case — 138 of the 139 that existed that day, and
`ResellerStoreActionMode` was the one that did not. Its own migration had
created the type as
`reseller_store_action_mode`, so the schema and the database disagreed about
the type's NAME while agreeing about every value. **Runtime cannot see this**:
the value maps were correct and value literals are what the client sends, so
the feature worked, the unit suite passed, typecheck passed, and the e2e suite
would have passed too. It surfaced one way only — CI's `Schema matches
migrations (no drift)` step went red, reporting the enum as added and removed
AND every column of `reseller_store_action_policy` as "would be dropped and
recreated (type changed)", which reads like a far larger problem than a missing
two words. The fix is to name the type the database already has; no corrective
SQL, because nothing about the data was ever wrong. **A new enum gets its
`@@map` in the same change that adds it** — there is no symptom to notice
later, only a gate that goes red on whatever commit happens to run next.

**A local `tsc --noEmit` is NOT a gate on its own (2026-07-27).** `apps/api` typechecks incrementally, and a stale `tsconfig.build.tsbuildinfo` will happily skip re-checking a newly-added file: commit `2347b29` was reported as passing typecheck locally and CI then found eight errors in a spec written minutes earlier. **Delete the `.tsbuildinfo` before the pre-commit typecheck**, or treat CI as the only typecheck that counts. Same failure class as the e2e gap above — a gate that did not run looks identical to a gate that passed.

Below: remaining frontends + module-level fast-follows + Phase-1B prerequisites.


<!-- from CLAUDE.md lines 1603-1621 · Session Hygiene -->
## Session Hygiene

- Each module is a fresh Claude Code session. Don't carry context across modules — context loads from this file + the schema doc + the phase-1a-debt doc + the relevant code.
- Session sequence:
  1. User and assistant design module in chat (decisions, scope, file structure).
  2. User pastes a focused prompt into a fresh Claude Code session.
  3. Claude Code reads `CLAUDE.md`, `docs/db-schema.md`, `docs/phase-1a-debt.md`, and the prompt; proposes a plan.
  4. User reviews plan, approves or refines.
  5. Claude Code executes, verifies, commits, pushes.
  6. User reports back to chat assistant with summary.
  7. Repeat for next module.

- Long sessions (30+ min, many tool calls) get expensive in context. End sessions when a logical unit completes.
- Multi-checkpoint pacing for big modules. Use checkpoints when the module spans 15+ commits.
- After every session, the assistant updates this `CLAUDE.md` if anything material changed.
- Mid-module checkpoints when security-critical or data-integrity-critical work lands. Mechanical CRUD can run end-to-end without interruption.
- **Pre-flight reviews catch real problems.** Modules 4-6 surfaced multiple findings pre-implementation (FK constraints, alert grain mismatch, adjustment intent gap, refactor circular dep, tx-boundary conflict with M5). When Claude Code proposes a plan, scrutinize it before approval.
- **After a crash or environment loss**, recovery is straightforward: `git log` shows what landed; `git status` shows uncommitted state; push any unpushed commits first; verify gates green; then resume from the appropriate checkpoint. Working tree is the source of truth, not session memory.
