import { ConflictException, Injectable } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationSubjectType,
  NotificationSubscriptionMode,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationPolicyService } from './notification-policy.service';

export interface SubscriptionView {
  readonly topic: string;
  readonly mode: NotificationSubscriptionMode;
  readonly mutedChannels: readonly NotificationChannel[];
}

/**
 * A person's standing choices — an OVERRIDE layer, not the mechanism.
 *
 * Every notification type declares its own default audience; these rows
 * only ADD somebody who would not have been included, or SILENCE
 * somebody who would. If subscriptions were the mechanism, the first
 * day would be complete silence and everybody would have to discover
 * what to switch on.
 *
 * A CREDENTIAL topic cannot be muted at all, and the refusal says why
 * rather than failing quietly: an unsubscribe that appears to work and
 * does not is worse than one that is refused.
 */
@Injectable()
export class NotificationSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: NotificationPolicyService,
  ) {}

  async list(
    subjectType: NotificationSubjectType,
    subjectId: string,
  ): Promise<readonly SubscriptionView[]> {
    const rows = await this.prisma.client.notificationSubscription.findMany({
      where: { subjectType, subjectId },
      orderBy: { topic: 'asc' },
      select: { topic: true, mode: true, mutedChannels: true },
    });
    return rows;
  }

  async set(input: {
    readonly subjectType: NotificationSubjectType;
    readonly subjectId: string;
    readonly topic: string;
    readonly mode: NotificationSubscriptionMode;
    readonly mutedChannels?: readonly NotificationChannel[];
  }): Promise<SubscriptionView> {
    if (input.mode === NotificationSubscriptionMode.MUTED) {
      await this.assertMutable(input.topic);
    }
    const mutedChannels = [...(input.mutedChannels ?? [])];
    const row = await this.prisma.client.notificationSubscription.upsert({
      where: {
        subjectType_subjectId_topic: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          topic: input.topic,
        },
      },
      create: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        topic: input.topic,
        mode: input.mode,
        mutedChannels,
      },
      update: { mode: input.mode, mutedChannels },
      select: { topic: true, mode: true, mutedChannels: true },
    });
    return row;
  }

  async clear(
    subjectType: NotificationSubjectType,
    subjectId: string,
    topic: string,
  ): Promise<{ cleared: boolean }> {
    const res = await this.prisma.client.notificationSubscription.deleteMany({
      where: { subjectType, subjectId, topic },
    });
    return { cleared: res.count > 0 };
  }

  /**
   * Refuse to silence something that must always arrive.
   *
   * The topic's category comes from its template. An unknown topic is
   * treated as mutable: it is not a credential message, because a
   * credential message always has a template behind it.
   */
  private async assertMutable(topic: string): Promise<void> {
    const template = await this.prisma.client.notificationTemplate.findFirst({
      where: { code: topic },
      select: { category: true },
    });
    const category = template?.category ?? NotificationCategory.INFORMATIONAL;
    if (!this.policy.isMutable(category)) {
      throw new ConflictException({
        code: 'NOTIFICATION_NOT_MUTABLE',
        message: `"${topic}" cannot be switched off. ` + this.policy.policyFor(category).reason,
      });
    }
  }
}
