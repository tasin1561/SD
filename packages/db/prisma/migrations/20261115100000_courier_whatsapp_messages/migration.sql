-- Delhivery's WhatsApp messages to the customer, read off their panel
-- (their public API has no endpoint for it). Additive: two new tables
-- and one new setting, nothing existing is touched.

CREATE TABLE "courier_whatsapp_messages" (
  "id"          UUID NOT NULL DEFAULT uuidv7(),
  "shipment_id" UUID NOT NULL,
  "courier_code" TEXT NOT NULL,
  "text"        TEXT NOT NULL,
  "sent_label"  TEXT NOT NULL,
  "sent_at"     TIMESTAMPTZ,
  "dedupe_hash" TEXT NOT NULL,
  "fetched_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "courier_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_whatsapp_messages_shipment_id_dedupe_hash_key"
  ON "courier_whatsapp_messages"("shipment_id", "dedupe_hash");
CREATE INDEX "courier_whatsapp_messages_shipment_id_idx"
  ON "courier_whatsapp_messages"("shipment_id");

ALTER TABLE "courier_whatsapp_messages"
  ADD CONSTRAINT "courier_whatsapp_messages_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "courier_whatsapp_checks" (
  "shipment_id"     UUID NOT NULL,
  "last_attempt_at" TIMESTAMPTZ NOT NULL,
  "last_outcome"    TEXT NOT NULL,
  "message_count"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "courier_whatsapp_checks_pkey" PRIMARY KEY ("shipment_id")
);

ALTER TABLE "courier_whatsapp_checks"
  ADD CONSTRAINT "courier_whatsapp_checks_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- seedSystemSettings() is create-only on value columns, so the setting is
-- inserted here to exist in an already-deployed database. Default OFF.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'courier.delhivery_whatsapp_enabled',
  'courier',
  'boolean',
  false,
  'Delhivery — read the WhatsApp messages they sent the customer',
  'When ON, the portal worker opens Delhivery One for parcels that were out for delivery or had a failed attempt, reads the WhatsApp messages Delhivery sent the customer, and shows them on the order page. Read-only on their panel. Default OFF until the panel read has been checked live.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
