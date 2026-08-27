import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { LookupTrackingDto } from '../dto/lookup-tracking.dto';
import {
  TrackingPollService,
  type PollCycleSummary,
  type PollHealth,
} from '../services/tracking-poll.service';

/**
 * The human lever.
 *
 * Delhivery pushes us no webhooks, so the poll cron is the only thing
 * moving an order through IN_TRANSIT, OUT_FOR_DELIVERY and DELIVERED.
 * Until now the ONLY way to run a cycle was to wait for the cron: if it
 * stopped, recovery meant an SSH session and a hand-written script — at
 * the exact moment somebody is under pressure and least likely to get
 * that right.
 *
 * `pollAll()` was already public and documented as the manual trigger.
 * It simply had no caller, which is the same shape as a capability with
 * an endpoint and no screen: invisible to everyone who needs it.
 *
 * Pressing it repeatedly is safe. A cycle applies only scans strictly
 * newer than each parcel's watermark, so a second run is a no-op rather
 * than a duplicated timeline.
 */
@ApiTags('admin-tracking-poll')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/tracking/poll')
export class AdminTrackingPollController {
  constructor(private readonly poll: TrackingPollService) {}

  @Get('health')
  @RequirePermissions('orders.tracking.run_poll')
  @ApiOperation({
    summary:
      'When the last tracking cycle completed — the number to look at first when a parcel "has not updated".',
  })
  health(): Promise<PollHealth> {
    return this.poll.health();
  }

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.tracking.run_poll')
  @ApiOperation({
    summary:
      'Ask Delhivery what it knows about specific AWBs, and show what we would make of it. Reads only — writes no tracking event and moves no order.',
  })
  lookup(@Body() body: LookupTrackingDto): ReturnType<TrackingPollService['lookup']> {
    return this.poll.lookup(body.awbNumbers);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.tracking.run_poll')
  @ApiOperation({
    summary:
      'Run a tracking cycle now rather than waiting for the cron. Idempotent — only scans newer than each parcel already has are applied.',
  })
  run(): Promise<PollCycleSummary> {
    return this.poll.pollAll();
  }
}
