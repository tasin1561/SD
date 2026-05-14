import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { ActorType, Prisma } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface CapturedCreate {
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

function makeSut(opts: { throwOnCreate?: boolean } = {}): {
  svc: AuditLogService;
  captured: CapturedCreate[];
} {
  const captured: CapturedCreate[] = [];
  const client = {
    auditLog: {
      create: jest.fn(async (args: CapturedCreate) => {
        if (opts.throwOnCreate) throw new Error('boom');
        captured.push(args);
        return { id: `audit-${captured.length}` };
      }),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  return { svc: new AuditLogService(prisma), captured };
}

describe('AuditLogService', () => {
  it('writes a row with the given action/entity and returns the new id', async () => {
    const { svc, captured } = makeSut();
    const id = await svc.log({
      actorType: ActorType.STAFF,
      staffUserId: 'staff-1',
      action: 'staff.login.success',
      entityType: 'staff_user',
      entityId: 'staff-1',
      metadata: { ipAddress: '1.2.3.4' },
    });

    expect(id).toBe('audit-1');
    expect(captured).toHaveLength(1);
    const data = captured[0]!.data;
    expect(data['actorType']).toBe(ActorType.STAFF);
    expect(data['staffUserId']).toBe('staff-1');
    expect(data['action']).toBe('staff.login.success');
    expect(data['entityType']).toBe('staff_user');
    expect(data['entityId']).toBe('staff-1');
    expect(data['metadata']).toEqual({ ipAddress: '1.2.3.4' });
  });

  it('handles unknown-email login failure: entityId null + email in metadata', async () => {
    const { svc, captured } = makeSut();
    await svc.log({
      actorType: ActorType.SYSTEM,
      action: 'staff.login.failure',
      entityType: 'staff_user',
      entityId: null,
      metadata: { attemptedEmail: 'ghost@example.com', reason: 'user_not_found' },
    });

    const data = captured[0]!.data;
    expect(data['entityId']).toBeNull();
    expect(data['metadata']).toMatchObject({
      attemptedEmail: 'ghost@example.com',
      reason: 'user_not_found',
    });
  });

  it('places severity into metadata when set', async () => {
    const { svc, captured } = makeSut();
    await svc.log({
      actorType: ActorType.SELLER,
      sellerId: 'seller-1',
      action: 'security.refresh_replay_detected',
      entityType: 'refresh_token',
      entityId: 'rt-abc',
      severity: 'HIGH',
      metadata: { subject: 'seller' },
    });

    const data = captured[0]!.data;
    expect(data['metadata']).toMatchObject({ severity: 'HIGH', subject: 'seller' });
  });

  it('does not throw when the underlying insert fails — returns null', async () => {
    const { svc } = makeSut({ throwOnCreate: true });
    const id = await svc.log({
      actorType: ActorType.SYSTEM,
      action: 'staff.login.failure',
      entityType: 'staff_user',
    });
    expect(id).toBeNull();
  });

  it('writes Prisma.DbNull for omitted changes/metadata so they end up as SQL NULL', async () => {
    const { svc, captured } = makeSut();
    await svc.log({
      actorType: ActorType.SYSTEM,
      action: 'system.bootstrap',
      entityType: 'system',
    });
    const data = captured[0]!.data;
    expect(data['changes']).toBe(Prisma.DbNull);
    expect(data['metadata']).toBe(Prisma.DbNull);
  });
});
