-- AI monitor (overnight reviewer). Purely additive: four new tables and six
-- enums, nothing existing is altered, so a code rollback can leave all of
-- this in place. The monitor switch and its $20 cap were seeded by
-- 20261113220000_assistant_panel; the monitor ships OFF.
--
-- * assistant_monitor_runs    — one pass; batch_id stored as soon as the
--   Anthropic batch exists so a restart resumes polling.
-- * assistant_monitor_results — one score per (conversation, last message),
--   UNIQUE, so a replayed batch stores nothing twice.
-- * assistant_monitor_usage   — the monitor's own cost line (billed, 2.5x of
--   the batch-discounted real price); UNIQUE on (run, custom id).
-- * assistant_monitor_themes  — a night's clusters with counts (no model call).
-- Conversation / message ids are soft references, like the other assistant tables.

-- CreateEnum
CREATE TYPE "assistant_monitor_run_status" AS ENUM ('collecting', 'submitted', 'done', 'skipped_budget', 'nothing_to_do', 'failed');

-- CreateEnum
CREATE TYPE "assistant_monitor_answered" AS ENUM ('yes', 'partly', 'no');

-- CreateEnum
CREATE TYPE "assistant_monitor_correct" AS ENUM ('yes', 'unsure', 'no');

-- CreateEnum
CREATE TYPE "assistant_monitor_link" AS ENUM ('yes', 'no', 'not_needed');

-- CreateEnum
CREATE TYPE "assistant_monitor_safety" AS ENUM ('none', 'data_leak', 'prompt_injection', 'abuse');

-- CreateEnum
CREATE TYPE "assistant_monitor_theme_kind" AS ENUM ('knowledge_gap', 'ui_confusion');

-- CreateTable
CREATE TABLE "assistant_monitor_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "trigger" TEXT NOT NULL,
    "status" "assistant_monitor_run_status" NOT NULL,
    "batch_id" TEXT,
    "requested" INTEGER NOT NULL DEFAULT 0,
    "scored" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "skipped_budget" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "summary" JSONB,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_monitor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_monitor_results" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "run_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "last_message_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "model" TEXT NOT NULL,
    "answered" "assistant_monitor_answered" NOT NULL,
    "correct_for_skydrop" "assistant_monitor_correct" NOT NULL,
    "correct_reason" TEXT,
    "link_given_and_right" "assistant_monitor_link" NOT NULL,
    "language_match" BOOLEAN NOT NULL,
    "user_frustration" INTEGER NOT NULL,
    "hallucination_suspected" BOOLEAN NOT NULL,
    "hallucination_quote" TEXT,
    "knowledge_gap" TEXT,
    "ui_confusion" TEXT,
    "safety_issue" "assistant_monitor_safety" NOT NULL,
    "safety_quote" TEXT,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_monitor_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_monitor_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "run_id" UUID NOT NULL,
    "custom_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "cache_write_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(14,8) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_monitor_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_monitor_themes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "run_id" UUID NOT NULL,
    "kind" "assistant_monitor_theme_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "conversation_ids" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_monitor_themes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_monitor_runs_status_idx" ON "assistant_monitor_runs"("status");

-- CreateIndex
CREATE INDEX "assistant_monitor_runs_started_at_idx" ON "assistant_monitor_runs"("started_at");

-- CreateIndex
CREATE INDEX "assistant_monitor_results_run_id_idx" ON "assistant_monitor_results"("run_id");

-- CreateIndex
CREATE INDEX "assistant_monitor_results_created_at_idx" ON "assistant_monitor_results"("created_at");

-- CreateIndex
CREATE INDEX "assistant_monitor_results_safety_issue_created_at_idx" ON "assistant_monitor_results"("safety_issue", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_monitor_results_conversation_id_last_message_id_key" ON "assistant_monitor_results"("conversation_id", "last_message_id");

-- CreateIndex
CREATE INDEX "assistant_monitor_usage_created_at_idx" ON "assistant_monitor_usage"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_monitor_usage_run_id_custom_id_key" ON "assistant_monitor_usage"("run_id", "custom_id");

-- CreateIndex
CREATE INDEX "assistant_monitor_themes_run_id_idx" ON "assistant_monitor_themes"("run_id");

-- CreateIndex
CREATE INDEX "assistant_monitor_themes_created_at_idx" ON "assistant_monitor_themes"("created_at");

