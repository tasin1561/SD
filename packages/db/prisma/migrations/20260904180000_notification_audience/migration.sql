-- Notifications that can address an AUDIENCE, on more than one channel.
--
-- Until now a notification had one hardcoded recipient and one channel
-- (email). This adds: what KIND a message is — which decides the
-- channels it may use at all — plus per-person subscriptions, the
-- grouping that makes "one notification, two channels" one thing, and
-- a record of each deliberate broadcast.

CREATE TYPE "notification_category" AS ENUM (
  'credential', 'operational', 'informational', 'announcement'
);
CREATE TYPE "notification_subscription_mode" AS ENUM ('subscribed', 'muted');
CREATE TYPE "notification_broadcast_status" AS ENUM (
  'draft', 'sending', 'sent', 'cancelled', 'failed'
);
CREATE TYPE "notification_subject_type" AS ENUM ('seller_user', 'staff_user');

-- The category is what makes the credential rule structural rather than
-- a setting somebody can get wrong. Defaulted to 'operational' so an
-- un-categorised template is never mistaken for a credential one; the
-- seed states every template explicitly.
ALTER TABLE "notification_templates"
  ADD COLUMN "category" "notification_category" NOT NULL DEFAULT 'operational';

-- One notification delivered to an inbox AND an email is one thing.
ALTER TABLE "notification_logs" ADD COLUMN "group_id" UUID;
ALTER TABLE "notification_logs" ADD COLUMN "broadcast_id" UUID;

-- The in-app feed reads by recipient, newest first, and counts unread.
CREATE INDEX "notification_logs_in_app_feed_idx"
  ON "notification_logs" ("to_in_app_user_id", "created_at" DESC)
  WHERE "to_in_app_user_id" IS NOT NULL;
CREATE INDEX "notification_logs_group_id_idx" ON "notification_logs" ("group_id");
CREATE INDEX "notification_logs_broadcast_id_idx" ON "notification_logs" ("broadcast_id");

CREATE TABLE "notification_subscriptions" (
  "id"             UUID PRIMARY KEY DEFAULT uuidv7(),
  "subject_type"   "notification_subject_type" NOT NULL,
  "subject_id"     UUID NOT NULL,
  "topic"          TEXT NOT NULL,
  "mode"           "notification_subscription_mode" NOT NULL,
  "muted_channels" "notification_channel"[] NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL
);
-- One standing choice per person per topic: two rows saying opposite
-- things is a question with no answer.
CREATE UNIQUE INDEX "notification_subscriptions_subject_type_subject_id_topic_key"
  ON "notification_subscriptions" ("subject_type", "subject_id", "topic");
CREATE INDEX "notification_subscriptions_topic_mode_idx"
  ON "notification_subscriptions" ("topic", "mode");

CREATE TABLE "notification_broadcasts" (
  "id"                    UUID PRIMARY KEY DEFAULT uuidv7(),
  "title"                 TEXT NOT NULL,
  "body"                  TEXT NOT NULL,
  "category"              "notification_category" NOT NULL,
  "audience"              JSONB NOT NULL,
  "channels"              "notification_channel"[] NOT NULL,
  "status"                "notification_broadcast_status" NOT NULL DEFAULT 'draft',
  "recipient_count"       INTEGER NOT NULL DEFAULT 0,
  "sent_count"            INTEGER NOT NULL DEFAULT 0,
  "failed_count"          INTEGER NOT NULL DEFAULT 0,
  "created_by_staff_id"   UUID NOT NULL REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cancelled_by_staff_id" UUID,
  "cancel_reason"         TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at"            TIMESTAMPTZ,
  "finished_at"           TIMESTAMPTZ
);
CREATE INDEX "notification_broadcasts_status_created_at_idx"
  ON "notification_broadcasts" ("status", "created_at");
