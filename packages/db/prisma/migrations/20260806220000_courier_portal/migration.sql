-- Phase 5 — the portal channel: taxonomy, run log, and SHADOW/LIVE.

CREATE TYPE "courier_portal_mode" AS ENUM ('shadow', 'live');

-- SHADOW by default: the worker runs, navigates and composes the action,
-- and never clicks the last button. Ships that way deliberately.
ALTER TABLE "courier_channel_settings"
    ADD COLUMN "portal_mode" "courier_portal_mode" NOT NULL DEFAULT 'shadow';

-- Delhivery's category tree, keyed on THEIR ids. Labels are stored for
-- humans and never matched on: a re-worded label would silently unlock a
-- category rather than fail loudly.
CREATE TABLE "courier_issue_categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_code" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parent_external_id" TEXT,
    "is_human_only" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "courier_issue_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_issue_categories_courier_code_external_id_key"
    ON "courier_issue_categories"("courier_code", "external_id");
CREATE INDEX "courier_issue_categories_courier_code_is_human_only_idx"
    ON "courier_issue_categories"("courier_code", "is_human_only");

CREATE TABLE "courier_portal_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "outbox_item_id" UUID,
    "kind" TEXT NOT NULL,
    "mode" "courier_portal_mode" NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "artifact_path" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    CONSTRAINT "courier_portal_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_portal_runs_outbox_item_id_idx" ON "courier_portal_runs"("outbox_item_id");
CREATE INDEX "courier_portal_runs_kind_started_at_idx" ON "courier_portal_runs"("kind", "started_at");
