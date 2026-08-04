import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { SellerStatus, SellerUserRole } from '@skydrop/db';
import { SellerJwtGuard } from '../../src/common/guards/seller-jwt.guard';
import {
  REQUIRE_SELLER_PERMISSIONS_KEY,
  SELLER_SELF_SERVICE_KEY,
} from '../../src/common/auth/require-seller-permissions.decorator';
import { ALL_SELLER_PERMISSION_KEYS } from '../../src/common/auth/seller-permissions';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { SELLER_AUTH_ALLOW_SUSPENDED_KEY } from '../../src/common/decorators/seller-auth-allow-suspended.decorator';
import type { JwtService } from '../../src/modules/auth-common/services/jwt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

/**
 * The seller guard's PERMISSION gate.
 *
 * ── WHAT IT REPLACED ─────────────────────────────────────────────────
 * A role gate that was fail-closed on WRITES only. Reads stayed open to
 * five of the six roles, with VIEWER narrowed by a hand-maintained
 * per-controller allow-list. A company could say "may not change the
 * wallet" and could not say "may not SEE the wallet" — which is the
 * ordinary thing a company with staff wants to say.
 *
 * Both directions are closed by default now, and an endpoint that
 * declares nothing is refused. These pin that, because getting it wrong
 * fails silently: an endpoint that answers everybody looks exactly like
 * one that was meant to.
 */

type AnyArgs = Record<string, unknown>;

const HANDLER = function handler(): void {};
const CLASS = class Ctrl {};

function makeGuard(opts: {
  permissions?: readonly string[];
  isOwner?: boolean;
  roleDeleted?: boolean;
  method?: string;
  handlerRequires?: readonly string[];
  classRequires?: readonly string[];
  selfService?: boolean;
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
    role: SellerUserRole.OPS,
    emailVerifiedAt: new Date(),
    sellerRole: {
      key: opts.isOwner === true ? 'owner' : 'custom',
      name: opts.isOwner === true ? 'Owner' : 'Custom role',
      isOwner: opts.isOwner ?? false,
      deletedAt: opts.roleDeleted === true ? new Date() : null,
      permissions: (opts.permissions ?? []).map((permission) => ({ permission })),
    },
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

  const getAllAndOverride = jest.fn((key: string) => {
    if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
    if (key === SELLER_AUTH_ALLOW_SUSPENDED_KEY) return opts.allowSuspended ?? false;
    if (key === SELLER_SELF_SERVICE_KEY) return opts.selfService ?? false;
    if (key === REQUIRE_SELLER_PERMISSIONS_KEY) {
      // Handler wins over class — the decorator OVERRIDES, never adds.
      return opts.handlerRequires ?? opts.classRequires;
    }
    return undefined;
  });
  const reflector = { get: jest.fn(), getAllAndOverride } as unknown as Reflector;

  const guard = new SellerJwtGuard(
    jwt as unknown as JwtService,
    prisma,
    audit as unknown as AuditLogService,
    reflector,
  );

  const req = {
    method: opts.method ?? 'GET',
    url: '/seller/wallet',
    ip: '1.2.3.4',
    header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer t' : undefined),
  } as unknown as Record<string, unknown>;

  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => HANDLER,
    getClass: () => CLASS,
  } as unknown as ExecutionContext;

  return { guard, ctx, req, auditLog, findFirst };
}

describe('SellerJwtGuard — permission gate', () => {
  it('lets through somebody who holds the required permission', async () => {
    const { guard, ctx } = makeGuard({
      permissions: ['wallet.view'],
      classRequires: ['wallet.view'],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('REFUSES a read the role does not hold — the change from the role system', async () => {
    // Under the old gate this was allowed: reads were open to every role
    // but VIEWER, so "may not see the wallet" was inexpressible.
    const { guard, ctx } = makeGuard({
      permissions: ['orders.view'],
      classRequires: ['wallet.view'],
      method: 'GET',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a write the same way', async () => {
    const { guard, ctx } = makeGuard({
      permissions: ['orders.view'],
      classRequires: ['orders.create'],
      method: 'POST',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a HANDLER declaration overrides the class one rather than adding to it', async () => {
    const { guard, ctx } = makeGuard({
      permissions: ['orders.view'],
      classRequires: ['orders.view'],
      handlerRequires: ['orders.cancel'],
      method: 'POST',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('several required permissions mean ANY of them', async () => {
    const { guard, ctx } = makeGuard({
      permissions: ['tickets.create'],
      classRequires: ['tickets.view', 'tickets.create'],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('FAILS CLOSED when an endpoint declares nothing at all', async () => {
    // The point of the whole change: a new controller is unreachable
    // until somebody decides who it is for.
    const { guard, ctx } = makeGuard({ permissions: ALL_SELLER_PERMISSION_KEYS });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ENDPOINT_NOT_AUTHORIZED' },
    });
  });

  it('the owner role holds everything, including permissions it has no row for', async () => {
    const { guard, ctx } = makeGuard({
      isOwner: true,
      permissions: [],
      classRequires: ['roles.manage'],
      method: 'POST',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('self-service needs no permission — it is about the caller themselves', async () => {
    const { guard, ctx } = makeGuard({ permissions: [], selfService: true, method: 'POST' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('a soft-deleted role ends the session rather than granting nothing', async () => {
    // Leaving somebody authenticated with an empty grant set is worse
    // than asking them to sign in again: every screen refuses and none
    // says why.
    const { guard, ctx } = makeGuard({ roleDeleted: true, classRequires: ['orders.view'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('audits a denial at LOW with the role, what was required, and the path', async () => {
    const { guard, ctx, auditLog } = makeGuard({
      permissions: ['orders.view'],
      classRequires: ['wallet.view'],
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller.access_denied_permission',
        severity: 'LOW',
        metadata: expect.objectContaining({
          role: 'custom',
          required: ['wallet.view'],
          path: '/seller/wallet',
          method: 'GET',
        }),
      }),
    );
  });

  it('attaches the resolved permissions to the request for downstream use', async () => {
    const { guard, ctx, req } = makeGuard({
      permissions: ['orders.view', 'wallet.view'],
      classRequires: ['orders.view'],
    });
    await guard.canActivate(ctx);
    expect((req['seller'] as { permissions: readonly string[] }).permissions).toEqual([
      'orders.view',
      'wallet.view',
    ]);
  });

  it('a suspended seller is rejected on status before permissions are considered', async () => {
    const { guard, ctx } = makeGuard({
      sellerStatus: SellerStatus.SUSPENDED,
      permissions: ALL_SELLER_PERMISSION_KEYS,
      classRequires: ['orders.view'],
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a public route short-circuits before any of this', async () => {
    const { guard, ctx, findFirst } = makeGuard({ isPublic: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
