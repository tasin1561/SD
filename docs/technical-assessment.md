# Skydrop — technical assessment

**Date:** 2026-10-09. **Scope:** the repo at `main` (f77dd8a3) plus read-only inspection of production.
No file was changed and no suite was run (the machine was in use). Every claim cites what I read; where
I could not confirm something I say so in those words.

**Read this first, because it frames everything.** Production has handled **53 orders** and the database
is 83 MB. The architecture, the invariant discipline and the test estate are those of a system an order
of magnitude larger — which is the right way round, and it means almost nothing here is "broken now"; it
is "will bite when volume arrives, and three things already are". The five items are ordered by what
they will cost you, not by how hard they were to find.

---

## 1. The stranded-parcel watchdog cannot fire. It is rule 4b again, in the one place it was never fixed.

TRK-10 exists because a human noticed an order looked wrong: two parcels sat in `DELIVERY_FAILED`
for two days while twenty-four `RTO_IN_TRANSIT` scans were dropped, and both sellers were told
delivery had failed while their goods were most of the way home. `checkStrandedTracking` was written
to catch that.

It selects on `shipments.updatedAt`:

- `apps/api/src/modules/order-attention/services/order-attention.service.ts:948` —
  `updatedAt: { lt: cutoff }`, cutoff = now − `ops.tracking_stranded_alert_hours` (6 h), swept hourly.

The tracking poll rewrites that same column every twenty minutes for every parcel it tracks:

- `apps/api/src/modules/tracking-poll/queue/tracking-poll.queue.ts:17` — `'*/20 * * * *'`.
- `apps/api/src/modules/tracking-poll/services/tracking-poll.service.ts:413` — the only bail-out is
  `if (Object.keys(data).length === 0) return;`. **There is no change check.** An in-flight parcel
  always yields a `courierStatusLine`, so the row is written with identical values and `@updatedAt`
  is bumped.
- `tracking-poll.service.ts:48-54` — the polled set includes `DELIVERY_FAILED`, `RTO_INITIATED`,
  `RTO_IN_TRANSIT`: exactly the population TRK-10 was written for.

Twenty minutes is less than six hours, so `updatedAt < now − 6h` is **unsatisfiable for any parcel
the poll is still asking about**. The check can only fire for parcels the poll has already given up on.

Confirmed in live data, not just in code: the poll last ran 14 minutes ago, ten orders are in
`rto_in_transit`, and five live shipments carry an `updatedAt` 13 minutes old. The comment at
`order-attention.service.ts:945` ("Something the courier told us") asserts a meaning the column does
not carry — which is precisely what CLAUDE.md rule 4b warns about, and the returns worklist had this
identical bug and was fixed (`order-attention.service.ts:1198` now uses `scanAt`). This one was not.

**Cost to fix: small.** The remedy is already injected here —
`TrackingEventAppendService.reachedStatusAt` (`tracking-event-append.service.ts:172-186`), whose own
docblock describes this bug. Two more of the same shape belong in the same change:
`courier-decision.service.ts:108` and `:223` (CUR-17's `AWAITING_COURIER` TTL — a seller correcting a
phone number silently buys the parcel another 6 h) and `review-expiry-sweep.service.ts:177` (R5b's
orphan-pause expiry, which *releases stock*).

---

## 2. Nothing gets louder because it was ignored.

The design chose, deliberately and correctly, that a recurrence must not re-notify: "a nightly job
failing for a fortnight interrupts one person once rather than fourteen times". It never grew the
counterweight. `system-issue.service.ts` `raiseInner` bumps `occurrenceCount`, returns
`isNew: false` and stops; `applySeverityOnRecurrence` changes severity **only if the caller asks for a
different one**, so there is no escalation by age or count. And
`system-issue-notifier.service.ts:170-173` is HIGH and CRITICAL only — **MEDIUM notifies nobody.**

So an issue open 46 days that has recurred 466 times is exactly as quiet as one raised an hour ago.
Three live consequences, in production right now:

- **`fee-fx-rate-stale`: 466 occurrences, open since 2026-09-20, last seen today, MEDIUM.** The
  INR↔BDT rate was last set **2026-08-24 — 46 days ago**, against a 7-day threshold. Your flat fees
  are agreed in taka (৳200 delivery, ৳30 RTO), so *every order's delivery fee and every return fee
  is being converted at a 24-August rate*, and so is every taka figure in the P&L.
  `checkStaleFeeFxRate` (`order-attention.service.ts:790-865`) raises MEDIUM and its own detail text
  says "this only changes when somebody sets it on the FX screen" — nothing fetches rates (M16
  deferred). **It is also the one check in that sweep with no test**: nine of the ten
  `check*` methods have named behavioural tests in `order-attention.service.spec.ts`; this one has none.
- **Three `job-failed:` cards at MEDIUM**, telling nobody: `PortalQueue`,
  `StoreRequestExpiryWorker` (store requests stop expiring) and `PackBoxExpiryWorker` (an abandoned
  pack box blocks a parcel *and* a packer). `system-issue.service.ts:518-526` raises MEDIUM even for
  a streak, beside detail text reading "That work did not happen and nothing will pick it up by itself."
- **`webhooks-unprocessed`: HIGH, 251 occurrences, open since 2026-09-29, still firing.** It can
  never clear. The seven stuck rows are all 12–13 September, `retry_count = 0`,
  `error_message = null` — the Shiprocket day-first timestamp failures, long since fixed in the
  parser. TRK-11 deliberately does not re-queue (right call for a bad payload) but left **no path to
  closure at all**, and there is no screen for one. Worse, all three waybills in those rows look like
  traffic from your wider Shiprocket account, not Skydrop parcels: **2,505 of 2,596 webhooks (96%) are
  `NO_MATCHING_SHIPMENT`**. So the only permanently-open HIGH card in production is noise, sitting in
  the same list as ₹2.44 lakh of real money problems.

That last one is the whole finding in miniature: CLAUDE.md predicted it in words — "a list that grows a
row per webhook is a list people stop reading" — and then shipped a card that cannot be cleared.

**Cost to fix: moderate, mostly in one file.** Escalate on age or occurrence count in `raiseInner`;
decide what MEDIUM is *for* if nobody is told; give `webhooks-unprocessed` an abandon path and exclude
rows that would have been IGNORED anyway.

---

## 3. The books are measurably behind the system — and the system is correctly saying so.

None of this is a code defect. All of it makes the two artefacts you run the business from wrong by
known amounts.

- **₹2,44,000 of courier wallet top-ups are not in the bank book.** 18 rows at
  `match_state = 'unrecorded'` (17 Delhivery = ₹2,39,000, oldest 2026-09-14, newest 2026-10-08; 1
  Shiprocket = ₹5,000). Against ₹2,90,000 resolved and ₹1,65,500 not-applicable, that is **34% of all
  recharges by value**. Each has its own HIGH card; the flow to clear them exists
  (`courier-wallet-record.service.ts:159-187`) and nobody has used it. Real money left a real bank
  account and the capital side of the P&L has not seen it.
- **The Shiprocket cost sync and invoice check have been dead for 10 days.** Last successful runs:
  `courier.shiprocket_wallet.synced` and `courier.shiprocket_invoices.checked` both
  **2026-09-29**. Cause is open and HIGH: `shiprocket-portal-challenge` (their panel asked for an OTP
  on 2026-10-01). That notified once, on the day. Eight days of continued death announced nothing —
  item 2's mechanism. Meanwhile Shiprocket parcel costs are not being written, so COST-2's netting is
  not running and margin on those parcels is stale.
- **Nothing in the estate notices a job that stopped running.** The only reader of those nightly
  audit actions for freshness is `PnlNightlyGateService`, and it runs at month-close — so a nightly
  money job that dies on the 2nd is reported on the 1st of the following month. The one exception is
  the tracking poll, which stamps `courier.tracking_poll_last_run_at` and has its own watchdog
  (`tracking-recovery.service.ts`); I verified it is healthy (last run 14 min ago). Every other
  scheduled job — ~38 of them, including the hourly `OrderAttentionService` sweep that *is* the
  watchdog for ten other things — is noticed only if it throws.
- **September 2026's P&L is locked PROVISIONAL and has been since 2026-10-01.** July and August are
  FINAL. Per PNL-CF-1 detection *skips* a provisional month, so nothing is being carried out of
  September, its late data stays in it, and the carry-forward invariant does not hold for it. It needs
  `lock-permanently`, which is your decision because the nightly gate still fails (the dead Shiprocket
  sync above).
- Five Delhivery invoice cards are open (three "transaction list will not download"), which CLAUDE.md
  records as deliberately left open to take up with Delhivery — but on the page they are
  indistinguishable from the things that need you.

**Cost to fix: hours of operator work, plus one product decision** (does the FX rate get fetched, or
does somebody own setting it weekly?).

---

## 4. The money invariants a mocked Prisma has never been able to test — and one is confirmed broken against Postgres.

This is the category CLAUDE.md keeps re-learning (`pack_boxes`, `courier_pickup_requests`, WAL-7,
WAL-8's `order-charges-rebill`, FRT-7). It still has live instances.

**Confirmed: the COD re-credit is a documented behaviour the database refuses.** WAL-6 states, and
three specs pin, that "a COD reversed by mistake and paid again is credited again" —
`cod-credit.service.ts:118-122, 305-311` gates on `count(COD_COLLECTION) > count(COD_REVERSAL)`. But
`seller_wallet_entries_once_per_order_uq`
(`20260906230000_wallet_once_per_order_uq/migration.sql:19-32`) covers `(linked_order_id, direction)`
**including `cod_collection`**, so the second credit raises P2002. The same call writes three more
covered directions on that order — `GST_WITHHOLDING` (`:248`, fires at any GST > 0, default 18%),
`COD_COLLECTION_FEE` (`:262`), `INSTANT_PAY_FEE` (`:276`) — and `gstWithholding.upsert` at `:243` was
written *for* the re-credit case. The intent is unambiguous; the schema makes it impossible.

The blast radius is what makes this item 4 rather than a footnote: **no P2002 handling exists on any of
the three call paths.** On `courier-settlement.service.ts:573` (`record`) and `:1206` (`allocateMore`) a
P2002 aborts the whole transaction — the payout row, every line, the bank entry and **every other
seller's credit in that payout** — so one mistakenly-reversed-and-re-paid order makes a real bank credit
unrecordable. On `accrual-execution.service.ts:226` it is caught, counted `failed`, and only logged. The
spec that pins the behaviour says outright it cannot see the index
(`settlement-bank-invariant.spec.ts:2275-2279`: "This fake book has no such index"), and no e2e writes a
second `cod_collection` against a real database. `order_charges` has this exact contradiction and **is**
fixed (`order-charges-accrual.service.ts:70-117`: ask first, skip, raise HIGH MONEY) — the pattern to
copy already exists.

Alongside it, confirmed but not reproduced:

- **`InboundFreightService.waive` takes no advisory lock.** `inbound-freight.service.ts:1281-1282`
  opens its transaction and claims with no `takeAdvisoryLock` anywhere in the method, while both
  siblings take the seller's WALLET key and both carry a comment naming this race (`settle` at `:724`,
  `void` at `:1400`). Interleaved with `debitForDeliveredOrder`, the waiver is granted and the seller is
  charged a slice of it anyway. One line, same as its siblings.
- **All 26 CHECK constraints are unexercised** — not one is named anywhere in the test tree. The
  dangerous ones are arithmetic: `reseller_order_credits_figures_ck`
  (`20260914250000_reseller_order_money/migration.sql:83`) is `ResellerMoneyPlan`'s whole output
  cross-checked by Postgres, and no test has ever fired it.
- **18 of 24 advisory locks have no concurrent real-database test**, including `SETTLEMENT_ORDER` ("two
  payouts would each recognise the whole gap"), `FREIGHT_COST`, `SHIPMENT_PROVISION` ("two parcels, and
  two real waybills booked"), `RESELLER_SET_ASIDE` and both P&L locks. CLAUDE.md flags exactly one
  (`LABEL_REPRINT`) as a known gap, which makes the other seventeen read as covered.
- **TRE-8b (`/admin/wallet-transfers`) has no e2e at all** — cash attribution, the capital-short refusal
  and its idempotency unique are mocked-only. And
  `inbound_freight_one_advance_per_consignment` (FRT-5's double-billing backstop, the one case the
  per-receipt unique structurally cannot see) has no e2e either — the exact family where FRT-7 found a
  mocked test asserting the opposite of what Postgres did.

**Cost to fix: the COD gate is an afternoon** (copy the `order_charges` pattern and add the e2e). The
CHECK/lock coverage is a sustained piece of work; prioritise `reseller_order_credits_figures_ck` and
the four money locks.

---

## 5. The everyday picking path has no expiry, and four money/courier failure paths die on a log line.

- **A `PRINTED` pick batch holds phase-2 stock forever.** `pick-batch.service.ts:267` allocates at print
  time; `:377` `confirmPrinted` moves orders to `PENDING_PICK` but stamps **no**
  `pickStartedAt`/`pickExpiresAt` and schedules **no** expiry job. WMS-5's expiry requires a non-null
  `pickStartedAt` (`pick-expiration.service.ts:73, 119-121`), which only the *retired* per-parcel station
  writes — and `OrderAttentionService` has no "on the floor for N hours" check at all. So WMS-1 made
  print-first the everyday path and **the retired path has a full CAS expiry while the live one has
  none**. A walk that does not come back leaves stock unsellable and orders in `PENDING_PICK`
  indefinitely, silently.
- **`rto-receipt.service.ts:358`** — the outer catch around `chargeOnReceive` logs and stops, so the
  return fee *and* the swept delivery fee are both gone for that parcel. `SystemIssueService` is already
  injected at `:137` and the class already raises at `:599`. Cheapest real-money fix in the audit.
- **`courier-decision.service.ts:238` vs `:259-266`** — CUR-17's TTL sweep raises its HIGH card *inside
  the try, after commit*; the catch does `skipped += 1` and a log line. A parcel past its 6 h deadline
  holding reserved stock, with its customer already told it is coming, produces nothing — from the sweep
  whose stated purpose is "a decision queue nobody watches is a queue that silently holds confirmed
  parcels".
- **`auto-withdrawal.queue.ts:86`** — WAL-3b's unpayable-withdrawal pass is swallowed *inside the worker
  handler* with `attempts: 1`, so the job reports success and `on('failed') → reportJobFailure` never
  fires. A pass that never ran leaves unpayable PENDING requests blocking every new request and the
  auto-sweep — the exact production condition WAL-3b was written for.
- **`courier_outbox_items.SENT_UNCONFIRMED` is excluded from its own watchdog.** CUR-20's watchdog
  watches PENDING and SENDING only (`courier-escalation-watch.service.ts:53`) while "Mark sent" writes
  SENT_UNCONFIRMED (`courier-ops-queue.service.ts:194`) — and per CUR-20 that is the *ordinary* path for
  every courier. The reconciler cannot leave it either (no adapter exposes `getThread`). Every
  escalation message a person sends by hand enters a state nothing chases: the TRK-11 shape the project
  wrote the rule for.
- Shared sub-finding: **ten of these services have no `SystemIssueService` injected at all**, so they
  could not raise if someone wanted them to.

**Cost to fix: three of these are one line each** (`rto-receipt:358`, `courier-decision:260`,
`auto-withdrawal.queue:86`). The pick-batch expiry is a half-day.

---

## What is genuinely strong — do not worry about these

I went looking for rot and mostly did not find it. Specifically:

- **The invariant discipline is real, not decorative.** I began by assuming many of the 203 invariant
  codes had no test behind them. That was wrong, and it is the most important positive finding here:
  **50 of the 52 spec files CLAUDE.md names as enforcement points exist**, and both absences are
  correct (`fe2.test.tsx` is a glob fragment; `seller-theme-scope.test.ts` pinned a stylesheet the
  restyle deleted). The specs just do not cite the codes, so a name-based audit under-reads them
  badly. `order-attention.service.spec.ts` is 1,087 lines covering nine of ten watchdogs with named
  behavioural tests — including rule 4b itself ("counts from the COURIER'S SCAN, not from when we
  recorded it").
- **The sanctioned-writer boundaries hold absolutely.** `sellerWalletEntry.create` appears **exactly
  once** in the whole API (`wallet.service.ts:200`); `storeWalletEntry.create` exactly once; `bankEntry`
  writes exactly three times, all in `BankLedgerService`. **No raw SQL touches any money table
  anywhere**, and no migration creates a money entry. For a system this size that is unusual.
- **Lock ordering is clean with no inversion anywhere** — WALLET → `lockAccountsForPosting` →
  `ATTRIBUTION_RECONCILE_KEY`, checked in every file taking two or more keys.
- **WAL-1 registration is complete in both directions for both enums** — 29 wallet directions (14
  credits, identical on both sides), 15 store directions (7 and 7); both parity specs compare whole sets
  both ways.
- **SCALE-1 is structurally enforced: 31 of 31 workers** call `shouldStart()`, all have a graceful
  close, and the spec derives its file list from `new Worker(` rather than the `.worker.ts` naming
  convention — which already caught three files the convention would have missed, one a money sweep.
  **NOTIF-19's drain-hook rule has no gaps** either, and its spec derives from the thing itself.
- **Both repo static checkers pass today with nothing outstanding.** 793 API routes against 613
  frontend calls: every call matches a route, every route has a caller, every data hook is used by a
  screen, all 657 literal e2e paths exist. And across four consoles (86 + 47 + 26 + 11 pages) every page
  asks only for what its gate allows — the check CLAUDE.md says catches what nothing else does, green.
- **`impersonation-deny-list.spec.ts` is the best spec in the repository**, worth copying elsewhere:
  it derives mutating routes off the controllers, asserts the walker found > 100 (so an empty list
  cannot pass), requires every route to be refused *or* explicitly allowed, checks every deny prefix
  matches a real route, and checks the forward-looking list matches *nothing*, so a stale entry fails
  the day its route lands. Bidirectional, with an anti-vacuity floor.
- **`deploy.sh` is better than CLAUDE.md implies**: a real health smoke (`/health` 503s on a dead
  Postgres, so it fails the deploy rather than reporting degraded) *and* a Next chunk check that
  fetches a real `/_next/static/*.js` off the page naming it — written after the 2026-09-27 five-hour
  silent reseller outage, with that history in the comments. `.last-deployed-sha` is written last, so
  the marker means built-restarted-and-answering.
- **Growth is bounded where it matters.** `WebhookPayloadRetentionService` blanks payloads after 90
  days while keeping the evidence row. Measured: `tracking_events` is **70 bytes/row** — at 30k
  orders/month and ~10 scans each, ~450 MB/year, not the emergency the compression story implies.
  Backups ran today (`system.backup.completed`, 2026-10-09).

---

## Smaller findings

- **`apps/marketing`'s only API call is checked by nothing.** `scripts/check-frontend-routes.py:120-131`
  `SOURCES` omits marketing, and `apps/marketing/e2e/invite-form.spec.ts:53` *mocks* the endpoint — so
  `/api/public/invite-leads` (`invite-form.tsx:45`) is correct today and joined by no gate, its path
  spelled in three places including a Caddy rule outside the repo. The "app missing from an
  enumeration" shape CLAUDE.md names.
- **The e2e suite is conditional and can be skipped on a change that deploys.** `ci.yml:234-235` gates
  on an `api` filter matching only `^(apps/api/|packages/db/|\.github/)` plus dependency files. A change
  confined to `packages/ui`, `e2e-shared/`, `playwright.config` or **`scripts/`** skips the whole e2e
  suite; one confined to `scripts/` or `docs/` skips e2e *and* browser, and `deploy.yml:28` gates on
  success — so it deploys. `scripts/deploy.sh` is never exercised by anything before production.
- **Three specs are byte-for-byte the RBAC-1 bug shape** — a slice window plus a positive `@decorator`
  assertion with no comment stripping, so deleting the decorator and leaving a comment passes, which is
  literally what happened in RBAC-1: `allow-cookie-auth.spec.ts:43-45` (FE-1/FE-4 cookie auth on the
  invoice PDF — I checked, there is already a comment adjacent to that decorator),
  `seller-initials-not-exposed.spec.ts:121-124`, `stock-config.test.ts:111-114`. Related: ~155 specs
  read source text and **only 20 strip comments**, with `stripComments` reimplemented four times and no
  shared helper.
- **`pm2 kill_timeout` is unset on all seven processes** → the pm2 default of **1,600 ms** to drain 31
  BullMQ workers and an HTTP server. The graceful-close code is universal and correct, then gets
  SIGKILLed before it can run; `skydrop-portal` holds a Chromium with a decrypted courier login. 45
  deploys so far. One line in `ecosystem.config.cjs`.
- **Deploy verifies only `127.0.0.1`.** Nothing touches a public hostname, so a broken Caddy vhost, a
  wrong cert or a Cloudflare misconfiguration deploys green; the marketing publish rsyncs with
  `--delete` and is never curled afterwards; nothing signs in, so an auth or proxy regression reaches
  production unobserved. The only external watchdog is `tracking-watchdog.yml` (tracking only), and its
  own docblock notes GitHub disables scheduled workflows after 60 days of repo inactivity.
- **`pnpm gate` is not the `static` job** — it omits all four checkers CI runs (brand tokens, contrast,
  both Python scripts), so a green local gate says nothing about the two checks CLAUDE.md calls the ones
  that catch what nothing else does. `scripts/ui-audit/*` runs nowhere in CI, and the last five commits
  on `main` are all bugs it found.
- **The migrate-before-build window makes expand-only migrations mandatory, and no gate enforces it.**
  `deploy.sh:147` migrates, `:159-169` builds seven apps (minutes), `:234` restarts — so production runs
  old code against the new schema for the length of the build. A contracting migration breaks production
  while the deploy still goes green, and there is no rollback path.
- **Two sweeps walk their whole processed history every run.** `pending_accruals` is swept hourly on
  `{ processedAt: null, eligibleAt: { lte: now } }` against an index of `(eligible_at, processed_at)`,
  and rows are never deleted — so the scanned range *is* the whole table
  (`pending-accrual-sweep.service.ts:42-47`). Same in `webhook-payload-retention.service.ts:81-85`, whose
  `pendingCount()` at `:119-121` sequentially scans `courier_webhooks` to render one number on the
  capacity page. Both want a partial index.
- **`audit_logs` became a job-history store without the index for it.** Seven call sites do
  `where { action } orderBy createdAt desc` with no time bound, including hourly
  `backup-watch.service.ts:137-140` (scanning its own growing history every hour) and four on one
  Shiprocket page load. One composite `(action, created_at DESC)` serves all seven.
- **Two `stock_movements` reads have no serving index**, including `stock-read.service.ts:398-401` on the
  bin-detail display path, where neither predicate column leads any index — a sequential scan of the
  fastest-growing table. And `OrderService.list`'s search (`order.service.ts:1681-1720`) runs four
  leading-wildcard `ILIKE`s OR-ed with a relation subquery, twice (the `count` repeats it), with no
  `pg_trgm` index anywhere.
- **Two nullable money columns now encode two meanings.** COST-1's `costsCleared` re-nets a cost to NULL
  without clearing `actualCourierCostAt` (`wallet-import.service.ts:634-637`), so NULL + a timestamp
  means "we had a figure and the courier's rows vanished" — and `courier-margin-report.service.ts:308-313`
  reports it identically to "never priced". And `reseller-order-money.service.ts:755-758` does `?? ZERO`
  on a transfer price inside a PREPAID_DEBIT (a NULL takes ₹0 from the store for real goods), with
  `store-pnl.service.ts:103-104` doing the same in a report that, unlike `PnlService`, has no coverage
  flag at all. Whether a NULL line is reachable is **SUSPECTED, not confirmed**; the point stands either
  way, because the fallback hides the condition instead of failing on it.
- **`staff_refresh_tokens`: 1,829 rows, 1,798 expired, 1,652 revoked, no cleanup path.** Small today; it
  is auth material that only grows.
- **Three doc-drift items**, which matter because CLAUDE.md *is* the architecture record and has twice
  been wrong about production: it says 17 BullMQ workers (there are **31**); it says 25 database
  connections (production reports `max_connections` 50 with 24 used — I could not determine whether DO
  enforces a lower effective cap, so **treat the headroom as unverified**); and `apps/workers` is still
  not deployed, which is worth re-reading before any design leans on the non-HTTP boundary.

## What I could not confirm

- Whether any parcel is *currently* stranded behind finding 1. I confirmed the check cannot fire for
  polled parcels and that the poll is refreshing the column; I found no live mismatched pair, and at 53
  orders that proves little either way.
- Whether a NULL `resellerTransferPriceInr` is reachable on a reseller order, and the effective
  production connection cap (both above).
- Whether the three `job-failed` MEDIUMs are ongoing or historical — the card does not distinguish,
  which is itself part of finding 2.
