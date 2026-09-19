import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface FeedItem {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  readonly topic: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
  readonly orderId: string | null;
}

export interface FeedPage {
  readonly items: readonly FeedItem[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
}

/**
 * WHOSE inbox — every field taken from the caller's token, never from a
 * request (2026-09-19).
 *
 * `storeId` is NOT optional, and that is the point. A seller or staff
 * caller passes `null`, which means `to_store_id IS NULL` in the WHERE
 * clause rather than "do not filter" — so a store's rows are invisible
 * to them by construction, and a store user's `storeId` is the only
 * store whose rows they can reach. An optional field would have made the
 * safe value the one you get by forgetting, which is backwards: here,
 * forgetting does not compile.
 */
export interface InboxScope {
  /** The PERSON — SellerUser.id, StaffUser.id or StoreUser.id. */
  readonly userId: string;
  /** The reseller store, for a store user; `null` for everybody else. */
  readonly storeId: string | null;
}

/**
 * A person's own in-app inbox.
 *
 * Reads and writes are ALWAYS scoped to the calling user's id, taken
 * from their token and never from the request body — an inbox that
 * accepts "whose?" as a parameter is an inbox anybody can read.
 *
 * The IN_APP notification_logs row IS the delivery, so unread state is
 * `readAt` on that row rather than a second table to keep in step.
 */
@Injectable()
export class NotificationFeedService {
  private static readonly PAGE = 20;

  constructor(private readonly prisma: PrismaService) {}

  async list(scope: InboxScope, cursor?: string): Promise<FeedPage> {
    const rows = await this.prisma.client.notificationLog.findMany({
      where: {
        ...owned(scope),
        channel: NotificationChannel.IN_APP,
        dismissedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: NotificationFeedService.PAGE + 1,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        subject: true,
        body: true,
        templateCode: true,
        createdAt: true,
        readAt: true,
        orderId: true,
      },
    });

    const hasMore = rows.length > NotificationFeedService.PAGE;
    const page = hasMore ? rows.slice(0, NotificationFeedService.PAGE) : rows;

    return {
      items: page.map((r) => ({
        id: r.id,
        title: r.subject,
        body: r.body,
        topic: r.templateCode,
        createdAt: r.createdAt,
        readAt: r.readAt,
        orderId: r.orderId,
      })),
      unreadCount: await this.unreadCount(scope),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async unreadCount(scope: InboxScope): Promise<number> {
    return this.prisma.client.notificationLog.count({
      where: {
        ...owned(scope),
        channel: NotificationChannel.IN_APP,
        readAt: null,
        dismissedAt: null,
      },
    });
  }

  /**
   * Mark one as read.
   *
   * Guarded on the caller's own id in the WHERE rather than fetched and
   * checked: a read-then-write here would be one missing comparison
   * away from letting anybody mark — and by implication read — somebody
   * else's row. A miss is a 404 and says nothing about whether the row
   * exists.
   */
  async markRead(scope: InboxScope, id: string): Promise<{ readAt: Date }> {
    const readAt = new Date();
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { id, ...owned(scope), readAt: null, dismissedAt: null },
      data: { readAt },
    });
    if (res.count === 0) {
      const already = await this.prisma.client.notificationLog.findFirst({
        where: { id, ...owned(scope) },
        select: { readAt: true },
      });
      if (already?.readAt != null) return { readAt: already.readAt };
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'No such notification',
      });
    }
    return { readAt };
  }

  /**
   * Put one back to unread.
   *
   * The mirror of markRead, and it needs to exist for the same reason
   * an email client has it: reading something and having dealt with it
   * are different, and the only way to say "come back to this" is to
   * un-read it. Guarded on the caller's own id in the WHERE, like every
   * other write here.
   */
  async markUnread(scope: InboxScope, id: string): Promise<{ readAt: null }> {
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { id, ...owned(scope), dismissedAt: null },
      data: { readAt: null },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'No such notification',
      });
    }
    return { readAt: null };
  }

  /**
   * Clear one from this person's inbox.
   *
   * NOT a row delete, and the distinction is load-bearing:
   * `notification_logs` is the ledger the NOTIF-2 dedup gate reads, so
   * removing a row would let a re-emit of the same event send again —
   * "delete" in a UI would quietly reopen the hole the partial unique
   * exists to close. This hides it from one person and leaves the
   * record of what was sent alone.
   *
   * Idempotent: dismissing an already-dismissed row is not an error,
   * because two tabs and a slow network are not a failure.
   */
  async dismiss(scope: InboxScope, id: string): Promise<{ dismissedAt: Date }> {
    const dismissedAt = new Date();
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { id, ...owned(scope), dismissedAt: null },
      data: { dismissedAt },
    });
    if (res.count === 0) {
      const already = await this.prisma.client.notificationLog.findFirst({
        where: { id, ...owned(scope) },
        select: { dismissedAt: true },
      });
      if (already?.dismissedAt != null) return { dismissedAt: already.dismissedAt };
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'No such notification',
      });
    }
    return { dismissedAt };
  }

  /** Clear everything currently in this person's inbox. */
  async dismissAll(scope: InboxScope): Promise<{ dismissed: number }> {
    const res = await this.prisma.client.notificationLog.updateMany({
      where: {
        ...owned(scope),
        channel: NotificationChannel.IN_APP,
        dismissedAt: null,
      },
      data: { dismissedAt: new Date() },
    });
    return { dismissed: res.count };
  }

  async markAllRead(scope: InboxScope): Promise<{ marked: number }> {
    const res = await this.prisma.client.notificationLog.updateMany({
      where: {
        ...owned(scope),
        channel: NotificationChannel.IN_APP,
        readAt: null,
        dismissedAt: null,
      },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }
}

/**
 * The ownership predicate, in ONE place.
 *
 * Both halves of it are from the token: the person's own id, and — for a
 * reseller store user — their store. `toStoreId: null` for a seller or
 * staff caller is a real filter, not an absent one, so a store's rows
 * can never surface in somebody else's inbox even if two id spaces ever
 * produced the same uuid, and a person moved between stores does not
 * carry the old store's messages with them.
 *
 * Written into the WHERE rather than fetched and compared: a
 * read-then-check here would be one missing comparison away from letting
 * anybody read somebody else's row, and a miss is a 404 that says
 * nothing about whether the row exists.
 */
function owned(scope: InboxScope): { toInAppUserId: string; toStoreId: string | null } {
  return { toInAppUserId: scope.userId, toStoreId: scope.storeId };
}
