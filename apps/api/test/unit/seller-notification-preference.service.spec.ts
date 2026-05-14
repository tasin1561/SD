import {
  NotificationFrequency,
  SellerNotificationCategory,
} from '@skydrop/db';
import {
  DEFAULT_PREFERENCES,
  SellerNotificationPreferenceService,
} from '../../src/modules/seller-notification-preference/services/seller-notification-preference.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

interface PrefRow {
  id: string;
  sellerId: string;
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

function makeSut() {
  const rows: PrefRow[] = [];
  let nextId = 1;
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

  const txClient = {
    sellerNotificationPreference: {
      createMany: jest.fn(async (args: { data: Omit<PrefRow, 'id' | 'updatedAt'>[] }) => {
        for (const r of args.data) {
          rows.push({
            id: `p-${nextId++}`,
            updatedAt: new Date(),
            ...r,
          });
        }
        return { count: args.data.length };
      }),
      update: jest.fn(async (args: { where: { sellerId_category: { sellerId: string; category: SellerNotificationCategory } }; data: Partial<PrefRow> }) => {
        const { sellerId, category } = args.where.sellerId_category;
        const row = rows.find((r) => r.sellerId === sellerId && r.category === category);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
    auditLog: { create: auditCreate },
  };

  const prismaClient = {
    sellerNotificationPreference: {
      findUnique: jest.fn(async (args: { where: { sellerId_category: { sellerId: string; category: SellerNotificationCategory } } }) => {
        const { sellerId, category } = args.where.sellerId_category;
        return rows.find((r) => r.sellerId === sellerId && r.category === category) ?? null;
      }),
      findMany: jest.fn(async (args: { where: { sellerId: string } }) => {
        return rows.filter((r) => r.sellerId === args.where.sellerId);
      }),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txClient) => unknown) => cb(txClient)),
  };

  const prisma = { client: prismaClient } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const svc = new SellerNotificationPreferenceService(prisma, audit);
  return { svc, rows, prismaClient, txClient, auditCreate };
}

describe('SellerNotificationPreferenceService — seedDefaults', () => {
  it('creates exactly 7 rows with Asia/Dhaka timezone and null quiet hours', async () => {
    const sut = makeSut();
    const tx = sut.txClient as unknown as Parameters<typeof sut.svc.seedDefaults>[1];
    await sut.svc.seedDefaults('seller-1', tx);
    expect(sut.rows).toHaveLength(7);
    for (const r of sut.rows) {
      expect(r.timezone).toBe('Asia/Dhaka');
      expect(r.quietHoursStart).toBeNull();
      expect(r.quietHoursEnd).toBeNull();
    }
  });

  it('MARKETING defaults to DAILY_DIGEST, others to IMMEDIATE', async () => {
    const sut = makeSut();
    const tx = sut.txClient as unknown as Parameters<typeof sut.svc.seedDefaults>[1];
    await sut.svc.seedDefaults('seller-1', tx);
    const marketing = sut.rows.find((r) => r.category === SellerNotificationCategory.MARKETING)!;
    expect(marketing.frequency).toBe(NotificationFrequency.DAILY_DIGEST);
    const orderUpdates = sut.rows.find(
      (r) => r.category === SellerNotificationCategory.ORDER_UPDATES,
    )!;
    expect(orderUpdates.frequency).toBe(NotificationFrequency.IMMEDIATE);
  });

  it('default channel matrix matches the Phase 1A spec', async () => {
    const sut = makeSut();
    const tx = sut.txClient as unknown as Parameters<typeof sut.svc.seedDefaults>[1];
    await sut.svc.seedDefaults('seller-1', tx);
    for (const expected of DEFAULT_PREFERENCES) {
      const actual = sut.rows.find((r) => r.category === expected.category)!;
      expect(actual.emailEnabled).toBe(expected.emailEnabled);
      expect(actual.smsEnabled).toBe(expected.smsEnabled);
      expect(actual.inAppEnabled).toBe(expected.inAppEnabled);
      expect(actual.webhookEnabled).toBe(expected.webhookEnabled);
    }
  });
});

describe('SellerNotificationPreferenceService — update', () => {
  it('writes only changed fields and logs audit', async () => {
    const sut = makeSut();
    const tx = sut.txClient as unknown as Parameters<typeof sut.svc.seedDefaults>[1];
    await sut.svc.seedDefaults('seller-1', tx);
    await sut.svc.update(
      'seller-1',
      SellerNotificationCategory.MARKETING,
      { emailEnabled: false, frequency: NotificationFrequency.DISABLED },
      ctx,
    );
    const row = sut.rows.find((r) => r.category === SellerNotificationCategory.MARKETING)!;
    expect(row.emailEnabled).toBe(false);
    expect(row.frequency).toBe(NotificationFrequency.DISABLED);
    expect(sut.auditCreate).toHaveBeenCalled();
    const data = sut.auditCreate.mock.calls.at(-1)?.[0].data;
    expect(data.action).toBe('seller.notification_preference.updated');
  });
});
