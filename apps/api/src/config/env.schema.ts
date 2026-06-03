import { z } from 'zod';

// Note: no `.strict()` — process.env contains many shell/OS vars; we only
// care about the ones declared here. Extras are silently dropped.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SIGNING_KEY: z.string().min(32, 'JWT_SIGNING_KEY must be at least 32 characters'),

  RESEND_API_KEY: z.string().optional().default(''),

  SELLER_APP_URL: z.string().url(),
  ADMIN_APP_URL: z.string().url(),
  // Module 11: base URL of the customer-facing tracking page (the
  // future apps/track SSR; the M10 GET /public/tracking/:awb endpoint
  // is the API side). M11 customer notifications template
  // {{ tracking_url }} as `${PUBLIC_TRACKING_URL}/${awb}` — the
  // priority template customer.order_dispatched.email is the most
  // visible consumer. Default to track.skydrop.online for Phase-1A
  // dev; prod sets this explicitly.
  PUBLIC_TRACKING_URL: z.string().url().default('https://track.skydrop.online'),

  SUPPORT_EMAIL: z.string().email().default('support@skydrop.online'),

  COOKIE_DOMAIN: z.string().optional(),

  // --- DigitalOcean Spaces (S3-compatible object storage) ---------------
  // Credentialed vars are optional so the app boots in DEV_MOCK_SPACES mode
  // without real DO creds (used by e2e + local dev).
  DEV_MOCK_SPACES: z.coerce.boolean().default(false),
  SPACES_ENDPOINT: z.string().url().default('https://sgp1.digitaloceanspaces.com'),
  SPACES_REGION: z.string().default('sgp1'),
  SPACES_BUCKET: z.string().default('skydrop-storage'),
  SPACES_ACCESS_KEY_ID: z.string().optional().default(''),
  SPACES_SECRET_ACCESS_KEY: z.string().optional().default(''),
  SPACES_CDN_URL: z.string().optional().default(''),

  // --- Catalog image + CSV limits --------------------------------------
  IMAGE_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
  CSV_MAX_ROWS: z.coerce.number().int().positive().default(1000),
  CSV_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // --- Courier credential encryption (Module 9, CUR-1) -----------------
  // AES-256-GCM key as 64 hex chars (32 bytes). VERSIONED — the
  // courier_credentials row records `encryptionKeyVersion`; a future key
  // rotation adds COURIER_CREDENTIALS_KEY_V2 without touching V1-encrypted
  // rows. Optional/empty so the app boots in stub mode (empty
  // courier.delhivery_api_base_url) without real courier creds — used by
  // e2e + local dev. The decryption key is NEVER in the DB (MUST NOT #1).
  COURIER_CREDENTIALS_KEY_V1: z
    .string()
    .regex(/^([0-9a-fA-F]{64})?$/, 'COURIER_CREDENTIALS_KEY_V1 must be 64 hex chars (32 bytes) or empty')
    .optional()
    .default(''),

  // --- Module 10 — Public Tracking webhook HMAC secrets ---------------
  // CUR-1 discipline (same as the courier-credential key): the secret
  // lives in env, never the DB. The `tracking.webhook_secret_ref`
  // system setting names which env var to read for a given courier
  // (Phase 1A has one — Delhivery). Optional/empty so the app boots
  // without it; an unconfigured secret means inbound webhooks for that
  // courier 401 (fail-closed, TRK-1). Real-mode HMAC scheme + header
  // name are TODO(delhivery-api).
  TRACKING_WEBHOOK_SECRET_DELHIVERY: z.string().optional().default(''),

  // --- Module 18 — ChatWoot live chat ---------------------------------
  // Real-mode token + HMAC secret. Both optional/empty so the app
  // boots in stub mode (chat.chatwoot_base_url unset). The system
  // settings (chat.chatwoot_base_url / _account_id / _inbox_id) gate
  // when these are READ; an empty token in real mode = silently no-op
  // (logged warning, no chat traffic).
  CHATWOOT_API_TOKEN: z.string().optional().default(''),
  CHATWOOT_HMAC_SECRET: z.string().optional().default(''),

  // --- Phase 1B #2 — Bank account number encryption ------------------
  // AES-256-GCM key (32 bytes / 64 hex chars) for encrypting the
  // `sellers.bank_account_number` plaintext at rest. Same shape as
  // COURIER_CREDENTIALS_KEY_V1. When empty the encryption layer is
  // disabled — writes pass through plaintext + `_key_version` stays
  // null. Reads of pre-encryption rows continue to work; encrypted
  // rows require the key. Rotating: deploy V2 alongside V1, run a
  // re-encrypt script, drop V1.
  BANK_ACCOUNTS_KEY_V1: z
    .string()
    .regex(
      /^([0-9a-fA-F]{64})?$/,
      'BANK_ACCOUNTS_KEY_V1 must be 64 hex chars (32 bytes) or empty',
    )
    .optional()
    .default(''),
});

export type Env = z.infer<typeof envSchema>;
