-- D5 — per-courier webhook authentication scheme.
--
-- TRK-1 assumed every courier signs its webhook payloads with an HMAC.
-- Delhivery does not: webhooks are enabled by emailing them a Webhook
-- Requirement Document carrying our endpoint URL and OUR chosen
-- authorization, which they then send back on every call. Against the
-- real Delhivery an HMAC-only verifier rejects every scan — silently,
-- because a 401'd webhook looks exactly like one that never arrived.
--
-- Resolution is courier-first then global, so one courier changing
-- scheme never disturbs another. HMAC remains the default: a missing
-- setting must never weaken authentication.

INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_string",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES
  (
    uuidv7(),
    'tracking.webhook_auth_scheme',
    'tracking',
    'string',
    'HMAC_SHA256',
    'Webhook Auth Scheme (default)',
    'How inbound courier webhooks are authenticated when a courier-specific key is absent: HMAC_SHA256 (the courier signs the raw body) or SHARED_SECRET (a static credential in a header). Override per courier with tracking.webhook_auth_scheme.<courierCode>.',
    true, false, false,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    uuidv7(),
    'tracking.webhook_auth_scheme.delhivery',
    'tracking',
    'string',
    'SHARED_SECRET',
    'Webhook Auth Scheme — Delhivery',
    'Delhivery does not sign webhooks; it returns the authorization we nominated in their Webhook Requirement Document. The credential itself lives in the env var named by tracking.webhook_secret_ref.',
    true, false, false,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
