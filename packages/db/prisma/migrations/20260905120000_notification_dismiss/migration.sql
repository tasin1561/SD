-- Clearing a notification from your own inbox.
--
-- Deliberately NOT a row delete. notification_logs is the ledger the
-- NOTIF-2 dedup gate reads (the partial unique on event_id): removing a
-- row would let a re-emit of the same event send again, so "delete" in
-- the UI has to mean "hide it from this person" and nothing more. The
-- record of what was sent survives.
ALTER TABLE "notification_logs" ADD COLUMN "dismissed_at" TIMESTAMPTZ;

-- The in-app feed reads by recipient, newest first, and now skips
-- dismissed rows — so the partial index that serves it has to know
-- about them too, or every read falls back to a scan.
DROP INDEX IF EXISTS "notification_logs_in_app_feed_idx";
CREATE INDEX "notification_logs_in_app_feed_idx"
  ON "notification_logs" ("to_in_app_user_id", "created_at" DESC)
  WHERE "to_in_app_user_id" IS NOT NULL AND "dismissed_at" IS NULL;
