-- Assistant recommendations loop (Haiku drafts, the owner approves). Purely
-- additive: new tables, new enums and ONE new nullable column; nothing
-- existing is altered, so a code rollback can leave all of this in place.
--
-- * assistant_knowledge_versions — IMMUTABLE overlay snapshots (guide entries,
--   glossary terms, prompt addenda) over the committed base.
-- * assistant_knowledge_live     — the one row (id = 1) naming the live
--   version; NULL = the committed base alone. Seeded here with NULL.
-- * assistant_knowledge_changes  — append-only audit of every approval and
--   rollback.
-- * assistant_recommendations    — what Haiku drafted from a monitor theme;
--   never live until the owner approves it after a passing eval run.
-- * assistant_eval_runs          — the gate: every eval case asked of the live
--   and of the draft version, per-case verdicts.
-- * assistant_conversations.knowledge_version_id — the version a conversation
--   started with; every request in it is built from that version.
-- Ids across these tables are soft references, like the other assistant tables.

-- CreateEnum
CREATE TYPE "assistant_recommendation_kind" AS ENUM ('knowledge', 'system');

-- CreateEnum
CREATE TYPE "assistant_recommendation_status" AS ENUM ('new', 'approved', 'rejected', 'live', 'rolled_back');

-- CreateEnum
CREATE TYPE "assistant_eval_run_status" AS ENUM ('running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "assistant_knowledge_change_action" AS ENUM ('go_live', 'rollback');

-- AlterTable
ALTER TABLE "assistant_conversations" ADD COLUMN     "knowledge_version_id" UUID;

-- CreateTable
CREATE TABLE "assistant_knowledge_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" SERIAL NOT NULL,
    "parent_version_id" UUID,
    "recommendation_id" UUID,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_knowledge_live" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_knowledge_live_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_knowledge_changes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "action" "assistant_knowledge_change_action" NOT NULL,
    "from_version_id" UUID,
    "to_version_id" UUID,
    "recommendation_id" UUID,
    "eval_run_id" UUID,
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_knowledge_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_recommendations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "assistant_recommendation_kind" NOT NULL,
    "status" "assistant_recommendation_status" NOT NULL DEFAULT 'new',
    "source_key" TEXT NOT NULL,
    "theme_kind" TEXT NOT NULL,
    "theme_label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "draft" JSONB NOT NULL,
    "live_version_id" UUID,
    "last_eval_run_id" UUID,
    "github_issue_url" TEXT,
    "draft_model" TEXT NOT NULL,
    "draft_cost_usd" DECIMAL(14,8) NOT NULL,
    "decided_by_staff_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_eval_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "recommendation_id" UUID NOT NULL,
    "draft_version_id" UUID NOT NULL,
    "baseline_version_id" UUID,
    "status" "assistant_eval_run_status" NOT NULL DEFAULT 'running',
    "passed" BOOLEAN,
    "total" INTEGER NOT NULL DEFAULT 0,
    "regressions" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "note" TEXT,
    "cost_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "started_by_staff_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "assistant_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_knowledge_versions_number_key" ON "assistant_knowledge_versions"("number");

-- CreateIndex
CREATE INDEX "assistant_knowledge_versions_recommendation_id_idx" ON "assistant_knowledge_versions"("recommendation_id");

-- CreateIndex
CREATE INDEX "assistant_knowledge_changes_created_at_idx" ON "assistant_knowledge_changes"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_recommendations_source_key_key" ON "assistant_recommendations"("source_key");

-- CreateIndex
CREATE INDEX "assistant_recommendations_status_created_at_idx" ON "assistant_recommendations"("status", "created_at");

-- CreateIndex
CREATE INDEX "assistant_eval_runs_recommendation_id_started_at_idx" ON "assistant_eval_runs"("recommendation_id", "started_at");


-- The live pointer is a single row; the CHECK keeps it that way.
ALTER TABLE "assistant_knowledge_live" ADD CONSTRAINT "assistant_knowledge_live_single_row" CHECK ("id" = 1);
INSERT INTO "assistant_knowledge_live" ("id", "version_id") VALUES (1, NULL) ON CONFLICT ("id") DO NOTHING;
