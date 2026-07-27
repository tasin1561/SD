import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Workers-only bootstrap.
 *
 * Boots the same `AppModule` as `main.ts` but via
 * `NestFactory.createApplicationContext()` — no HTTP listen, no
 * Swagger, no global filters/pipes (controllers are unreachable
 * because there's no HTTP server, so global request-pipeline
 * machinery is unused). BullMQ workers, BullMQ queues, the
 * lifecycle-event bus subscriber, and every `OnApplicationBootstrap`
 * hook fire exactly as they would in `main.ts`.
 *
 * Run alongside `main.ts` (api process) and BullMQ will distribute
 * jobs across consumers — N consumers => N× concurrent processing.
 * Or run this process ALONE on a worker node and have the api node
 * skip workers (TODO: a `WORKERS_DISABLED=true` env flag if/when we
 * scale to >1 droplet — Phase 1B). For Phase 1A both processes can
 * safely co-host workers.
 *
 * shutdown: `enableShutdownHooks()` so SIGTERM from pm2 drains
 * BullMQ workers + lifecycle-event listener cleanly (NOTIF-1's
 * drain hook + WMS-5 / CC-7 timer cleanup all run on
 * `OnModuleDestroy`).
 */
async function bootstrap(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  ctx.useLogger(ctx.get(Logger));
  ctx.flushLogs();

  ctx.enableShutdownHooks();

  console.info(
    '[skydrop-workers] application context booted — BullMQ workers + lifecycle listener live',
  );

  // Keep the process alive — Nest's createApplicationContext does NOT
  // start an HTTP server, but BullMQ workers + the rxjs Subject
  // listener hold the event loop open (active sockets to Redis +
  // active subscriptions). The bootstrap promise resolves immediately;
  // pm2 / SIGTERM is responsible for tearing the process down.
}

void bootstrap();
