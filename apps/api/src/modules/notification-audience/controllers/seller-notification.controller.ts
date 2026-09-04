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
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { NotificationFeedService, type FeedPage } from '../services/notification-feed.service';
import {
  NotificationSubscriptionService,
  type SubscriptionView,
} from '../services/notification-subscription.service';
import { FeedQueryDto, SetSubscriptionDto } from '../dto/notification.dto';

/**
 * A seller user's own inbox and their standing choices.
 *
 * Everything is scoped to `seller.userId` — the person who
 * authenticated — never to an id in the request. Notifications are now
 * addressed to PEOPLE rather than to a company mailbox, so one seller's
 * finance person and their packer see different things.
 *
 * Readable by every seller role including VIEWER (RBAC-1): this is a
 * person's own inbox, and a role that can read orders but not its own
 * notifications about them would be a strange kind of read-only.
 */
@ApiTags('seller-notifications')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerViewerReadable()
@RequireSellerPermissions('notifications.inbox')
@Controller('seller/notifications')
export class SellerNotificationController {
  constructor(
    private readonly feed: NotificationFeedService,
    private readonly subs: NotificationSubscriptionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'This user’s in-app notifications, newest first' })
  list(@CurrentSeller() seller: AuthenticatedSeller, @Query() q: FeedQueryDto): Promise<FeedPage> {
    return this.feed.list(seller.userId, q.cursor);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread — for the bell' })
  async unread(@CurrentSeller() seller: AuthenticatedSeller): Promise<{ unread: number }> {
    return { unread: await this.feed.unreadCount(seller.userId) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one read' })
  read(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id') id: string,
  ): Promise<{ readAt: Date }> {
    return this.feed.markRead(seller.userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  readAll(@CurrentSeller() seller: AuthenticatedSeller): Promise<{ marked: number }> {
    return this.feed.markAllRead(seller.userId);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'This user’s standing choices' })
  listSubs(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly SubscriptionView[]> {
    return this.subs.list(NotificationSubjectType.SELLER_USER, seller.userId);
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Subscribe to, or silence, one topic. Credential messages cannot be silenced and the refusal says why',
  })
  setSub(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SetSubscriptionDto,
  ): Promise<SubscriptionView> {
    return this.subs.set({
      subjectType: NotificationSubjectType.SELLER_USER,
      subjectId: seller.userId,
      topic: body.topic,
      mode: body.mode,
      ...(body.mutedChannels === undefined ? {} : { mutedChannels: body.mutedChannels }),
    });
  }

  @Delete('subscriptions/:topic')
  @ApiOperation({ summary: 'Back to the default for this topic' })
  clearSub(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('topic') topic: string,
  ): Promise<{ cleared: boolean }> {
    return this.subs.clear(NotificationSubjectType.SELLER_USER, seller.userId, topic);
  }
}
