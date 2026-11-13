-- Public tracking-page helper (assistant Batch C). Purely additive.
--
-- * assistant_audience gains 'public': the anonymous visitor of one tracking
--   page. Console audiences are untouched.
-- * assistant_conversations.public_awb — the ONE AWB a public conversation is
--   bound to (NULL for every console conversation).
-- * Two settings: the on/off switch (OFF until the owner turns it on) and its
--   own monthly cap in REAL USD (stored usage is billed 2.5x, as everywhere).

-- AlterEnum
ALTER TYPE "assistant_audience" ADD VALUE IF NOT EXISTS 'public';

-- AlterTable
ALTER TABLE "assistant_conversations" ADD COLUMN "public_awb" TEXT;

INSERT INTO "system_settings"
  ("key", "category", "value_type", "value_boolean", "value_int", "value_decimal", "display_name", "description", "seller_overridable", "is_editable_by_admin", "updated_at")
VALUES
  ('assistant.public_enabled', 'assistant', 'boolean', false, NULL, NULL,
   'AI parcel helper on the public tracking page',
   'Switch for the "Ask about this parcel" helper on the public tracking page. Off by default: the page shows no helper and nothing is sent to the AI provider for visitors.',
   false, true, CURRENT_TIMESTAMP),
  ('assistant.public_monthly_budget_usd', 'assistant', 'decimal', NULL, NULL, 10.000000,
   'AI parcel helper monthly budget (USD)',
   'Hard cap on what the public parcel helper may cost in a calendar month (real spend), separate from the assistant budget. Once reached, the helper is hidden from visitors until the month turns or this is raised.',
   false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
