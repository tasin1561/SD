import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SellerInvitationService } from '../../src/modules/seller-invitation/seller-invitation.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface InvRow {
  id: string;
  email: string;
  token: string;
  invitedById: string;
  sellerId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

function buildClient() {
  const invitations: InvRow[] = [];
  const sellersByEmail = new Set<string>();
  let seq = 0;
  const auditCalls: { data: Record<string, unknown> }[] = [];

  const client = {
    seller: {
      findUnique: jest.fn(async ({ where }: { where: { email: string } }) =>
        sellersByEmail.has(where.email) ? { id: 'pre-existing' } : null,
      ),
    },
    sellerInvitation: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<InvRow, 'id' | 'sellerId' | 'usedAt' | 'deletedAt' | 'createdAt'>;
        }) => {
          seq += 1;
          const row: InvRow = {
            ...data,
            id: `inv-${seq}`,
            sellerId: null,
            usedAt: null,
            deletedAt: null,
            createdAt: new Date(),
          };
          invitations.push(row);
          return row;
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          invitations.find((r) => r.id === where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          invitations.find((r) => {
            const emailFilter = where['email'] as undefined | { equals?: string };
            if (emailFilter?.equals && r.email.toLowerCase() !== emailFilter.equals.toLowerCase())
              return false;
            if (where['usedAt'] === null && r.usedAt !== null) return false;
            if (where['deletedAt'] === null && r.deletedAt !== null) return false;
            const exp = where['expiresAt'] as undefined | { gt: Date };
            if (exp && r.expiresAt.getTime() <= exp.gt.getTime()) return false;
            return true;
          }) ?? null
        );
      }),
      findMany: jest.fn(async () => invitations),
      count: jest.fn(async () => invitations.length),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<InvRow> }) => {
        const row = invitations.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        auditCalls.push(args);
        return { id: `a-${auditCalls.length}` };
      }),
    },
  };
  return { client, invitations, sellersByEmail, auditCalls };
}

function makeEnv(): EnvService {
  return makeTestEnv();
}

function makeSut() {
  const fixt = buildClient();
  const prisma = { client: fixt.client } as unknown as PrismaService;
  const env = makeEnv();
  const hashes = new TokenHashService();
  const audit = new AuditLogService(prisma);
  const enqueueMock = jest.fn().mockResolvedValue('job-1');
  const email = { enqueue: enqueueMock } as unknown as EmailQueue;
  const svc = new SellerInvitationService(prisma, env, hashes, audit, email);
  return { svc, fixt, enqueueMock, hashes };
}

const ctx = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

describe('SellerInvitationService', () => {
  it('create: stores hashed token, returns plaintext + invite URL, enqueues email, audits', async () => {
    const { svc, fixt, enqueueMock, hashes } = makeSut();
    const result = await svc.create({ email: 'NewSeller@brand.com' }, { staffId: 'staff-1' }, ctx);

    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.inviteUrl).toContain(result.token);
    expect(result.status).toBe('pending');

    // What's stored in the DB is the HASH — not the plaintext.
    const stored = fixt.invitations[0]!;
    expect(stored.token).toBe(hashes.sha256Hex(result.token));
    expect(stored.token).not.toBe(result.token);

    // Email enqueued with template + invite_url.
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const payload = enqueueMock.mock.calls[0]![0];
    expect(payload.templateCode).toBe('seller.invitation.email');
    expect(payload.variables.invite_url).toBe(result.inviteUrl);

    // Audit.
    expect(fixt.auditCalls[0]!.data['action']).toBe('staff.seller_invitation.created');
    expect(fixt.auditCalls[0]!.data['staffUserId']).toBe('staff-1');
  });

  it('create: refuses when a seller already exists for the email', async () => {
    const { svc, fixt } = makeSut();
    fixt.sellersByEmail.add('exists@brand.com');
    await expect(
      svc.create({ email: 'exists@brand.com' }, { staffId: 'staff-1' }, ctx),
    ).rejects.toThrow(ConflictException);
  });

  it('create: refuses when a live invitation already exists', async () => {
    const { svc } = makeSut();
    await svc.create({ email: 'dup@brand.com' }, { staffId: 'staff-1' }, ctx);
    await expect(
      svc.create({ email: 'dup@brand.com' }, { staffId: 'staff-1' }, ctx),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_ALREADY_PENDING' } });
  });

  it('resend: rotates the hash so the old plaintext stops working, re-enqueues email, audits', async () => {
    const { svc, fixt, hashes } = makeSut();
    const first = await svc.create({ email: 'rotate@brand.com' }, { staffId: 'staff-1' }, ctx);
    const oldHash = fixt.invitations[0]!.token;

    const resent = await svc.resend(fixt.invitations[0]!.id, { staffId: 'staff-2' }, ctx);
    const newHash = fixt.invitations[0]!.token;
    expect(newHash).not.toBe(oldHash);
    expect(newHash).toBe(hashes.sha256Hex(resent.token));
    expect(resent.token).not.toBe(first.token);

    const resendAudit = fixt.auditCalls.find(
      (c) => c.data['action'] === 'staff.seller_invitation.resent',
    );
    expect(resendAudit).toBeDefined();
  });

  it('resend: refuses to resend a used invitation', async () => {
    const { svc, fixt } = makeSut();
    await svc.create({ email: 'used@brand.com' }, { staffId: 'staff-1' }, ctx);
    fixt.invitations[0]!.usedAt = new Date();
    fixt.invitations[0]!.sellerId = 'seller-x';
    await expect(svc.resend(fixt.invitations[0]!.id, { staffId: 'staff-1' }, ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('softDelete: marks deletedAt + audits; refuses for missing or used invitations', async () => {
    const { svc, fixt } = makeSut();
    await svc.create({ email: 'del@brand.com' }, { staffId: 'staff-1' }, ctx);

    await svc.softDelete(fixt.invitations[0]!.id, { staffId: 'staff-1' }, ctx);
    expect(fixt.invitations[0]!.deletedAt).toBeInstanceOf(Date);

    await expect(
      svc.softDelete(fixt.invitations[0]!.id, { staffId: 'staff-1' }, ctx),
    ).rejects.toThrow(NotFoundException);

    // Used invitation cannot be deleted.
    await svc.create({ email: 'used2@brand.com' }, { staffId: 'staff-1' }, ctx);
    const usedInv = fixt.invitations.at(-1)!;
    usedInv.usedAt = new Date();
    usedInv.sellerId = 'seller-y';
    await expect(svc.softDelete(usedInv.id, { staffId: 'staff-1' }, ctx)).rejects.toThrow(
      BadRequestException,
    );
  });
});
