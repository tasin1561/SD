-- Shiprocket support tickets, handled by hand exactly like Delhivery's.
--
-- 1. Shiprocket's channel row, at the same posture production holds for
--    Delhivery: MANUAL (a person sends every message), portal OFF (no
--    browser opens), no auto categories. Without a row the service
--    upserts a SUPERVISED default on first read — not what anyone chose.
INSERT INTO "courier_channel_settings" ("courier_code", "write_mode", "portal_mode", "auto_categories", "updated_at")
VALUES ('shiprocket', 'manual', 'off', ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("courier_code") DO NOTHING;

-- 2. Each courier's support-desk email, shown to the operator beside a
--    message waiting to be sent. Seeded EMPTY: an address we guessed
--    would send a seller's parcel problem to nobody. seedSystemSettings()
--    is create-only on value columns, so the rows are inserted here.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_string",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES
(
  uuidv7(),
  'courier.delhivery_support_email',
  'courier',
  'string',
  '',
  'Delhivery support desk email',
  'Where an operator emails Delhivery support by hand. Shown beside every Delhivery message waiting in the courier send queue. Empty until somebody copies the address off Delhivery One — nothing is emailed automatically.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  uuidv7(),
  'courier.shiprocket_support_email',
  'courier',
  'string',
  '',
  'Shiprocket support desk email',
  'Where an operator emails Shiprocket support by hand. Shown beside every Shiprocket message waiting in the courier send queue. Empty until somebody copies the address off the Shiprocket panel''s support section — nothing is emailed automatically.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- 3. How long a message to a courier may wait to be sent by hand before
--    it is raised on the system issues board — any courier.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'ops.courier_outbox_stall_alert_hours',
  'ops',
  'int',
  24,
  'Courier message unsent — hours before we flag it',
  'No courier accepts support messages from software, so every message queued for Delhivery or Shiprocket waits for a person to send it on their panel. After this many hours each unsent message is raised on the system issues board, and it clears itself once sent. The check never sends anything.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
