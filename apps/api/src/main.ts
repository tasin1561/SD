import 'reflect-metadata';
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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const env = app.get(EnvService);

  app.set('trust proxy', 1); // for x-forwarded-for behind a load balancer

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

  await app.listen(env.port);
  console.info(`[skydrop-api] listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`);
}

void bootstrap();
