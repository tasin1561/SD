-- Phase 1B — Seller team members.
--
-- Splits the "seller account" into:
--   sellers      — the COMPANY (legal entity, bank, brand)
--   seller_users — a PERSON at that company who can sign in
--
-- Auth refactor: seller-auth lookup happens on seller_users.email
-- instead of sellers.email. The original sellers.email/password_hash
-- columns are KEPT for now to avoid a cross-cutting refactor of the
-- legacy paths (notification routing, audit metadata); they're unused
-- by the auth flow after this migration and will be dropped in a
-- Phase-2 migration once all reads switch over.
--
-- Backfill: for every existing non-deleted seller, create one
-- seller_users row with role=OWNER carrying over the email +
-- password_hash. Existing sessions continue to work because the
-- JWT shape stays { sub: sellerUserId } — but every existing JWT
-- in flight after this migration will fail validation (the sub is
-- now expected to be a seller_user id, not a seller id). That's
-- acceptable — every seller re-logs in once.

CREATE TYPE "seller_user_role" AS ENUM (
  'owner', 'admin', 'ops', 'inventory', 'finance', 'viewer'
);

CREATE TABLE "seller_users" (
  "id"                UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"         UUID NOT NULL,
  "email"             TEXT NOT NULL,
  "email_display"     TEXT NOT NULL,
  "password_hash"     TEXT NOT NULL,
  "full_name"         TEXT NOT NULL,
  "role"              "seller_user_role" NOT NULL,
  "invited_by_id"     UUID,
  "email_verified_at" TIMESTAMPTZ,
  "last_login_at"     TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ NOT NULL,
  "deleted_at"        TIMESTAMPTZ,

  CONSTRAINT "seller_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_users_email_key" ON "seller_users"("email");
CREATE INDEX "seller_users_seller_id_idx" ON "seller_users"("seller_id");
CREATE INDEX "seller_users_seller_id_role_idx" ON "seller_users"("seller_id", "role");

ALTER TABLE "seller_users"
  ADD CONSTRAINT "seller_users_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_users"
  ADD CONSTRAINT "seller_users_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "seller_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "seller_user_invitations" (
  "id"             UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"      UUID NOT NULL,
  "email"          TEXT NOT NULL,
  "token"          TEXT NOT NULL,
  "role"           "seller_user_role" NOT NULL,
  "invited_by_id"  UUID NOT NULL,
  "accepted_by_id" UUID,
  "expires_at"     TIMESTAMPTZ NOT NULL,
  "used_at"        TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ NOT NULL,
  "deleted_at"     TIMESTAMPTZ,

  CONSTRAINT "seller_user_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_user_invitations_token_key" ON "seller_user_invitations"("token");
CREATE INDEX "seller_user_invitations_seller_id_idx" ON "seller_user_invitations"("seller_id");
CREATE INDEX "seller_user_invitations_email_idx" ON "seller_user_invitations"("email");
CREATE INDEX "seller_user_invitations_expires_at_idx" ON "seller_user_invitations"("expires_at");
CREATE INDEX "seller_user_invitations_invited_by_id_idx" ON "seller_user_invitations"("invited_by_id");

ALTER TABLE "seller_user_invitations"
  ADD CONSTRAINT "seller_user_invitations_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_user_invitations"
  ADD CONSTRAINT "seller_user_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "seller_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_user_invitations"
  ADD CONSTRAINT "seller_user_invitations_accepted_by_id_fkey"
    FOREIGN KEY ("accepted_by_id") REFERENCES "seller_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one OWNER seller_user per existing non-deleted seller.
INSERT INTO "seller_users" (
  "id", "seller_id", "email", "email_display", "password_hash",
  "full_name", "role", "email_verified_at", "last_login_at",
  "created_at", "updated_at"
)
SELECT
  uuidv7(),
  s."id",
  s."email",
  s."email_display",
  s."password_hash",
  s."contact_person_name",
  'owner'::"seller_user_role",
  s."email_verified_at",
  s."last_login_at",
  s."created_at",
  CURRENT_TIMESTAMP
FROM "sellers" s
WHERE s."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "seller_users" su WHERE su."seller_id" = s."id"
  );
