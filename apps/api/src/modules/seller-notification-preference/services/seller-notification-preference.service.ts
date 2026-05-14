import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  NotificationFrequency,
  Prisma,
  SellerNotificationCategory,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateNotificationPreferenceDto } from '../dto/update-preference.dto';

interface DefaultRow {
  category: SellerNotificationCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  webhookEnabled: boolean;
  frequency: NotificationFrequency;
}

export const DEFAULT_PREFERENCES: ReadonlyArray<DefaultRow> = [
  {
    category: SellerNotificationCategory.ORDER_UPDATES,
    emailEnabled: true,
    smsEnabled: true,
    inAppEnabled: true,
    webhookEnabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.SHIPMENT_UPDATES,
    emailEnabled: true,
    smsEnabled: true,
    inAppEnabled: true,
    webhookEnabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.STOCK_ALERTS,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.CALL_CENTER_OUTCOMES,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.BILLING,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: false,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.SYSTEM_ANNOUNCEMENTS,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    webhookEnabled: false,
    frequency: NotificationFrequency.IMMEDIATE,
  },
  {
    category: SellerNotificationCategory.MARKETING,
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: false,
    webhookEnabled: false,
    frequency: NotificationFrequency.DAILY_DIGEST,
  },
];

const DEFAULT_TIMEZONE = 'Asia/Dhaka';

export interface NotificationPreferenceView {
  id: string;
  category: SellerNotificationCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  webhookEnabled: boolean;
  frequency: NotificationFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  category: true,
  emailEnabled: true,
  smsEnabled: true,
  inAppEnabled: true,
  webhookEnabled: true,
  frequency: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  timezone: true,
  updatedAt: true,
} as const;

@Injectable()
export class SellerNotificationPreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Inserts the 7 category rows for a new seller using the Phase-1A
   * defaults. Must be called inside the registration tx so a rollback
   * doesn't leave orphan preference rows.
   */
  async seedDefaults(sellerId: string, tx: Prisma.TransactionClient): Promise<void> {
    const data: Prisma.SellerNotificationPreferenceCreateManyInput[] = DEFAULT_PREFERENCES.map(
      (d) => ({
        sellerId,
        category: d.category,
        emailEnabled: d.emailEnabled,
        smsEnabled: d.smsEnabled,
        inAppEnabled: d.inAppEnabled,
        webhookEnabled: d.webhookEnabled,
        frequency: d.frequency,
        timezone: DEFAULT_TIMEZONE,
        quietHoursStart: null,
        quietHoursEnd: null,
      }),
    );
    await tx.sellerNotificationPreference.createMany({ data });
  }

  async list(sellerId: string): Promise<NotificationPreferenceView[]> {
    return this.prisma.client.sellerNotificationPreference.findMany({
      where: { sellerId },
      orderBy: { category: 'asc' },
      select: VIEW_SELECT,
    });
  }

  async update(
    sellerId: string,
    category: SellerNotificationCategory,
    input: UpdateNotificationPreferenceDto,
    ctx: ClientContext,
  ): Promise<NotificationPreferenceView> {
    const existing = await this.prisma.client.sellerNotificationPreference.findUnique({
      where: { sellerId_category: { sellerId, category } },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PREFERENCE_NOT_FOUND',
        message: `Preference for ${category} not found for this seller`,
      });
    }

    const data: Prisma.SellerNotificationPreferenceUpdateInput = {};
    const changes: Record<string, string | boolean | null> = {};

    if (input.emailEnabled !== undefined) {
      data.emailEnabled = input.emailEnabled;
      changes['emailEnabled'] = input.emailEnabled;
    }
    if (input.smsEnabled !== undefined) {
      data.smsEnabled = input.smsEnabled;
      changes['smsEnabled'] = input.smsEnabled;
    }
    if (input.inAppEnabled !== undefined) {
      data.inAppEnabled = input.inAppEnabled;
      changes['inAppEnabled'] = input.inAppEnabled;
    }
    if (input.webhookEnabled !== undefined) {
      data.webhookEnabled = input.webhookEnabled;
      changes['webhookEnabled'] = input.webhookEnabled;
    }
    if (input.frequency !== undefined) {
      data.frequency = input.frequency;
      changes['frequency'] = input.frequency;
    }
    if (input.quietHoursStart !== undefined) {
      data.quietHoursStart = input.quietHoursStart;
      changes['quietHoursStart'] = input.quietHoursStart;
    }
    if (input.quietHoursEnd !== undefined) {
      data.quietHoursEnd = input.quietHoursEnd;
      changes['quietHoursEnd'] = input.quietHoursEnd;
    }
    if (input.timezone !== undefined) {
      data.timezone = input.timezone;
      changes['timezone'] = input.timezone;
    }

    if (Object.keys(changes).length === 0) {
      return this.requireRow(sellerId, category);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.sellerNotificationPreference.update({
        where: { sellerId_category: { sellerId, category } },
        data,
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.notification_preference.updated',
          entityType: 'seller_notification_preference',
          entityId: row.id,
          changes: changes as Prisma.InputJsonValue,
          metadata: {
            category,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
  }

  private async requireRow(
    sellerId: string,
    category: SellerNotificationCategory,
  ): Promise<NotificationPreferenceView> {
    const row = await this.prisma.client.sellerNotificationPreference.findUnique({
      where: { sellerId_category: { sellerId, category } },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'PREFERENCE_NOT_FOUND',
        message: `Preference for ${category} not found for this seller`,
      });
    }
    return row;
  }
}
