import { EnvService } from '../../src/config/env.service';
import type { Env } from '../../src/config/env.schema';

const BASE_ENV: Env = {
  NODE_ENV: 'test',
  PORT: 4000,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://x:y@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SIGNING_KEY: 'a'.repeat(64),
  RESEND_API_KEY: '',
  SELLER_APP_URL: 'http://localhost:3001',
  ADMIN_APP_URL: 'http://localhost:3002',
  SUPPORT_EMAIL: 'support@skydrop.online',
  DEV_MOCK_SPACES: true,
  SPACES_ENDPOINT: 'https://sgp1.digitaloceanspaces.com',
  SPACES_REGION: 'sgp1',
  SPACES_BUCKET: 'skydrop-storage',
  SPACES_ACCESS_KEY_ID: '',
  SPACES_SECRET_ACCESS_KEY: '',
  SPACES_CDN_URL: '',
  IMAGE_MAX_SIZE_BYTES: 10485760,
  CSV_MAX_ROWS: 1000,
  CSV_PRESIGN_TTL_SECONDS: 900,
  // 32-byte AES key (64 hex chars) — fixed test fixture for the courier
  // credential cipher; never a real key.
  COURIER_CREDENTIALS_KEY_V1: 'f'.repeat(64),
};

/** Shared EnvService fixture; pass overrides for the few vars a test cares about. */
export function makeTestEnv(overrides: Partial<Env> = {}): EnvService {
  return new EnvService({ ...BASE_ENV, ...overrides });
}
