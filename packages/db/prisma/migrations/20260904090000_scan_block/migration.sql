-- A repeated box scan stops the operator who scanned it.
--
-- Scanning the same parcel twice at pack or at handover is not a
-- harmless retry: it means a duplicate label exists, or somebody is
-- working from a pile that has already been done. Both are wrong in a
-- way that gets more expensive the longer it goes unnoticed, so the
-- scan refuses and stays refusing until an admin resolves the issue.
--
-- PER OPERATOR, not per station: four packers work in parallel and
-- halting the building over one person's mistake would cost more than
-- the mistake. Nullable so every other kind of issue leaves it unset.
ALTER TABLE "system_issues" ADD COLUMN "blocks_scan_for_staff_id" UUID;

-- Read on EVERY scan at both benches — an index, not a board scan.
CREATE INDEX "system_issues_scan_block_idx"
  ON "system_issues" ("blocks_scan_for_staff_id", "resolved_at");

ALTER TYPE "system_issue_kind" ADD VALUE 'warehouse_scan' BEFORE 'courier_portal_login';
