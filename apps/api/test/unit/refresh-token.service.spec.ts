import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from '../../src/modules/auth-common/services/refresh-token.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// ---------------------------------------------------------------------------
// In-memory fake of just enough Prisma surface area to exercise refresh-token
// rotation + reuse detection. Hand-rolled rather than mocked per call so the
// invariants we care about (revokedAt set on rotate, every active row revoked
// on reuse) are visible as observable state in the fake.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

class FakeTable {
  rows: FakeRow[] = [];
  private seq = 0;
  constructor(private readonly userField: 'staffUserId' | 'sellerUserId') {}

  async create({
    data,
    select: _select,
  }: {
    data: Record<string, unknown>;
    select?: Record<string, true>;
  }): Promise<{ id: string }> {
    this.seq += 1;
    const row: FakeRow = {
      id: `row-${this.seq}`,
      userId: data[this.userField] as string,
      tokenHash: data['tokenHash'] as string,
      expiresAt: data['expiresAt'] as Date,
      revokedAt: null,
    };
    this.rows.push(row);
    return { id: row.id };
  }

  async findFirst({
    where,
    select: _select,
  }: {
    where: { tokenHash: string };
    select?: Record<string, true>;
  }): Promise<Record<string, unknown> | null> {
    const row = this.rows.find((r) => r.tokenHash === where.tokenHash);
    if (!row) return null;
    return {
      id: row.id,
      [this.userField]: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async update({
    where,
    data,
  }: {
    where: { id: string };
    data: { revokedAt: Date };
  }): Promise<FakeRow> {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error(`fake table: no row ${where.id}`);
    row.revokedAt = data.revokedAt;
    return row;
  }

  async updateMany({
    where,
    data,
  }: {
    where: Record<string, unknown>;
    data: { revokedAt: Date };
  }): Promise<{ count: number }> {
    let count = 0;
    for (const r of this.rows) {
      let match = true;
      for (const k of Object.keys(where)) {
        const expected = where[k];
        const actual = (r as unknown as Record<string, unknown>)[k === this.userField ? 'userId' : k];
        if (k === 'revokedAt' && expected === null && r.revokedAt !== null) match = false;
        else if (k !== 'revokedAt' && expected !== actual) match = false;
      }
      if (match) {
        r.revokedAt = data.revokedAt;
        count += 1;
      }
    }
    return { count };
  }
}

interface FakeClient {
  staffRefreshToken: FakeTable;
  sellerRefreshToken: FakeTable;
  auditLog: { create: jest.Mock };
  $transaction: <T>(cb: (tx: FakeClient) => Promise<T>) => Promise<T>;
}

/**
 * Snapshots table state at $transaction entry and restores it if the callback
 * throws. This is a deliberately minimal simulation of the rollback semantics
 * that matter for refresh-token tests: a throw from inside the tx must
 * NOT leave any of the writes the callback performed. The reuse-detection
 * test relies on this so we can prove the burn-down commits separately.
 */
function buildFakeClient(): FakeClient {
  const client: FakeClient = {
    staffRefreshToken: new FakeTable('staffUserId'),
    sellerRefreshToken: new FakeTable('sellerUserId'),
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-row' }) },
    $transaction: async (cb) => {
      const snapshot = {
        staff: client.staffRefreshToken.rows.map((r) => ({ ...r })),
        seller: client.sellerRefreshToken.rows.map((r) => ({ ...r })),
        auditCallCount: client.auditLog.create.mock.calls.length,
      };
      try {
        return await cb(client);
      } catch (err) {
        client.staffRefreshToken.rows = snapshot.staff;
        client.sellerRefreshToken.rows = snapshot.seller;
        // Trim audit calls back to the snapshot.
        const drop = client.auditLog.create.mock.calls.length - snapshot.auditCallCount;
        for (let i = 0; i < drop; i++) client.auditLog.create.mock.calls.pop();
        throw err;
      }
    },
  };
  return client;
}

function makeSut(): {
  svc: RefreshTokenService;
  hashes: TokenHashService;
  audit: AuditLogService;
  client: FakeClient;
} {
  const client = buildFakeClient();
  const prisma = { client } as unknown as PrismaService;
  const hashes = new TokenHashService();
  const audit = new AuditLogService(prisma);
  const svc = new RefreshTokenService(prisma, hashes, audit);
  return { svc, hashes, audit, client };
}

describe('RefreshTokenService', () => {
  it('issue: returns a 32+ char url-safe plaintext and persists its hash', async () => {
    const { svc, hashes, client } = makeSut();
    const issued = await svc.issue({ subject: 'staff', userId: 'u1', ipAddress: '1.2.3.4' });

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issued.tokenHash).toBe(hashes.sha256Hex(issued.token));
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(client.staffRefreshToken.rows).toHaveLength(1);
    expect(client.staffRefreshToken.rows[0]?.tokenHash).toBe(issued.tokenHash);
  });

  it('rotate: happy path — revokes old, mints new, writes rotated audit', async () => {
    const { svc, client } = makeSut();
    const first = await svc.issue({ subject: 'staff', userId: 'u1' });

    const { issued, userId } = await svc.rotate({
      subject: 'staff',
      presentedToken: first.token,
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(userId).toBe('u1');
    expect(issued.token).not.toEqual(first.token);
    expect(issued.tokenHash).not.toEqual(first.tokenHash);

    // Old row is revoked; new row is active.
    const rows = client.staffRefreshToken.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(rows[1]?.revokedAt).toBeNull();

    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = client.auditLog.create.mock.calls[0]?.[0];
    expect(auditArgs.data.action).toBe('staff.refresh.rotated');
    expect(auditArgs.data.entityType).toBe('refresh_token');
    expect(auditArgs.data.entityId).toBe(rows[0]?.id);
  });

  it('rotate: rejects an unknown token', async () => {
    const { svc } = makeSut();
    await expect(
      svc.rotate({ subject: 'staff', presentedToken: 'not-issued' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rotate: rejects an expired token without raising the reuse alarm', async () => {
    const { svc, client } = makeSut();
    const first = await svc.issue({ subject: 'staff', userId: 'u1' });
    // Force it past its expiry.
    client.staffRefreshToken.rows[0]!.expiresAt = new Date(Date.now() - 1000);

    await expect(svc.rotate({ subject: 'staff', presentedToken: first.token })).rejects.toThrow(
      UnauthorizedException,
    );

    // No replay audit row should have been written.
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('rotate: REUSE DETECTED — replaying a revoked token burns the family + writes HIGH audit', async () => {
    const { svc, client } = makeSut();
    // User has two active sessions (two devices).
    const sessionA = await svc.issue({ subject: 'staff', userId: 'u1' });
    const sessionB = await svc.issue({ subject: 'staff', userId: 'u1' });

    // First normal rotation on session A — revokes A1 plaintext, mints A2.
    const rotated = await svc.rotate({
      subject: 'staff',
      presentedToken: sessionA.token,
    });
    expect(rotated.userId).toBe('u1');
    client.auditLog.create.mockClear();

    // Attacker (or buggy client) replays the original A1 plaintext.
    await expect(
      svc.rotate({
        subject: 'staff',
        presentedToken: sessionA.token,
        ipAddress: '9.9.9.9',
        userAgent: 'attacker',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // Every active refresh token for u1 must now be revoked — including
    // session B that had nothing to do with the replay.
    const activeForU1 = client.staffRefreshToken.rows.filter(
      (r) => r.userId === 'u1' && r.revokedAt === null,
    );
    expect(activeForU1).toHaveLength(0);
    // sessionB was an unrelated active session — must be revoked too.
    const sessionBRow = client.staffRefreshToken.rows.find(
      (r) => r.tokenHash === sessionB.tokenHash,
    );
    expect(sessionBRow?.revokedAt).toBeInstanceOf(Date);

    // Audit row written with severity HIGH.
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    const auditCall = client.auditLog.create.mock.calls[0]?.[0];
    expect(auditCall.data.action).toBe('security.refresh_replay_detected');
    expect(auditCall.data.entityType).toBe('refresh_token');
    expect(auditCall.data.metadata).toMatchObject({
      severity: 'HIGH',
      subject: 'staff',
      ipAddress: '9.9.9.9',
      userAgent: 'attacker',
    });
  });

  it('rotate: seller subject is supported in parallel with staff', async () => {
    const { svc, client } = makeSut();
    const issued = await svc.issue({ subject: 'seller', userId: 'seller-1' });
    const { userId } = await svc.rotate({
      subject: 'seller',
      presentedToken: issued.token,
    });
    expect(userId).toBe('seller-1');
    expect(client.sellerRefreshToken.rows).toHaveLength(2);
  });

  it('revokeAllForUser: revokes every active token for the user only', async () => {
    const { svc, client } = makeSut();
    await svc.issue({ subject: 'staff', userId: 'u1' });
    await svc.issue({ subject: 'staff', userId: 'u1' });
    await svc.issue({ subject: 'staff', userId: 'other' });

    const count = await svc.revokeAllForUser({ subject: 'staff', userId: 'u1' });
    expect(count).toBe(2);

    const rows = client.staffRefreshToken.rows;
    expect(rows.filter((r) => r.userId === 'u1').every((r) => r.revokedAt !== null)).toBe(true);
    expect(rows.find((r) => r.userId === 'other')?.revokedAt).toBeNull();
  });

  it('revokeByPlaintext: revokes the matching row only', async () => {
    const { svc, client } = makeSut();
    const a = await svc.issue({ subject: 'seller', userId: 'u1' });
    const b = await svc.issue({ subject: 'seller', userId: 'u1' });

    const revoked = await svc.revokeByPlaintext('seller', a.token);
    expect(revoked).toBe(true);

    const aRow = client.sellerRefreshToken.rows.find((r) => r.tokenHash === a.tokenHash);
    const bRow = client.sellerRefreshToken.rows.find((r) => r.tokenHash === b.tokenHash);
    expect(aRow?.revokedAt).toBeInstanceOf(Date);
    expect(bRow?.revokedAt).toBeNull();

    // A second revoke on the same plaintext is a no-op.
    expect(await svc.revokeByPlaintext('seller', a.token)).toBe(false);
  });
});
