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

  /**
   * The ROOT is readiness under another name — it runs the identical
   * check and returns the identical body — so it answers the identical
   * status. It is deliberately NOT a liveness probe: `/health/live` is
   * that, and it exists separately.
   *
   * Two names for one check that disagreed on their verdict would be
   * worse than either alone. `/health` is the obvious thing to point a
   * monitor at (it is what `scripts/deploy.sh` and `scripts/sim-e2e.ts`
   * already poll), so it is the one that must not lie.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Aggregate health (DB + Redis) — 503 when degraded' })
  async overall(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    return this.respondReadiness(res);
  }

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness — process is up' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness answers **503 when degraded**, exactly as `/health/tracking`
   * below does when stale, and for the same reason: a monitor should not
   * have to parse a body to learn something is wrong, and a non-2xx is
   * the one signal every monitoring tool already understands. Reporting
   * 200 with `{"status":"degraded"}` is worse than having no endpoint —
   * an uptime check, a load balancer and a deploy smoke test all read the
   * status and would each conclude the system is fine while it cannot
   * reach its own database.
   *
   * The BODY is unchanged: the per-dependency detail is what makes the
   * alert actionable, since a monitor shows it in the notification.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — DB + Redis reachable; 503 when either is not' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    return this.respondReadiness(res);
  }

  /**
   * ONE place decides the status from the report, so the root and
   * `/ready` cannot drift apart.
   */
  private async respondReadiness(res: Response): Promise<ReadinessReport> {
    const report = await this.checkReadiness();
    if (report.status === 'degraded') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }

  private async checkReadiness(): Promise<ReadinessReport> {
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
