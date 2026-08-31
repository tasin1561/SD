-- A courier with no API has no credential to hold.
--
-- Manual placement is DEFINED by there being no integration: you ring
-- somebody and hand them a parcel (CUR-8). Requiring a credential made
-- a manual courier account impossible to create, and without an account
-- the courier appeared nowhere on the money side — no settlement
-- dropdown, no payout bank link, no margin line. A manually-placed COD
-- parcel collected cash that had nothing to be recorded against.
--
-- UNIQUE survives: Postgres allows many NULLs in a unique index, so
-- several credential-less accounts coexist while two accounts sharing
-- one real credential still cannot.
ALTER TABLE "courier_accounts"
  ALTER COLUMN "credential_id" DROP NOT NULL;

-- The foreign key changes with the column. Prisma's referential action
-- for a REQUIRED relation is ON DELETE RESTRICT; for an OPTIONAL one it
-- is SET NULL, so leaving the old constraint in place is drift the
-- shadow-database check catches — correctly, since the two describe
-- different behaviour when a credential is deleted.
ALTER TABLE "courier_accounts"
  DROP CONSTRAINT "courier_accounts_credential_id_fkey";

ALTER TABLE "courier_accounts"
  ADD CONSTRAINT "courier_accounts_credential_id_fkey"
  FOREIGN KEY ("credential_id")
  REFERENCES "courier_credentials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
