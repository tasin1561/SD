-- Module 11 — Notifications fan-out: additive schema changes.
--
-- 1. NotificationStatus += SKIPPED.
--    NOTIF-8: a fan-out target with no resolvable address (e.g., a
--    customer with no recipient email on the order snapshot) lands a
--    ledger row in SKIPPED — not FAILED. Lets reports distinguish
--    "tried to send but the provider rejected" from "no address, send
--    was never attempted."
--
-- 2. notification_logs.event_id (nullable text).
--    Carries the deterministic per-lifecycle-event idempotency key
--    (e.g., "order_status:<orderId>:<from>:<to>") for the M11 fan-out
--    path. Nullable because the 8+ legacy fire-once call sites
--    (auth, seller-mgmt, inventory alerts/receipt/adjustments,
--    category-proposal) continue to dedup by hand-coded findFirst and
--    pass no event_id.
--
-- 3. Partial unique index gating ONLY the eventId-bearing rows.
--    NOTIF-2/3: a re-emitted lifecycle event → identical event_id →
--    duplicate insert lands a unique-violation that the ledger catches
--    and converts to `deduped:true`, never enqueuing a second send.
--    `WHERE event_id IS NOT NULL` keeps legacy NULL-event rows
--    untouched (B2 — separately documented in phase-1a-debt).
--    Components include `recipient_id` IS NULLABLE (polymorphic
--    recipients allow null id); PostgreSQL treats NULL as distinct in
--    unique indexes by default — fine here since the lifecycle-event
--    fan-out always resolves a concrete recipient_id (seller id or
--    customer id) before enqueuing.

ALTER TYPE "notification_status" ADD VALUE IF NOT EXISTS 'skipped';

ALTER TABLE "notification_logs"
  ADD COLUMN "event_id" TEXT;

CREATE UNIQUE INDEX "notification_logs_event_dedup_uq"
  ON "notification_logs" (
    "event_id",
    "recipient_type",
    "recipient_id",
    "channel",
    "template_code"
  )
  WHERE "event_id" IS NOT NULL;

-- Supporting btree on event_id for the lookup path used by the e2e
-- regression test (finding rows by event_id without the full key).
CREATE INDEX "notification_logs_event_id_idx"
  ON "notification_logs" ("event_id")
  WHERE "event_id" IS NOT NULL;
