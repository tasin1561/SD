import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  CLOSED,
  gate,
  onFailure,
  onSuccess,
  type BreakerGate,
  type BreakerReason,
  type BreakerState,
} from '../breaker';

const KEY = 'courier-whatsapp:breaker';
const PROBE_KEY = 'courier-whatsapp:breaker:probe';
export const DROPPED_KEY = 'courier-whatsapp:dropped';
export const LOWMEM_KEY = 'courier-whatsapp:lowmem';

/** The breaker's state in Redis, shared by the worker and the API. */
@Injectable()
export class WhatsappBreakerStore {
  constructor(private readonly redis: RedisService) {}

  async state(): Promise<BreakerState> {
    try {
      const raw = await this.redis.client.get(KEY);
      return raw === null ? CLOSED : (JSON.parse(raw) as BreakerState);
    } catch {
      return CLOSED;
    }
  }

  private async save(s: BreakerState): Promise<void> {
    await this.redis.client.set(KEY, JSON.stringify(s));
  }

  /** `run`, `wait`, or `probe` (only one caller gets the probe). */
  async gate(now = Date.now()): Promise<BreakerGate> {
    const g = gate(await this.state(), now);
    if (g !== 'probe') return g;
    const won = await this.redis.client.set(PROBE_KEY, '1', 'EX', 90, 'NX');
    return won === 'OK' ? 'probe' : 'wait';
  }

  async success(): Promise<void> {
    await this.redis.client.del(PROBE_KEY);
    if ((await this.state()).status === 'open' || (await this.state()).failures > 0) {
      await this.save(onSuccess());
    }
  }

  async failure(reason: BreakerReason, hard: boolean, now = Date.now()): Promise<BreakerState> {
    const next = onFailure(await this.state(), now, reason, hard);
    await this.save(next);
    await this.redis.client.del(PROBE_KEY);
    return next;
  }

  async count(key: string): Promise<number> {
    return Number((await this.redis.client.get(key)) ?? 0);
  }

  async bump(key: string): Promise<void> {
    await this.redis.client.incr(key);
  }
}
