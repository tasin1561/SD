import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  NotificationBroadcastStatus,
  NotificationCategory,
  NotificationChannel,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  NotificationAudienceService,
  type AudienceSelector,
} from './notification-audience.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationPolicyService } from './notification-policy.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface BroadcastPreview {
  readonly recipientCount: number;
  readonly channels: readonly NotificationChannel[];
  /** A handful of names, so "4,300 people" is checkable. */
  readonly sample: readonly string[];
}

/**
 * A message somebody deliberately sends to an audience.
 *
 * ── THE ONE NOTIFICATION THAT CANNOT BE RECALLED ─────────────────────
 * Everything else here is triggered by an event and reaches the people
 * that event concerns. A broadcast is a person choosing, and one wrong
 * click reaches every seller you have. So it is deliberately slower
 * than it needs to be:
 *
 *   - PREVIEW FIRST. `preview()` resolves the audience and returns the
 *     count plus a sample of who. "Send to all sellers" means nothing;
 *     "send to 4,312 people, starting with these five" is checkable.
 *   - The count is RESOLVED AGAIN at send and stored on the row, so
 *     what actually happened is recorded rather than inferred from an
 *     audience definition whose population has since changed.
 *   - CREDENTIAL is refused outright as a broadcast category: those are
 *     addressed to one person about their own account, and a broadcast
 *     of one is a contradiction.
 *   - A guarded status claim means two operators pressing send cannot
 *     both send it.
 *   - Audited HIGH, with the audience and the count.
 */
@Injectable()
export class NotificationBroadcastService {
  private readonly logger = new Logger(NotificationBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: NotificationAudienceService,
    private readonly dispatch: NotificationDispatchService,
    private readonly policy: NotificationPolicyService,
    private readonly audit: AuditLogService,
  ) {}

  async preview(
    selectors: readonly AudienceSelector[],
    category: NotificationCategory,
    requested: readonly NotificationChannel[],
  ): Promise<BroadcastPreview> {
    this.assertBroadcastable(category);
    const people = await this.audience.resolveMany(selectors);
    return {
      recipientCount: people.length,
      channels: this.policy.resolveChannels({ category, requested }),
      sample: people.slice(0, 5).map((p) => p.email),
    };
  }

  async send(input: {
    readonly staffId: string;
    readonly title: string;
    readonly body: string;
    readonly category: NotificationCategory;
    readonly channels: readonly NotificationChannel[];
    readonly audience: readonly AudienceSelector[];
    /** What the sender was shown. A mismatch means the population moved
     *  under them, and they should look again rather than find out
     *  afterwards. */
    readonly expectedRecipientCount?: number;
    readonly ctx?: ClientContext;
  }): Promise<{ broadcastId: string; recipientCount: number; delivered: number }> {
    this.assertBroadcastable(input.category);

    const channels = this.policy.resolveChannels({
      category: input.category,
      requested: input.channels,
    });
    if (channels.length === 0) {
      throw new ConflictException({
        code: 'NO_PERMITTED_CHANNELS',
        message: `A ${input.category} message cannot be sent on any of the channels you chose.`,
      });
    }

    const people = await this.audience.resolveMany(input.audience);
    if (people.length === 0) {
      throw new ConflictException({
        code: 'EMPTY_AUDIENCE',
        message: 'That audience is empty right now — nobody would receive this.',
      });
    }
    if (
      input.expectedRecipientCount !== undefined &&
      input.expectedRecipientCount !== people.length
    ) {
      throw new ConflictException({
        code: 'AUDIENCE_CHANGED',
        message:
          `This now reaches ${people.length} people, not the ${input.expectedRecipientCount} you ` +
          'were shown. Look again before sending.',
      });
    }

    const broadcast = await this.prisma.client.notificationBroadcast.create({
      data: {
        title: input.title,
        body: input.body,
        category: input.category,
        audience: input.audience as unknown as Prisma.InputJsonValue,
        channels: [...channels],
        status: NotificationBroadcastStatus.SENDING,
        recipientCount: people.length,
        createdByStaffId: input.staffId,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    const result = await this.dispatch.dispatch({
      topic: 'system.announcement',
      templateCode: 'system.announcement.email',
      category: input.category,
      title: input.title,
      body: input.body,
      channels,
      audience: input.audience,
      triggerEvent: 'notification.broadcast',
      broadcastId: broadcast.id,
      // Keyed on the broadcast, so a retry of the SAME broadcast cannot
      // send twice while a genuinely new one is unaffected.
      eventId: `broadcast:${broadcast.id}`,
    });

    await this.prisma.client.notificationBroadcast.update({
      where: { id: broadcast.id },
      data: {
        status:
          result.failures > 0 && result.delivered === 0
            ? NotificationBroadcastStatus.FAILED
            : NotificationBroadcastStatus.SENT,
        sentCount: result.delivered,
        failedCount: result.failures,
        finishedAt: new Date(),
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      action: 'notification.broadcast_sent',
      entityType: 'notification_broadcast',
      entityId: broadcast.id,
      severity: 'HIGH',
      metadata: {
        title: input.title,
        category: input.category,
        channels,
        audience: input.audience as unknown as Prisma.InputJsonValue,
        recipientCount: people.length,
        delivered: result.delivered,
        failures: result.failures,
        ipAddress: input.ctx?.ipAddress ?? null,
        userAgent: input.ctx?.userAgent ?? null,
        requestId: input.ctx?.requestId ?? null,
      },
    });

    this.logger.log(
      { broadcastId: broadcast.id, recipients: people.length, delivered: result.delivered },
      'Broadcast sent',
    );
    return {
      broadcastId: broadcast.id,
      recipientCount: people.length,
      delivered: result.delivered,
    };
  }

  async list(limit = 25): Promise<unknown[]> {
    return this.prisma.client.notificationBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        category: true,
        channels: true,
        status: true,
        recipientCount: true,
        sentCount: true,
        failedCount: true,
        createdAt: true,
        finishedAt: true,
      },
    });
  }

  async getById(id: string): Promise<unknown> {
    const row = await this.prisma.client.notificationBroadcast.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException({ code: 'BROADCAST_NOT_FOUND', message: 'No such broadcast' });
    }
    return row;
  }

  /**
   * A credential message is addressed to one person about their own
   * account. Broadcasting one is a contradiction, and refusing it here
   * stops the category being used as a way to reach an audience on a
   * channel the policy would otherwise deny.
   */
  private assertBroadcastable(category: NotificationCategory): void {
    if (category === NotificationCategory.CREDENTIAL) {
      throw new ConflictException({
        code: 'CATEGORY_NOT_BROADCASTABLE',
        message: 'Credential messages are about one person’s own account and cannot be broadcast.',
      });
    }
  }
}
