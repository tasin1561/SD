-- Phase 2 — the read pipeline: a courier conversation hanging off a Ticket.

CREATE TYPE "courier_message_channel" AS ENUM ('email', 'mcp', 'portal', 'manual');
CREATE TYPE "courier_message_direction" AS ENUM ('inbound', 'outbound');
CREATE TYPE "courier_template_candidate_status" AS ENUM ('unmatched', 'suggested', 'promoted', 'rejected');

CREATE TABLE "courier_escalations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "external_ticket_id" TEXT,
    "category_id" TEXT,
    "awb_number" TEXT,
    "courier_code" TEXT NOT NULL DEFAULT 'delhivery',
    "state" TEXT,
    "last_message_at" TIMESTAMPTZ,
    "needs_review_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "courier_escalations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_escalations_ticket_id_key" ON "courier_escalations"("ticket_id");
CREATE INDEX "courier_escalations_external_ticket_id_idx" ON "courier_escalations"("external_ticket_id");
CREATE INDEX "courier_escalations_awb_number_idx" ON "courier_escalations"("awb_number");
CREATE INDEX "courier_escalations_needs_review_at_idx" ON "courier_escalations"("needs_review_at");

CREATE TABLE "courier_escalation_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "escalation_id" UUID NOT NULL,
    "direction" "courier_message_direction" NOT NULL,
    "channel" "courier_message_channel" NOT NULL,
    "body" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "minute_bucket" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "template_code" TEXT,
    "state" TEXT,
    "confidence" DECIMAL(4,3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "source_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courier_escalation_messages_pkey" PRIMARY KEY ("id")
);

-- The dedup key. The minute bucket is load-bearing, not defensive:
-- Delhivery's canned replies repeat byte-identically across days, so a
-- (escalation, hash) key alone would swallow tomorrow's genuine reply as
-- a duplicate of today's.
CREATE UNIQUE INDEX "courier_escalation_messages_dedup"
    ON "courier_escalation_messages"("escalation_id", "body_hash", "minute_bucket");
CREATE INDEX "courier_escalation_messages_escalation_id_occurred_at_idx"
    ON "courier_escalation_messages"("escalation_id", "occurred_at");
CREATE INDEX "courier_escalation_messages_needs_review_idx"
    ON "courier_escalation_messages"("needs_review");

CREATE TABLE "courier_template_candidates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "body" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "status" "courier_template_candidate_status" NOT NULL DEFAULT 'unmatched',
    "suggested_regex" TEXT,
    "suggested_state" TEXT,
    "reviewed_by_staff_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_notes" TEXT,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courier_template_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_template_candidates_body_hash_key"
    ON "courier_template_candidates"("body_hash");
CREATE INDEX "courier_template_candidates_status_seen_count_idx"
    ON "courier_template_candidates"("status", "seen_count");

CREATE TABLE "courier_message_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "action" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "courier_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_message_templates_code_key" ON "courier_message_templates"("code");
CREATE INDEX "courier_message_templates_is_active_priority_idx"
    ON "courier_message_templates"("is_active", "priority");

ALTER TABLE "courier_escalations"
    ADD CONSTRAINT "courier_escalations_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courier_escalation_messages"
    ADD CONSTRAINT "courier_escalation_messages_escalation_id_fkey"
    FOREIGN KEY ("escalation_id") REFERENCES "courier_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
