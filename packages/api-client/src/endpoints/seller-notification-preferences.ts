import type {
  NotificationFrequency,
  SellerNotificationCategory,
} from '@skydrop/db';

export interface NotificationPreferenceView {
  readonly id: string;
  readonly category: SellerNotificationCategory;
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly inAppEnabled: boolean;
  readonly webhookEnabled: boolean;
  readonly frequency: NotificationFrequency;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly timezone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateNotificationPreferenceRequest {
  readonly emailEnabled?: boolean;
  readonly smsEnabled?: boolean;
  readonly inAppEnabled?: boolean;
  readonly webhookEnabled?: boolean;
  readonly frequency?: NotificationFrequency;
  readonly quietHoursStart?: string | null;
  readonly quietHoursEnd?: string | null;
  readonly timezone?: string;
}
