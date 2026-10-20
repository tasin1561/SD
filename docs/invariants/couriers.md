# Couriers: Delhivery, Shiprocket, AWB, dispatch (CUR-*, ATT-1)

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 312-313 · Database -->
**ATT-1 (2026-09-04): a refusal is NOT a resolution, and a courier that keeps refusing must stop being asked.** `checkAwblessConfirmed` retries a waybill-less order and then decides whether to raise. Its settled check counted `shipment.supersededAt !== null` as success — true when a refusal ROUTES the order away (to PENDING_MANUAL_PLACEMENT), false when it does not, which is exactly what happens to an order already past CONFIRMED. So each retry retired the shipment the sweep was watching, the sweep read that as "sorted", and **every retry closed the issue it should have raised.** SD-2026-26-000001 cycled on a SEVEN-hour loop for two days (6h cutoff + hourly cron): refused → superseded → fresh shipment → clock reset → refused again, four live Delhivery writes, zero issues, nobody aware. The settled check now asks the order's **current live shipment** for a waybill, never the row the loop started with. And retries are CAPPED at `MAX_AWB_RETRY_SUPERSEDES` (3): a refusal is an opinion about the parcel and will be the same opinion tomorrow (CUR-13), so past the cap the sweep stops calling the courier and raises saying so — the issue distinguishes the two cases in its title, detail and metadata (`retriesExhausted`). **Whenever a watchdog RETRIES then re-reads, re-read the thing that would still be broken — not the row the retry replaced.** A retry that destroys its own evidence looks identical to a fix.


<!-- from CLAUDE.md lines 384-434 · Database -->
**Courier Integration rules (Module 9 — CUR-1 through CUR-9, NON-NEGOTIABLE):**

1. **CUR-1: Courier credentials are decrypt-with-audit.** `CourierCredentialService` decrypts `courier_credentials` (AES-256-GCM); the key is NEVER in the DB — env `COURIER_CREDENTIALS_KEY_<version>`. Every decrypt writes an `audit_logs` row BEFORE returning plaintext; plaintext is never logged, never serialized to a response, never cached longer than 5 min.

2. **CUR-2: AWB generation is a per-manifest BullMQ saga with per-shipment failure isolation.** `ManifestService.close` (→ CLOSED) enqueues `AwbGenerationQueue`; `AwbGenerationJobService.processManifest` iterates the manifest's CREATED shipments — one shipment's failure NEVER aborts the others (same fan-out discipline as M8 `ManifestService.close`). ≥1 AWB generated → manifest CONFIRMED; zero → FAILED. Idempotent (already-CONFIRMED/DISPATCHED/FAILED → no-op; superseded shipments self-detach so a retry never re-supersedes); `processManifest` is public — it doubles as the manual ops trigger.

3. **CUR-3: qtyOnHand decrements EXACTLY ONCE, at PACK (Model C, 2026-09-03 — supersedes Model A).** The decrement lives on the `PICKED → PACKED` matrix edge (`DISPATCH_STOCK` side-effect — the enum member keeps its OLD NAME as a pointer to where it used to live, so grep history stays legible): per phase-2 reservation, `StockMutationService` issues a `PACK_CONFIRM` movement (`−qtyReserved` — the ONE normal-lifecycle physical decrement) AND `StockReservationService.fulfill()` consumes the reservation, right when the box is sealed. `PENDING_DISPATCH → DISPATCHED` and `PENDING_MANUAL_PLACEMENT → DISPATCHED` are now STOCK-NEUTRAL (`sideEffects: []`) — "a driver took it" is a real fact worth recording, but by then the decrement already happened. DELIVERED stays STOCK-NEUTRAL too; M10 tracking webhooks never touch stock. **The give-back, `UNPACK_STOCK`:** cancelling an order whose parcel is packed but never left the building (`PICKED → PACK_FAILED`, `PACKED → PACK_FAILED`/`CANCELLED_BY_ADMIN`, `PENDING_DISPATCH → CANCELLED_BY_ADMIN`, and `PENDING_MANUAL_PLACEMENT → CANCELLED`/`CANCELLED_BY_ADMIN`) reverses every `PACK_CONFIRM` movement for the **order** (queried by `orderId`, NEVER by the order's current live shipment — a courier-rejection arrival at `PENDING_MANUAL_PLACEMENT` has already been through `AwbSupersedeService`, so the `PACK_CONFIRM` sits on the ORIGINAL, now `FAILED_AT_CREATION` shipment, and a shipmentId-scoped lookup silently finds nothing and skips the give-back entirely — this was a real bug caught by CI, not a hypothetical) with a `PACK_REVERSED` +qty movement stamped with THAT original shipment's id (per-movement idempotent via `metadata.reversesMovementId`, not a shipment-grained boolean — an order can have zero, one, or in principle more PACK_CONFIRM rows to reverse) and defensively releases anything still ACTIVE. `PENDING_MANUAL_PLACEMENT`'s cancel edges use `UNPACK_STOCK` rather than plain `RELEASE_STOCK` because that state is reached via TWO shapes — a pick shortfall (never packed, nothing to reverse — `UNPACK_STOCK` degrades to a clean no-op) or a courier rejection (already packed) — and a cancel here cannot assume which one it is. `DISPATCHED → CANCELLED_BY_ADMIN` stays plain `RELEASE_STOCK` — goods truly left with a courier by then, nothing to give back. `RtoDispositionService.finalize()` is decoupled from WHEN the decrement fired (RESTOCK → `RETURN_RESTOCK +qty` re-add; WRITE_OFF → no movement — the original decrement stands) — Model C required NO changes there. The PACK saga is shipment-grained idempotent (gate: a prior `PACK_CONFIRM` movement for the live shipment) — visible-vs-silent ordering: movements pre-tx, transition tx, fulfill post-commit.

4. **CUR-4: THE SCAN IS THE HANDOVER; the per-manifest fan-out is the fallback (AMENDED 2026-09-03).** `DispatchHandoffService.recordHandoverScan` — a parcel scanned at the bench is dispatched there and then: `PACKED → DISPATCHED` (a NEW matrix edge) or `PENDING_DISPATCH → DISPATCHED` if somebody had closed a manifest, shipment `HANDED_TO_COURIER`, unit ledger advanced, and the manifest **closes itself** once its last live parcel has gone (`flipManifestIfComplete`, guarded `updateMany`, accepts any non-DISPATCHED state INCLUDING DRAFT — a manifest nobody ever closed is now the ordinary case). Saga: stamp the scan FIRST (durable, visible), transition LAST; a crash between leaves a scanned-but-undispatched parcel and a re-scan converges. A repeat scan is an idempotent no-op returning `alreadyScanned`, NOT a 409 — with the scan carrying the dispatch, a second scan is the normal "did that register?" shape and an error there teaches operators to ignore errors (CC-6 dual-path reasoning). **Why the scan and not a button: it is per parcel, at the door, at the moment the box leaves; `confirmHandoff` is one person asserting afterwards that forty parcels went. Both record the same fact and only one of them was there.** Gated on `ops.handover_scan_dispatches` (seeded TRUE), which fails OPEN to the old stamp-only behaviour — recording a dispatch that did not happen is worse than making somebody click. `confirmHandoff` (`WAREHOUSE_SUPERVISOR`/`SUPER_ADMIN`, controller-gated) SURVIVES as the fallback for a driver who took a stack before anyone scanned it: per-shipment `PENDING_DISPATCH → DISPATCHED` with failure isolation, transitions FIRST and the manifest flip LAST, idempotent on already-DISPATCHED (parcels a scan already dispatched fail the `expectedFrom` guard and land in `failures` as stale, so a mixed manifest still closes cleanly). **The manifest is a RECORD, not a step** — created for you at pack (WMS-7), finished for you at the last scan; it answers "what went out on Tuesday's van" and nothing else consumes it (we never send or print one — every "Manifested" in the courier adapters is *Delhivery's* word for "a waybill exists", which for us happens at order confirmation, CUR-2b). `/warehouse/manifests` is delisted from the warehouse hub, linked from the handover bench as history. **Consequence to keep in view:** manifest close was also re-running the AWB job, so `OrderAttentionService.checkAwblessConfirmed` was widened past CONFIRMED to every pre-dispatch status (`AWB_EXPECTED_STATUSES`) — pick and pack never check for a waybill, so an unbooked parcel can reach PACKED and then sit at the bench with no label to scan, and that sweep is now the only thing asking.

5. **CUR-5: Serviceability is REACTIVE.** No proactive pre-dispatch serviceability call gates the order flow — a Delhivery AWB rejection (non-serviceable / courier failure) IS the signal: the AWB job routes the order to `PENDING_MANUAL_PLACEMENT` via auto-supersede (CUR-7). `DelhiveryServiceabilityService` exists but is NOT on the critical path (proactive serviceability deferred — phase-1a-debt).

**CUR-2b (2026-08-01): the AWB is generated at order CONFIRMATION, not at manifest close.** `OrderConfirmedAwbListener` subscribes to the R3 `OrderLifecycleEventBus` (the SECOND subscriber after M11's) and enqueues `AwbGenerationJobService.processOrder` — a bus listener rather than a call from `transitionStatus`, because `courier-awb` already imports `OrderWriteService` and the reverse call would close a cycle. **Generating the AWB must NOT advance `ShipmentStatus`**: both warehouse queues select on `status = 'created'` (WMS-2), so stamping `AWB_GENERATED` at confirmation takes the parcel straight out of the pick and pack flow — the pick 409s and the box can never be packed. `awbNumber` is the authoritative AWB fact (CUR-9); the status says where the parcel physically IS, and dispatch handoff selects on `awbNumber`, not on the status. A NON_SERVICEABLE failure routes the order `CONFIRMED → PENDING_MANUAL_PLACEMENT` and supersedes; a TRANSIENT courier failure does NOT — an unpicked order pushed into manual placement is then refused by CUR-8 for lacking phase-2 reservations, so it stays CONFIRMED and manifest close retries it. **Confirm-then-immediately-pick is now racy** (the AWB job holds a row lock and `pullNext` is `FOR UPDATE ... SKIP LOCKED`); benign in production, but a test must settle first — see `settleAwb` / `claimPick` in the e2e harness. Cost: a waybill per CONFIRMED order, including ones that never ship, each leaving a live AWB needing an operator-triggered cancel (CUR-10). Size the pool against confirmed volume.

6. **CUR-6: AWB labels are persisted to OUR Spaces.** On AWB success the label is fetched (`DelhiveryLabelService`) and uploaded to our DigitalOcean Spaces bucket; an `awb_labels` row (versioned, `isCurrent`) records it. A re-issue (`AWB_REISSUED`) demotes the prior current label. **A MANUAL courier has no label leg at all** (2026-09-02): the waybill is a number an operator read off a paper docket and there is no API behind `courierCode = 'manual'`. `isManualCourier` is checked BEFORE the label test in `generateForShipment`, because a manual shipment carries an AWB and no `awb_labels` row — byte-identical to the "AWB landed, label leg failed, resume it" recovery shape, which would ask a courier with no adapter for a PDF and be re-queued by BullMQ forever. **Real-mode ordering bug** — label upload currently precedes the awbNumber persist; a label-upload failure after Delhivery issued a real AWB leaks an unpersisted AWB → CUR-9 gate misses → retry double-generates. Inert in stub mode; the real-mode fix (persist awbNumber first, label as a retryable follow-on) is tracked in phase-1a-debt. **CUR-6b (2026-09-12): a waybill whose label never landed is asked for again, and a label is judged by its bytes.** The AWB job fetched the label once; on failure BullMQ retried ~20s, filed one generic per-worker "gave up on a job" issue, and nothing asked again. `AwbGenerationService.persistLabelForExistingAwb` is the label-only leg and NEVER books (no waybill ⇒ SKIPPED, never handed to `generateForShipment`); it also skips manual, adapter-less, already-labelled and retired shipments, and in production a stubbed courier (CUR-15). The hourly order-attention sweep (`checkLabellessAwbs`) retries PRE_DISPATCH waybills older than 10 min, raises HIGH `awb-label-missing:<shipment>` after an hour, and clears itself. `POST /admin/courier/awb-labels/backfill` (`courier.accounts.manage`, dry run by default, `scope` PRE_DISPATCH|ALL) is the operator catch-up. **Delhivery's download link sends an EMPTY Content-Type**, so the stored type comes from the bytes (`%PDF-`) and anything neither a PDF nor a typed image is refused (`LABEL_NOT_A_PDF`) rather than stored. **Shipments written by `scripts/seed-tracking-test-orders.mjs` never passed through the saga** (`awb_generated_at` NULL, no `awb.generated` audit) — count missing labels, and real bookings, against saga-booked waybills, never every row with an AWB (the 12 Sep courier table briefly read "22 real AWBs" when 2 were).

7. **CUR-7: Supersede chain — a failed AWB RETIRES the shipment, never deletes.** `AwbSupersedeService` sets the OLD shipment `FAILED_AT_CREATION` + `supersededAt`/`supersedeReason`, clears its `manifestId`, and creates a REPLACEMENT (status `CREATED`, `supersedesShipmentId` = OLD — the NEW→OLD FK; copies the dest snapshot + physical + pick/pack operational state + line snapshots; NO AWB / NO manifest). Idempotent (already-superseded → returns the existing replacement). Order routing to `PENDING_MANUAL_PLACEMENT` is the CALLER's (AWB job's) job — supersede is a shipment-level mechanism only (WMS-9 / ORD-3 separation).

8. **CUR-8: Manual placement.** A `MANUAL_PLACEMENT_ADMIN`/`SUPER_ADMIN` records a manually-arranged courier AWB on a `PENDING_MANUAL_PLACEMENT` shipment (`ManualPlacementService.placeAwb` — `courierCode='manual'`, `isManualCourier=true`) and the order dispatches directly (`PENDING_MANUAL_PLACEMENT → DISPATCHED`). Under Model C this edge is stock-neutral (`sideEffects: []`) — the decrement already fired at pack. **AMENDED 2026-09-02: conservation is preserved by ROUTING, not by refusing.** `resolveReadiness` asks whether the goods are on a shelf: every ACTIVE reservation phase-2 ⇒ stamp the AWB and dispatch (as before); any phase-1 residual ⇒ stamp the AWB and transition to `PENDING_PICK`, so the parcel flows through the ordinary pick → pack → handoff path and `DISPATCH_STOCK` fires exactly once, at pack (CUR-3). The old 409 was a correct guard and a bad instruction: it was written for the PICK-SHORTFALL arrival (WMS-4), but an order also arrives here from a COURIER REFUSAL at confirmation (CUR-2b) having never been near the warehouse — nothing is wrong with it, it just needs picking. The two look identical to whoever is typing the AWB, and only one was accepted. **The unpicked path must NOT stamp `AWB_GENERATED`** — both warehouse queues select on `status='created'` (WMS-2), so that takes the parcel out of the pick AND pack queues in one silent move; this is exactly the CUR-2b trap, and it is pinned by a test. **AMENDED 2026-09-03 (Model C): "zero ACTIVE reservations" stopped being a reliable anomaly signal on its own.** A courier-rejection arrival is now ON_SHELF with ZERO active reservations by construction — pack.complete already `fulfill()`ed it, the same event `resolveReadiness` used to assume only happened at DISPATCH. So zero-active first checks for an existing `PACK_CONFIRM` movement (queried by `orderId`, which survives a supersede — it stays keyed to the ORIGINAL shipment, not the live replacement `placeAwb` targets): found ⇒ ON_SHELF; absent ⇒ still the genuine anomaly, still refused. Saga: stamp the AWB FIRST (visible), transition LAST; idempotent + convergent (AWB stamped + order still PMP → re-run the transition). `cancelUnfulfillable` → `CANCELLED_BY_ADMIN` now carries `UNPACK_STOCK` (CUR-3), not plain `RELEASE_STOCK` — the parcel may already be packed (courier-rejection shape) or may never have been (pick-shortfall shape), and a cancel here cannot assume which; idempotent.

9. **CUR-9: AWB is generated EXACTLY ONCE.** `shipment.awbNumber !== null` is the idempotency gate — a shipment that already carries an AWB is SKIPPED, never re-generated (in real mode this prevents a double Delhivery call / double charge on a BullMQ retry). The supersede chain (idempotency keyed on the old shipment's `supersededAt`) and manual placement honor the same once-only discipline.

**Multi-courier rules (CUR-12 through CUR-16, 2026-08-29 — NON-NEGOTIABLE). Shiprocket joined Delhivery; these are what keep two couriers from becoming two half-systems.**

1. **CUR-12: a courier is reached through a DISPATCHER, never by a branch at the call site.** `CourierAwbDispatchService` (book + label), `CourierNdrDispatchService` (re-attempt), `CourierOpsDispatchService` (cancel / pickup / warehouse / edit), `CourierSupportRegistryService` (escalation desks), and the `COURIER_TRACKING_SOURCES` list (poll + webhook normalise). Each is the ONE place that knows Delhivery takes one call where Shiprocket takes two, or that one returns a PDF where the other returns a URL. Everything that must happen identically — CUR-2's failure isolation, CUR-9's once-only gate, the audit row, CUR-11's refusal to move the order — stays outside them, written once. **Add a third courier by implementing the interface and appending it to the list; do not add a branch upstream.**

2. **CUR-13: `serviceable: false` is the load-bearing field, and it means "this courier will not carry this parcel".** True means "ask again later". **It is NOT "the pincode is out of range" (corrected 2026-09-02).** The Delhivery classifier read it that way — a regex over the message for serviceability wording, with every OTHER refusal reported as `serviceable: true`. So a refusal that was permanent got the answer a timeout gets. SD-2026-26-000003 was refused with `[ER0005] ... suspicious order/consignee`, an opinion about the consignee identical on every future attempt; it never failed over, never reached manual placement, and sat in CONFIRMED being re-asked forever with nobody told. **The default now inverts: a parsed refusal IS a refusal** (`DELHIVERY_REFUSED`), and only wording that genuinely means "not right now" — internal error, rate limit, an explicit try-again — stays retryable. When adding a courier adapter, classify on whether they FORMED AN OPINION about the parcel, never on which words the opinion used. That distinction is what makes failover correct: a refusal fails over immediately, a timeout does not (the existing BullMQ retries own it, CUR-2b). Failing over on a thirty-second wobble silently moves volume, and cost, to a courier nobody chose. Both refusing ends at manual placement — where it went before failover existed.

3. **CUR-14: failover is SYMMETRIC by construction and must stay that way.** The saga never names a courier: on a refusal it asks `CourierDistributionService.pickAlternate` for a DIFFERENT one, excluding whoever just said no. Delhivery→Shiprocket and Shiprocket→Delhivery are the same code path, and `awb-generation.service.spec.ts` pins both directions. **A shipment records WHO CARRIED IT** — `courierCode` and `courierShipmentId` are rewritten on a successful failover, because every later label fetch, tracking match, cancel and POD is addressed from that row.

4. **CUR-15: a STUB may never answer for a LIVE courier.** Stub mode returns a fabricated success (a waybill derived from the shipment id) — right in dev and CI, catastrophic in a MIXED configuration, which is what production is: Delhivery live, Shiprocket stubbed. Without the guard, a parcel Delhivery refuses fails over to the stub, comes back "booked" with a waybill nobody issued, and is dispatched: stock already decremented at PACK (CUR-3), the customer told it shipped, no van ever coming, surfacing weeks later as a parcel that never moved. The rule is narrow on purpose — refuse the failover only when the ALTERNATE is stubbed and the refuser is NOT. Both stubbed is dev/CI; both live is the case failover exists for.

5. **CUR-16: the intake switch is `Courier.isActive`, read in ONE place (`CourierEnablementService`), and OFF means NO NEW PARCELS — not "stop tracking".** A courier switched off mid-week still holds real parcels moving towards real customers; going quiet on those is the same failure as never polling them. So the tracking poll, the NDR runner, cancels and the ops panel all keep working for in-flight parcels. **The flag is the COLUMN, deliberately not a `courier.<code>_enabled` setting** — a second source of truth for "can this courier carry a parcel" is exactly the drift CNS-2 and BIN-1 exist to prevent. The distribution paths already honoured it; the AWB dispatcher did NOT, which meant a shipment arriving with a courier code already on it (a stale seller link, a supersede replacement, a manual re-run) was still booked. Enforced at the booking boundary now, reported as `COURIER_DISABLED` + `serviceable: false` so it reaches a human rather than retrying a switch somebody turned off on purpose. Toggle: `PATCH /admin/couriers/:code` (reason ≥10 chars, audited HIGH), screen on `/courier-accounts`. **CUR-19 (2026-09-12): the default courier is PER SELLER, and a courier with no adapter is never failed over from.** `ops.default_courier_code` is seller-overridable (SET-1): `OrderPostCommitHooksService` resolves it with the order's `sellerId` and passes it in `ProvisionShipmentInput.courierCode` (REQUIRED); `ShipmentProvisionService` never reads the key, because a global fallback there would silently undo a seller pinned to `manual`. Resolution FAILS CLOSED — an error leaves the order CONFIRMED with no shipment rather than provisioning with the global default and booking a live waybill. `setOverride` refuses a code not in `couriers` (`UNKNOWN_COURIER_CODE`); a switched-off courier is still a valid value. `CourierAwbDispatchService` answers `NO_ADAPTER` for an adapter-less courier BEFORE the intake switch — `COURIER_DISABLED` fails over, and `manual` is routinely `is_active=false`, so an inactive manual courier used to fail over to a real Delhivery booking — and the saga refuses failover whenever `!dispatch.hasAdapter(shipment.courierCode)`: a manual parcel goes to PENDING_MANUAL_PLACEMENT and never to a live courier. This is how production money-flow tests run for ONE seller without booking real waybills. **A failed provision is never silent**: it raises HIGH `shipment-missing:<orderId>`, and the hourly AWB-less sweep also finds CONFIRMED / AWAITING_COURIER / PENDING_PICK orders with NO live shipment and re-provisions them through the shared hook (`OrderWriteService.reprovisionShipment`) — before this a confirmed order holding reserved stock could sit with no shipment, no waybill and nothing raised.

6. **CUR-17 (2026-09-09): WHICH carrier, when the courier is an aggregator — and `AWAITING_COURIER` is where a parcel waits for that answer.** Delhivery IS a carrier, so booking with them is the choice. Shiprocket resells a dozen, quotes them all at serviceability, and **will rank and pick one itself if the assign call carries no `courier_id`** — which is a real answer, was the behaviour before this existed, and stays the default (`courier.selection_policy` seeded `SHIPROCKET_DEFAULT`, so the deploy changes nothing). The other four policies are `CHEAPEST`, `FASTEST`, `CHEAPEST_WITHIN_DAYS` (`courier.selection_max_days`, 5) and `MANUAL`; all are seller-overridable through SET-1, because a seller selling ₹300 kurtas and one selling ₹9,000 electronics do not want the same trade.

   **`CourierOptionSelectionService` is the ONE place a policy becomes a carrier** — pure, no Prisma, no HTTP, F2-exhaustive over the five values, so a sixth fails to compile until somebody decides what it means. Three callers need "what would the policy pick" (the AWB saga, the decision screen, the TTL sweep), and three copies of that arithmetic is how the sweep comes to disagree with the screen an operator was looking at. Its rules are opinions worth keeping: an unknown day estimate sorts LAST rather than as 0 (a carrier that told us least must not look like the quickest) and is EXCLUDED from `CHEAPEST_WITHIN_DAYS`'s qualifying set (an unknown ETA is not evidence of arriving in time, and it would win on price every time); when nothing meets the deadline it takes the FASTEST, not the cheapest, because the policy is a deadline with a price preference inside it and missing the deadline to save money inverts what was asked for. **ONE option is never a question**, whatever the policy says — a decision screen with a single button on it holds a parcel, its stock and its customer for nothing, and our own pickup pin really does return one carrier on some lanes.

   **`CourierChoiceService` fails open on EVERY path.** A serviceability timeout, an unreadable setting, a missing origin pin, a policy value that is a typo, a failed options write — all of them return "book, and let the carrier rank". The failure this design is protecting against is not picking the wrong carrier; it is a rate lookup taking the day's dispatches with it. The DEFAULT policy costs no API call at all, because fetching options nobody reads would put a live round-trip on the critical path of the commonest configuration.

   **`AWAITING_COURIER` sits between call confirmation and printing, and exists so the wait is VISIBLE.** Without it a MANUAL parcel would sit in CONFIRMED looking exactly like every other confirmed order, and the only sign that it was waiting on anybody would be an absent waybill — which is what ATT-1's sweep chases hours later. Edges: `CONFIRMED → AWAITING_COURIER` (stock-neutral — ORD-10 reserved on the FIRST entry to CONFIRMED), back to `CONFIRMED` once booked (**not** forward to PENDING_PICK: the label queue selects on CONFIRMED/PENDING_PICK per WMS-2 and printing comes first per WMS-1, so returning puts the parcel exactly where an unpaused one would be, and re-entry cannot double-book because CUR-9's gate is `awbNumber !== null` and by then it is set), `PENDING_MANUAL_PLACEMENT` when every courier refuses, and both cancels with `RELEASE_STOCK`. It is in `SELLER_CANCELLABLE_STATES` — no waybill, nothing picked, one of the cheapest points in the lifecycle to change your mind.

   **A decision already made is never re-asked**: `shipments.chosenCourierCompanyId` is read FIRST in `decide` and short-circuits the policy, or un-pausing a MANUAL parcel would immediately re-pause it — a loop rather than a workflow. **The chosen id must be one WE offered** (`COURIER_NOT_OFFERED`): sending a carrier that was never quoted for the lane comes back as a booking failure with nothing pointing at the cause. `courierOptions` + `courierOptionsFetchedAt` are persisted whatever the outcome and BEFORE it is acted on — asked a month later, "why did it go by that one" is answered by the list that was on the table at the time, and rates move.

   **The TTL sweep is the half that matters most, and it is LOUD ON PURPOSE.** A decision queue nobody watches is a queue that silently holds confirmed parcels whose stock is reserved and whose customers have been told they are coming — and the seller who set the policy is not the person watching. After `courier.selection_decision_ttl_hours` (6) we book the CHEAPEST ourselves (choosing on somebody's behalf should spend the least of their money) and raise a HIGH `COURIER_DECISION` system issue saying we did. **Auto-picking quietly would make MANUAL indistinguishable from CHEAPEST for anybody not watching**, and the seller would keep believing they were choosing. Per-parcel isolation in the loop; every 15 minutes, because the tick only decides how far past an already-missed deadline a parcel goes.

   **Failover is unchanged and still applies after a choice**: a refusal from the chosen carrier goes through CUR-14 to the alternate courier, and both refusing ends at manual placement. Screen: `/courier-decisions` behind `orders.courier_choice` — its own permission, because the people who work this queue are not necessarily the ones who cancel orders or force statuses.


7. **CUR-18 (2026-09-09): `CourierPortalMode.OFF` is the stop, and SHADOW never was.** SHADOW prepares everything and withholds the click — which still means opening a browser, signing in and reading their tabs, so it keeps a live session against somebody else's portal and keeps failing at 3am about work nobody is waiting for. OFF opens nothing: the dispatcher, the ticket sweep and the nightly canary are all gated in `PortalQueue`'s own worker handler, which is their single entry point, so "no browser opens while OFF" is provable by reading one function rather than trusting three services to remember (**the ticket sweep in particular reads its own settings and deliberately ignores `portalMode`**, which is exactly why the stop sits above it). Checked PER JOB rather than at boot, so re-enabling takes effect on the next tick — a kill switch that needs a release is not a kill switch. A MODE and not a second boolean, because "may the portal act" already has one reader and a parallel flag is the drift CNS-2 and BIN-1 exist to prevent. **Only LIVE executes**: the dispatcher and canary computed `shadow = mode === SHADOW`, so a third mode would have fallen through to EXECUTING; they now ask `mode !== LIVE`, and a future mode is safe by default. **Production is OFF as of 2026-09-09** — Delhivery escalations are handled by hand — while `writeMode` stays AUTO, which changes nothing because `DelhiverySupportAdapterService` reports `postComment: false` / `raiseTicket: false` and every item already routes to a person. **CUR-20 (2026-09-12): support tickets are MANUAL for every courier, through one path.** No courier takes tickets from software (every support adapter reports `postComment`/`raiseTicket` false), so an escalation is opened on a ticket, its messages wait in the ops send queue, a person raises it on the courier's own desk, marks it sent with THEIR ticket number (which links replies), and types answers back in. **An escalation belongs to the courier that CARRIED the parcel**: `CourierEscalationService.openForTicket` reads it from the ticket's own parcel (`parcelForTicket`); the `'delhivery'` literal is only for a ticket with no parcel — defaulting had filed every Shiprocket escalation under Delhivery, and the ops queue hard-coded Delhivery One's link. **The desk is declared by the adapter** (`CourierSupportAdapter.supportDesk()`: panel, per-ticket URL or null, how-to) and read through `CourierSupportDeskService`; the email is the editable `courier.<code>_support_email`, seeded EMPTY (never guess an address) and required per courier by `courier-settings-coverage.spec.ts`. Nothing in `courier-escalation` compares or switches on a courier code (`courier-support-parity.spec.ts` scans for it). **An unsent message is chased**: `CourierEscalationWatchService` raises a HIGH INTEGRATION issue `courier-outbox-stalled:<itemId>` per outbox item still PENDING/SENDING after `ops.courier_outbox_stall_alert_hours` (24), any courier, clearing itself when the item leaves the queue. Both channels are MANUAL / portal OFF; a new courier needs its `courier_channel_settings` row in a migration, or the first read creates a SUPERVISED default nobody chose.


<!-- from CLAUDE.md lines 455-458 · Database -->
**Per-courier switches, and why every one of them is per courier.** `courier.<code>_live_writes_enabled`, `courier.<code>_api_base_url`, and `courier.<code>_auto_pickup_enabled` (CUR-10 amendment #3 — whether a packed box may ask that courier for its own pickup) are all derived from the courier code, so a third courier is a data change. **A single shared flag would mean enabling Delhivery for its first controlled parcel silently arms every Shiprocket write path**, with nobody having decided that. The NDR runner's dry-run gate follows the same rule: a run can legitimately be live for one courier and planning-only for the other, and it reports `dryRun` when ANY courier in the sweep was planning. **A new courier needs its seeded rows** — `courier-settings-coverage.spec.ts` reads the couriers off the AWB dispatcher's own switch and fails if a row is missing, because the guard fails CLOSED on an absent setting and therefore behaves perfectly while the admin page has no switch to show.

**What Shiprocket genuinely cannot do, refused BY NAME rather than silently degraded:** amend a registered pickup location (they have add, no edit — routing an update to `addpickup` creates a second location with the same name, and the name is what every manifest matches on); change a product description on a live parcel; convert payment mode; and they hold ONE document (the POD) where Delhivery has four, so a signature or RVP-QC request is refused rather than answered with the POD. **Their NDR is SYNCHRONOUS** — the reply is the outcome and there is no UPL to poll, so a successful submit is CONFIRMED at submit time; leaving it SUBMITTED sent it to the UPL poller, which read the missing handle as "the submit produced nothing" and escalated a re-attempt that had worked.


<!-- from CLAUDE.md lines 530-539 · Database -->
**Module 9 architecture (R3 + adapter):**
- The Delhivery integration is built against a clean `DelhiveryClient` ADAPTER INTERFACE. **STUB MODE** (empty `courier.delhivery_api_base_url`) is the default for local dev, e2e and CI — deterministic, no network (postal-code-keyed branches drive every test path: `999999` transient failure, `000000` non-serviceable — the latter is not a valid PIN so e2e drives failure via `999999`). **REAL MODE** marshals + calls Delhivery's wire API.
- **PRODUCTION IS IN REAL MODE (verified 2026-08-05).** `courier.delhivery_api_base_url = https://track.delhivery.com` on the live database. This doc claimed stub was "the Phase-1A default" everywhere, including in production; that has not been true since the D1–D7 work. What actually holds production safe is a DIFFERENT pair of switches, both currently OFF: `courier.delhivery_live_writes_enabled` (`DelhiveryWriteGuardService`) and `courier.delhivery_waybill_pool_refill_enabled`. **Reason about production safety from those two flags, never from the base URL.**
- **The wire contract WAS validated against the production API on 2026-07-27** — endpoints, auth, rate limits and response shapes are recorded in `docs/delhivery-integration.md` (distilled) and `docs/vendor/delhivery-b2c-api-raw.md` (raw capture). **No real-mode call site throws any more.** The 7 surviving `TODO(delhivery-api)` markers are cross-references and two genuine unknowns, both of which need Delhivery rather than code: the exact webhook payload field/header naming (Delhivery fixes this when they provision from our Webhook Requirement Document) and the NDR `failureReason` vocabulary. **GO-LIVE HAS HAPPENED (corrected 2026-08-29).** This paragraph claimed for weeks that no real write had been made, and it was wrong — checked against the production database rather than the docs: `courier.delhivery_live_writes_enabled` is **TRUE**, the base URL is `https://track.delhivery.com`, **11 shipments carry a real AWB**, and there are **7 `courier.delhivery.live_write_to_production` audit rows**. `docs/delhivery-go-live-test.md` was never updated and still reads "not yet performed"; treat that file as stale until somebody rewrites it.

**Reason about the write posture from the DATABASE, never from this file or that one.** The two questions are `courier.<code>_live_writes_enabled` and `courier.<code>_api_base_url`, and both are one query away. Repeating a stale doc is how a session concludes that production is safe when it is manifesting real parcels — which happened, twice in one conversation, immediately before this correction.
- Module split: `courier-shared` (`CourierCredentialService`), `courier-delhivery` (the adapter — `DelhiveryHttpService`/`DelhiveryAwbService`/`DelhiveryLabelService`/`DelhiveryServiceabilityService`), `courier-awb` (the AWB generation saga + BullMQ worker), `courier-dispatch` (`DispatchHandoffService` + endpoint), `courier-manual-placement` (`ManualPlacementService` + endpoints). The M8 R3 primitive `shipment-provision` is reused (`ShipmentNumberingService` for supersede replacements).
- The AWB generation saga is the **FIFTH canonical application** of the saga + visible-vs-silent failure-ordering pattern.
- **M9 HTTP endpoint map** (all staff-JWT, `requireStaffRoles` inline RBAC): `POST /admin/courier/manifests/:manifestId/confirm-handoff` (`WAREHOUSE_SUPERVISOR`/`SUPER_ADMIN` — CUR-4 dispatch handoff); `POST /admin/courier/manual-placement/shipments/:shipmentId/place-awb` and `.../cancel` (`MANUAL_PLACEMENT_ADMIN`/`SUPER_ADMIN` — CUR-8). AWB generation itself has NO endpoint — it is BullMQ-driven off `ManifestService.close` (CUR-2); `AwbGenerationJobService.processManifest` is public as the manual ops re-trigger.


<!-- from CLAUDE.md lines 556-566 · Database -->
**Shipment rules:**
1. Webhook idempotency: M10 implements TRK-2's two-layer dedup — ingest-time `(courierCode, signature)` (same signed body ⇒ duplicate; 200 + original webhookId, no new row) + processor-time master gate (`courier_webhooks.status !== RECEIVED` short-circuits a BullMQ retry) + per-side-effect dedup keyed on `webhookId` (tracking_events, delivery_attempts). The historical "(courierCode, awbNumber, eventType, externalEventId)" dedup spec is superseded by signature-based dedup — see TRK-2.
2. Status transitions enforced by state machine (16 statuses).
3. AWB lifecycle: when superseded (e.g., Delhivery rejected → Bluedart), new shipment gets new AWB. Never reassign.
4. Webhook receipt acknowledged ASAP: write raw row, return HTTP 200 within 500ms, process async via BullMQ (M10 implements this — the public controller returns 200 with `webhookId` immediately after the dedup + insert; processing is the BullMQ `TrackingWebhookWorker`).

**Credential rules:**
1. Decryption key NEVER in DB. Always env var (`COURIER_CREDENTIALS_KEY_<version>`).
2. Every decrypt writes an `audit_logs` row before returning plaintext.
3. Plaintext credentials are NEVER logged, NEVER serialized to API responses, NEVER cached longer than 5 min.


<!-- from CLAUDE.md lines 872-1062 · MUST / MUST NOT -->
19. Honor CUR-1 through CUR-9 (Module 9) **and CUR-10/CUR-11 (courier-ops, 2026-07-27)**. qtyOnHand decrements EXACTLY ONCE — at PACK (`PICKED → PACKED`), via the `DISPATCH_STOCK` matrix side-effect (CUR-3, Model C, 2026-09-03 — supersedes Model A's dispatch-time decrement); never add another lifecycle decrement. A cancel of an already-packed-but-undispatched order uses the `UNPACK_STOCK` give-back, never plain `RELEASE_STOCK`. **The handover SCAN dispatches the parcel and closes its manifest out (CUR-4, amended 2026-09-03); the manifest is a record, not a step — do not reintroduce a mandatory close/confirm click, and do not make anything depend on a manifest having been closed.** AWB generation is once-only — `shipment.awbNumber` is the gate (CUR-9). Courier credentials decrypt only via `CourierCredentialService` with an audit row per decrypt (CUR-1); the key stays in env, never the DB. The Delhivery wire contract WAS validated against the production API on 2026-07-27 (`docs/delhivery-integration.md`); no real-mode call site throws. **Delhivery IS LIVE (corrected 2026-08-29): live writes ON, real base URL, 11 real AWBs issued.** Shiprocket WAS NOT until at least 2026-09-09 (no base URL, stub answers, live writes off); **on 2026-09-12 production showed it ON — `Courier.isActive` true, base URL `https://apiv2.shiprocket.in`, `courier.shiprocket_live_writes_enabled` true — so failover to it is real (docs/courier-parity.md)**. Earlier text: — and the blocker is not engineering time (`docs/shiprocket-integration.md`, 2026-09-08): their API is **not** geo-restricted so no India-hosted worker is needed. **The account was provisioned and the contract PROVEN on 2026-09-09**: a real parcel was booked through our own adapter (AWB 90658129413, Blue Dart Air) and cancelled cleanly. It stays OFF for ordinary traffic (`Courier.isActive` false, base URL empty, live writes off) — the switches were on only for that run. **Check the database before asserting either way** — this file said the opposite for weeks. Safety comes from the write guard, NOT from stub mode. Manual placement is conservation-guarded — never dispatch an order with a residual phase-1 reservation (CUR-8). **CUR-10 (AMENDED 2026-08-05 — see the dated note below): a physical-world courier call is OPERATOR-TRIGGERED and audited, OR fired by a runner whose write channel an operator explicitly enabled — behind the live-write guard, the per-category auto list, and the kill switch.** A cancel turns a moving parcel into a return; an NDR re-attempt sends a van; there is no sandbox, so every one of those is real. Every such call sits behind the write guard (per courier, default OFF). Automating one before the controlled first-parcel test proves the contract is automating an unproven call.

    > **CUR-10 amendment, 2026-08-05.** The original wording was absolute: *"never fired from a lifecycle transition, a cron, or a customer-facing handler."* The courier-escalation work needs a nightly NDR batch runner — Delhivery only accepts re-attempt actions after 21:00 IST, so the action is inherently scheduled and cannot be operator-triggered at the moment it must happen. Rather than let a cron quietly violate a written invariant, the invariant is widened DELIBERATELY and narrowly: a runner may fire courier writes **only** when an operator has explicitly enabled that write channel, and every such call still passes the live-write guard, an explicit per-category auto list (default EMPTY), and a one-click kill switch. **A lifecycle transition and a customer-facing handler remain forbidden triggers — that half of the original rule is unchanged.** CUR-11 is untouched: whatever a runner fires, the courier's own scans remain the sole authority on order status.

    > **Amendment, 2026-09-29 — the two gates are now PER SELLER, and a
    > seller override may only ever NARROW.** `courier.ndr_runner_enabled`
    > and `courier.ndr_auto_categories` are seller-overridable (SET-1);
    > the other NDR keys — the cron lines, the batch cap, the UPL poll and
    > the reconciliation window — stay global, being properties of ONE
    > sweep on ONE schedule. **SET-1's ordinary `sellerOverride ??
    > systemDefault` is exactly the shape that must NOT be used for these
    > two**: one seller row saying `true` would fire vans on a night an
    > operator had switched the runner off, and a seller list naming an
    > action the global list has never permitted would send it. So
    > `narrowNdrGate` (`courier-ndr-runner/services/ndr-gate.ts`, pure) is
    > the ONE place the two pairs are combined — `enabled` is **ANDed**,
    > the action list is **INTERSECTED** with the global CEILING — and
    > `NdrSettingsService` is its only caller (`runnerEnabled` /
    > `autoActions` are private, so nothing outside can read a global
    > switch and act on it as the answer for a parcel). A global "off"
    > additionally returns before any seller override is read at all.
    > Resolution is per PARCEL'S SELLER inside the sweep, cached per
    > distinct seller, and FAILS CLOSED — an unreadable setting narrows
    > that seller to nothing, because not firing a van we meant to costs a
    > day while firing one we did not costs money and a customer's
    > afternoon. A seller switched off is reported as
    > `notActionedForSeller`, NEVER as `dryRun`: a dry run means the write
    > guard stopped a submission, this means there was never going to be
    > one, and reading one as the other tells an operator the whole run
    > was planning when it was live for everybody else. **SET-1 also
    > gained JSON content validation** (`JSON_VALUED_ENUM_LIST_KEYS`):
    > `parseAndClamp` checked only that a JSON value was an object or an
    > array, so a list holding `RE_ATTEMPT` saved cleanly, showed on the
    > seller's screen, and was silently discarded by the runner — an
    > action a seller believed was on and which never fired. Both keys'
    > overrides audit **HIGH** rather than the ordinary MEDIUM
    > (`PHYSICAL_CONSEQUENCE_OVERRIDE_KEYS`), set and cleared, because
    > this decides whether a van is dispatched on that seller's behalf.
    > Pinned by `ndr-seller-gate.spec.ts` (the narrowing in both
    > directions, the intersection, fail-closed, and the resolver's
    > vocabulary against the runner's own) and the per-seller block of
    > `ndr-runner.service.spec.ts` (a mixed batch, one resolution per
    > distinct seller, no tracking read for a seller switched off).

    > **CUR-10 amendment #2, 2026-09-01 — the seller may return their OWN parcel.**
    > The original rule forbade a customer-facing handler from firing a courier
    > write outright. That is widened, narrowly, for exactly ONE action: a seller
    > choosing "send it back" on their own order calls Delhivery's cancel
    > immediately, with no operator in the loop. The reasoning is that it is the
    > seller's goods and the seller's return fee (delivery + `pricing.flat_rto_fee_inr`),
    > and an operator step adds hours to a decision that was never ours — while
    > the parcel keeps moving further from the warehouse the whole time.
    > **What does NOT change:** the call still passes `assertWritable('shipment.cancel')`,
    > so the per-courier live-write guard and kill switch apply exactly as before
    > — the guard sits inside the dispatcher and does not care who asked. The
    > audit row records `ActorType.SELLER` with the seller id, never a staff
    > member who did not act, because "we decided to return this" and "the seller
    > decided to return this" are different facts and only one of them is ours to
    > answer for when the customer rings. RE-ATTEMPT and RECALL are UNCHANGED and
    > still stop at an operator: a re-attempt dispatches a van at our cost, which
    > is not the seller's to spend. A lifecycle transition remains a forbidden
    > trigger. **Do not widen this to a second action without the same argument
    > holding — whose goods, whose money, and what an operator would actually add.**
    >
    > **A courier that accepts a cancellation is not a parcel coming back.**
    > `OrderAttentionService.checkStalledReturns` is the watchdog: an EXECUTED RTO
    > request with no return scan after `ops.rto_stall_alert_hours` (48) raises a
    > HIGH system issue and clears itself once the order reaches any RTO state.
    > Without it the request row reads EXECUTED (the courier really did accept),
    > every downstream step waits on a scan that is not coming, and the seller
    > believes their goods are on the way back. It runs even when the NSA half is
    > switched off — it is not an NSA flag, and gating it behind an unrelated
    > switch is how it would come to be silently off.

    > **CUR-10 amendment #3, 2026-09-03 — a packed box may ask for its own pickup.**
    > `PackService.complete`'s post-commit hook (alongside the existing WMS-7
    > manifest auto-attach) now calls `CourierPickupService.raiseIfDue`, which
    > asks the courier for today's van the moment a parcel is ready — but ONLY
    > when `courier.<code>_auto_pickup_enabled` is explicitly ON (default OFF).
    > This is the SAME shape as the 2026-08-05 runner amendment, not a new kind
    > of exception to it: a recurring operational fact the warehouse already
    > produces, gated behind its own per-category switch, still behind the
    > live-write guard, audited as a RUNNER action. **What makes this safe to
    > widen at all is the GRAIN**: a pickup is requested per (courier,
    > warehouse, day), never per parcel — `raiseIfDue` checks for an existing
    > REQUESTED row for today before calling anything, so the first box closed
    > that day is the only one that reaches the courier; every later box the
    > same day is a no-op, because one van already covers the building. A
    > FAILED day is deliberately NOT retried automatically — that stays the
    > Pickups screen's release-day/retry job, so one bad response cannot turn
    > into a call fired on every subsequent parcel. The request row records
    > `requestedByStaffId: null` and the audit row `ActorType.SYSTEM` — a
    > packer did not decide to summon a van, and crediting them with that
    > decision would be a false record of who acted, the same distinction the
    > handover-scan gate and the automatic dispatch handoff already draw.
    > A MANUAL courier is skipped before this is ever reached — there is no
    > account to ask. **Do not widen the grain to "per parcel" or make a
    > FAILED day auto-retry without the same argument holding.**
    >
    > **Same day, standing-ON decision:** both switches are seeded `true`
    > from here forward (`20260903200000_auto_pickup_standing_on` flips the
    > two already-deployed rows, since seedSystemSettings() is create-only
    > on value columns — same reason 2026-07-26's accrual-tier default
    > needed a migration, not just a seed edit). This is a change of
    > DEFAULT, not a removal of the switch: the kill switch is the entire
    > point of gating this behind a setting rather than hardcoding it, and
    > it stays reachable from `/settings` with no deploy required. The
    > manual "raise a pickup" screen (`/warehouse/pickups`) is delisted
    > from the warehouse hub's nav — the ordinary case needs nobody to
    > visit it now — but the ROUTE is kept, for exactly the case CUR-10
    > amendment #3 already named: a FAILED day is not auto-retried, and
    > releasing one plus manually re-raising immediately (rather than
    > waiting for the next box to close) is done from that screen.
    >
    > **Amendment, 2026-09-12 — a box that asks for no van SAYS so.** Production
    > had both switches ON and an EMPTY `courier_pickup_requests`: every box
    > packed since 3 Sep was a MANUAL parcel, and the 22 Delhivery rows were
    > `SH-TEST-*` seeded straight to DISPATCHED, so the trigger never ran — and
    > had it run and failed, nobody would have known (the outcome went unread;
    > a pre-claim refusal was one warn line). `raiseIfDue` now NEVER throws;
    > every outcome leaving a box without a van (`COURIER_FAILED`,
    > `DAY_FAILED`, `NOT_RAISED`) raises a HIGH INTEGRATION issue
    > `auto-pickup:<courier>:<warehouse>`, bumped by later boxes and cleared by
    > a successful request; a pre-claim refusal also audits
    > `courier.pickup.auto_not_raised`. A FAILED day is looked up explicitly,
    > not left to the partial unique. The pickup location resolves exactly as
    > the AWB booking does (account name, then
    > `courier.<code>_pickup_location`). A box packed after
    > `courier.default_pickup_time` IST asks for TOMORROW's van. The switch
    > being OFF is deliberately not announced. **A parcel that never passes
    > `PackService.complete` never asks for a van** — seeded or imported
    > straight to DISPATCHED, or a god-mode jump past PACKED; its van is
    > arranged on /warehouse/pickups.
    >
    > **Amendment, 2026-09-19 — the per-courier location key is now TRUE,
    > and a courier that does not use one is not asked for one.** The
    > paragraph above claimed `courier.<code>_pickup_location`; the pickup
    > service actually held `const PICKUP_LOCATION_SETTING =
    > 'courier.delhivery_pickup_location'` and read it for EVERY courier,
    > beside a `const COURIER_CODE = 'delhivery'` used for every other
    > per-courier decision in the file. So a Shiprocket pickup either sent
    > DELHIVERY'S warehouse name to Shiprocket, or (with no account-level
    > name) was refused by a message naming a Delhivery setting that has
    > nothing to do with it. The key is composed per courier now,
    > `courier.shiprocket_pickup_location` is seeded EMPTY, and
    > **`CourierOpsDispatchService.pickupNeedsLocationName` is the ONE place
    > that knows a courier's own call does not use one** — Shiprocket's
    > `generate/pickup` takes shipment ids and nothing else, so demanding a
    > registered name there refused a collection that would have worked.
    > `pickupSchedulesPerParcel` and `pickupCourierCodes` moved to the same
    > dispatcher for the same reason: they were the dispatcher's switch
    > restated at the call site. The default courier for a pickup raised
    > with none named reads `ops.default_courier_code` (CUR-19's one key)
    > and **FAILS CLOSED** (`PICKUP_COURIER_REQUIRED`) rather than guessing
    > which company to send a real van request to. The manual
    > `/warehouse/pickups` form gained a courier picker — until then it
    > could only ever raise a Delhivery van, while the automatic trigger
    > passed the parcel's own courier, so the two halves disagreed.

    > **CUR-10 amendment #4, 2026-09-12 — a cancelled order's waybill is closed by a person, and chased until it is.**
    > A waybill is booked and charged at confirmation (CUR-2b); cancelling or
    > rejecting the order voids the shipment locally (`voidForOrder`: status
    > CANCELLED + `deletedAt`) and tells the courier nothing, and the courier
    > credits the charge back only once the waybill is cancelled with THEM. The
    > lifecycle stays a FORBIDDEN trigger — nothing cancels it automatically.
    > The courier-ops per-shipment cancel accepts a VOIDED shipment holding a
    > waybill (same permission, live-write guard, HIGH audit; the reply moves no
    > order, CUR-11); every other courier action still refuses one — the lookup
    > filtered `deletedAt: null`, so before this a voided shipment answered
    > SHIPMENT_NOT_FOUND to everything. **`shipments.courier_cancelled_at` is the
    > fact "the courier accepted a cancellation"**, stamped on a successful reply
    > by a guarded `updateMany`; a stamped voided shipment is refused
    > (`WAYBILL_ALREADY_CANCELLED`). `OrderAttentionService.checkLiveWaybills`
    > raises a HIGH `LIVE_WAYBILL` issue per voided shipment with a waybill and
    > no stamp after `ops.cancelled_waybill_alert_hours` (2), aged from
    > `deletedAt` (only the void writes it — rule 4b), clears once stamped or
    > un-voided, and never calls a courier (a source scan pins that it holds no
    > courier client). **A MANUAL courier waybill is refused and excluded** —
    > there is no courier account to cancel it on or be credited from. A cancel
    > claims `shipments.courier_cancel_started_at` before calling the courier
    > (a second operator gets `WAYBILL_CANCEL_IN_PROGRESS`; stale after 5 min).
    > A waybill cancelled in the courier's own portal is recorded with
    > `POST .../cancelled-outside` (voided shipments only, reason ≥10 chars,
    > audited HIGH, courier not called). In production a cancel on a STUBBED
    > courier is refused (`COURIER_STUBBED`) — a stub reports success without
    > calling anyone, which would have cleared `LIVE_WAYBILL` on a waybill
    > still live.

        **CUR-11: the courier is not an authority on our order status.** A successful cancel/edit/NDR action does NOT transition the order — Delhivery's own scans do, through the M10 webhook processor and `OrderWriteService.transitionStatus` (ORD-3). Writing the transition at the action site as well would give the order two authorities that can disagree, and only the scan reflects where the parcel physically is. The `courier-ops` module is the sole caller of the adapter's capability services; the adapter stays domain-free (it takes pincodes and grams), and `ShipmentCourierContextService` is the ONE place a shipment id becomes those inputs — five call sites resolving it inline is how they slowly disagree about which weight field to use.
19b. Honor CUR-12 through CUR-16 (multi-courier, 2026-08-29). Reach a courier through its DISPATCHER, never a branch at the call site (CUR-12) — add a third courier by implementing the interface and appending it to the list. `serviceable: false` means "will not carry"; true means "ask later", and only the first fails over (CUR-13). Failover is symmetric by construction — never special-case a direction — and a successful failover REWRITES `courierCode`/`courierShipmentId` on the shipment (CUR-14). A stubbed courier may never answer for a live one (CUR-15). The intake switch is `Courier.isActive` through `CourierEnablementService` alone, OFF means no NEW parcels while in-flight ones keep being tracked, and it is enforced at the BOOKING boundary as well as in routing (CUR-16). Every write switch is per courier; a new courier needs its seeded `courier.<code>_live_writes_enabled` row or it has a gate with no screen.
