import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule as NestThrottlerModule, seconds, minutes } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppThrottlerGuard } from './app-throttler.guard';

/**
 * Single named throttler ('default') with a baseline of 100/min keyed by
 * request IP. Per-route decorators tighten this:
 *
 *   @Throttle({ default: { limit: 5, ttl: minutes(15) } })  // 5 in 15 min
 *   @ThrottleKey('email-ip')                                 // … per (email, ip)
 *
 * Storage is the shared Redis instance so rate limits are durable across
 * process restarts and shared across multiple API instances.
 */
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: minutes(1), limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis.client),
        errorMessage: 'Too many requests. Please slow down and try again later.',
        skipIf: () => false,
        // Headers stay on so clients see X-RateLimit-Remaining / Retry-After.
        setHeaders: true,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class ThrottlerModule {}

// Re-export so other modules can `import { seconds, minutes, hours }`.
export { seconds, minutes };
