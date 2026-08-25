import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvService } from './config/env.service';

/** The three courier document pushes — the only routes that may be big. */
const DOCUMENT_WEBHOOK_PREFIX = '/public/tracking/documents';
const GENERAL_BODY_LIMIT = '1mb';
const GENERAL_BODY_LIMIT_BYTES = 1024 * 1024;
const DOCUMENT_BODY_LIMIT = '12mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Module 10 (TRK-1) — captures the raw request bytes so the
    // tracking webhook controller can verify the HMAC signature over
    // the EXACT bytes signed by the courier (re-serializing the parsed
    // JSON would change whitespace and break the signature). Adds a
    // small per-request memory cost; acceptable at Phase 1A volume.
    rawBody: true,
    // Registered by hand below so the DOCUMENT webhooks can accept an
    // image while every other endpoint stays small. See the block after
    // `app.set('trust proxy')`.
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const env = app.get(EnvService);

  app.set('trust proxy', 1); // for x-forwarded-for behind a load balancer

  // ── Body size ─────────────────────────────────────────────────────
  // Express defaults to 100kb, which is far below a courier's document
  // push: Delhivery sends the EPOD / QC / sorter image as base64 inside
  // the JSON, and base64 adds a third again on top of a photo. At the
  // default, EVERY real document push was refused — and refused as a
  // 500, so the courier would have retried it forever.
  //
  // The large limit is scoped to those three routes rather than granted
  // globally. A 12MB body allowed on every public endpoint is a cheap
  // way to exhaust a 4GB box: the body is buffered before any guard
  // runs, so throttling does not help.
  //
  // Order matters — the guard must be registered BEFORE the parser, and
  // `useBodyParser` appends at call time, which is why bodyParser is off
  // at create.
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if ((req.url ?? '').startsWith(DOCUMENT_WEBHOOK_PREFIX)) return next();
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > GENERAL_BODY_LIMIT_BYTES) {
      res.statusCode = 413;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is larger than this endpoint accepts',
        }),
      );
      return;
    }
    next();
  });
  // A chunked request declares no length, so the guard above cannot see
  // it; the parser limit is the backstop that bounds it either way.
  app.useBodyParser('json', { limit: DOCUMENT_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: GENERAL_BODY_LIMIT });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Api-Key'],
    exposedHeaders: ['X-Request-Id'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: undefined as never });

  if (!env.isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('Skydrop API')
      .setDescription('Cross-border courier aggregator + light WMS — REST API')
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'staff-jwt')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'seller-jwt')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'seller-api-key')
      .addCookieAuth('__Host-staffRefresh', { type: 'apiKey', in: 'cookie' }, 'staff-refresh')
      .addCookieAuth('__Host-sellerRefresh', { type: 'apiKey', in: 'cookie' }, 'seller-refresh')
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  // Loopback by default — see BIND_HOST in env.schema.ts. Caddy and the
  // Next proxies are the only callers, and they are on this host.
  await app.listen(env.port, env.bindHost);
  console.info(`[skydrop-api] listening on http://${env.bindHost}:${env.port} (${env.nodeEnv})`);
}

void bootstrap();
