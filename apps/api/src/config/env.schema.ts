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
});

export type Env = z.infer<typeof envSchema>;
