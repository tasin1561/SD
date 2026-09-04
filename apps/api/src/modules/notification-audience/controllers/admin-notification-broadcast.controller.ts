import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  NotificationBroadcastService,
  type BroadcastPreview,
} from '../services/notification-broadcast.service';
import type { AudienceSelector } from '../services/notification-audience.service';
import { BroadcastPreviewDto, SendBroadcastDto } from '../dto/notification.dto';

/**
 * Sending to an audience — its own controller, its own permission.
 *
 * Split from the inbox rather than sharing it: the guard short-circuits
 * the whole permission gate on a class-level self-service marker, so a
 * controller cannot be self-service for some handlers and gated for
 * others. Two controllers say the same thing more honestly anyway —
 * reading what was sent to you and sending to four thousand people are
 * not two flavours of one capability.
 *
 * A broadcast cannot be recalled. Preview exists so the number is seen
 * before it is true.
 */
@ApiTags('admin-notifications')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('notifications.broadcast')
@Controller('admin/notifications/broadcasts')
export class AdminNotificationBroadcastController {
  constructor(private readonly broadcasts: NotificationBroadcastService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'How many people this would reach, and a sample of who. "All sellers" means nothing; "4,312 people, starting with these five" is checkable',
  })
  preview(@Body() body: BroadcastPreviewDto): Promise<BroadcastPreview> {
    return this.broadcasts.preview(
      body.audience as unknown as AudienceSelector[],
      body.category,
      body.channels,
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send to an audience. Refuses if the population moved since the preview, and audits HIGH with the audience and the count',
  })
  send(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: SendBroadcastDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ broadcastId: string; recipientCount: number; delivered: number }> {
    return this.broadcasts.send({
      staffId: staff.id,
      title: body.title,
      body: body.body,
      category: body.category,
      channels: body.channels,
      audience: body.audience as unknown as AudienceSelector[],
      ...(body.expectedRecipientCount === undefined
        ? {}
        : { expectedRecipientCount: body.expectedRecipientCount }),
      ctx,
    });
  }

  @Get()
  @ApiOperation({ summary: 'What has been sent, newest first' })
  listBroadcasts(): Promise<unknown[]> {
    return this.broadcasts.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One broadcast, with its audience and counts' })
  getBroadcast(@Param('id') id: string): Promise<unknown> {
    return this.broadcasts.getById(id);
  }
}
