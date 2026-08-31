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
