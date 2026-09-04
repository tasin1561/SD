import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationSubjectType } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { NotificationFeedService, type FeedPage } from '../services/notification-feed.service';
import {
  NotificationSubscriptionService,
  type SubscriptionView,
} from '../services/notification-subscription.service';
import {
  NotificationBroadcastService,
  type BroadcastPreview,
} from '../services/notification-broadcast.service';
import type { AudienceSelector } from '../services/notification-audience.service';
import {
  BroadcastPreviewDto,
  FeedQueryDto,
  SendBroadcastDto,
  SetSubscriptionDto,
} from '../dto/notification.dto';

/**
 * A staff member's own inbox, their standing choices, and — behind its
 * own permission — the ability to send to an audience.
 *
 * The inbox needs no special permission beyond being staff: it is the
 * caller's own, scoped to their token. Broadcasting is separate and
 * deliberately narrow.
 */
@ApiTags('admin-notifications')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('notifications.inbox')
@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(
    private readonly feed: NotificationFeedService,
    private readonly subs: NotificationSubscriptionService,
    private readonly broadcasts: NotificationBroadcastService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'This staff member’s in-app notifications, newest first' })
  list(@CurrentStaff() staff: AuthenticatedStaff, @Query() q: FeedQueryDto): Promise<FeedPage> {
    return this.feed.list(staff.id, q.cursor);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread — for the bell' })
  async unread(@CurrentStaff() staff: AuthenticatedStaff): Promise<{ unread: number }> {
    return { unread: await this.feed.unreadCount(staff.id) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one read' })
  read(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
  ): Promise<{ readAt: Date }> {
    return this.feed.markRead(staff.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  readAll(@CurrentStaff() staff: AuthenticatedStaff): Promise<{ marked: number }> {
    return this.feed.markAllRead(staff.id);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'This staff member’s standing choices' })
  listSubs(@CurrentStaff() staff: AuthenticatedStaff): Promise<readonly SubscriptionView[]> {
    return this.subs.list(NotificationSubjectType.STAFF_USER, staff.id);
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe to, or silence, one topic' })
  setSub(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: SetSubscriptionDto,
  ): Promise<SubscriptionView> {
    return this.subs.set({
      subjectType: NotificationSubjectType.STAFF_USER,
      subjectId: staff.id,
      topic: body.topic,
      mode: body.mode,
      ...(body.mutedChannels === undefined ? {} : { mutedChannels: body.mutedChannels }),
    });
  }

  @Delete('subscriptions/:topic')
  @ApiOperation({ summary: 'Back to the default for this topic' })
  clearSub(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('topic') topic: string,
  ): Promise<{ cleared: boolean }> {
    return this.subs.clear(NotificationSubjectType.STAFF_USER, staff.id, topic);
  }

  // ── Broadcast: its own permission, because it cannot be recalled ────

  @Post('broadcasts/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.broadcast')
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

  @Post('broadcasts')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.broadcast')
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

  @Get('broadcasts')
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'What has been sent, newest first' })
  listBroadcasts(): Promise<unknown[]> {
    return this.broadcasts.list();
  }

  @Get('broadcasts/:id')
  @RequirePermissions('notifications.broadcast')
  @ApiOperation({ summary: 'One broadcast, with its audience and counts' })
  getBroadcast(@Param('id') id: string): Promise<unknown> {
    return this.broadcasts.getById(id);
  }
}
