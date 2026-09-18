-- AlterTable
ALTER TABLE "reseller_order_credits" ADD COLUMN     "cod_fee_percent_at_plan" DECIMAL(5,2),
ADD COLUMN     "gst_percent_at_plan" DECIMAL(5,2),
ADD COLUMN     "instant_pay_fee_percent_at_plan" DECIMAL(5,2),
ADD COLUMN     "times_repriced" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "store_address_change_requests" ADD COLUMN     "patch" JSONB;


-- ── 2026-09-18 (owner) — a reseller store keeps its own customers' ──────
-- records, so its ADMIN and OPS roles gain `customers.manage` on EXISTING
-- stores. New stores get it from provisionDefaultStoreRoles; the owner
-- holds every permission implicitly. Finance and Viewer are deliberately
-- left out: they read customers, they do not maintain them.
INSERT INTO "store_role_permissions" ("id", "role_id", "permission", "granted_at")
SELECT uuidv7(), r."id", 'customers.manage', CURRENT_TIMESTAMP
FROM "store_roles" r
WHERE r."key" IN ('admin', 'ops') AND r."is_system" = true AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;
