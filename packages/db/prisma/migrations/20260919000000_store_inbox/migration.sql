-- A reseller store gets an INBOX (2026-09-19, owner).
--
-- Until now a store was reachable by email and by a portal-wide banner
-- only. Skydrop admin and Seller staff have had a bell, a feed and a
-- per-topic settings page since NOTIF-9..21; the store had none of it,
-- so every decision on one of its requests, every change to one of its
-- orders and every reply on one of its disputes arrived in a mailbox or
-- nowhere.
--
-- THREE things are added, and each is the smallest shape that works:
--
--   1. `notification_subject_type` gains `store_user`, so a store
--      person's own standing choices are THEIRS rather than their
--      seller's. `notification_subscriptions` is keyed on
--      (subject_type, subject_id, topic); without the third subject a
--      store user's mute would have had to borrow `seller_user`, and two
--      id spaces sharing one key is how one person's silence becomes
--      somebody else's.
--
--   2. `notification_logs.to_store_id`, NULL on every existing row. The
--      table is polymorphic, so before this the only thing tying a row
--      to a store was a join through `store_users` that no read
--      performed. The store inbox scopes on this column AND on the
--      person's own id, both from the TOKEN — isolation as a property of
--      the WHERE clause rather than of an invariant in another table.
--
--   3. `store_notification_preferences` — the STORE's own say, per
--      category. The first of the two layers a store message passes
--      through (the person's per-topic mute is the second); both can
--      only ever REMOVE a delivery, so they compose by intersection.
--
-- ADD VALUE runs inside the migration's transaction (Postgres >= 12).
-- The value is not USED in this migration, which is the condition.

-- AlterEnum
ALTER TYPE "notification_subject_type" ADD VALUE IF NOT EXISTS 'store_user';

-- CreateEnum
CREATE TYPE "store_notification_category" AS ENUM ('order_updates', 'money', 'support', 'terms', 'announcements');

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "to_store_id" UUID;

-- CreateTable
CREATE TABLE "store_notification_preferences" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "category" "store_notification_category" NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_store_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_notification_preferences_store_id_idx" ON "store_notification_preferences"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_notification_preferences_store_id_category_key" ON "store_notification_preferences"("store_id", "category");

-- AddForeignKey
ALTER TABLE "store_notification_preferences" ADD CONSTRAINT "store_notification_preferences_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Beyond the generated diff: the feed index ────────────────────────
--
-- The in-app feed reads by recipient, newest first, skipping dismissed
-- rows (NOTIF-21) — and a store's feed additionally scopes on the store.
-- Prisma cannot express a partial index, so it lives here and is
-- invisible to the drift check; the existing
-- `notification_logs_in_app_feed_idx` keeps serving the seller and staff
-- feeds, and this one serves the store's.
CREATE INDEX "notification_logs_store_feed_idx"
  ON "notification_logs" ("to_store_id", "to_in_app_user_id", "created_at" DESC)
  WHERE "to_store_id" IS NOT NULL AND "dismissed_at" IS NULL;
