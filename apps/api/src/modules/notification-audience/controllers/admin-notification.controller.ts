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
import {
  NotificationTopicCatalogService,
  type TopicDef,
} from '../services/notification-topic-catalog.service';

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
    private readonly catalog: NotificationTopicCatalogService,
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

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Put one back to unread. Reading something and having dealt with it are different things.',
  })
  markUnread(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
  ): Promise<{ readAt: null }> {
    return this.feed.markUnread(staff.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear one from your inbox. Hides it from you; the record of what was sent is kept, because the dedup gate reads it.',
  })
  dismiss(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id') id: string,
  ): Promise<{ dismissedAt: Date }> {
    return this.feed.dismiss(staff.id, id);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear everything currently in your inbox.' })
  dismissAll(@CurrentStaff() staff: AuthenticatedStaff): Promise<{ dismissed: number }> {
    return this.feed.dismissAll(staff.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  readAll(@CurrentStaff() staff: AuthenticatedStaff): Promise<{ marked: number }> {
    return this.feed.markAllRead(staff.id);
  }

  @Get('topics')
  @ApiOperation({
    summary:
      'The topics that can be chosen about, with names. Silencing something used to mean typing its code — nobody knows the codes',
  })
  topics(): readonly TopicDef[] {
    return this.catalog.forSubject(NotificationSubjectType.STAFF_USER);
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
