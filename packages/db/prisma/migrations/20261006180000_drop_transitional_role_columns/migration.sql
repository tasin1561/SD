-- Phase 2 of 2: drop the transitional role columns for real.
--
-- Phase 1 (`20261006120000_relax_transitional_role_columns`) made these
-- optional so the build that stopped writing them could ship without an
-- outage. That build is live and nothing reads or writes them, so the
-- columns are now dead weight — and a dead column that still looks
-- authoritative is exactly the drift CNS-2 and BIN-1 exist to prevent.
--
-- IRREVERSIBLE. There is nothing here to preserve: every role these
-- named is a row in `staff_user_roles` / `seller_user_roles` /
-- `store_user_roles`, which has been the sole authority since
-- `20261005000000_multi_role_per_person`.

ALTER TABLE "staff_users"            DROP COLUMN "role_id";
ALTER TABLE "staff_users"            DROP COLUMN "role";
ALTER TABLE "staff_invitations"      DROP COLUMN "role";
ALTER TABLE "seller_users"           DROP COLUMN "role_id";
ALTER TABLE "seller_users"           DROP COLUMN "role";
ALTER TABLE "seller_user_invitations" DROP COLUMN "role";
ALTER TABLE "store_users"            DROP COLUMN "role_id";
ALTER TABLE "store_user_invitations" DROP COLUMN "role_id";

-- The enum TYPES go with their last column. Nothing else uses them;
-- a type with no column is a spelling of roles that no longer exists.
DROP TYPE "staff_role";
DROP TYPE "seller_user_role";
