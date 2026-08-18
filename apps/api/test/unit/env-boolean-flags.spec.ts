import { envSchema } from '../../src/config/env.schema';

/**
 * Boolean env flags must fail SAFE.
 *
 * `DEV_MOCK_SPACES` used `z.coerce.boolean()`, which coerces with plain
 * JavaScript truthiness — so every non-empty string is true, including
 * the string "false". Production ran for an unknown period with object
 * storage silently MOCKED: presign returned `mock://…` URLs, so every
 * logo and product-image upload failed in the browser with "Failed to
 * fetch" while the server looked entirely healthy and every server-side
 * probe passed.
 *
 * The values below are the ones a person actually types. A flag that
 * turns dev mocking ON because someone wrote "false" is the wrong
 * direction to fail in, and it is invisible until an upload is tried.
 */

/** The minimum the schema demands, so a flag can be varied in isolation. */
const base = (): Record<string, string> => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SIGNING_KEY: 'x'.repeat(32),
  SELLER_APP_URL: 'https://app.example.com',
  ADMIN_APP_URL: 'https://admin.example.com',
});

function mockFlag(value: string | undefined): boolean {
  const env = base();
  if (value === undefined) delete env['DEV_MOCK_SPACES'];
  else env['DEV_MOCK_SPACES'] = value;
  return envSchema.parse(env).DEV_MOCK_SPACES;
}

describe('DEV_MOCK_SPACES only turns on when it plainly says so', () => {
  it.each([['true'], ['1']])('%s enables mocking', (v) => {
    expect(mockFlag(v)).toBe(true);
  });

  it.each([['false'], ['FALSE'], ['0'], ['no'], ['off'], [''], [' ']])(
    '%p leaves REAL storage in use',
    (v) => {
      expect(mockFlag(v)).toBe(false);
    },
  );

  it('absent leaves real storage in use', () => {
    expect(mockFlag(undefined)).toBe(false);
  });
});

describe('WORKERS_ENABLED keeps its own contract', () => {
  it('defaults to true — a single instance must run its queues', () => {
    const env = base();
    delete env['WORKERS_ENABLED'];
    expect(envSchema.parse(env).WORKERS_ENABLED).toBe(true);
  });

  it('only the exact string "false" disables it', () => {
    expect(envSchema.parse({ ...base(), WORKERS_ENABLED: 'false' }).WORKERS_ENABLED).toBe(false);
    expect(envSchema.parse({ ...base(), WORKERS_ENABLED: 'no' }).WORKERS_ENABLED).toBe(true);
  });
});
