import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
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
}
