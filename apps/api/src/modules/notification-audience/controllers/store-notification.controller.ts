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
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { StoreSelfService } from '../../../common/auth/require-store-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  NotificationFeedService,
  type FeedPage,
  type InboxScope,
} from '../services/notification-feed.service';
import {
  NotificationSubscriptionService,
  type SubscriptionView,
} from '../services/notification-subscription.service';
import { FeedQueryDto, SetSubscriptionDto } from '../dto/notification.dto';
import {
  NotificationTopicCatalogService,
  type TopicView,
} from '../services/notification-topic-catalog.service';

/**
 * A reseller store person's own inbox and their standing choices
 * (2026-09-19) — the seller and staff controllers' twin for the third
 * identity (RS-2).
 *
 * ── SELF-SERVICE, NOT A GRANTABLE PERMISSION (NOTIF-11) ──────────────
 * The third entry in the estate's self-service list, and it is there for
 * the same two reasons the other two are. Every row is addressed to the
 * caller by the ids on their TOKEN — their own user id AND their store —
 * so "may this person read this?" is already answered by who they are;
 * a permission would be asking a question the token has settled. And a
 * permission has to be GRANTED: a key added today reaches no role that
 * already exists, so every store login in production would have seen a
 * bell that rendered and then 403'd on the day this shipped.
 *
 * ── THE STORE-WIDE HALF IS A DIFFERENT CONTROLLER ────────────────────
 * Deciding what the whole STORE is told is an administrative act and is
 * gated (`StoreNotificationPreferenceController`). The split is not
 * tidiness: `StoreJwtGuard` SHORT-CIRCUITS its whole permission gate on
 * a class-level self-service marker, so one controller cannot be
 * self-service for some handlers and gated for others — exactly the
 * reason `AdminNotificationBroadcastController` is separate from
 * `AdminNotificationController`.
 */
@ApiTags('store-notifications')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@StoreSelfService()
@Controller('store/notifications')
export class StoreNotificationController {
  constructor(
    private readonly feed: NotificationFeedService,
    private readonly subs: NotificationSubscriptionService,
    private readonly catalog: NotificationTopicCatalogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'This person’s in-app notifications, newest first' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: FeedQueryDto,
  ): Promise<FeedPage> {
    return this.feed.list(scopeOf(user), q.cursor);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread — for the bell' })
  async unread(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<{ unread: number }> {
    return { unread: await this.feed.unreadCount(scopeOf(user)) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one read' })
  read(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id') id: string,
  ): Promise<{ readAt: Date }> {
    return this.feed.markRead(scopeOf(user), id);
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Put one back to unread. Reading something and having dealt with it are different things.',
  })
  markUnread(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id') id: string,
  ): Promise<{ readAt: null }> {
    return this.feed.markUnread(scopeOf(user), id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear one from your inbox. Hides it from you; the record of what was sent is kept, because the dedup gate reads it.',
  })
  dismiss(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id') id: string,
  ): Promise<{ dismissedAt: Date }> {
    return this.feed.dismiss(scopeOf(user), id);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear everything currently in your inbox.' })
  dismissAll(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<{ dismissed: number }> {
    return this.feed.dismissAll(scopeOf(user));
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  readAll(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<{ marked: number }> {
    return this.feed.markAllRead(scopeOf(user));
  }

  @Get('topics')
  @ApiOperation({
    summary:
      'The topics a store person can choose about, by name, each saying whether it can be silenced at all and why not',
  })
  topics(): readonly TopicView[] {
    return this.catalog.forSubject(NotificationSubjectType.STORE_USER);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'This person’s standing choices' })
  listSubs(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<readonly SubscriptionView[]> {
    return this.subs.list(NotificationSubjectType.STORE_USER, user.id);
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Subscribe to, or silence, one topic. A decision on something you asked for, anything about your money, and a change to one of your orders cannot be silenced — the refusal says why',
  })
  setSub(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: SetSubscriptionDto,
  ): Promise<SubscriptionView> {
    return this.subs.set({
      subjectType: NotificationSubjectType.STORE_USER,
      subjectId: user.id,
      topic: body.topic,
      mode: body.mode,
      ...(body.mutedChannels === undefined ? {} : { mutedChannels: body.mutedChannels }),
    });
  }

  @Delete('subscriptions/:topic')
  @ApiOperation({ summary: 'Back to the default for this topic' })
  clearSub(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('topic') topic: string,
  ): Promise<{ cleared: boolean }> {
    return this.subs.clear(NotificationSubjectType.STORE_USER, user.id, topic);
  }
}

/**
 * The inbox scope, from the TOKEN and nothing else.
 *
 * Both fields come off `req.storeUser`, which `StoreJwtGuard` re-reads
 * from the database on every request — so a person removed from a store,
 * or a store that has been closed, stops here rather than at the query.
 */
function scopeOf(user: AuthenticatedStoreUser): InboxScope {
  return { userId: user.id, storeId: user.storeId };
}
