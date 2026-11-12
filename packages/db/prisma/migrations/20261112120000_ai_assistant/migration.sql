-- In-app AI assistant, phase A (backend core, READ-ONLY).
--
-- Four tables and two enums, plus the three settings that govern them.
--
-- NO foreign keys to sellers / staff / stores / users, on purpose: a
-- conversation records what somebody was told and what the assistant read
-- for them, so it has to outlive the account and the support session it
-- names (the `audit_logs` precedent). The only FKs are the three
-- child tables -> assistant_conversations, ON DELETE RESTRICT: nothing
-- deletes a conversation (the API soft-deletes via deleted_at), and
-- assistant_messages / assistant_tool_calls are append-only.
--
-- The settings rows are INSERTed here, not only seeded: seedSystemSettings()
-- is create-only on value columns and does not run against a deployed
-- database on its own, so a seed edit alone would leave the kill switch
-- missing in production. `updated_at` is listed explicitly (Prisma applies
-- @updatedAt client-side; a raw INSERT without it fails NOT NULL).
-- ON CONFLICT keeps the migration re-runnable.

-- CreateEnum
CREATE TYPE "assistant_audience" AS ENUM ('staff', 'seller', 'store', 'associate');

-- CreateEnum
CREATE TYPE "assistant_message_role" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "audience" "assistant_audience" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "impersonated_by_staff_id" UUID,
    "title" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "role" "assistant_message_role" NOT NULL,
    "content" JSONB NOT NULL,
    "is_question" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_tool_calls" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "caller_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "impersonated_by_staff_id" UUID,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result_bytes" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "caller_user_id" UUID NOT NULL,
    "impersonated_by_staff_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "cache_write_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(14,8) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_audience_owner_user_id_updated_at_idx" ON "assistant_conversations"("audience", "owner_user_id", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_id_idx" ON "assistant_messages"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "assistant_tool_calls_conversation_id_created_at_idx" ON "assistant_tool_calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_tool_calls_caller_user_id_created_at_idx" ON "assistant_tool_calls"("caller_user_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_usage_created_at_idx" ON "assistant_usage"("created_at");

-- CreateIndex
CREATE INDEX "assistant_usage_caller_user_id_created_at_idx" ON "assistant_usage"("caller_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateData: the assistant's settings.
INSERT INTO "system_settings"
  ("key", "category", "value_type", "value_boolean", "value_int", "value_decimal", "display_name", "description", "seller_overridable", "is_editable_by_admin", "updated_at")
VALUES
  ('assistant.enabled', 'assistant', 'boolean', true, NULL, NULL,
   'AI assistant enabled',
   'Kill switch for the in-app AI assistant. When off, nobody in any console can use it and no request is sent to the AI provider; the assistant tells people it is resting and points them to the help pages. On by default.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.monthly_budget_usd', 'assistant', 'decimal', NULL, NULL, 80.000000,
   'AI assistant monthly budget (USD)',
   'Hard cap on what the AI assistant may cost in a calendar month (UTC), summed from the recorded usage of every answer. Once reached, the assistant stops calling the AI provider until the month turns or this is raised.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.daily_messages_per_user', 'assistant', 'int', NULL, 60, NULL,
   'AI assistant messages per person per day',
   'How many questions one person may ask the AI assistant in a UTC day. Past it, the assistant says it is resting for them until tomorrow. Counts questions, not answers.',
   false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
