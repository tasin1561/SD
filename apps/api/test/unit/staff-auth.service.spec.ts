import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ActorType, NotificationRecipientType } from '@skydrop/db';
import { StaffAuthService } from '../../src/modules/staff-auth/staff-auth.service';
import { PasswordService } from '../../src/modules/auth-common/services/password.service';
import { JwtService } from '../../src/modules/auth-common/services/jwt.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { RefreshTokenService } from '../../src/modules/auth-common/services/refresh-token.service';
import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// ---------------------------------------------------------------------------
// In-memory Prisma fake — just enough surface for staff-auth's tables.
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string;
  email: string;
  emailDisplay: string;
  passwordHash: string;
  role: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface PrtRow {
  id: string;
  staffUserId: string;
  tokenHash: string;
  ipAddress: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface EvtRow {
  id: string;
  staffUserId: string;
  tokenHash: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface RtRow {
  id: string;
  staffUserId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

class FakeStaffUserTable {
  rows: StaffRow[] = [];

  async findFirst({
    where,
    select: _s,
  }: {
    where: Partial<StaffRow> & { deletedAt?: Date | null };
    select?: unknown;
  }): Promise<StaffRow | null> {
    return (
      this.rows.find((r) => {
        for (const k of Object.keys(where) as (keyof StaffRow)[]) {
          if (k === 'deletedAt') {
            const want = where['deletedAt'];
            if (want === null && r.deletedAt !== null) return false;
            if (want !== null && want !== undefined && r.deletedAt === null) return false;
            continue;
          }
          if (where[k] !== undefined && r[k] !== where[k]) return false;
        }
        return true;
      }) ?? null
    );
  }

  async update({
    where,
    data,
  }: {
    where: { id: string };
    data: Partial<StaffRow>;
  }): Promise<StaffRow> {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error(`staffUser not found: ${where.id}`);
    Object.assign(row, data);
    return row;
  }
}

class FakePrtTable {
  rows: PrtRow[] = [];
  private seq = 0;
  constructor(private readonly staffTable: FakeStaffUserTable) {}

  async create({
    data,
  }: {
    data: Omit<PrtRow, 'id' | 'createdAt' | 'usedAt'> & { ipAddress: string | null };
  }) {
    this.seq += 1;
    const row: PrtRow = {
      ...data,
      id: `prt-${this.seq}`,
      usedAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findFirst({
    where,
    select,
  }: {
    where: { tokenHash: string };
    select?: Record<string, unknown>;
  }): Promise<unknown> {
    const row = this.rows.find((r) => r.tokenHash === where.tokenHash);
    if (!row) return null;
    const hasStaffUserSelect = select && typeof select === 'object' && 'staffUser' in select;
    if (!hasStaffUserSelect) return row;
    const staff = this.staffTable.rows.find((s) => s.id === row.staffUserId);
    return {
      ...row,
      staffUser: staff ? { id: staff.id, deletedAt: staff.deletedAt } : null,
    };
  }

  async update({ where, data }: { where: { id: string }; data: Partial<PrtRow> }): Promise<PrtRow> {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error(`prt not found: ${where.id}`);
    Object.assign(row, data);
    return row;
  }
}

class FakeEvtTable {
  rows: EvtRow[] = [];
  private seq = 0;
  constructor(private readonly staffTable: FakeStaffUserTable) {}

  async create({ data }: { data: Omit<EvtRow, 'id' | 'createdAt' | 'usedAt'> }) {
    this.seq += 1;
    const row: EvtRow = { ...data, id: `evt-${this.seq}`, usedAt: null, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async findFirst({
    where,
    select,
  }: {
    where: { tokenHash: string };
    select?: Record<string, unknown>;
  }): Promise<unknown> {
    const row = this.rows.find((r) => r.tokenHash === where.tokenHash);
    if (!row) return null;
    const hasStaffUserSelect = select && typeof select === 'object' && 'staffUser' in select;
    if (!hasStaffUserSelect) return row;
    const staff = this.staffTable.rows.find((s) => s.id === row.staffUserId);
    return {
      ...row,
      staffUser: staff ? { id: staff.id, email: staff.email, deletedAt: staff.deletedAt } : null,
    };
  }
  async update({ where, data }: { where: { id: string }; data: Partial<EvtRow> }) {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error('evt not found');
    Object.assign(row, data);
    return row;
  }
}

class FakeRtTable {
  rows: RtRow[] = [];
  private seq = 0;
  async create({ data }: { data: Omit<RtRow, 'id' | 'createdAt' | 'revokedAt'> }) {
    this.seq += 1;
    const row: RtRow = { ...data, id: `rt-${this.seq}`, revokedAt: null, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async findFirst({ where }: { where: { tokenHash: string }; select?: unknown }): Promise<unknown> {
    const row = this.rows.find((r) => r.tokenHash === where.tokenHash);
    if (!row) return null;
    return {
      id: row.id,
      staffUserId: row.staffUserId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }
  async update({ where, data }: { where: { id: string }; data: Partial<RtRow> }) {
    const row = this.rows.find((r) => r.id === where.id);
    if (!row) throw new Error('rt not found');
    Object.assign(row, data);
    return row;
  }
  async updateMany({
    where,
    data,
  }: {
    where: { staffUserId: string; revokedAt: null };
    data: { revokedAt: Date };
  }) {
    let count = 0;
    for (const r of this.rows) {
      if (r.staffUserId === where.staffUserId && r.revokedAt === null) {
        r.revokedAt = data.revokedAt;
        count += 1;
      }
    }
    return { count };
  }
}

interface FakeClient {
  staffUser: FakeStaffUserTable;
  staffPasswordResetToken: FakePrtTable;
  staffEmailVerificationToken: FakeEvtTable;
  staffRefreshToken: FakeRtTable;
  sellerRefreshToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $transaction: <T>(cb: (tx: FakeClient) => Promise<T>) => Promise<T>;
}

function buildClient(): FakeClient {
  const staffUser = new FakeStaffUserTable();
  const client: FakeClient = {
    staffUser,
    staffPasswordResetToken: new FakePrtTable(staffUser),
    staffEmailVerificationToken: new FakeEvtTable(staffUser),
    staffRefreshToken: new FakeRtTable(),
    sellerRefreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-x' }) },
    $transaction: async (cb) => cb(client),
  };
  return client;
}

function makeEnv(): EnvService {
  return makeTestEnv();
}

interface Sut {
  svc: StaffAuthService;
  client: FakeClient;
  enqueueMock: jest.Mock;
  password: PasswordService;
  hashes: TokenHashService;
}

function makeSut(): Sut {
  const client = buildClient();
  const prisma = { client } as unknown as PrismaService;
  const env = makeEnv();
  const password = new PasswordService();
  const hashes = new TokenHashService();
  const jwt = new JwtService(env);
  const audit = new AuditLogService(prisma);
  const refresh = new RefreshTokenService(prisma, hashes, audit);
  const enqueueMock = jest.fn().mockResolvedValue('job-1');
  const email = { enqueue: enqueueMock } as unknown as EmailQueue;
  const svc = new StaffAuthService(prisma, env, password, jwt, hashes, refresh, audit, email);
  return { svc, client, enqueueMock, password, hashes };
}

async function seedStaff(
  { password, client }: Sut,
  overrides: Partial<StaffRow> = {},
): Promise<StaffRow> {
  const hash = await password.hash('CorrectHorseBattery!12');
  const row: StaffRow = {
    id: 'staff-1',
    email: 'admin@skydrop.online',
    emailDisplay: 'Admin@Skydrop.Online',
    passwordHash: hash,
    role: 'SUPER_ADMIN',
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  client.staffUser.rows.push(row);
  return row;
}

const ctx = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StaffAuthService — login', () => {
  it('unknown email: returns generic INVALID_CREDENTIALS + audit with entityId null', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.login({ email: 'ghost@example.com', password: 'anything' }, ctx),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    expect(sut.client.auditLog.create).toHaveBeenCalledTimes(1);
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.action).toBe('staff.login.failure');
    expect(data.actorType).toBe(ActorType.SYSTEM);
    expect(data.staffUserId).toBeNull();
    expect(data.entityId).toBeNull();
    expect(data.metadata).toMatchObject({
      attemptedEmail: 'ghost@example.com',
      reason: 'user_not_found',
    });
  });

  it('wrong password: returns generic error + audit with reason=wrong_password', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);
    await expect(sut.svc.login({ email: staff.email, password: 'WRONG' }, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.action).toBe('staff.login.failure');
    expect(data.staffUserId).toBe(staff.id);
    expect(data.entityId).toBe(staff.id);
    expect(data.metadata.reason).toBe('wrong_password');
  });

  it('soft-deleted account: returns generic error + audit reason=soft_deleted', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut, { deletedAt: new Date() });
    await expect(
      sut.svc.login({ email: staff.email, password: 'CorrectHorseBattery!12' }, ctx),
    ).rejects.toThrow(UnauthorizedException);
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.metadata.reason).toBe('soft_deleted');
  });

  it('email is normalized (lowercased, trimmed) for the lookup', async () => {
    const sut = makeSut();
    await seedStaff(sut, { email: 'admin@skydrop.online' });
    const result = await sut.svc.login(
      { email: '  ADMIN@Skydrop.online  ', password: 'CorrectHorseBattery!12' },
      ctx,
    );
    expect(result.staff.id).toBe('staff-1');
  });

  it('success: issues access + refresh tokens, bumps lastLoginAt, audits success', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);

    const result = await sut.svc.login(
      { email: staff.email, password: 'CorrectHorseBattery!12' },
      ctx,
    );

    expect(result.accessToken.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(result.accessToken.expiresIn).toBe(300);
    expect(result.refresh.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.staff).toEqual({ id: staff.id, email: staff.email, role: staff.role });

    // lastLoginAt updated
    const stored = sut.client.staffUser.rows[0]!;
    expect(stored.lastLoginAt).toBeInstanceOf(Date);

    // refresh row persisted
    expect(sut.client.staffRefreshToken.rows).toHaveLength(1);
    expect(sut.client.staffRefreshToken.rows[0]!.staffUserId).toBe(staff.id);

    // audit success row
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.action).toBe('staff.login.success');
    expect(data.actorType).toBe(ActorType.STAFF);
    expect(data.staffUserId).toBe(staff.id);
  });
});

describe('StaffAuthService — password reset request', () => {
  it('unknown email: returns generic message, NO email enqueued, audit records truth', async () => {
    const sut = makeSut();
    const result = await sut.svc.requestPasswordReset({ email: 'ghost@example.com' }, ctx);
    expect(result.message).toMatch(/If an account exists/);
    expect(sut.enqueueMock).not.toHaveBeenCalled();
    const audit = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(audit.action).toBe('staff.password_reset.requested');
    expect(audit.entityId).toBeNull();
    expect(audit.metadata.outcome).toBe('unknown_email');
    expect(audit.metadata.attemptedEmail).toBe('ghost@example.com');
  });

  it('known email: creates token, enqueues email with reset_url, audits truth', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);
    const result = await sut.svc.requestPasswordReset({ email: staff.email }, ctx);

    expect(result.message).toMatch(/If an account exists/);
    expect(sut.client.staffPasswordResetToken.rows).toHaveLength(1);

    expect(sut.enqueueMock).toHaveBeenCalledTimes(1);
    const payload = sut.enqueueMock.mock.calls[0]![0];
    expect(payload.templateCode).toBe('staff.password_reset.email');
    expect(payload.recipient).toEqual({
      type: NotificationRecipientType.STAFF,
      id: staff.id,
      email: staff.email,
    });
    expect(payload.variables.reset_url).toMatch(/\/auth\/reset-password\?token=/);

    const audit = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(audit.action).toBe('staff.password_reset.requested');
    expect(audit.entityId).toBe(staff.id);
    expect(audit.metadata.outcome).toBeUndefined();
  });
});

describe('StaffAuthService — password reset confirm', () => {
  async function seedResetToken(sut: Sut, opts: { ttlMs?: number; used?: boolean } = {}) {
    const staff = await seedStaff(sut);
    const plaintext = sut.hashes.generatePasswordResetToken();
    sut.client.staffPasswordResetToken.rows.push({
      id: 'prt-seeded',
      staffUserId: staff.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      ipAddress: '1.2.3.4',
      expiresAt: new Date(Date.now() + (opts.ttlMs ?? 30 * 60 * 1000)),
      usedAt: opts.used ? new Date() : null,
      createdAt: new Date(),
    });
    return { staff, plaintext };
  }

  it('invalid token → 400 BAD_REQUEST', async () => {
    const sut = makeSut();
    await seedStaff(sut);
    await expect(
      sut.svc.confirmPasswordReset(
        { token: 'wrong-token', newPassword: 'Cstrong-Password!00' },
        ctx,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('expired token → 400 BAD_REQUEST', async () => {
    const sut = makeSut();
    const { plaintext } = await seedResetToken(sut, { ttlMs: -1000 });
    await expect(
      sut.svc.confirmPasswordReset({ token: plaintext, newPassword: 'Cstrong-Password!00' }, ctx),
    ).rejects.toThrow(BadRequestException);
  });

  it('used token → 400 BAD_REQUEST', async () => {
    const sut = makeSut();
    const { plaintext } = await seedResetToken(sut, { used: true });
    await expect(
      sut.svc.confirmPasswordReset({ token: plaintext, newPassword: 'Cstrong-Password!00' }, ctx),
    ).rejects.toThrow(BadRequestException);
  });

  it('happy path: updates password, marks token used, revokes all refresh sessions, audits', async () => {
    const sut = makeSut();
    const { staff, plaintext } = await seedResetToken(sut);

    // Pre-existing active refresh sessions for this staff.
    sut.client.staffRefreshToken.rows.push(
      {
        id: 'rt-a',
        staffUserId: staff.id,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 7 * 86400000),
        revokedAt: null,
        createdAt: new Date(),
      },
      {
        id: 'rt-b',
        staffUserId: staff.id,
        tokenHash: 'h2',
        expiresAt: new Date(Date.now() + 7 * 86400000),
        revokedAt: null,
        createdAt: new Date(),
      },
    );

    const newPw = 'Brand-New-Password!42';
    await sut.svc.confirmPasswordReset({ token: plaintext, newPassword: newPw }, ctx);

    const updated = sut.client.staffUser.rows[0]!;
    expect(await sut.password.verify(updated.passwordHash, newPw)).toBe(true);

    const token = sut.client.staffPasswordResetToken.rows[0]!;
    expect(token.usedAt).toBeInstanceOf(Date);

    // Every refresh session revoked.
    expect(sut.client.staffRefreshToken.rows.every((r) => r.revokedAt !== null)).toBe(true);

    const audit = sut.client.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('staff.password_reset.completed');
  });
});

describe('StaffAuthService — email verification', () => {
  it('request: already-verified staff → 409 CONFLICT', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut, { emailVerifiedAt: new Date() });
    await expect(sut.svc.requestEmailVerification(staff.id, ctx)).rejects.toThrow(
      ConflictException,
    );
  });

  it('request: enqueues the verification email + audits', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);
    await sut.svc.requestEmailVerification(staff.id, ctx);

    expect(sut.client.staffEmailVerificationToken.rows).toHaveLength(1);
    expect(sut.enqueueMock).toHaveBeenCalledTimes(1);
    const payload = sut.enqueueMock.mock.calls[0]![0];
    expect(payload.templateCode).toBe('staff.email_verification.email');
    expect(payload.variables.verify_url).toMatch(/\/auth\/verify-email\?token=/);
  });

  it('confirm: invalid token → 400', async () => {
    const sut = makeSut();
    await expect(sut.svc.confirmEmailVerification({ token: 'nope' }, ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('confirm: token whose stored email no longer matches the staff (email changed since issuance) → 400', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut, { email: 'new@skydrop.online' });
    const plaintext = sut.hashes.generateEmailVerificationToken();
    sut.client.staffEmailVerificationToken.rows.push({
      id: 'evt-1',
      staffUserId: staff.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      email: 'old@skydrop.online', // mismatch
      expiresAt: new Date(Date.now() + 86400000),
      usedAt: null,
      createdAt: new Date(),
    });
    await expect(sut.svc.confirmEmailVerification({ token: plaintext }, ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('confirm: happy path sets emailVerifiedAt, marks token used, audits', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);
    const plaintext = sut.hashes.generateEmailVerificationToken();
    sut.client.staffEmailVerificationToken.rows.push({
      id: 'evt-2',
      staffUserId: staff.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      email: staff.email,
      expiresAt: new Date(Date.now() + 86400000),
      usedAt: null,
      createdAt: new Date(),
    });

    await sut.svc.confirmEmailVerification({ token: plaintext }, ctx);

    expect(sut.client.staffUser.rows[0]!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(sut.client.staffEmailVerificationToken.rows[0]!.usedAt).toBeInstanceOf(Date);
    const audit = sut.client.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('staff.email_verification.completed');
  });
});

describe('StaffAuthService — logout-all', () => {
  it('revokes every active refresh session, returns count, audits', async () => {
    const sut = makeSut();
    const staff = await seedStaff(sut);

    sut.client.staffRefreshToken.rows.push(
      {
        id: 'rt-1',
        staffUserId: staff.id,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      },
      {
        id: 'rt-2',
        staffUserId: staff.id,
        tokenHash: 'h2',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      },
      {
        id: 'rt-3',
        staffUserId: 'other-staff',
        tokenHash: 'h3',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      },
    );

    const result = await sut.svc.logoutAll(staff.id);
    expect(result.revokedCount).toBe(2);
    expect(
      sut.client.staffRefreshToken.rows
        .filter((r) => r.staffUserId === staff.id)
        .every((r) => r.revokedAt !== null),
    ).toBe(true);
    expect(sut.client.staffRefreshToken.rows.find((r) => r.id === 'rt-3')!.revokedAt).toBeNull();

    const audit = sut.client.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('staff.logout_all.success');
    expect(audit.metadata.revokedCount).toBe(2);
  });
});
