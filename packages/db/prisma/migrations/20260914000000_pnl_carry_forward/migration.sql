-- PNL-CF-1 (2026-09-14): the carry-forward P&L.
--
-- A month is CLOSED once its nightly jobs have run: its whole P&L and every
-- record behind every line is frozen (pnl_periods + pnl_snapshot_rows), and
-- it is never reopened. Anything that changes it later — a courier cost
-- that lands, a delivered parcel coming back, an expense typed with last
-- month's date — is an append-only pnl_carry_forwards row carried into the
-- month that was OPEN when it was found. No data is written here: the
-- months that already exist are closed by the operator-run backfill
-- endpoint, because a snapshot needs the P&L engine, which SQL is not.

-- CreateEnum
CREATE TYPE "pnl_close_kind" AS ENUM ('auto', 'manual', 'backfill');

-- CreateTable
CREATE TABLE "pnl_periods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "month" VARCHAR(7) NOT NULL,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_staff_id" UUID,
    "close_kind" "pnl_close_kind" NOT NULL,
    "reason" TEXT,
    "gross_margin_inr" DECIMAL(14,2) NOT NULL,
    "operating_expenses_inr" DECIMAL(14,2) NOT NULL,
    "net_inr" DECIMAL(14,2) NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "report" JSONB NOT NULL,
    "nightly_jobs" JSONB,

    CONSTRAINT "pnl_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_snapshot_rows" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "period_id" UUID NOT NULL,
    "line_key" VARCHAR(40) NOT NULL,
    "ref_key" VARCHAR(200) NOT NULL,
    "revenue_inr" DECIMAL(14,2),
    "cost_inr" DECIMAL(14,2),
    "label" JSONB NOT NULL,

    CONSTRAINT "pnl_snapshot_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_carry_forwards" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "origin_period_id" UUID NOT NULL,
    "origin_month" VARCHAR(7) NOT NULL,
    "landed_month" VARCHAR(7) NOT NULL,
    "line_key" VARCHAR(40) NOT NULL,
    "ref_key" VARCHAR(200) NOT NULL,
    "revenue_delta_inr" DECIMAL(14,2) NOT NULL,
    "cost_delta_inr" DECIMAL(14,2) NOT NULL,
    "revenue_before_inr" DECIMAL(14,2),
    "revenue_after_inr" DECIMAL(14,2),
    "cost_before_inr" DECIMAL(14,2),
    "cost_after_inr" DECIMAL(14,2),
    "reason" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pnl_carry_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pnl_periods_month_key" ON "pnl_periods"("month");

-- CreateIndex
CREATE UNIQUE INDEX "pnl_snapshot_rows_period_line_ref_key" ON "pnl_snapshot_rows"("period_id", "line_key", "ref_key");

-- CreateIndex
CREATE INDEX "pnl_carry_forwards_landed_origin_line_idx" ON "pnl_carry_forwards"("landed_month", "origin_month", "line_key");

-- CreateIndex
CREATE INDEX "pnl_carry_forwards_origin_line_ref_idx" ON "pnl_carry_forwards"("origin_period_id", "line_key", "ref_key");

-- AddForeignKey
ALTER TABLE "pnl_periods" ADD CONSTRAINT "pnl_periods_closed_by_staff_id_fkey" FOREIGN KEY ("closed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pnl_snapshot_rows" ADD CONSTRAINT "pnl_snapshot_rows_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "pnl_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pnl_carry_forwards" ADD CONSTRAINT "pnl_carry_forwards_origin_period_id_fkey" FOREIGN KEY ("origin_period_id") REFERENCES "pnl_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
