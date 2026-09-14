-- PNL-CF-1, amended 2026-09-14 (owner): a month closes on time even when a
-- nightly job failed — PROVISIONAL — and is locked permanently (FINAL) once
-- the missing data is in; a FINAL month can be re-locked in god mode. Every
-- lock is a VERSION and no version is ever deleted or overwritten.
--
-- The months already closed (July and August 2026, by BACKFILL) become FINAL
-- and their snapshot becomes version 1, with every existing row attached to it.

-- CreateEnum
CREATE TYPE "pnl_lock_state" AS ENUM ('provisional', 'final');

-- CreateEnum
CREATE TYPE "pnl_version_kind" AS ENUM ('auto_final', 'auto_provisional', 'lock_permanently', 'god_mode', 'backfill', 'manual');

-- Existing closed months are FINAL. The default only fills them; new rows state it.
ALTER TABLE "pnl_periods" ADD COLUMN "lock_state" "pnl_lock_state" NOT NULL DEFAULT 'final';
ALTER TABLE "pnl_periods" ALTER COLUMN "lock_state" DROP DEFAULT;

-- CreateTable
CREATE TABLE "pnl_snapshot_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "period_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "pnl_version_kind" NOT NULL,
    "lock_state" "pnl_lock_state" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_staff_id" UUID,
    "reason" TEXT,
    "gross_margin_inr" DECIMAL(14,2) NOT NULL,
    "operating_expenses_inr" DECIMAL(14,2) NOT NULL,
    "net_inr" DECIMAL(14,2) NOT NULL,
    "net_before_inr" DECIMAL(14,2),
    "complete" BOOLEAN NOT NULL,
    "report" JSONB NOT NULL,
    "nightly_jobs" JSONB,
    "carried_out" JSONB,
    "superseded_at" TIMESTAMPTZ,

    CONSTRAINT "pnl_snapshot_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pnl_snapshot_versions_period_id_version_key" ON "pnl_snapshot_versions"("period_id", "version");

-- AddForeignKey
ALTER TABLE "pnl_snapshot_versions" ADD CONSTRAINT "pnl_snapshot_versions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "pnl_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pnl_snapshot_versions" ADD CONSTRAINT "pnl_snapshot_versions_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing close becomes its month's version 1, exactly as it was frozen.
INSERT INTO "pnl_snapshot_versions"
    ("period_id", "version", "kind", "lock_state", "created_at", "created_by_staff_id", "reason",
     "gross_margin_inr", "operating_expenses_inr", "net_inr", "complete", "report", "nightly_jobs")
SELECT "id", 1,
       CASE "close_kind"
         WHEN 'auto' THEN 'auto_final'::"pnl_version_kind"
         WHEN 'manual' THEN 'manual'::"pnl_version_kind"
         ELSE 'backfill'::"pnl_version_kind"
       END,
       'final', "closed_at", "closed_by_staff_id", "reason",
       "gross_margin_inr", "operating_expenses_inr", "net_inr", "complete", "report", "nightly_jobs"
FROM "pnl_periods";

-- Every existing snapshot row belongs to its month's version 1.
ALTER TABLE "pnl_snapshot_rows" ADD COLUMN "version_id" UUID;
UPDATE "pnl_snapshot_rows" r
SET "version_id" = v."id"
FROM "pnl_snapshot_versions" v
WHERE v."period_id" = r."period_id" AND v."version" = 1;
ALTER TABLE "pnl_snapshot_rows" ALTER COLUMN "version_id" SET NOT NULL;

-- A record appears once per VERSION now, not once per month.
DROP INDEX "pnl_snapshot_rows_period_line_ref_key";
CREATE UNIQUE INDEX "pnl_snapshot_rows_version_line_ref_key" ON "pnl_snapshot_rows"("version_id", "line_key", "ref_key");
CREATE INDEX "pnl_snapshot_rows_period_id_idx" ON "pnl_snapshot_rows"("period_id");

-- AddForeignKey
ALTER TABLE "pnl_snapshot_rows" ADD CONSTRAINT "pnl_snapshot_rows_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "pnl_snapshot_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
