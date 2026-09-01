-- Things the system cannot fix by itself.
--
-- `audit_logs` records what HAPPENED; this records what is still WRONG.
-- A HIGH-severity audit row is a fact about a moment that nobody owns;
-- an issue has a state and stays visible until a person closes it.
CREATE TYPE "system_issue_kind" AS ENUM (
  'courier_portal_login', 'courier_portal_challenge', 'courier_cost_sync',
  'courier_credential', 'tracking_stalled', 'integration', 'other'
);
CREATE TYPE "system_issue_severity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE "system_issues" (
  "id"                        UUID PRIMARY KEY DEFAULT uuidv7(),
  "kind"                      "system_issue_kind" NOT NULL,
  "severity"                  "system_issue_severity" NOT NULL,
  "title"                     TEXT NOT NULL,
  "detail"                    TEXT NOT NULL,
  "source"                    TEXT NOT NULL,
  "dedupe_key"                TEXT NOT NULL,
  "occurrence_count"          INTEGER NOT NULL DEFAULT 1,
  "first_seen_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "acknowledged_at"           TIMESTAMPTZ,
  "acknowledged_by_staff_id"  UUID,
  "resolved_at"               TIMESTAMPTZ,
  "resolved_by_staff_id"      UUID,
  "resolution_note"           TEXT,
  "metadata"                  JSONB,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- @updatedAt is set by Prisma on every write, so no DB default.
  "updated_at"                TIMESTAMPTZ NOT NULL
);

CREATE INDEX "system_issues_resolved_at_severity_last_seen_at_idx"
  ON "system_issues" ("resolved_at", "severity", "last_seen_at");
CREATE INDEX "system_issues_kind_resolved_at_idx"
  ON "system_issues" ("kind", "resolved_at");

-- ONE open issue per problem.
--
-- A nightly job failing for a fortnight is one issue seen fourteen
-- times, not fourteen issues — a list that grows a row a night is a list
-- people stop reading. Partial, so a RESOLVED issue that returns opens a
-- fresh one rather than silently reopening a row somebody already
-- closed. Enforced by the index rather than by a read-then-write, which
-- under READ COMMITTED lets two concurrent raises both insert.
CREATE UNIQUE INDEX "system_issues_open_dedupe_key"
  ON "system_issues" ("dedupe_key") WHERE "resolved_at" IS NULL;
