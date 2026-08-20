-- Who was holding a call, for how long, and what came of it.
--
-- Append-only, and its own table rather than columns on
-- call_queue_entries: an entry is pulled many times over its life, so
-- columns could only ever remember the last agent to touch it — which is
-- exactly the history worth keeping for evaluating agents.

CREATE TYPE "call_hold_outcome" AS ENUM (
  'completed',
  'released',
  'expired',
  'agent_absent',
  'reassigned'
);

CREATE TABLE "call_assignment_holds" (
  "id"             UUID PRIMARY KEY DEFAULT uuidv7(),
  "queue_entry_id" UUID NOT NULL,
  "order_id"       UUID NOT NULL,
  "agent_id"       UUID NOT NULL,
  "started_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ended_at"       TIMESTAMPTZ,
  "outcome"        "call_hold_outcome",
  "held_seconds"   INTEGER,
  "attempt_id"     UUID,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "call_assignment_holds_queue_entry_id_fkey"
    FOREIGN KEY ("queue_entry_id") REFERENCES "call_queue_entries"("id") ON DELETE CASCADE,
  CONSTRAINT "call_assignment_holds_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "staff_users"("id") ON DELETE CASCADE
);

CREATE INDEX "call_assignment_holds_agent_id_started_at_idx"
  ON "call_assignment_holds" ("agent_id", "started_at");
CREATE INDEX "call_assignment_holds_queue_entry_id_idx"
  ON "call_assignment_holds" ("queue_entry_id");
-- Closing a hold finds it by (entry, still open).
CREATE INDEX "call_assignment_holds_queue_entry_id_ended_at_idx"
  ON "call_assignment_holds" ("queue_entry_id", "ended_at");
CREATE INDEX "call_assignment_holds_outcome_started_at_idx"
  ON "call_assignment_holds" ("outcome", "started_at");
