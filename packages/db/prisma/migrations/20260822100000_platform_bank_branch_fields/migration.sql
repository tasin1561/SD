-- A Bangladeshi transfer needs the branch, the district and the 9-digit
-- BEFTN routing number, and the form asked for none of them. `branch_code`
-- was carrying IFSC/SWIFT/routing all at once, so whoever filled it in had
-- to choose which one to lose.
--
-- All nullable: an Indian account has an IFSC and no routing number, and a
-- Bangladeshi one the reverse.

ALTER TABLE "platform_bank_accounts"
  ADD COLUMN "branch_name" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "routing_number" TEXT;
