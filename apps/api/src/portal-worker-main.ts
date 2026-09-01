import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CourierPortalModule } from './modules/courier-portal/courier-portal.module';
import { SystemIssuesModule } from './modules/system-issues/system-issues.module';

/**
 * The portal worker's own root module.
 *
 * Deliberately NOT `AppModule`. `workers-main.ts` boots the whole
 * AppModule without an HTTP listener, which is right for the BullMQ
 * workers that share the application's wiring — but wrong here: this
 * process should contain a browser and the few things the browser needs,
 * and nothing else. Booting AppModule would give it every controller,
 * every other worker and every other queue, which means a second process
 * firing crons that are supposed to have exactly one owner (SCALE-1).
 */
/**
 * EXPORTED so it can be boot-tested.
 *
 * `app-module-boots.spec.ts` compiles `AppModule`, which deliberately does
 * NOT reach the portal — so it says nothing about this graph. An
 * unexported root module would therefore be the one part of the system
 * with no DI check at all, which is exactly the shape of the defect CI
 * caught on 2026-08-06.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, SystemIssuesModule, CourierPortalModule],
})
export class PortalWorkerRootModule {}

/**
 * The portal worker process.
 *
 * ── WHY IT IS A SEPARATE PROCESS ─────────────────────────────────────
 * A long-lived Chromium must not live inside the process serving customer
 * HTTP: it holds a decrypted portal login for the life of the process, it
 * is the heaviest thing in the system by memory, and if it crashes it
 * should not take the API with it.
 *
 * ── ENABLING IS GATED ON THE DEPLOY, NOT ON A FLAG ───────────────────
 * There is no `PORTAL_WORKER_ENABLED` setting, because a flag inside the
 * API process would not help: the point is that this code is unreachable
 * from there. The gate is that somebody has to deploy and start THIS
 * entry point. Until they do, Phase 5 is code in the repository and
 * nothing more — and even once started it is SHADOW by default.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('PortalWorker');
  const app = await NestFactory.createApplicationContext(PortalWorkerRootModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  logger.log('Courier portal worker started (SHADOW unless portal_mode says otherwise)');

  const shutdown = async (signal: string): Promise<void> => {
    // Closing the context runs PortalQueue.onModuleDestroy, which
    // persists storageState. Losing that only costs a re-login, but a
    // re-login is the step most likely to meet an OTP.
    logger.log(`${signal} — closing the portal worker`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/**
 * Only when this file IS the process entry point.
 *
 * Without the guard, `import('./portal-worker-main')` starts a real
 * application context — which is what the boot test does, and it hung
 * forever waiting on signal handlers that never arrive. An entry point
 * that runs on import cannot be tested, and the thing most worth testing
 * about it is that its module graph resolves.
 *
 * `process.argv[1]` rather than `require.main === module`: the eslint
 * config has no CommonJS globals, so `require` and `module` are `no-undef`
 * here. Comparing argv is lint-clean and true for both `node dist/…js` and
 * a ts-node run.
 */
const invokedDirectly =
  process.argv[1] !== undefined && /portal-worker-main(\.[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  void bootstrap();
}
