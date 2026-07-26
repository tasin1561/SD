-- R2 (revised-plan roadmap) — seller-initiated withdrawal requests.
--
-- Additive only. A WithdrawalRequest never itself moves money —
-- RemittanceService.create() (the existing admin-manual-payout flow)
-- remains the sole executor; resolving a request creates a Remittance
-- separately and links it via linked_remittance_id.

CREATE TYPE "withdrawal_request_status" AS ENUM (
  'pending',
  'approved',
  'paid',
  'rejected'
);

CREATE TYPE "withdrawal_requested_by" AS ENUM (
  'seller',
  'system'
);

CREATE TABLE "withdrawal_requests" (
  "id"                    UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"             UUID NOT NULL,
  "currency"              "currency" NOT NULL,
  "amount_requested"      DECIMAL(14, 2) NOT NULL,
  "status"                "withdrawal_request_status" NOT NULL DEFAULT 'pending',
  "requested_by"          "withdrawal_requested_by" NOT NULL,
  "requested_by_user_id"  UUID,
  "linked_remittance_id"  UUID,
  "resolved_by_staff_id"  UUID,
  "resolved_at"           TIMESTAMPTZ,
  "rejection_reason"      TEXT,
  "note"                  TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ NOT NULL,

  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "withdrawal_requests_linked_remittance_id_key"
  ON "withdrawal_requests" ("linked_remittance_id");
CREATE INDEX "withdrawal_requests_seller_id_status_idx"
  ON "withdrawal_requests" ("seller_id", "status");
CREATE INDEX "withdrawal_requests_status_idx"
  ON "withdrawal_requests" ("status");
CREATE INDEX "withdrawal_requests_requested_by_user_id_idx"
  ON "withdrawal_requests" ("requested_by_user_id");
CREATE INDEX "withdrawal_requests_resolved_by_staff_id_idx"
  ON "withdrawal_requests" ("resolved_by_staff_id");

ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "seller_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_linked_remittance_id_fkey"
    FOREIGN KEY ("linked_remittance_id") REFERENCES "remittances"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_resolved_by_staff_id_fkey"
    FOREIGN KEY ("resolved_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
