import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ActorType, Currency, SellerStatus } from '@skydrop/db';
import type { ImpersonationBannerService } from '../../src/common/impersonation/impersonation-banner';
import { SellerAuthService } from '../../src/modules/seller-auth/seller-auth.service';
import { PasswordService } from '../../src/modules/auth-common/services/password.service';
import { JwtService } from '../../src/modules/auth-common/services/jwt.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { FxRateService } from '../../src/modules/fx/services/fx-rate.service';
import { RefreshTokenService } from '../../src/modules/auth-common/services/refresh-token.service';
import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SellerOnboardingService } from '../../src/modules/seller-onboarding/services/seller-onboarding.service';
import type { SellerNotificationPreferenceService } from '../../src/modules/seller-notification-preference/services/seller-notification-preference.service';

// ---------------------------------------------------------------------------
// In-memory rows + factory-built fake client.
// ---------------------------------------------------------------------------

interface SellerRow {
  id: string;
  email: string;
  emailDisplay: string;
  passwordHash: string;
  companyName: string;
  /** Operations short code, derived at registration. */
  initials?: string | null;
  contactPersonName: string;
  phone: string;
  whatsapp: string | null;
  status: SellerStatus;
  approvedAt: Date | null;
  approvedById: string | null;
  displayCurrency: Currency;
  displayLanguage: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface InvitationRow {
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

interface PrtRow {
  id: string;
  sellerUserId: string;
  tokenHash: string;
  ipAddress: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

interface EvtRow {
  id: string;
  sellerUserId: string;
  tokenHash: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface RtRow {
  id: string;
  sellerId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface SellerUserRow {
  id: string;
  sellerId: string;
  email: string;
  emailDisplay: string;
  fullName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface Tables {
  sellers: SellerRow[];
  invitations: InvitationRow[];
  prts: PrtRow[];
  evts: EvtRow[];
  rts: RtRow[];
  sellerUsers: SellerUserRow[];
}

interface FakeClient {
  tables: Tables;
  seller: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  sellerUser: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  /** And its first SHOPFRONT, which is what lets `orders.store_id` be
   *  NOT NULL — there is never a moment when a seller exists with
   *  nowhere for their orders to belong. */
  sellerStore: {
    create: jest.Mock;
  };
  /** Registration provisions the company's six starting roles in the
   *  same tx: a seller user with no role row cannot sign in at all. */
  sellerRoleDefinition: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  sellerInvitation: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  sellerPasswordResetToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  sellerEmailVerificationToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  sellerRefreshToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  staffRefreshToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $transaction: <T>(cb: (tx: FakeClient) => Promise<T>) => Promise<T>;
}

function buildClient(): FakeClient {
  const tables: Tables = {
    sellers: [],
    invitations: [],
    prts: [],
    evts: [],
    rts: [],
    sellerUsers: [],
  };
  let prtSeq = 0;
  let evtSeq = 0;
  let rtSeq = 0;
  let sellerSeq = 0;
  let sellerUserSeq = 0;

  const client: FakeClient = {
    tables,
    seller: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          tables.sellers.find((r) => {
            for (const [k, want] of Object.entries(where)) {
              if (k === 'deletedAt') {
                if (want === null && r.deletedAt !== null) return false;
                if (want !== null && want !== undefined && r.deletedAt === null) return false;
                continue;
              }
              if (want !== undefined && (r as unknown as Record<string, unknown>)[k] !== want)
                return false;
            }
            return true;
          }) ?? null
        );
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          tables.sellers.find((r) => (where.email ? r.email === where.email : r.id === where.id)) ??
          null,
      ),
      // Registration derives the seller's short code and checks it is
      // free inside the same tx; the real guard is the unique index.
      count: jest.fn(
        async ({ where }: { where: { initials?: string } }) =>
          tables.sellers.filter((r) => r.initials === where.initials).length,
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Partial<SellerRow> & {
            email: string;
            emailDisplay: string;
            passwordHash: string;
            companyName: string;
            contactPersonName: string;
            phone: string;
            status: SellerStatus;
            displayCurrency: Currency;
            displayLanguage: string;
          };
        }) => {
          sellerSeq += 1;
          const row: SellerRow = {
            id: `seller-${sellerSeq}`,
            email: data.email,
            emailDisplay: data.emailDisplay,
            passwordHash: data.passwordHash,
            companyName: data.companyName,
            contactPersonName: data.contactPersonName,
            phone: data.phone,
            whatsapp: data.whatsapp ?? null,
            status: data.status,
            approvedAt: data.approvedAt ?? null,
            approvedById: data.approvedById ?? null,
            displayCurrency: data.displayCurrency,
            displayLanguage: data.displayLanguage,
            countryCode: data.countryCode ?? 'BD',
            emailVerifiedAt: data.emailVerifiedAt ?? null,
            lastLoginAt: data.lastLoginAt ?? null,
            createdAt: new Date(),
            deletedAt: null,
          };
          tables.sellers.push(row);
          return { id: row.id, email: row.email, status: row.status };
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<SellerRow> }) => {
          const row = tables.sellers.find((r) => r.id === where.id);
          if (!row) throw new Error('seller not found');
          Object.assign(row, data);
          return row;
        },
      ),
    },
    sellerStore: {
      create: jest.fn(async () => ({ id: 'store-default' })),
    },
    sellerRoleDefinition: {
      create: jest.fn(async ({ data }: { data: { key: string; isOwner?: boolean } }) => ({
        id: `role-${data.key}`,
      })),
      findFirst: jest.fn(async ({ where }: { where: { key?: string } }) => ({
        id: `role-${where.key ?? 'owner'}`,
      })),
    },
    sellerUser: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = tables.sellerUsers.find((r) => {
          if (where['email'] !== undefined && r.email !== where['email']) return false;
          if (where['id'] !== undefined && r.id !== where['id']) return false;
          if (where['deletedAt'] === null && r.deletedAt !== null) return false;
          return true;
        });
        if (!row) return null;
        const seller = tables.sellers.find((s) => s.id === row.sellerId);
        return {
          id: row.id,
          email: row.email,
          passwordHash: row.passwordHash,
          deletedAt: row.deletedAt,
          seller: seller
            ? { id: seller.id, status: seller.status, deletedAt: seller.deletedAt }
            : null,
        };
      }),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Partial<SellerUserRow> & {
            sellerId: string;
            email: string;
            emailDisplay: string;
            fullName: string;
            passwordHash: string;
          };
        }) => {
          sellerUserSeq += 1;
          const row: SellerUserRow = {
            id: `seller-user-${sellerUserSeq}`,
            sellerId: data.sellerId,
            email: data.email,
            emailDisplay: data.emailDisplay,
            fullName: data.fullName,
            passwordHash: data.passwordHash,
            emailVerifiedAt: data.emailVerifiedAt ?? null,
            lastLoginAt: data.lastLoginAt ?? null,
            createdAt: new Date(),
            deletedAt: null,
          };
          tables.sellerUsers.push(row);
          return { id: row.id };
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<SellerUserRow> }) => {
          const row = tables.sellerUsers.find((r) => r.id === where.id);
          if (!row) throw new Error('seller user not found');
          Object.assign(row, data);
          return row;
        },
      ),
    },
    sellerInvitation: {
      findUnique: jest.fn(
        async ({ where }: { where: { token?: string; id?: string } }) =>
          tables.invitations.find((r) =>
            where.token ? r.token === where.token : r.id === where.id,
          ) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          tables.invitations.find((r) => {
            const emailFilter = where['email'] as
              | undefined
              | { equals: string; mode: 'insensitive' };
            if (emailFilter && r.email.toLowerCase() !== emailFilter.equals.toLowerCase())
              return false;
            if (where['usedAt'] === null && r.usedAt !== null) return false;
            if (where['deletedAt'] === null && r.deletedAt !== null) return false;
            const exp = where['expiresAt'] as undefined | { gt: Date };
            if (exp && r.expiresAt.getTime() <= exp.gt.getTime()) return false;
            return true;
          }) ?? null,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<InvitationRow> }) => {
          const row = tables.invitations.find((r) => r.id === where.id);
          if (!row) throw new Error('invitation not found');
          Object.assign(row, data);
          return row;
        },
      ),
    },
    sellerPasswordResetToken: {
      create: jest.fn(async ({ data }: { data: Omit<PrtRow, 'id' | 'usedAt'> }) => {
        prtSeq += 1;
        const row: PrtRow = { ...data, id: `prt-${prtSeq}`, usedAt: null };
        tables.prts.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const row = tables.prts.find((r) => r.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = tables.sellerUsers.find((u) => u.id === row.sellerUserId);
        const seller = user ? tables.sellers.find((s) => s.id === user.sellerId) : undefined;
        return {
          ...row,
          sellerUser: user
            ? {
                id: user.id,
                deletedAt: user.deletedAt,
                seller: seller ? { id: seller.id, deletedAt: seller.deletedAt } : null,
              }
            : null,
        };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<PrtRow> }) => {
        const row = tables.prts.find((r) => r.id === where.id);
        if (!row) throw new Error('prt not found');
        Object.assign(row, data);
        return row;
      }),
      // APPLIES the predicate. A fake that ignored `usedAt: null` would
      // report a claim on an already-spent link as a success, which is
      // the exact bug the guarded consume exists to stop.
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string; usedAt: null }; data: Partial<PrtRow> }) => {
          const row = tables.prts.find((r) => r.id === where.id && r.usedAt === null);
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    sellerEmailVerificationToken: {
      create: jest.fn(async ({ data }: { data: Omit<EvtRow, 'id' | 'usedAt'> }) => {
        evtSeq += 1;
        const row: EvtRow = { ...data, id: `evt-${evtSeq}`, usedAt: null };
        tables.evts.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const row = tables.evts.find((r) => r.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = tables.sellerUsers.find((u) => u.id === row.sellerUserId);
        const seller = user ? tables.sellers.find((s) => s.id === user.sellerId) : undefined;
        return {
          ...row,
          sellerUser: user
            ? {
                id: user.id,
                email: user.email,
                deletedAt: user.deletedAt,
                seller: seller ? { id: seller.id, deletedAt: seller.deletedAt } : null,
              }
            : null,
        };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<EvtRow> }) => {
        const row = tables.evts.find((r) => r.id === where.id);
        if (!row) throw new Error('evt not found');
        Object.assign(row, data);
        return row;
      }),
      /** APPLIES the predicate — see sellerPasswordResetToken.updateMany. */
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string; usedAt: null }; data: Partial<EvtRow> }) => {
          const row = tables.evts.find((r) => r.id === where.id && r.usedAt === null);
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    sellerRefreshToken: {
      create: jest.fn(async ({ data }: { data: Omit<RtRow, 'id' | 'revokedAt'> }) => {
        rtSeq += 1;
        const row: RtRow = { ...data, id: `rt-${rtSeq}`, revokedAt: null };
        tables.rts.push(row);
        return { id: row.id };
      }),
      findFirst: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const row = tables.rts.find((r) => r.tokenHash === where.tokenHash);
        if (!row) return null;
        return {
          id: row.id,
          sellerId: row.sellerId,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
        };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RtRow> }) => {
        const row = tables.rts.find((r) => r.id === where.id);
        if (!row) throw new Error('rt not found');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; sellerId?: string; tokenHash?: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          let count = 0;
          for (const r of tables.rts) {
            // `id` matters: the rotation claim revokes ONE row by id, and a
            // fake that ignored it would revoke the whole family and call
            // that a success.
            if (where.id && r.id !== where.id) continue;
            if (where.sellerId && r.sellerId !== where.sellerId) continue;
            if (where.tokenHash && r.tokenHash !== where.tokenHash) continue;
            if (r.revokedAt !== null) continue;
            r.revokedAt = data.revokedAt;
            count += 1;
          }
          return { count };
        },
      ),
    },
    staffRefreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-x' }) },
    $transaction: async <T>(cb: (tx: FakeClient) => Promise<T>) => cb(client),
  };
  return client;
}

function makeEnv(): EnvService {
  return makeTestEnv();
}

interface Sut {
  svc: SellerAuthService;
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
  const onboarding = {
    initializeProgress: jest.fn().mockResolvedValue(undefined),
    markStepComplete: jest.fn().mockResolvedValue({ marked: true, onboardingCompleted: false }),
  } as unknown as SellerOnboardingService;
  const notificationPreferences = {
    seedDefaults: jest.fn().mockResolvedValue(undefined),
  } as unknown as SellerNotificationPreferenceService;
  const svc = new SellerAuthService(
    prisma,
    env,
    password,
    jwt,
    hashes,
    refresh,
    audit,
    email,
    onboarding,
    notificationPreferences,
    // Nobody is impersonating a unit test. Null is the answer on every
    // ordinary request, which is what this models.
    {
      current: jest.fn().mockResolvedValue(null),
    } as unknown as ImpersonationBannerService,
    // Sign-in must not depend on the FX table having a row: a rate that
    // cannot be resolved is a display inconvenience, never a reason a
    // seller cannot reach their account. Throwing here proves it.
    {
      getRate: jest.fn().mockRejectedValue(new Error('FX_RATE_NOT_FOUND')),
    } as unknown as FxRateService,
  );
  return { svc, client, enqueueMock, password, hashes };
}

async function seedSeller(
  { password, client }: Sut,
  overrides: Partial<SellerRow> = {},
): Promise<SellerRow> {
  const hash = await password.hash('Seller-Secret-123');
  const row: SellerRow = {
    id: 'seller-seed',
    email: 'seller@brand.com',
    emailDisplay: 'Seller@Brand.com',
    passwordHash: hash,
    companyName: 'Brand Co',
    contactPersonName: 'Sara K',
    phone: '+8801712345678',
    whatsapp: null,
    status: SellerStatus.APPROVED,
    approvedAt: new Date(),
    approvedById: 'staff-1',
    displayCurrency: Currency.INR,
    displayLanguage: 'en',
    countryCode: 'BD',
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  client.tables.sellers.push(row);
  // Phase 1B RBAC: every active seller has at least one OWNER SellerUser.
  // The legacy sellers.email/passwordHash are kept on the parent row for
  // back-compat, but auth + RBAC are driven by SellerUser.
  client.tables.sellerUsers.push({
    id: `${row.id}-owner`,
    sellerId: row.id,
    email: row.email,
    emailDisplay: row.emailDisplay,
    fullName: row.contactPersonName,
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    deletedAt: null,
  });
  return row;
}

const ctx = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SellerAuthService — login', () => {
  it('unknown email → INVALID_CREDENTIALS + audit entityId null', async () => {
    const sut = makeSut();
    await expect(
      sut.svc.login({ email: 'ghost@example.com', password: 'pw' }, ctx),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.action).toBe('seller.login.failure');
    expect(data.entityId).toBeNull();
    expect(data.metadata.reason).toBe('user_not_found');
  });

  it('a refusal without a real hash STILL pays the argon2 cost (no exists-oracle by timing)', async () => {
    // Generic MESSAGE, generic TIMING. An unknown email returned before
    // argon2 ran, so the refusal came back ~50 ms sooner than a real
    // account with a wrong password — measurable over HTTP. Asserted as a
    // call rather than a stopwatch: a wall-clock assertion on argon2 is
    // exactly the test that goes flaky on a loaded CI runner.
    const sut = makeSut();
    const spy = jest.spyOn(sut.password, 'verifyDummy');

    await expect(
      sut.svc.login({ email: 'ghost@example.com', password: 'pw' }, ctx),
    ).rejects.toThrow(UnauthorizedException);
    expect(spy).toHaveBeenCalledTimes(1);

    // The soft-deleted branch too — that address DOES exist.
    const seller = await seedSeller(sut, { deletedAt: new Date() });
    await expect(
      sut.svc.login({ email: seller.email, password: 'Seller-Secret-123' }, ctx),
    ).rejects.toThrow(UnauthorizedException);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('wrong password → generic + audit reason=wrong_password', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut);
    await expect(sut.svc.login({ email: seller.email, password: 'BAD' }, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.metadata.reason).toBe('wrong_password');
  });

  it.each([SellerStatus.PENDING, SellerStatus.REJECTED])(
    'status=%s → 403 ACCOUNT_NOT_ACTIVE + audit reason=status_not_active',
    async (status) => {
      const sut = makeSut();
      const seller = await seedSeller(sut, { status });
      await expect(
        sut.svc.login({ email: seller.email, password: 'Seller-Secret-123' }, ctx),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_NOT_ACTIVE' } });
      const data = sut.client.auditLog.create.mock.calls[0]![0].data;
      expect(data.metadata.reason).toBe('status_not_active');
      expect(data.metadata.status).toBe(status);
    },
  );

  it('APPROVED + correct password → tokens issued + audit success', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut);
    const result = await sut.svc.login({ email: seller.email, password: 'Seller-Secret-123' }, ctx);
    expect(result.seller.id).toBe(seller.id);
    expect(result.accessToken.token).toContain('.');
    const audit = sut.client.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('seller.login.success');
    expect(audit.actorType).toBe(ActorType.SELLER);
  });

  it('SUSPENDED + correct password → tokens issued (read-only access) + audit success', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut, { status: SellerStatus.SUSPENDED });
    const result = await sut.svc.login({ email: seller.email, password: 'Seller-Secret-123' }, ctx);
    expect(result.seller.status).toBe(SellerStatus.SUSPENDED);
    expect(result.accessToken.token).toContain('.');
    const audit = sut.client.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('seller.login.success');
  });
});

describe('SellerAuthService — registerViaInvitation', () => {
  function seedInvitation(sut: Sut, opts: Partial<InvitationRow> = {}) {
    const plaintext = sut.hashes.generateInvitationToken();
    const row: InvitationRow = {
      id: 'inv-1',
      email: 'invitee@brand.com',
      token: sut.hashes.sha256Hex(plaintext),
      invitedById: 'staff-1',
      sellerId: null,
      expiresAt: new Date(Date.now() + 86400000),
      usedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      ...opts,
    };
    sut.client.tables.invitations.push(row);
    return { plaintext, row };
  }

  it('happy path: creates APPROVED seller, marks invitation used, audits registered_via_invitation', async () => {
    const sut = makeSut();
    const { plaintext } = seedInvitation(sut);
    const result = await sut.svc.registerViaInvitation(
      {
        token: plaintext,
        companyName: 'Brand Co',
        contactPersonName: 'Sara K',
        phone: '+8801712345678',
        password: 'NewSeller-Pass!42',
      },
      ctx,
    );

    const created = sut.client.tables.sellers[0]!;
    expect(created.status).toBe(SellerStatus.APPROVED);
    expect(created.email).toBe('invitee@brand.com');
    expect(created.approvedAt).toBeInstanceOf(Date);
    expect(created.approvedById).toBe('staff-1');

    const inv = sut.client.tables.invitations[0]!;
    expect(inv.usedAt).toBeInstanceOf(Date);
    expect(inv.sellerId).toBe(created.id);

    expect(sut.enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'seller.welcome.email' }),
    );

    const registration = sut.client.auditLog.create.mock.calls.find(
      (c) => c[0].data.action === 'seller.registered_via_invitation',
    );
    expect(registration).toBeDefined();
    expect(registration![0].data.metadata.invitationId).toBe(inv.id);

    expect(result.accessToken.token).toContain('.');
  });

  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['already used', { usedAt: new Date() }],
    ['soft-deleted', { deletedAt: new Date() }],
    ['already linked to a seller', { sellerId: 'pre-existing' }],
  ])('rejects %s invitation with INVALID_INVITATION', async (_label, override) => {
    const sut = makeSut();
    const { plaintext } = seedInvitation(sut, override as Partial<InvitationRow>);
    await expect(
      sut.svc.registerViaInvitation(
        {
          token: plaintext,
          companyName: 'X',
          contactPersonName: 'Y',
          phone: '+8801712345678',
          password: 'Long-Enough-pw-1',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_INVITATION' } });
  });

  it('rejects when a seller already exists for the invitation email', async () => {
    const sut = makeSut();
    await seedSeller(sut, { email: 'invitee@brand.com' });
    const { plaintext } = seedInvitation(sut);
    await expect(
      sut.svc.registerViaInvitation(
        {
          token: plaintext,
          companyName: 'X',
          contactPersonName: 'Y',
          phone: '+8801712345678',
          password: 'Long-Enough-pw-1',
        },
        ctx,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('welcome-email enqueue failure does NOT roll back the registration', async () => {
    const sut = makeSut();
    const { plaintext } = seedInvitation(sut);
    sut.enqueueMock.mockRejectedValueOnce(new Error('redis down'));

    const result = await sut.svc.registerViaInvitation(
      {
        token: plaintext,
        companyName: 'X',
        contactPersonName: 'Y',
        phone: '+8801712345678',
        password: 'Long-Enough-pw-1',
      },
      ctx,
    );

    expect(result.seller.id).toBeDefined();
    expect(sut.client.tables.sellers).toHaveLength(1);
    expect(sut.client.tables.invitations[0]!.usedAt).toBeInstanceOf(Date);
  });

  it('creates a DEFAULT store alongside the company', async () => {
    /*
    This is what lets `orders.store_id` be NOT NULL: there is never a
    moment when a seller exists with nowhere for their orders to
    belong.

    Created here rather than lazily on the first order, because a lazy
    create is a read-then-write — two concurrent first orders would
    both find none and both make one, and the one-default-per-seller
    partial unique would refuse the second, failing an order for a
    reason nobody could act on.
  */
    const sut = makeSut();
    const { plaintext } = seedInvitation(sut);
    await sut.svc.registerViaInvitation(
      {
        token: plaintext,
        companyName: 'Brand Co',
        contactPersonName: 'Sara K',
        phone: '+8801712345678',
        password: 'NewSeller-Pass!42',
      },
      ctx,
    );
    expect(sut.client.sellerStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true, isActive: true }),
      }),
    );
  });
});

describe('SellerAuthService — password reset', () => {
  it('unknown email: generic 200, NO enqueue, audit outcome=unknown_email', async () => {
    const sut = makeSut();
    const result = await sut.svc.requestPasswordReset({ email: 'ghost@example.com' }, ctx);
    expect(result.message).toMatch(/If an account exists/);
    expect(sut.enqueueMock).not.toHaveBeenCalled();
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.metadata.outcome).toBe('unknown_email');
    expect(data.entityId).toBeNull();
  });

  it('suspended seller can still request reset (audit captures status)', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut, { status: SellerStatus.SUSPENDED });
    await sut.svc.requestPasswordReset({ email: seller.email }, ctx);
    expect(sut.enqueueMock).toHaveBeenCalled();
    const data = sut.client.auditLog.create.mock.calls[0]![0].data;
    expect(data.metadata.status).toBe(SellerStatus.SUSPENDED);
  });

  it('a link spent between the read and the write sets NO password', async () => {
    // The lookup runs OUTSIDE the transaction, so under READ COMMITTED two
    // tabs submitting the same link both see `usedAt: null`. Model that
    // honestly: hand back the pre-race snapshot, then let the other tab
    // commit. An unconditional `update` on the token accepted the second
    // submission and set a password from it.
    const sut = makeSut();
    const seller = await seedSeller(sut);
    const user = sut.client.tables.sellerUsers[0];
    if (!user) throw new Error('fixture: no seller user');
    const originalHash = user.passwordHash;

    const plaintext = sut.hashes.generatePasswordResetToken();
    const tokenRow = {
      id: 'prt-race',
      sellerUserId: user.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      ipAddress: '1.2.3.4',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      usedAt: null as Date | null,
    };
    sut.client.tables.prts.push(tokenRow);

    const readThrough = sut.client.sellerPasswordResetToken.findFirst
      .getMockImplementation()
      ?.bind(null);
    if (!readThrough) throw new Error('fixture: prt findFirst has no implementation');
    sut.client.sellerPasswordResetToken.findFirst.mockImplementation(async (args: unknown) => {
      const snapshot = await readThrough(args);
      tokenRow.usedAt = new Date(); // the other tab commits, here
      return snapshot; // ...and we still believe the link is unused
    });

    await expect(
      sut.svc.confirmPasswordReset({ token: plaintext, newPassword: 'Second-Tab-Wins!99' }, ctx),
    ).rejects.toThrow(BadRequestException);

    expect(user.passwordHash).toBe(originalHash);
    expect(await sut.password.verify(user.passwordHash, 'Second-Tab-Wins!99')).toBe(false);
    expect(seller.email).toBe(user.email);
  });
});

describe('SellerAuthService — refresh', () => {
  it.each([SellerStatus.PENDING, SellerStatus.REJECTED])(
    'refresh by status=%s seller → 403 ACCOUNT_NOT_ACTIVE + freshly-minted token revoked',
    async (status) => {
      const sut = makeSut();
      const seller = await seedSeller(sut);
      const login = await sut.svc.login(
        { email: seller.email, password: 'Seller-Secret-123' },
        ctx,
      );
      // Flip mid-session, after the cookie was issued.
      seller.status = status;

      await expect(
        sut.svc.rotateRefresh({ plaintext: login.refresh.token }, ctx),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_NOT_ACTIVE' } });

      // The new refresh row that rotate created must have been revoked
      // so the cookie just set is dead.
      const newest = sut.client.tables.rts.at(-1)!;
      expect(newest.revokedAt).toBeInstanceOf(Date);
    },
  );

  it('refresh by a SUSPENDED seller succeeds (read-only access kept alive)', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut);
    const login = await sut.svc.login({ email: seller.email, password: 'Seller-Secret-123' }, ctx);
    seller.status = SellerStatus.SUSPENDED;

    const result = await sut.svc.rotateRefresh({ plaintext: login.refresh.token }, ctx);
    expect(result.accessToken.token).toContain('.');
    expect(result.refresh.token).toBeDefined();
  });
});

describe('SellerAuthService — email verification', () => {
  it('already-verified → 409', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut);
    // Mark the OWNER sellerUser as verified — emailVerifiedAt now lives
    // on the user, not the company.
    const owner = sut.client.tables.sellerUsers.find((u) => u.sellerId === seller.id)!;
    owner.emailVerifiedAt = new Date();
    await expect(sut.svc.requestEmailVerification(owner.id, ctx)).rejects.toMatchObject({
      response: { code: 'ALREADY_VERIFIED' },
    });
  });

  it('confirm: stale email mismatch → 400', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut, { email: 'new@brand.com' });
    // The OWNER sellerUser carries the new email; the token carries the old.
    const owner = sut.client.tables.sellerUsers.find((u) => u.sellerId === seller.id)!;
    owner.email = 'new@brand.com';
    const plaintext = sut.hashes.generateEmailVerificationToken();
    sut.client.tables.evts.push({
      id: 'evt-1',
      sellerUserId: owner.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      email: 'old@brand.com',
      expiresAt: new Date(Date.now() + 86400000),
      usedAt: null,
    });
    await expect(sut.svc.confirmEmailVerification({ token: plaintext }, ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('confirm: happy path sets emailVerifiedAt + audits', async () => {
    const sut = makeSut();
    const seller = await seedSeller(sut);
    const owner = sut.client.tables.sellerUsers.find((u) => u.sellerId === seller.id)!;
    const plaintext = sut.hashes.generateEmailVerificationToken();
    sut.client.tables.evts.push({
      id: 'evt-2',
      sellerUserId: owner.id,
      tokenHash: sut.hashes.sha256Hex(plaintext),
      email: owner.email,
      expiresAt: new Date(Date.now() + 86400000),
      usedAt: null,
    });
    await sut.svc.confirmEmailVerification({ token: plaintext }, ctx);
    // emailVerifiedAt now lands on the sellerUser, not the seller.
    expect(owner.emailVerifiedAt).toBeInstanceOf(Date);
    expect(sut.client.tables.evts[0]!.usedAt).toBeInstanceOf(Date);
  });
});
