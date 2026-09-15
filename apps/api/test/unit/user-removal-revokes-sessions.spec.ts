import { SellerUserRole } from '@skydrop/db';
import { SellerTeamService } from '../../src/modules/seller-team/services/seller-team.service';
import { StaffInvitationService } from '../../src/modules/staff-invitation/services/staff-invitation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';
import type { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import type { PasswordService } from '../../src/modules/auth-common/services/password.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';

/**
 * Removing a person ends their sessions in the same transaction as the
 * removal (2026-09-15). Before this, staff and seller-team removal marked
 * the user deleted and left their refresh sessions open until they expired —
 * found on production as two removed test accounts each holding one live
 * session. Store-team removal already did this; these pin the other two.
 */
const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };

interface Harness {
  prisma: PrismaService;
  tx: {
    sellerUser: { updateMany: jest.Mock };
    sellerRefreshToken: { updateMany: jest.Mock };
    staffUser: { updateMany: jest.Mock };
    staffRefreshToken: { updateMany: jest.Mock };
  };
  audit: { log: jest.Mock };
}

function harness(opts: { alreadyRemovedMeanwhile?: boolean } = {}): Harness {
  const count = opts.alreadyRemovedMeanwhile ? 0 : 1;
  const tx = {
    sellerUser: { updateMany: jest.fn().mockResolvedValue({ count }) },
    sellerRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    staffUser: { updateMany: jest.fn().mockResolvedValue({ count }) },
    staffRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    sellerUser: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'member-1',
        role: SellerUserRole.VIEWER,
        deletedAt: null,
      }),
      count: jest.fn().mockResolvedValue(1),
    },
    staffUser: {
      findUnique: jest.fn().mockResolvedValue({ id: 'staff-2', deletedAt: null }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    prisma: { client } as unknown as PrismaService,
    tx,
    audit: { log: jest.fn().mockResolvedValue(undefined) },
  };
}

function sellerTeam(h: Harness): SellerTeamService {
  return new SellerTeamService(
    h.prisma,
    {} as EnvService,
    {} as TokenHashService,
    {} as PasswordService,
    h.audit as unknown as AuditLogService,
    {} as EmailQueue,
  );
}

function staffInvitations(h: Harness): StaffInvitationService {
  return new StaffInvitationService(
    h.prisma,
    {} as EnvService,
    {} as TokenHashService,
    {} as PasswordService,
    h.audit as unknown as AuditLogService,
    {} as EmailQueue,
  );
}

describe('removing a person ends their sessions', () => {
  it('seller team: the removal and the session revoke happen in one transaction', async () => {
    const h = harness();
    await sellerTeam(h).deactivate('seller-1', 'member-1', { sellerUserId: 'owner-1' }, ctx);

    expect(h.tx.sellerUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'member-1', sellerId: 'seller-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(h.tx.sellerRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { sellerUserId: 'member-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seller.team_member.deactivated' }),
    );
  });

  it('staff: the removal and the session revoke happen in one transaction', async () => {
    const h = harness();
    await staffInvitations(h).deactivate('staff-2', { staffId: 'admin-1' }, ctx);

    expect(h.tx.staffUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'staff-2', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(h.tx.staffRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { staffUserId: 'staff-2', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'staff.staff_user.deactivated' }),
    );
  });

  it('a removal that lost a race to another removes nothing twice and audits once', async () => {
    const h = harness({ alreadyRemovedMeanwhile: true });
    await sellerTeam(h).deactivate('seller-1', 'member-1', { sellerUserId: 'owner-1' }, ctx);
    await staffInvitations(h).deactivate('staff-2', { staffId: 'admin-1' }, ctx);

    expect(h.tx.sellerRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(h.tx.staffRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });
});
