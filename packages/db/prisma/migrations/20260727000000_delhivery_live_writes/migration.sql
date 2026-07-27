-- Delhivery goes to PRODUCTION with no sandbox available.
--
-- seedSystemSettings() is create-only on value columns, so a new setting
-- must be inserted here to exist in an already-deployed database.
--
-- Defaults to FALSE: reads may flow, but nothing that manifests a parcel,
-- dispatches a van, cancels a customer's order or consumes waybills runs
-- until an operator turns this on deliberately.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'courier.delhivery_live_writes_enabled',
  'courier',
  'boolean',
  false,
  'Delhivery LIVE Writes Enabled',
  'When OFF (default) Skydrop refuses any Delhivery call with a physical or billable effect — manifest a shipment, edit/cancel one, request a pickup, take an NDR action, register a warehouse, consume waybills — while still allowing reads. There is no sandbox for this account: every write here is a real parcel, a real van or a real cancellation.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
