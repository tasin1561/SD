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

  COOKIE_DOMAIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
