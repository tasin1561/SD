-- Phase 3 — the outbox, the write-mode switch, and the 2FA challenge that
-- guards it.

CREATE TYPE "courier_outbox_status" AS ENUM ('pending', 'sending', 'sent_unconfirmed', 'confirmed', 'failed');
CREATE TYPE "courier_dispatch_error_class" AS ENUM ('pre_dispatch', 'ambiguous', 'rejected');
CREATE TYPE "courier_outbox_kind" AS ENUM ('comment', 'raise_ticket');
CREATE TYPE "courier_write_mode" AS ENUM ('manual', 'supervised', 'auto');

CREATE TABLE "courier_outbox_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "escalation_id" UUID NOT NULL,
    "kind" "courier_outbox_kind" NOT NULL,
    "body" TEXT NOT NULL,
    "category_id" TEXT,
    "status" "courier_outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "routed_mode" "courier_write_mode",
    "claimed_by_staff_id" UUID,
    "claimed_by_kind" TEXT,
    "claimed_at" TIMESTAMPTZ,
    "claim_expires_at" TIMESTAMPTZ,
    "dispatched_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "external_ref" TEXT,
    "last_error" TEXT,
    "last_error_class" "courier_dispatch_error_class",
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "courier_outbox_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_outbox_items_status_created_at_idx" ON "courier_outbox_items"("status", "created_at");
CREATE INDEX "courier_outbox_items_escalation_id_idx" ON "courier_outbox_items"("escalation_id");
CREATE INDEX "courier_outbox_items_claim_expires_at_idx" ON "courier_outbox_items"("claim_expires_at");

ALTER TABLE "courier_outbox_items"
    ADD CONSTRAINT "courier_outbox_items_escalation_id_fkey"
    FOREIGN KEY ("escalation_id") REFERENCES "courier_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "courier_channel_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_code" TEXT NOT NULL,
    "write_mode" "courier_write_mode" NOT NULL DEFAULT 'manual',
    "auto_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paused_until" TIMESTAMPTZ,
    "pause_reason" TEXT,
    "updated_by_staff_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courier_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_channel_settings_courier_code_key" ON "courier_channel_settings"("courier_code");

CREATE TABLE "courier_mode_challenges" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_code" TEXT NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "requested_mode" "courier_write_mode" NOT NULL,
    "requested_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "code_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courier_mode_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_mode_challenges_expires_at_idx" ON "courier_mode_challenges"("expires_at");

ALTER TABLE "courier_mode_challenges"
    ADD CONSTRAINT "courier_mode_challenges_staff_user_id_fkey"
    FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The write channel ships MANUAL with an EMPTY auto list. Seeded here
-- rather than left absent so the ops console has a row to show and the
-- resolver never has to invent a default at read time.
INSERT INTO "courier_channel_settings" ("courier_code", "write_mode", "auto_categories", "updated_at")
VALUES ('delhivery', 'manual', ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("courier_code") DO NOTHING;
