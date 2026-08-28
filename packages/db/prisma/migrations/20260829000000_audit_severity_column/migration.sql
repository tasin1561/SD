-- Severity, promoted out of JSON.
--
-- It has always been written into `metadata.severity`, which made "show
-- me everything CRITICAL this month" a JSON scan over the largest table
-- we keep. As a column with an index it is a question anyone can afford
-- to ask.
--
-- Backfilled from where it already lives, so history is not flattened to
-- the default. Rows that never carried one are genuinely LOW: the field
-- is optional at the call site and the callers that omit it are the
-- routine ones.
--
-- The service keeps writing metadata.severity as well. Every existing
-- reader and test assertion goes through it, and breaking those to
-- avoid one duplicated string would be a poor trade.
CREATE TYPE "audit_severity" AS ENUM ('low', 'medium', 'high', 'critical');

ALTER TABLE "audit_logs"
  ADD COLUMN "severity" "audit_severity" NOT NULL DEFAULT 'low';

UPDATE "audit_logs"
SET "severity" = CASE lower("metadata"->>'severity')
    WHEN 'critical' THEN 'critical'::"audit_severity"
    WHEN 'high'     THEN 'high'::"audit_severity"
    WHEN 'medium'   THEN 'medium'::"audit_severity"
    ELSE 'low'::"audit_severity"
  END
WHERE "metadata" ? 'severity';

-- Partial on purpose. The point is finding the few rows worth somebody's
-- attention, and LOW is almost all of them — indexing those too would
-- pay for a scan nobody performs.
CREATE INDEX "audit_logs_severity_created_at_idx"
  ON "audit_logs"("severity", "created_at")
  WHERE "severity" <> 'low';
