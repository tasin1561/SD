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

  async list(userId: string, cursor?: string): Promise<FeedPage> {
    const rows = await this.prisma.client.notificationLog.findMany({
      where: { toInAppUserId: userId, channel: NotificationChannel.IN_APP },
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
      unreadCount: await this.unreadCount(userId),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.client.notificationLog.count({
      where: { toInAppUserId: userId, channel: NotificationChannel.IN_APP, readAt: null },
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
  async markRead(userId: string, id: string): Promise<{ readAt: Date }> {
    const readAt = new Date();
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { id, toInAppUserId: userId, readAt: null },
      data: { readAt },
    });
    if (res.count === 0) {
      const already = await this.prisma.client.notificationLog.findFirst({
        where: { id, toInAppUserId: userId },
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

  async markAllRead(userId: string): Promise<{ marked: number }> {
    const res = await this.prisma.client.notificationLog.updateMany({
      where: { toInAppUserId: userId, channel: NotificationChannel.IN_APP, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }
}
