import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SellerNoteCategory, SellerStatus } from '@skydrop/db';
import { SellerAccountStatusService } from '../../src/modules/seller-management/services/seller-account-status.service';
import { EnvService } from '../../src/config/env.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

interface FakeSellerRow {
  id: string;
  email: string;
  companyName: string;
  status: SellerStatus;
}

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

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

interface SuiteState {
  sellers: FakeSellerRow[];
  notes: Array<{
    id: string;
    sellerId: string;
    category: SellerNoteCategory;
    isPinned: boolean;
    content: string;
    authorId: string;
  }>;
  tokensRevoked: number;
  auditCreate: jest.Mock;
  enqueue: jest.Mock;
}

function makeSut(seeded: Partial<FakeSellerRow> = {}) {
  const state: SuiteState = {
    sellers: [
      {
        id: 'seller-1',
        email: 'seller@brand.com',
        companyName: 'Brand Co',
        status: seeded.status ?? SellerStatus.APPROVED,
        ...seeded,
      },
    ],
    notes: [],
    tokensRevoked: 0,
    auditCreate: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    enqueue: jest.fn().mockResolvedValue('job-1'),
  };

  let nextNoteId = 1;

  const txClient = {
    seller: {
      update: jest.fn(async (args: { where: { id: string }; data: Partial<FakeSellerRow> }) => {
        const row = state.sellers.find((s) => s.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
    sellerRefreshToken: {
      updateMany: jest.fn(async () => {
        state.tokensRevoked += 2;
        return { count: 2 };
      }),
    },
    sellerNote: {
      create: jest.fn(async (args: { data: { sellerId: string; authorId: string; content: string; category: SellerNoteCategory; isPinned: boolean } }) => {
        const id = `note-${nextNoteId++}`;
        state.notes.push({ id, ...args.data });
        return { id };
      }),
    },
    auditLog: { create: state.auditCreate },
  };

  const prismaClient = {
    seller: {
      findFirst: jest.fn(async (args: { where: { id: string; deletedAt: null } }) => {
        const row = state.sellers.find((s) => s.id === args.where.id);
        return row ?? null;
      }),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txClient) => unknown) => cb(txClient)),
  };

  const prisma = { client: prismaClient } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const email = { enqueue: state.enqueue } as unknown as EmailQueue;

  const svc = new SellerAccountStatusService(prisma, makeEnv(), audit, email);
  return { svc, state, prismaClient, txClient };
}

describe('SellerAccountStatusService — suspend', () => {
  it('rejects blank reasonNote with REASON_NOTE_REQUIRED', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.suspend({ sellerId: 'seller-1', staffActorId: 'staff-1', reasonNote: '   ', ctx }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-existent seller with NotFound', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.suspend({ sellerId: 'missing', staffActorId: 'staff-1', reasonNote: 'x', ctx }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects suspending a non-APPROVED seller', async () => {
    const sut = makeSut({ status: SellerStatus.PENDING });
    await expect(
      sut.svc.suspend({ sellerId: 'seller-1', staffActorId: 'staff-1', reasonNote: 'bad behavior', ctx }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS_TRANSITION' } });
  });

  it('runs all 5 side effects: status, tokens, note, audit, email', async () => {
    const sut = makeSut();
    const result = await sut.svc.suspend({
      sellerId: 'seller-1',
      staffActorId: 'staff-1',
      reasonNote: 'compliance breach',
      ctx,
    });
    expect(result.newStatus).toBe(SellerStatus.SUSPENDED);
    expect(sut.state.sellers[0]!.status).toBe(SellerStatus.SUSPENDED);
    expect(sut.txClient.sellerRefreshToken.updateMany).toHaveBeenCalled();
    expect(sut.state.notes).toHaveLength(1);
    expect(sut.state.notes[0]!.category).toBe(SellerNoteCategory.COMPLIANCE);
    expect(sut.state.notes[0]!.isPinned).toBe(true);
    expect(sut.state.notes[0]!.content).toBe('compliance breach');
    expect(sut.state.auditCreate).toHaveBeenCalled();
    const auditData = sut.state.auditCreate.mock.calls.at(-1)?.[0].data;
    expect(auditData.action).toBe('seller.suspended');
    expect(auditData.metadata.severity).toBe('HIGH');
    expect(sut.state.enqueue).toHaveBeenCalledTimes(1);
    expect(sut.state.enqueue.mock.calls[0]![0].templateCode).toBe(
      'seller.account_suspended.email',
    );
  });
});

describe('SellerAccountStatusService — reapprove', () => {
  it('rejects reapproving a non-SUSPENDED seller', async () => {
    const sut = makeSut({ status: SellerStatus.APPROVED });
    await expect(
      sut.svc.reapprove({ sellerId: 'seller-1', staffActorId: 'staff-1', ctx }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS_TRANSITION' } });
  });

  it('uses default note when noteContent is blank', async () => {
    const sut = makeSut({ status: SellerStatus.SUSPENDED });
    await sut.svc.reapprove({
      sellerId: 'seller-1',
      staffActorId: 'staff-1',
      noteContent: '   ',
      ctx,
    });
    expect(sut.state.notes[0]!.content).toBe('Account reapproved');
    expect(sut.state.notes[0]!.category).toBe(SellerNoteCategory.GENERAL);
    expect(sut.state.notes[0]!.isPinned).toBe(false);
  });

  it('runs side effects: status, note, audit, email; does not revoke tokens', async () => {
    const sut = makeSut({ status: SellerStatus.SUSPENDED });
    await sut.svc.reapprove({
      sellerId: 'seller-1',
      staffActorId: 'staff-1',
      noteContent: 'After review, all good',
      ctx,
    });
    expect(sut.state.sellers[0]!.status).toBe(SellerStatus.APPROVED);
    expect(sut.state.notes[0]!.content).toBe('After review, all good');
    expect(sut.txClient.sellerRefreshToken.updateMany).not.toHaveBeenCalled();
    const auditData = sut.state.auditCreate.mock.calls.at(-1)?.[0].data;
    expect(auditData.action).toBe('seller.reapproved');
    expect(sut.state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'seller.account_reapproved.email' }),
    );
  });
});
