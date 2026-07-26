import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { SellerStatus, SellerUserRole } from '@skydrop/db';
import { SellerJwtGuard } from '../../src/common/guards/seller-jwt.guard';
import { SELLER_ROLES_KEY, SELLER_ROLES_ALL } from '../../src/common/decorators/seller-roles.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { SELLER_AUTH_ALLOW_SUSPENDED_KEY } from '../../src/common/decorators/seller-auth-allow-suspended.decorator';
import type { JwtService } from '../../src/modules/auth-common/services/jwt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

const HANDLER = function handler(): void {};
const CLASS = class Ctrl {};

function makeGuard(opts: {
  role?: SellerUserRole;
  method?: string;
  /** metadata seen at the HANDLER level */
  handlerRoles?: SellerUserRole[];
  /** metadata seen at the CLASS level */
  classRoles?: SellerUserRole[];
  sellerStatus?: SellerStatus;
  allowSuspended?: boolean;
  isPublic?: boolean;
}) {
  const verifySellerAccess = jest.fn(() => ({ sub: 'user-1', jti: 'jti-1' }));
  const jwt = { verifySellerAccess };

  const findFirst = jest.fn(async () => ({
    id: 'user-1',
    email: 'u@example.com',
    fullName: 'U',
    role: opts.role ?? SellerUserRole.OWNER,
    emailVerifiedAt: new Date(),
    seller: {
      id: 'seller-1',
      email: 's@example.com',
      status: opts.sellerStatus ?? SellerStatus.APPROVED,
      deletedAt: null,
    },
  }));
  const prisma = { client: { sellerUser: { findFirst } } } as unknown as PrismaService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };

  // `get` distinguishes handler vs class; `getAllAndOverride` is used for
  // the public + allow-suspended flags.
  const get = jest.fn((key: string, target: unknown) => {
    if (key !== SELLER_ROLES_KEY) return undefined;
    if (target === HANDLER) return opts.handlerRoles;
    if (target === CLASS) return opts.classRoles;
    return undefined;
  });
  const getAllAndOverride = jest.fn((key: string) => {
    if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
    if (key === SELLER_AUTH_ALLOW_SUSPENDED_KEY) return opts.allowSuspended ?? false;
    return undefined;
  });
  const reflector = { get, getAllAndOverride } as unknown as Reflector;

  const req: AnyArgs = {
    method: opts.method ?? 'POST',
    url: '/seller/things',
    ip: '1.2.3.4',
    header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer tok' : undefined),
  };
  const ctx = {
    getHandler: () => HANDLER,
    getClass: () => CLASS,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  const guard = new SellerJwtGuard(
    jwt as unknown as JwtService,
    prisma,
    audit as unknown as AuditLogService,
    reflector,
  );
  return { guard, ctx, req, auditLog, findFirst };
}

describe('SellerJwtGuard — RBAC policy', () => {
  it('allows a public route with no token work at all', async () => {
    const { guard, ctx, findFirst } = makeGuard({ isPublic: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    const { guard, ctx, req } = makeGuard({});
    req.header = () => undefined;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── default policy (no @SellerRoles anywhere) ────────────────────────

  it.each([SellerUserRole.OWNER, SellerUserRole.ADMIN])(
    'default: %s may perform a write',
    async (role) => {
      const { guard, ctx } = makeGuard({ role, method: 'POST' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    },
  );

  it.each([
    SellerUserRole.OPS,
    SellerUserRole.INVENTORY,
    SellerUserRole.FINANCE,
    SellerUserRole.VIEWER,
  ])('default: %s is BLOCKED from a write (fail-closed)', async (role) => {
    const { guard, ctx } = makeGuard({ role, method: 'POST' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'default: VIEWER may perform a %s (read-only access to everything)',
    async (method) => {
      const { guard, ctx } = makeGuard({ role: SellerUserRole.VIEWER, method });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    },
  );

  it.each(['PATCH', 'PUT', 'DELETE'])(
    'default: VIEWER is BLOCKED from a %s',
    async (method) => {
      const { guard, ctx } = makeGuard({ role: SellerUserRole.VIEWER, method });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('audits a role denial at LOW with role/allowed/path/method', async () => {
    const { guard, ctx, auditLog } = makeGuard({ role: SellerUserRole.VIEWER, method: 'POST' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller.access_denied_role',
        severity: 'LOW',
        metadata: expect.objectContaining({
          role: SellerUserRole.VIEWER,
          allowedRoles: [SellerUserRole.OWNER, SellerUserRole.ADMIN],
          method: 'POST',
          path: '/seller/things',
        }),
      }),
    );
  });

  // ── CLASS-level declaration = the domain's WRITE allow-list ──────────

  it('class-level roles let the domain role write', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.INVENTORY,
      method: 'POST',
      classRoles: [SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('class-level roles still block a role outside the domain', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.OPS,
      method: 'POST',
      classRoles: [SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY],
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it('class-level roles do NOT lock VIEWER out of that controller\'s reads', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.VIEWER,
      method: 'GET',
      classRoles: [SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ── HANDLER-level declaration is absolute ────────────────────────────

  it('handler-level SELLER_ROLES_ALL opens a self-service POST to VIEWER', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.VIEWER,
      method: 'POST',
      handlerRoles: [...SELLER_ROLES_ALL],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('handler-level roles override a wider class-level list', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.INVENTORY,
      method: 'POST',
      classRoles: [SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY],
      handlerRoles: [SellerUserRole.OWNER],
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it('handler-level roles apply to READS too (can lock down a GET)', async () => {
    const { guard, ctx } = makeGuard({
      role: SellerUserRole.VIEWER,
      method: 'GET',
      handlerRoles: [SellerUserRole.OWNER, SellerUserRole.FINANCE],
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  // ── status check still precedes the role check ───────────────────────

  it('a SUSPENDED seller is rejected on status before role is considered', async () => {
    const { guard, ctx, auditLog } = makeGuard({
      role: SellerUserRole.OWNER,
      method: 'GET',
      sellerStatus: SellerStatus.SUSPENDED,
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seller.access_denied_status' }),
    );
  });

  it('a SUSPENDED seller passes a route that opts in, and the role gate still applies', async () => {
    const ok = makeGuard({
      role: SellerUserRole.VIEWER,
      method: 'GET',
      sellerStatus: SellerStatus.SUSPENDED,
      allowSuspended: true,
    });
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);

    const denied = makeGuard({
      role: SellerUserRole.VIEWER,
      method: 'POST',
      sellerStatus: SellerStatus.SUSPENDED,
      allowSuspended: true,
    });
    await expect(denied.guard.canActivate(denied.ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_ROLE' },
    });
  });

  it('populates req.seller with the resolved user + role on success', async () => {
    const { guard, ctx, req } = makeGuard({ role: SellerUserRole.OPS, method: 'GET' });
    await guard.canActivate(ctx);
    expect(req.seller).toMatchObject({
      id: 'seller-1',
      userId: 'user-1',
      role: SellerUserRole.OPS,
    });
  });
});
