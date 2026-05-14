import {
  OnboardingStepActor,
  SellerOnboardingStep,
} from '@skydrop/db';
import {
  SellerOnboardingService,
  OPTIONAL_STEPS,
  REQUIRED_STEPS,
} from '../../src/modules/seller-onboarding/services/seller-onboarding.service';
import { EnvService } from '../../src/config/env.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function makeEnv(): EnvService {
  return new EnvService({
    NODE_ENV: 'test',
    PORT: 4000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://x:y@localhost:5432/x',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    RESEND_API_KEY: '',
    SELLER_APP_URL: 'http://localhost:3001',
    ADMIN_APP_URL: 'http://localhost:3002',
    SUPPORT_EMAIL: 'support@skydrop.online',
  });
}

interface ProgressRow {
  id: string;
  sellerId: string;
  stepCode: SellerOnboardingStep;
  isRequired: boolean;
  completedAt: Date | null;
  completedBy: OnboardingStepActor | null;
}

interface FakeClient {
  rows: ProgressRow[];
  notificationLogs: Array<{ recipientId: string | null; templateCode: string }>;
  sellers: Array<{ id: string; email: string; companyName: string }>;
  sellerOnboardingProgress: {
    createMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  notificationLog: { findFirst: jest.Mock };
  seller: { findUnique: jest.Mock };
}

function makeClient(): FakeClient {
  const rows: ProgressRow[] = [];
  const notificationLogs: Array<{ recipientId: string | null; templateCode: string }> = [];
  const sellers: Array<{ id: string; email: string; companyName: string }> = [];

  let nextId = 1;

  const client: FakeClient = {
    rows,
    notificationLogs,
    sellers,
    sellerOnboardingProgress: {
      createMany: jest.fn(async (args: { data: Omit<ProgressRow, 'id'>[] }) => {
        for (const r of args.data) {
          rows.push({ id: `pg-${nextId++}`, ...r });
        }
        return { count: args.data.length };
      }),
      findUnique: jest.fn(async (args: { where: { sellerId_stepCode: { sellerId: string; stepCode: SellerOnboardingStep } } }) => {
        const { sellerId, stepCode } = args.where.sellerId_stepCode;
        const row = rows.find((r) => r.sellerId === sellerId && r.stepCode === stepCode);
        return row ?? null;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<ProgressRow> }) => {
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error('row not found');
        Object.assign(row, args.data);
        return row;
      }),
      findMany: jest.fn(async (args: { where: { sellerId: string; isRequired?: boolean; completedAt?: null } }) => {
        return rows.filter((r) => {
          if (r.sellerId !== args.where.sellerId) return false;
          if (args.where.isRequired !== undefined && r.isRequired !== args.where.isRequired) return false;
          if (args.where.completedAt === null && r.completedAt !== null) return false;
          return true;
        });
      }),
      count: jest.fn(async (args: { where: { sellerId: string; isRequired?: boolean; completedAt?: null } }) => {
        return rows.filter((r) => {
          if (r.sellerId !== args.where.sellerId) return false;
          if (args.where.isRequired !== undefined && r.isRequired !== args.where.isRequired) return false;
          if (args.where.completedAt === null && r.completedAt !== null) return false;
          return true;
        }).length;
      }),
    },
    notificationLog: {
      findFirst: jest.fn(async (args: { where: { recipientId: string; templateCode: string } }) => {
        return (
          notificationLogs.find(
            (n) =>
              n.recipientId === args.where.recipientId &&
              n.templateCode === args.where.templateCode,
          ) ?? null
        );
      }),
    },
    seller: {
      findUnique: jest.fn(async (args: { where: { id: string } }) => {
        return sellers.find((s) => s.id === args.where.id) ?? null;
      }),
    },
  };
  return client;
}

function makeSut() {
  const client = makeClient();
  const prisma = { client } as unknown as PrismaService;
  const enqueueMock = jest.fn().mockResolvedValue('job-1');
  const email = { enqueue: enqueueMock } as unknown as EmailQueue;
  const svc = new SellerOnboardingService(prisma, makeEnv(), email);
  return { svc, client, enqueueMock };
}

describe('SellerOnboardingService — initializeProgress', () => {
  it('inserts 8 rows; REGISTRATION_COMPLETED + COMPANY_INFO_FILLED auto-completed', async () => {
    const sut = makeSut();
    const tx = sut.client as unknown as Parameters<typeof sut.svc.initializeProgress>[1];
    await sut.svc.initializeProgress('seller-1', tx);
    expect(sut.client.rows).toHaveLength(8);
    const reg = sut.client.rows.find((r) => r.stepCode === SellerOnboardingStep.REGISTRATION_COMPLETED);
    const company = sut.client.rows.find((r) => r.stepCode === SellerOnboardingStep.COMPANY_INFO_FILLED);
    const emailV = sut.client.rows.find((r) => r.stepCode === SellerOnboardingStep.EMAIL_VERIFIED);
    expect(reg?.completedAt).not.toBeNull();
    expect(reg?.completedBy).toBe(OnboardingStepActor.SYSTEM);
    expect(company?.completedAt).not.toBeNull();
    expect(emailV?.completedAt).toBeNull();
  });

  it('REQUIRED_STEPS and OPTIONAL_STEPS together cover all rows', async () => {
    const sut = makeSut();
    const tx = sut.client as unknown as Parameters<typeof sut.svc.initializeProgress>[1];
    await sut.svc.initializeProgress('seller-2', tx);
    const required = sut.client.rows.filter((r) => r.isRequired);
    expect(required).toHaveLength(REQUIRED_STEPS.length);
    const optional = sut.client.rows.filter((r) => !r.isRequired);
    expect(optional).toHaveLength(OPTIONAL_STEPS.length);
  });
});

describe('SellerOnboardingService — markStepComplete', () => {
  async function seedSeller(sut: ReturnType<typeof makeSut>, sellerId = 'seller-1'): Promise<void> {
    const tx = sut.client as unknown as Parameters<typeof sut.svc.initializeProgress>[1];
    await sut.svc.initializeProgress(sellerId, tx);
    sut.client.sellers.push({
      id: sellerId,
      email: 's@brand.com',
      companyName: 'Brand Co',
    });
  }

  it('idempotent: re-marking a completed step is a no-op', async () => {
    const sut = makeSut();
    await seedSeller(sut);
    const first = await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.REGISTRATION_COMPLETED,
      OnboardingStepActor.SYSTEM,
    );
    expect(first.marked).toBe(false);
    const second = await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.REGISTRATION_COMPLETED,
      OnboardingStepActor.SYSTEM,
    );
    expect(second.marked).toBe(false);
  });

  it('does not enqueue the complete email when optional step is marked', async () => {
    const sut = makeSut();
    await seedSeller(sut);
    await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.IN_RETURN_ADDRESS_ADDED,
      OnboardingStepActor.SELLER,
    );
    expect(sut.enqueueMock).not.toHaveBeenCalled();
  });

  it('enqueues the onboarding-complete email when the last required step finishes', async () => {
    const sut = makeSut();
    await seedSeller(sut);
    // Complete EMAIL_VERIFIED first.
    await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.EMAIL_VERIFIED,
      OnboardingStepActor.SYSTEM,
    );
    expect(sut.enqueueMock).not.toHaveBeenCalled();
    // Now BD_ORIGIN_ADDRESS_ADDED finishes the last required step.
    const result = await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
      OnboardingStepActor.SELLER,
    );
    expect(result.onboardingCompleted).toBe(true);
    expect(sut.enqueueMock).toHaveBeenCalledTimes(1);
    const job = sut.enqueueMock.mock.calls[0]![0];
    expect(job.templateCode).toBe('seller.onboarding_complete.email');
  });

  it('fire-once: a prior onboarding-complete notification_log suppresses re-send', async () => {
    const sut = makeSut();
    await seedSeller(sut);
    sut.client.notificationLogs.push({
      recipientId: 'seller-1',
      templateCode: 'seller.onboarding_complete.email',
    });
    await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.EMAIL_VERIFIED,
      OnboardingStepActor.SYSTEM,
    );
    await sut.svc.markStepComplete(
      'seller-1',
      SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
      OnboardingStepActor.SELLER,
    );
    expect(sut.enqueueMock).not.toHaveBeenCalled();
  });
});

describe('SellerOnboardingService — getProgress / isOnboardingComplete', () => {
  it('reports missing required steps and isComplete=false until all required complete', async () => {
    const sut = makeSut();
    const tx = sut.client as unknown as Parameters<typeof sut.svc.initializeProgress>[1];
    await sut.svc.initializeProgress('seller-1', tx);
    const progress = await sut.svc.getProgress('seller-1');
    expect(progress.isComplete).toBe(false);
    expect(progress.missingRequired).toEqual(
      expect.arrayContaining([
        SellerOnboardingStep.EMAIL_VERIFIED,
        SellerOnboardingStep.BD_ORIGIN_ADDRESS_ADDED,
      ]),
    );
    expect(progress.steps).toHaveLength(8);
  });
});
