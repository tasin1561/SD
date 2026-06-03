-- Phase 1B #2 — Seller bank account number encryption at rest.
--
-- Additive only:
--   - sellers.bank_account_number_masked  TEXT  -- plaintext last 4
--   - sellers.bank_account_number_key_version SMALLINT  -- AES key version
--
-- Migration semantics:
--   - bank_account_number column keeps its current type (TEXT). The
--     service layer interprets it as ciphertext when
--     bank_account_number_key_version IS NOT NULL, and as plaintext
--     when NULL (legacy / encryption-disabled mode).
--   - Existing rows are unaffected; their key_version stays NULL until
--     the next write of bankAccountNumber re-encrypts via the new path.
--   - When BANK_ACCOUNTS_KEY_V1 env is empty, the service path falls
--     back to plaintext (key_version stays NULL); no rows are
--     encrypted accidentally.
--
-- W-7 reached: bank account numbers can now be stored encrypted at
-- rest. The deferral in docs/phase-1b-plan.md is closed.

ALTER TABLE "sellers"
  ADD COLUMN "bank_account_number_masked" TEXT,
  ADD COLUMN "bank_account_number_key_version" SMALLINT;
