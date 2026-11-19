-- Additive: the auto-confirm delay expressed in minutes. The hours key stays and
-- every existing override keeps its meaning. NULL default = "not set": the
-- resolver then falls back to the hours value x 60.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "override_min_int", "override_max_int",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(), 'ops.call_auto_confirm_ttl_minutes', 'ops', 'int', NULL,
  'Auto-Confirm After (minutes)',
  'Minutes version of the auto-confirm delay, used only while confirmation calls are OFF. When a client has their own minutes value it wins; else their own hours value x 60; else this default if set; else the hours default x 60. From 5 minutes to 10080 (7 days).',
  true, false, true, 5, 10080, now(), now()
)
ON CONFLICT ("key") DO NOTHING;
