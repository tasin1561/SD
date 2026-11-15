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
  "next_read_at"    TIMESTAMPTZ,
  "gap_ms"          INTEGER,
  "last_new_at"     TIMESTAMPTZ,
  CONSTRAINT "courier_whatsapp_checks_pkey" PRIMARY KEY ("shipment_id")
);

ALTER TABLE "courier_whatsapp_checks"
  ADD CONSTRAINT "courier_whatsapp_checks_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "courier_whatsapp_reads" (
  "id"          UUID NOT NULL DEFAULT uuidv7(),
  "shipment_id" UUID NOT NULL,
  "outcome"     TEXT NOT NULL,
  "new_count"   INTEGER NOT NULL DEFAULT 0,
  "kind"        TEXT NOT NULL,
  "at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "courier_whatsapp_reads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "courier_whatsapp_reads_at_idx" ON "courier_whatsapp_reads"("at");

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

INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES
  (uuidv7(), 'courier.delhivery_whatsapp_batch', 'courier', 'int', 60,
   'Delhivery WhatsApp — parcels queued per 15-minute sweep',
   'The safety-net sweep queues at most this many due parcels per run (every 15 minutes). The real-time reads come from scans and from people opening an order, and are not counted here.',
   true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (uuidv7(), 'courier.delhivery_whatsapp_parallel', 'courier', 'int', 2,
   'Delhivery WhatsApp — reads at the same time',
   'How many Delhivery WhatsApp windows are read at once, each in its own tab of the one signed-in browser. Hard maximum 3 (the droplet has 4 GB of memory).',
   true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (uuidv7(), 'courier.delhivery_whatsapp_hourly_cap', 'courier', 'int', 400,
   'Delhivery WhatsApp — reads per hour ceiling',
   'Once this many reads have run in the last hour, sweep reads wait; parcels in a live conversation keep going.',
   true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (uuidv7(), 'courier.delhivery_whatsapp_queue_max', 'courier', 'int', 2000,
   'Delhivery WhatsApp — most reads allowed to wait',
   'When more than this many WhatsApp reads are waiting, new routine sweep reads are dropped (counted on the System limits page); reads for live conversations and for pages being viewed are still accepted.',
   true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
