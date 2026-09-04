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
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { StaffSelfService } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { NotificationFeedService, type FeedPage } from '../services/notification-feed.service';
import {
  NotificationSubscriptionService,
  type SubscriptionView,
} from '../services/notification-subscription.service';
import { FeedQueryDto, SetSubscriptionDto } from '../dto/notification.dto';

/**
 * A staff member's own inbox and their standing choices.
 *
 * SELF-SERVICE, deliberately — not gated on a grantable permission.
 * Every row here is addressed to the caller by id, taken from their
 * token and never from the request, so the question a permission would
 * answer ("may this person read this?") is already answered by who
 * they are. Gating it would also have meant granting it: a permission
 * added today reaches no EXISTING role without a backfill, so the bell
 * would have rendered and then 403'd for most of the estate on the day
 * it shipped.
 *
 * Sending TO an audience is the opposite kind of act and lives in its
 * own controller behind `notifications.broadcast`.
 */
@ApiTags('admin-notifications')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@StaffSelfService()
@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(
    private readonly feed: NotificationFeedService,
    private readonly subs: NotificationSubscriptionService,
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
}
