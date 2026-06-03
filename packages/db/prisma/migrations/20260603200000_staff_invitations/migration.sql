-- Phase 1B — admin staff invitations.
--
-- Mirrors seller_invitations but the row carries a StaffRole assigned
-- at invite time. Only SUPER_ADMIN can invite (controller-gated).
-- Token is the same shape as seller invitations (plaintext returned
-- ONCE in the API response; sha256-hashed equivalent on the wire
-- for the accept-invitation endpoint, mirroring the seller pattern).

CREATE TABLE "staff_invitations" (
  "id"                UUID NOT NULL DEFAULT uuidv7(),
  "email"             TEXT NOT NULL,
  "token"             TEXT NOT NULL,
  "role"              "staff_role" NOT NULL,
  "invited_by_id"     UUID NOT NULL,
  "accepted_by_id"    UUID,
  "expires_at"        TIMESTAMPTZ NOT NULL,
  "used_at"           TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ NOT NULL,
  "deleted_at"        TIMESTAMPTZ,

  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_invitations_token_key" ON "staff_invitations"("token");
CREATE INDEX "staff_invitations_email_idx" ON "staff_invitations"("email");
CREATE INDEX "staff_invitations_expires_at_idx" ON "staff_invitations"("expires_at");
CREATE INDEX "staff_invitations_invited_by_id_idx" ON "staff_invitations"("invited_by_id");

ALTER TABLE "staff_invitations"
  ADD CONSTRAINT "staff_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "staff_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations"
  ADD CONSTRAINT "staff_invitations_accepted_by_id_fkey"
    FOREIGN KEY ("accepted_by_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
