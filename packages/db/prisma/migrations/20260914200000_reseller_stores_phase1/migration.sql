-- RS-1 / RS-2 (2026-09-14) — reseller stores, phase 1. docs/reseller-stores.md.
--
-- WHAT THIS DOES TO EXISTING ROWS: every existing seller_stores row gets
-- kind = 'channel' through the column default, and every reseller-only
-- column stays NULL. The CHECK constraint at the end is validated against
-- those rows and passes because they are all channel stores with nothing
-- set. Nothing else existing is touched; every other table here is new.
--
-- Two enum values are ADDED (actor_type 'store', notification_recipient_type
-- 'store_user'); neither is used in this migration, which is what keeps
-- ALTER TYPE ... ADD VALUE legal inside the migration's transaction.
-- No TimescaleDB object is created or altered (no compression settings).

-- CreateEnum
CREATE TYPE "seller_store_kind" AS ENUM ('channel', 'reseller');

-- CreateEnum
CREATE TYPE "reseller_store_status" AS ENUM ('pending_seller_approval', 'active', 'paused', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "reseller_store_origin" AS ENUM ('seller', 'admin');

-- CreateEnum
CREATE TYPE "reseller_wallet_manager" AS ENUM ('seller', 'skydrop');

-- CreateEnum
CREATE TYPE "reseller_store_event_kind" AS ENUM ('created', 'approved', 'rejected', 'paused', 'resumed', 'closed', 'wallet_manager_changed');

-- AlterEnum
ALTER TYPE "actor_type" ADD VALUE 'store';

-- AlterEnum
ALTER TYPE "notification_recipient_type" ADD VALUE 'store_user';

-- AlterTable
ALTER TABLE "seller_stores" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "kind" "seller_store_kind" NOT NULL DEFAULT 'channel',
ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "logo_mime_type" TEXT,
ADD COLUMN     "origin" "reseller_store_origin",
ADD COLUMN     "status" "reseller_store_status",
ADD COLUMN     "status_changed_at" TIMESTAMPTZ,
ADD COLUMN     "wallet_managed_by" "reseller_wallet_manager";

-- CreateTable
CREATE TABLE "reseller_store_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "kind" "reseller_store_event_kind" NOT NULL,
    "from_status" "reseller_store_status",
    "to_status" "reseller_store_status",
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_store_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_display" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "store_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "store_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_role_permissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_user_invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "invited_by_actor_type" "actor_type" NOT NULL,
    "invited_by_id" UUID,
    "accepted_by_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "store_user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reseller_store_events_store_id_created_at_idx" ON "reseller_store_events"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_users_email_key" ON "store_users"("email");

-- CreateIndex
CREATE INDEX "store_users_store_id_idx" ON "store_users"("store_id");

-- CreateIndex
CREATE INDEX "store_users_role_id_idx" ON "store_users"("role_id");

-- CreateIndex
CREATE INDEX "store_roles_store_id_idx" ON "store_roles"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_roles_store_id_key_key" ON "store_roles"("store_id", "key");

-- CreateIndex
CREATE INDEX "store_role_permissions_role_id_idx" ON "store_role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_role_permissions_role_id_permission_key" ON "store_role_permissions"("role_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "store_user_invitations_token_key" ON "store_user_invitations"("token");

-- CreateIndex
CREATE INDEX "store_user_invitations_store_id_idx" ON "store_user_invitations"("store_id");

-- CreateIndex
CREATE INDEX "store_user_invitations_email_idx" ON "store_user_invitations"("email");

-- CreateIndex
CREATE INDEX "store_user_invitations_expires_at_idx" ON "store_user_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "store_refresh_tokens_store_user_id_idx" ON "store_refresh_tokens"("store_user_id");

-- CreateIndex
CREATE INDEX "store_refresh_tokens_token_hash_idx" ON "store_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "store_refresh_tokens_expires_at_idx" ON "store_refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "store_password_reset_tokens_store_user_id_idx" ON "store_password_reset_tokens"("store_user_id");

-- CreateIndex
CREATE INDEX "store_password_reset_tokens_token_hash_idx" ON "store_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "store_password_reset_tokens_expires_at_idx" ON "store_password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "store_email_verification_tokens_store_user_id_idx" ON "store_email_verification_tokens"("store_user_id");

-- CreateIndex
CREATE INDEX "store_email_verification_tokens_token_hash_idx" ON "store_email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "store_email_verification_tokens_expires_at_idx" ON "store_email_verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "seller_stores_kind_status_idx" ON "seller_stores"("kind", "status");

-- AddForeignKey
ALTER TABLE "reseller_store_events" ADD CONSTRAINT "reseller_store_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "store_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_roles" ADD CONSTRAINT "store_roles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_role_permissions" ADD CONSTRAINT "store_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "store_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user_invitations" ADD CONSTRAINT "store_user_invitations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user_invitations" ADD CONSTRAINT "store_user_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "store_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user_invitations" ADD CONSTRAINT "store_user_invitations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "store_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_refresh_tokens" ADD CONSTRAINT "store_refresh_tokens_store_user_id_fkey" FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_password_reset_tokens" ADD CONSTRAINT "store_password_reset_tokens_store_user_id_fkey" FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_email_verification_tokens" ADD CONSTRAINT "store_email_verification_tokens_store_user_id_fkey" FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A channel store carries none of the reseller columns; a reseller store
-- carries its status, origin and wallet manager, and is never the default
-- (the default is where a seller's OWN orders are filed). Prisma cannot
-- express a CHECK, so it lives here, and it is what makes a half-reseller
-- row unrepresentable rather than merely unlikely.
ALTER TABLE "seller_stores" ADD CONSTRAINT "seller_stores_reseller_fields_ck" CHECK (
  (
    "kind" = 'channel'
    AND "status" IS NULL
    AND "origin" IS NULL
    AND "wallet_managed_by" IS NULL
  )
  OR (
    "kind" = 'reseller'
    AND "status" IS NOT NULL
    AND "origin" IS NOT NULL
    AND "wallet_managed_by" IS NOT NULL
    AND "is_default" = false
  )
);

-- One LIVE invitation per email across every store. store_users.email is
-- globally unique, so two stores inviting the same person would leave the
-- second one's link failing at the moment it is clicked. A partial unique
-- rather than an application check: a read-then-write lets two concurrent
-- invites both see "none pending". The service retires EXPIRED live rows
-- before inserting, since an index predicate cannot read the clock.
CREATE UNIQUE INDEX "store_user_invitations_one_live_uq"
  ON "store_user_invitations" (lower("email"))
  WHERE "used_at" IS NULL AND "deleted_at" IS NULL;
