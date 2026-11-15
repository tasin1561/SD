-- CreateData: UAT switch for the client code in front of the recipient name. OFF by default.
INSERT INTO "system_settings"
  ("key", "category", "value_type", "value_boolean", "value_int", "value_decimal", "display_name", "description", "seller_overridable", "is_editable_by_admin", "updated_at")
VALUES
  ('uat.recipient_name_prefix', 'uat', 'boolean', false, NULL, NULL,
   'UAT — add the client code before the customer name',
   'Whether a client''s short code (for example MST) is stored in front of the recipient''s full name on orders placed from the client console, the bulk CSV and the API. OFF (default) — the name is saved exactly as typed. ON — it is saved as ''MST Syed Talha Islam''. Past orders are never rewritten either way.',
   false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
