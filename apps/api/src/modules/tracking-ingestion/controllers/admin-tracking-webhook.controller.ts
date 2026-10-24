import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { ReplayWebhookDto } from '../dto/replay-webhook.dto';
import { WebhookReplayService } from '../services/webhook-replay.service';

/**
 * The button TRK-11's watchdog has been pointing at with nothing behind
 * it.
 *
 * `checkUnprocessedWebhooks` raises ONE issue naming the stuck rows and
 * stops, on purpose. Until now that was the whole story: the alert said
 * seven scans had been dropped and offered no way to apply them, so the
 * issue simply repeated — 604 times, against a backlog nothing could
 * clear. This is the other half, and it is the same shape as
 * `AdminTrackingPollController`: a capability that already existed in a
 * public service method, with no surface in front of it.
 *
 * `orders.tracking.manual_scan` guards it rather than `run_poll`,
 * because its own description is exactly what happens here — "Drives
 * the same order transitions a real scan would" — and it is already
 * marked dangerous. A poll is safe to press repeatedly against live
 * data; this applies a scan that has been sitting in a drawer.
 */
@ApiTags('admin-tracking-webhooks')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/tracking/webhooks')
export class AdminTrackingWebhookController {
  constructor(private readonly replay: WebhookReplayService) {}

  @Get('unprocessed')
  @RequirePermissions('orders.tracking.manual_scan')
  @ApiOperation({
    summary:
      'Every webhook that arrived and was never processed — the rows behind the "webhooks-unprocessed" alert, with the error that stopped each one.',
  })
  listUnprocessed(): ReturnType<WebhookReplayService['listUnprocessed']> {
    return this.replay.listUnprocessed();
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.tracking.manual_scan')
  @ApiOperation({
    summary:
      'Hand one stored webhook back to the processor. The scan keeps its own timestamp, so it lands where it belongs in the timeline, and an order that has moved on is left alone.',
  })
  replayWebhook(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: ReplayWebhookDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<WebhookReplayService['replay']> {
    return this.replay.replay(id, staff.id, body.reason);
  }
}
