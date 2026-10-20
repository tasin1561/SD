# Call center (CC-1..7)

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 258-278 · Database -->
**Call Center rules (Module 7 — CC-1 through CC-7, NON-NEGOTIABLE):**

1. **CC-1: `call_attempts` is APPEND-ONLY.** Each row is a historical fact; no UPDATE/DELETE path by construction (matches ORD-4 / `order_events` / `stock_movements`). Added to MUST NOT list.

2. **CC-2: Outcome→transition mapping is centralized in `CallOutcomeMappingService`.** Single source of truth (pure logic, no Prisma, mirrors `OrderStateMachineService`). The 9-outcome table + the at-cap NDR reroute live ONLY here; never duplicated in controllers/other services. The 6/9 cap-counting set is derived from this service so it can't drift.

3. **CC-3: The order transition is POST-COMMIT of the attempt write.** The attempt is the source of truth: it persists regardless of what the transition does. A `transitionStatus` failure is logged + audited HIGH (`call_attempt.transition_failed`) and swallowed — NEVER thrown upstream, NEVER rolls back the attempt. The M5 reserve saga may itself land CONFIRMED→OUT_OF_STOCK; that is M5's call and surfaces in `finalOrderStatus`.

4. **CC-4: Attempt write + queue-entry COMPLETED are one tx.** Atomic: attempt inserted AND entry closed together, or neither. `priorAttemptCount` is counted BEFORE the insert (filtered to the 6 counting outcomes) so the resolver's +1 is exact.

5. **CC-5: Attempt counting respects the 6/9 list.** CONFIRMED, CUSTOMER_DECLINED, WRONG_NUMBER, NO_ANSWER, BUSY, VOICEMAIL_LEFT count; CALLBACK_REQUESTED, TECHNICAL_FAILURE, LANGUAGE_BARRIER do NOT. At cap, a CALL_NO_RESPONSE-bound counting outcome reroutes to terminal REJECTED_NDR with no re-queue. Effective cap = `seller.callMaxAttemptsBeforeNdrOverride ?? ops.call_max_attempts_before_ndr ?? 3`.

6. **CC-6: Enqueue on entry to PENDING_CONFIRMATION, dequeue on exit — both idempotent, both POST-COMMIT, best-effort.** Enqueue at `OrderService.create` (PENDING_CONFIRMATION initialStatus — covers the CSV worker) + `OrderService.submit` + `OrderWriteService.transitionStatus` (result.status===PENDING_CONFIRMATION). Dequeue at `transitionStatus` on any PENDING_CONFIRMATION exit. **Dual-path idempotency:** a CallAttemptService flow already COMPLETED the entry in its own tx, so the post-commit transition's dequeue is a safe no-op (`{dequeued:0}`); an admin cancel or a god-mode status change (which runs the same `OrderPostCommitHooksService.runForStatusChange`, ORD-2) does the real close; the enqueue on entry to PENDING_CONFIRMATION runs for god mode too. enqueue no-ops on an existing OPEN entry (partial-unique). A best-effort failure never fails the order write — an admin re-enqueue / out-of-band reconciler recovers (mirrors INV-5 / the saga post-commit discipline).

7. **CC-7: Assignment expiration is purely time-based + idempotent.** A delayed BullMQ job scheduled at pull time fires `AssignmentExpirationService.expire()`; a guarded conditional `updateMany` on `(status=ASSIGNED, that exact assignedAt)` reverts ASSIGNED→PENDING (clears agent, `availableAt` untouched → original FIFO position kept). Already-COMPLETED/EXPIRED, already-PENDING, or re-ASSIGNED-with-newer-assignedAt all no-op, so retries / duplicate deliveries / an old timer racing a fresh re-pull can never double-expire or steal a new assignment. The `expire()` method is public — it doubles as the manual trigger. Custom BullMQ jobId must be colon-free (Redis key separator) — encode the timestamp as epoch-ms.

**Module 7 architecture (R3 + facade):**
- The queue PRIMITIVE lives in a standalone `call-queue` module (`CallQueueService` — `enqueueOrder` / `enqueueAgain` / `dequeueOrder`; NO Order dependency). Imported by BOTH `order` and `call-center`; it imports neither. This **R3 split** removes the would-be `order ↔ call-center` circular module dependency WITHOUT `forwardRef` (same spirit as inventory-shared/inventory-stock and order-core/order). **When M8/M9 face the same "two domains need a shared cross-cutting primitive" shape, extract the primitive into its own dependency-free module rather than reaching for `forwardRef`.**
- `pullNext` lives in `call-center`'s `CallAssignmentService` (NOT the queue primitive) because it enriches via `OrderReadService`. FIFO via `ORDER BY available_at ASC, created_at ASC` + `FOR UPDATE SKIP LOCKED LIMIT 1` inside the assigning tx (Postgres-native; two agents clicking "next" can never get the same row).
- Cross-module export surface: `CallQueueService` (from `call-queue`) only. `call-center` exports NOTHING externally (CallOutcomeMappingService is exported intra-module only); CallAttemptService / AgentSettingsService / Admin* services are internal.
