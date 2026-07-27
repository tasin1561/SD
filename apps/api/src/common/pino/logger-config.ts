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
