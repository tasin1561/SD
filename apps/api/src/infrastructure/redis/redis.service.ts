import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '../../config/env.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(env: EnvService) {
    this.client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  /** A second connection — BullMQ workers want their own subscriber. */
  createConnection(): Redis {
    return this.client.duplicate();
  }

  async healthCheck(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG' ? { ok: true } : { ok: false, error: `unexpected reply: ${reply}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
