-- Bank-detail changes go to an admin before they take effect.
--
-- The FIRST set of details a seller adds still writes straight through:
-- there is nothing to redirect yet. Every EDIT after that lands here,
-- because anyone who got into a seller's account could otherwise point
-- payouts at their own bank and the seller would find out when the money
-- did not arrive.
--
-- While a row is PENDING the live columns on `sellers` are untouched and
-- payouts keep going to the existing account. A proposed change is not a
-- fact yet, and freezing payouts would punish the seller for asking.

CREATE TYPE "bank_change_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "seller_bank_change_requests" (
    "id"                               UUID                NOT NULL DEFAULT uuidv7(),
    "seller_id"                        UUID                NOT NULL,
    "bank_name"                        TEXT                NOT NULL,
    "bank_branch_name"                 TEXT                NOT NULL,
    "bank_account_name"                TEXT                NOT NULL,
    -- Encrypted with the same cipher as the live column, and carrying its
    -- own masked copy. A request row must never be where plaintext leaks.
    "bank_account_number"              TEXT                NOT NULL,
    "bank_account_number_masked"       TEXT                NOT NULL,
    "bank_account_number_key_version"  SMALLINT,
    "bank_routing_number"              TEXT                NOT NULL,
    "bank_swift_code"                  TEXT                NOT NULL,
    "status"                           "bank_change_status" NOT NULL DEFAULT 'pending',
    "requested_by_seller_user_id"      UUID,
    "submitted_at"                     TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_staff_id"              UUID,
    "decided_at"                       TIMESTAMPTZ,
    -- The seller reads this verbatim on a rejection. Without it they
    -- resubmit the same thing.
    "decision_reason"                  TEXT,
    "created_at"                       TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                       TIMESTAMPTZ         NOT NULL,
    CONSTRAINT "seller_bank_change_requests_pkey" PRIMARY KEY ("id")
);

-- ONE pending request per seller, enforced by the DATABASE.
--
-- Not a read-then-write check in the service: under READ COMMITTED two
-- concurrent submissions would both read "none pending" and both insert,
-- and this is the money path — the same shape as every read-then-write
-- money bug this codebase has already had to fix. A partial unique index
-- cannot be raced. Approved and rejected rows are history and are
-- deliberately outside it, so a seller may submit again once decided.
CREATE UNIQUE INDEX "seller_bank_change_requests_one_pending_uq"
    ON "seller_bank_change_requests"("seller_id")
    WHERE "status" = 'pending';

CREATE INDEX "seller_bank_change_requests_seller_id_status_idx"
    ON "seller_bank_change_requests"("seller_id", "status");
CREATE INDEX "seller_bank_change_requests_status_submitted_at_idx"
    ON "seller_bank_change_requests"("status", "submitted_at");

ALTER TABLE "seller_bank_change_requests"
    ADD CONSTRAINT "seller_bank_change_requests_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_bank_change_requests"
    ADD CONSTRAINT "seller_bank_change_requests_requested_by_fkey"
    FOREIGN KEY ("requested_by_seller_user_id") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seller_bank_change_requests"
    ADD CONSTRAINT "seller_bank_change_requests_decided_by_fkey"
    FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who may decide one.
--
-- SUPER_ADMIN needs no row — it resolves to every permission implicitly,
-- so a key added later reaches it without a backfill anyone has to
-- remember. `finance` is granted explicitly because it is already the
-- role trusted to reveal a seller's bank details in order to send a
-- remittance; deciding whether those details may change is the same job
-- and the same person.
INSERT INTO staff_role_permissions (role_id, permission)
SELECT r.id, 'sellers.bank_change.approve'
FROM staff_roles r
WHERE r.key = 'finance'
  AND NOT EXISTS (
    SELECT 1 FROM staff_role_permissions p
    WHERE p.role_id = r.id AND p.permission = 'sellers.bank_change.approve'
  );
