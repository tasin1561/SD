import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.tokenHash',
  '*.token_hash',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.api_key',
  '*.keyHash',
  '*.key_hash',
  '*.signingKey',
  '*.JWT_SIGNING_KEY',
  // Outbound webhook signing key. A leaked one lets anyone forge a
  // payload a seller's system will trust as ours — the whole point of
  // the HMAC.
  '*.secretKey',
  '*.secret_key',
  '*.webhookSecret',
  '*.webhook_secret',
  // Courier API credentials. `credentialFields` is the RAW object POSTed
  // to /admin/courier-accounts before it is encrypted (CUR-1 says field
  // NAMES may be audited, values never); `encryptedPayload` is the
  // ciphertext, redacted because logging it hands an attacker the thing
  // the key is protecting.
  '*.credentialFields',
  '*.credential_fields',
  '*.encryptedPayload',
  '*.encrypted_payload',
  // Seller bank details. Encrypted at rest, but the plaintext passes
  // through DTOs on the way in.
  '*.bankAccountNumber',
  '*.bank_account_number',
  // Generic catch-alls for anything added later that follows the
  // obvious naming. Cheap, and the failure mode of missing one is a
  // credential in a log file that outlives the incident.
  '*.secret',
  '*.privateKey',
  '*.private_key',
];

export function pinoConfig(env: Env): Params {
  const isProd = env.NODE_ENV === 'production';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      ...(isProd
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
            },
          }),
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
      autoLogging: {
        ignore: (req) =>
          req.url === '/health' || req.url === '/health/live' || req.url === '/health/ready',
      },
      serializers: {
        req: (req: { id?: string; method?: string; url?: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
      },
    },
  };
}
