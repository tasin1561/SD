import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  TrackingPollService,
  TRACKING_STALE_AFTER_MINUTES,
} from '../tracking-poll/services/tracking-poll.service';
import { Public } from '../../common/decorators/public.decorator';

interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: {
    database: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
  };
}

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly poll: TrackingPollService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggregate health (DB + Redis)' })
  async overall(): Promise<ReadinessReport> {
    return this.readiness();
  }

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness — process is up' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness — DB + Redis reachable' })
  async readiness(): Promise<ReadinessReport> {
    const [db, redis] = await Promise.all([this.prisma.healthCheck(), this.redis.healthCheck()]);
    const dbCheck = db.ok ? { ok: true } : { ok: false, error: db.error };
    const redisCheck = redis.ok ? { ok: true } : { ok: false, error: redis.error };
    return {
      status: db.ok && redis.ok ? 'ok' : 'degraded',
      checks: { database: dbCheck, redis: redisCheck },
    };
  }

  /**
   * Tracking liveness, for a watcher OUTSIDE this machine.
   *
   * Every other guard we have shares fate with the app: an in-process
   * alarm cannot fire if the process is gone, and a dashboard nobody
   * opens is not an alarm either. This endpoint exists so something with
   * no dependency on the droplet — a scheduled job elsewhere — can ask
   * "is tracking still moving?" and shout if it is not.
   *
   * It answers **503 when stale** on purpose. A watcher should not have
   * to parse a body to know something is wrong; a non-2xx is the one
   * signal every monitoring tool already understands.
   *
   * Deliberately thin: how long since a cycle, and nothing else. No
   * counts, no parcels, no customer data — it is a public endpoint, and
   * a liveness probe is not a place to leak volume.
   */
  @Public()
  @Get('tracking')
  @ApiOperation({ summary: 'Tracking liveness — 503 when no poll cycle has completed recently' })
  async tracking(@Res({ passthrough: true }) res: Response): Promise<{
    status: 'ok' | 'stale';
    minutesSinceLastRun: number | null;
    staleAfterMinutes: number;
  }> {
    const h = await this.poll.health();
    if (h.stale) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: h.stale ? 'stale' : 'ok',
      minutesSinceLastRun: h.minutesSinceLastRun,
      staleAfterMinutes: TRACKING_STALE_AFTER_MINUTES,
    };
  }
}
