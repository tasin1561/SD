-- AI control panel, step 1. Purely additive: nothing existing is altered
-- except one new nullable column, so a rollback of the code can leave all
-- of this in place.
--
-- * assistant_feedback  — thumbs up / down on one answer, one per answer
--   per person (UNIQUE message + owner). Owner columns mirror the
--   conversation. Never read by the model.
-- * assistant_notices   — a CODE (never any text) for every fixed notice the
--   assistant showed, so the panel can show error and refusal rates.
-- * assistant_conversations.anonymised_at — set by the 180-day retention job.
-- * system_settings rows for the controls (per-portal switches, attachments,
--   monitor switch + monitor monthly cap). assistant_usage already has
--   an index on (created_at) for the billing group-by.

-- CreateEnum
CREATE TYPE "assistant_feedback_rating" AS ENUM ('up', 'down');

-- AlterTable
ALTER TABLE "assistant_conversations" ADD COLUMN "anonymised_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "assistant_feedback" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "impersonated_by_staff_id" UUID,
    "rating" "assistant_feedback_rating" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_notices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_feedback_message_id_owner_user_id_key" ON "assistant_feedback"("message_id", "owner_user_id");
CREATE INDEX "assistant_feedback_conversation_id_idx" ON "assistant_feedback"("conversation_id");
CREATE INDEX "assistant_feedback_created_at_idx" ON "assistant_feedback"("created_at");
CREATE INDEX "assistant_notices_created_at_idx" ON "assistant_notices"("created_at");
CREATE INDEX "assistant_notices_conversation_id_idx" ON "assistant_notices"("conversation_id");
-- The retention job finds un-anonymised old conversations by last activity.
CREATE INDEX "assistant_conversations_anonymised_at_updated_at_idx" ON "assistant_conversations"("anonymised_at", "updated_at");

-- AddForeignKey
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assistant_notices" ADD CONSTRAINT "assistant_notices_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Control settings. All editable by an admin; read on every request, so a
-- change takes effect on the next message with no deploy.
INSERT INTO "system_settings"
  ("key", "category", "value_type", "value_boolean", "value_int", "value_decimal", "display_name", "description", "seller_overridable", "is_editable_by_admin", "updated_at")
VALUES
  ('assistant.portal_staff_enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant on in the staff console',
   'Switch the AI assistant on or off for staff in the admin console only. Off means staff see it resting; the other consoles are unaffected.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.portal_seller_enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant on in the client console',
   'Switch the AI assistant on or off for clients (sellers) only.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.portal_store_enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant on in the member-store console',
   'Switch the AI assistant on or off for member-store users only.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.portal_associate_enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant on in the associate console',
   'Switch the AI assistant on or off for associates (own-orders store logins) only.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.attachments_enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant file attachments',
   'Whether people may attach images and PDFs to a question. Off means new uploads are refused; questions without files keep working.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.monitor_enabled', 'assistant', 'boolean', false, NULL, NULL,
   'AI monitor enabled',
   'Switch for the AI monitor (the reviewer that watches conversations). Off until the monitor exists; nothing reads it yet.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.monitor_monthly_budget_usd', 'assistant', 'decimal', NULL, NULL, 20.000000,
   'AI monitor monthly budget (USD)',
   'Hard cap on what the AI monitor may cost in a calendar month, separate from the assistant''s own budget. Nothing reads it until the monitor exists.',
   false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
