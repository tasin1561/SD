-- RS-8 / RS-9 — reseller REPORTS and ANALYSIS (2026-09-15).
-- docs/reseller-stores.md "Reports and analysis as built".
--
-- Every report is DERIVED on read from append-only ledgers and the order
-- snapshot. Stored here: a reseller store's own expenses, the frozen
-- months of its P&L (PNL-CF-1's shape, for a store), the seller's
-- auto-pause rule, and the settings the analysis reads. Nothing here
-- writes money, stock or a bank entry.

-- ── Enum values ─────────────────────────────────────────────────────────
-- A fraud signal on a reseller store is its own issue kind: the audience
-- is whoever watches reseller stores. Not used in this migration.
ALTER TYPE "system_issue_kind" ADD VALUE 'reseller_risk';

CREATE TYPE "store_expense_category" AS ENUM (
  'ad_spend', 'staff', 'software', 'photography', 'packaging',
  'customer_refunds', 'rent', 'other'
);

-- ── store_expenses ──────────────────────────────────────────────────────
CREATE TABLE "store_expenses" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "store_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "category" "store_expense_category" NOT NULL,
  "amount_inr" DECIMAL(14,2) NOT NULL,
  "expense_date" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "idempotency_key" UUID,
  "created_by_store_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ,
  "deleted_by_store_user_id" UUID,
  "delete_reason" TEXT,
  CONSTRAINT "store_expenses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_expenses_idempotency_key_key" ON "store_expenses"("idempotency_key");
CREATE INDEX "store_expenses_store_id_expense_date_idx" ON "store_expenses"("store_id", "expense_date");
ALTER TABLE "store_expenses" ADD CONSTRAINT "store_expenses_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_expenses" ADD CONSTRAINT "store_expenses_amount_positive_ck" CHECK ("amount_inr" > 0);
-- A soft delete always says why.
ALTER TABLE "store_expenses" ADD CONSTRAINT "store_expenses_delete_reason_ck"
  CHECK (("deleted_at" IS NULL) = ("delete_reason" IS NULL));

-- ── store_pnl_periods / snapshot rows / carry-forwards ─────────────────
CREATE TABLE "store_pnl_periods" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "store_id" UUID NOT NULL,
  "month" TEXT NOT NULL,
  "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_by_actor_type" "actor_type" NOT NULL,
  "report" JSONB NOT NULL,
  CONSTRAINT "store_pnl_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_pnl_periods_store_id_month_key" ON "store_pnl_periods"("store_id", "month");
ALTER TABLE "store_pnl_periods" ADD CONSTRAINT "store_pnl_periods_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_pnl_periods" ADD CONSTRAINT "store_pnl_periods_month_ck"
  CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

CREATE TABLE "store_pnl_snapshot_rows" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "period_id" UUID NOT NULL,
  "line_key" TEXT NOT NULL,
  "ref_key" TEXT NOT NULL,
  "amount_inr" DECIMAL(14,2) NOT NULL,
  "label" JSONB NOT NULL,
  CONSTRAINT "store_pnl_snapshot_rows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_pnl_snapshot_rows_period_id_line_key_ref_key_key"
  ON "store_pnl_snapshot_rows"("period_id", "line_key", "ref_key");
ALTER TABLE "store_pnl_snapshot_rows" ADD CONSTRAINT "store_pnl_snapshot_rows_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "store_pnl_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_pnl_carry_forwards" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "store_id" UUID NOT NULL,
  "origin_month" TEXT NOT NULL,
  "landed_month" TEXT NOT NULL,
  "line_key" TEXT NOT NULL,
  "ref_key" TEXT NOT NULL,
  "amount_before_inr" DECIMAL(14,2),
  "amount_after_inr" DECIMAL(14,2),
  "delta_inr" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "label" JSONB NOT NULL,
  "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_pnl_carry_forwards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_pnl_carry_forwards_store_id_landed_month_idx"
  ON "store_pnl_carry_forwards"("store_id", "landed_month");
CREATE INDEX "store_pnl_carry_forwards_store_id_origin_month_idx"
  ON "store_pnl_carry_forwards"("store_id", "origin_month");
ALTER TABLE "store_pnl_carry_forwards" ADD CONSTRAINT "store_pnl_carry_forwards_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A carry-forward always lands in a LATER month than the one it changes,
-- and always moves something.
ALTER TABLE "store_pnl_carry_forwards" ADD CONSTRAINT "store_pnl_carry_forwards_months_ck"
  CHECK ("landed_month" > "origin_month");
ALTER TABLE "store_pnl_carry_forwards" ADD CONSTRAINT "store_pnl_carry_forwards_delta_ck"
  CHECK ("delta_inr" <> 0);

-- ── reseller_store_auto_pause ───────────────────────────────────────────
CREATE TABLE "reseller_store_auto_pause" (
  "store_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "return_rate_percent" DECIMAL(5,2) NOT NULL,
  "min_decided_orders" INTEGER NOT NULL DEFAULT 10,
  "window_days" INTEGER NOT NULL DEFAULT 30,
  "updated_by_seller_user_id" UUID,
  "last_evaluated_at" TIMESTAMPTZ,
  "last_paused_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "reseller_store_auto_pause_pkey" PRIMARY KEY ("store_id")
);
ALTER TABLE "reseller_store_auto_pause" ADD CONSTRAINT "reseller_store_auto_pause_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reseller_store_auto_pause" ADD CONSTRAINT "reseller_store_auto_pause_rate_ck"
  CHECK ("return_rate_percent" >= 0 AND "return_rate_percent" <= 100);
ALTER TABLE "reseller_store_auto_pause" ADD CONSTRAINT "reseller_store_auto_pause_min_ck"
  CHECK ("min_decided_orders" >= 1);
ALTER TABLE "reseller_store_auto_pause" ADD CONSTRAINT "reseller_store_auto_pause_window_ck"
  CHECK ("window_days" >= 1 AND "window_days" <= 365);

-- ── Settings the analysis reads (SET-1) ─────────────────────────────────
-- seedSystemSettings() is create-only and deploy runs migrations, not the
-- seed, so the rows are inserted here. ON CONFLICT DO NOTHING: a row the
-- seed already made (dev, CI) keeps what it holds. The fraud thresholds
-- are GLOBAL (a signal about a store is judged the same for everyone);
-- the stock forecast's two are the seller's to tune.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "override_min_int", "override_max_int",
  "created_at", "updated_at"
)
VALUES
  (uuidv7(), 'reseller.fraud_window_days', 'reseller', 'int', 30,
   'Reseller fraud signals: days looked back',
   'The fraud flags on reseller stores (cancel, return and NDR rates, one customer across many stores, retail far above suggested, rapid-fire orders) are judged over the store''s orders placed in this many days.',
   true, false, false, NULL, NULL, now(), now()),
  (uuidv7(), 'reseller.fraud_min_orders', 'reseller', 'int', 10,
   'Reseller fraud signals: fewest orders before a rate is judged',
   'A cancel, return or NDR rate is only flagged once the store has at least this many orders in the window — two cancellations out of three orders say nothing.',
   true, false, false, NULL, NULL, now(), now()),
  (uuidv7(), 'reseller.fraud_orders_per_hour', 'reseller', 'int', 30,
   'Reseller fraud signals: orders in one hour',
   'A store that places this many orders or more inside any one hour is flagged as rapid-fire ordering.',
   true, false, false, NULL, NULL, now(), now()),
  (uuidv7(), 'reseller.fraud_shared_phone_stores', 'reseller', 'int', 3,
   'Reseller fraud signals: stores sharing one customer',
   'A customer phone number that appears on orders of at least this many different reseller stores in the window is flagged on each of them.',
   true, false, false, NULL, NULL, now(), now()),
  (uuidv7(), 'reseller.stock_reorder_days', 'reseller', 'int', 14,
   'Reseller stock forecast: reorder when stock lasts fewer days than',
   'A product your reseller stores sell is flagged for reordering when, at the rate it sold recently, the stock on hand lasts fewer than this many days. You are told in-app once a week while it stays low.',
   true, false, true, 1, 180, now(), now()),
  (uuidv7(), 'reseller.stock_forecast_window_days', 'reseller', 'int', 30,
   'Reseller stock forecast: days of sales it learns from',
   'How many days of confirmed orders the stock forecast averages to work out how fast each product sells.',
   true, false, true, 7, 180, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_decimal",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES
  (uuidv7(), 'reseller.fraud_cancel_rate_percent', 'reseller', 'decimal', 40.00,
   'Reseller fraud signals: cancel rate (%)',
   'A reseller store whose orders in the window are cancelled or rejected at this rate or above is flagged. Twice the rate raises it as HIGH.',
   true, false, false, now(), now()),
  (uuidv7(), 'reseller.fraud_return_rate_percent', 'reseller', 'decimal', 40.00,
   'Reseller fraud signals: return rate (%)',
   'A reseller store whose parcels come back (of those delivered or returned) at this rate or above is flagged. Twice the rate raises it as HIGH.',
   true, false, false, now(), now()),
  (uuidv7(), 'reseller.fraud_ndr_rate_percent', 'reseller', 'decimal', 50.00,
   'Reseller fraud signals: failed delivery rate (%)',
   'A reseller store whose dispatched parcels have a failed delivery attempt at this rate or above is flagged.',
   true, false, false, now(), now()),
  (uuidv7(), 'reseller.fraud_retail_markup_percent', 'reseller', 'decimal', 100.00,
   'Reseller fraud signals: retail above suggested (%)',
   'An order line sold at more than the suggested retail plus this percentage is flagged — a store charging a customer double what the seller suggested.',
   true, false, false, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ── Permissions for the store roles that already exist ─────────────────
-- Every store was provisioned with five roles (RS-2). The OWNER holds
-- every key implicitly; ADMIN and FINANCE get the reports and expenses
-- keys here, exactly as a store created from now on gets them from the
-- code (DEFAULT_STORE_ROLES). OPS and VIEWER are left without: a P&L and
-- an expense book are not day-to-day order work.
INSERT INTO "store_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "store_roles" r
CROSS JOIN (
  VALUES ('reports.view'), ('expenses.view'), ('expenses.manage')
) AS p("permission")
WHERE r."key" IN ('admin', 'finance')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- The seller's reseller reports, for seller admin roles already trusted
-- with stores.manage (as RS-3 did for stores.pricing). The owner holds it
-- implicitly.
INSERT INTO "seller_role_permissions" ("role_id", "permission")
SELECT r."id", 'stores.reports'
FROM "seller_roles" r
WHERE r."key" = 'admin'
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "seller_role_permissions" m
    WHERE m."role_id" = r."id" AND m."permission" = 'stores.manage'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "seller_role_permissions" p
    WHERE p."role_id" = r."id" AND p."permission" = 'stores.reports'
  );
