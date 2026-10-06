-- Phase 1 of 2: let the transitional role columns go unwritten.
--
-- ── WHY TWO MIGRATIONS AND NOT ONE DROP ─────────────────────────────
-- `scripts/deploy.sh` runs `prisma migrate deploy` at step 4 and
-- restarts pm2 at step 7, with six app builds in between. For those
-- minutes the OLD build is still serving, and the old build's JWT
-- guards do `select: { role: true }` on staff_users and seller_users —
-- every authenticated request goes through them. A migration that
-- DROPPED those columns would therefore take the whole platform down
-- for the length of a build, silently, on a deploy reported as green.
--
-- So this migration only RELAXES: the columns stay, and the old code
-- keeps reading and writing them exactly as it does today. What changes
-- is that they may now be absent, which is what lets the new build stop
-- writing them. `20261006..._drop_transitional_role_columns` removes
-- them for real, in a later deploy, once nothing reads them at all.
--
-- ── NOTHING IS LOST HERE ────────────────────────────────────────────
-- Every role these columns named is already a row in `staff_user_roles`
-- / `seller_user_roles` / `store_user_roles`, verified before this was
-- written: zero users and zero pending invitations held a role that the
-- join tables did not also hold. Those tables have been the authority
-- for authorisation since `20261005000000_multi_role_per_person`.

-- staff_users ---------------------------------------------------------
ALTER TABLE "staff_users" DROP CONSTRAINT "staff_users_role_id_fkey";
ALTER TABLE "staff_users" ALTER COLUMN "role_id" DROP NOT NULL;
DROP INDEX "staff_users_role_id_idx";
DROP INDEX "staff_users_role_idx";

-- seller_users --------------------------------------------------------
ALTER TABLE "seller_users" DROP CONSTRAINT "seller_users_role_id_fkey";
ALTER TABLE "seller_users" ALTER COLUMN "role_id" DROP NOT NULL;
DROP INDEX "seller_users_role_id_idx";
DROP INDEX "seller_users_seller_id_role_idx";

-- store_users ---------------------------------------------------------
ALTER TABLE "store_users" DROP CONSTRAINT "store_users_role_id_fkey";
ALTER TABLE "store_users" ALTER COLUMN "role_id" DROP NOT NULL;
DROP INDEX "store_users_role_id_idx";

-- store_user_invitations ----------------------------------------------
ALTER TABLE "store_user_invitations" DROP CONSTRAINT "store_user_invitations_role_id_fkey";
ALTER TABLE "store_user_invitations" ALTER COLUMN "role_id" DROP NOT NULL;
