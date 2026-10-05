import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { StaffRole } from '@skydrop/db';
import { StaffJwtGuard } from '../../src/common/guards/staff-jwt.guard';
import {
  REQUIRE_PERMISSIONS_KEY,
  STAFF_SELF_SERVICE_KEY,
} from '../../src/common/auth/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';

/**
 * The staff guard's PERMISSION gate.
 *
 * There was NO spec for this file before multi-role landed — the seller
 * and store guards each had one and the staff guard, which is the one
 * standing in front of god mode, did not. It is the same two rules
 * (RBAC-1): self-service short-circuits; otherwise the handler's
 * declaration, else the class's; holding ANY listed key passes; and an
 * endpoint declaring NEITHER is refused, reads included.
 *
 * What multi-role adds is that `permissions` is the UNION of every role
 * held and that a super-admin role ANYWHERE in the set grants the
 * catalogue — which is the half that fails silently if it regresses,
 * because it presents as working software with some buttons missing.
 */

interface Opts {
  readonly roles?: readonly {
    key: string;
    permissions?: readonly string[];
    isSuperAdmin?: boolean;
    deleted?: boolean;
  }[];
  readonly handlerRequires?: readonly string[];
  readonly classRequires?: readonly string[];
  readonly selfService?: boolean;
  readonly isPublic?: boolean;
  readonly noUser?: boolean;
  readonly noBearer?: boolean;
}

function makeGuard(opts: Opts) {
  const jwt = { verifyStaffAccess: jest.fn(() => ({ sub: 'staff-1', jti: 'jti-1' })) };

  const roles = opts.roles ?? [{ key: 'call_agent', permissions: ['callcenter.work'] }];
  const findFirst = jest.fn(async () =>
    opts.noUser === true
      ? null
      : {
          id: 'staff-1',
          email: 's@skydrop.global',
          role: StaffRole.CALL_AGENT,
          emailVerifiedAt: new Date(),
          roles: roles.map((r) => ({
            role: {
              key: r.key,
              name: r.key.toUpperCase(),
              isSuperAdmin: r.isSuperAdmin ?? false,
              deletedAt: r.deleted === true ? new Date() : null,
              permissions: (r.permissions ?? []).map((permission) => ({ permission })),
            },
          })),
        },
  );
  const prisma = { client: { staffUser: { findFirst } } };

  const getAllAndOverride = jest.fn((key: string) => {
    if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
    if (key === STAFF_SELF_SERVICE_KEY) return opts.selfService ?? false;
    if (key === REQUIRE_PERMISSIONS_KEY) return opts.handlerRequires ?? opts.classRequires;
    return undefined;
  });
  const reflector = { getAllAndOverride } as unknown as Reflector;

  const req: Record<string, unknown> = {
    header: (n: string) =>
      n.toLowerCase() === 'authorization' && opts.noBearer !== true ? 'Bearer t' : undefined,
    url: '/admin/x',
    method: 'GET',
  };
  const handler = () => undefined;
  class K {}
  const ctx = {
    getHandler: () => handler,
    getClass: () => K,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

   
  const guard = new StaffJwtGuard(jwt as any, prisma as any, reflector);
  return { guard, ctx, req };
}

describe('StaffJwtGuard', () => {
  it('refuses a request with no bearer token', async () => {
    const { guard, ctx } = makeGuard({ noBearer: true });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a public route short-circuits before anything is read', async () => {
    const { guard, ctx } = makeGuard({ isPublic: true, noBearer: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses a staff member who no longer exists', async () => {
    const { guard, ctx } = makeGuard({ noUser: true });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * The fail-closed rule, in the direction that matters: an endpoint
   * somebody forgot to annotate is UNREACHABLE rather than open, and
   * that holds for reads as much as writes.
   */
  it('FAILS CLOSED: an endpoint declaring nothing is refused', async () => {
    const { guard, ctx } = makeGuard({});
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ENDPOINT_NOT_AUTHORIZED' },
    });
  });

  it('refuses a permission nobody holds, by name', async () => {
    const { guard, ctx } = makeGuard({ handlerRequires: ['orders.override'] });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_PERMISSION' },
    });
  });

  it('admits a holder and attaches the resolved permissions', async () => {
    const { guard, ctx, req } = makeGuard({ handlerRequires: ['callcenter.work'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
     
    expect((req as any).staff.permissions).toEqual(['callcenter.work']);
  });

  it('self-service needs no permission at all', async () => {
    const { guard, ctx } = makeGuard({ selfService: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('several roles', () => {
    it('two roles COMPOSE — admitted on a key the second grants', async () => {
      const { guard, ctx, req } = makeGuard({
        roles: [
          { key: 'call_agent', permissions: ['callcenter.work'] },
          { key: 'support', permissions: ['tickets.view', 'tickets.resolve'] },
        ],
        handlerRequires: ['tickets.resolve'],
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
       
      const staff = (req as any).staff;
      expect([...staff.permissions].sort()).toEqual([
        'callcenter.work',
        'tickets.resolve',
        'tickets.view',
      ]);
      expect(staff.roleKeys).toEqual(['call_agent', 'support']);
      // The LABEL is the first role; the authority is the union.
      expect(staff.roleKey).toBe('call_agent');
    });

    /**
     * A super-admin role carries NO permission rows — it grants the
     * catalogue implicitly, including keys a later release adds. Taking
     * the union of ROWS would silently demote somebody holding it
     * alongside a narrow role.
     */
    it('a super-admin role among several grants EVERYTHING', async () => {
      const { guard, ctx } = makeGuard({
        roles: [
          { key: 'call_agent', permissions: ['callcenter.work'] },
          { key: 'super_admin', isSuperAdmin: true },
        ],
        handlerRequires: ['orders.override'],
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('a soft-deleted role among several grants nothing of its own', async () => {
      const { guard, ctx } = makeGuard({
        roles: [
          { key: 'call_agent', permissions: ['callcenter.work'] },
          { key: 'support', permissions: ['tickets.resolve'], deleted: true },
        ],
        handlerRequires: ['tickets.resolve'],
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * Every role gone is nobody to be. The guard answers UNAUTHORIZED —
     * "sign in again" — rather than carrying on with an empty grant
     * set, which would reach every self-service endpoint while reading
     * as a working login.
     */
    it('EVERY role soft-deleted is UNAUTHORIZED, even on a self-service route', async () => {
      const { guard, ctx } = makeGuard({
        roles: [{ key: 'call_agent', permissions: ['callcenter.work'], deleted: true }],
        selfService: true,
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('a person with NO roles at all is UNAUTHORIZED, never fail-open', async () => {
      const { guard, ctx } = makeGuard({ roles: [], selfService: true });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('names every role it refused, so a 403 says who was refused', async () => {
      const { guard, ctx } = makeGuard({
        roles: [
          { key: 'call_agent', permissions: ['callcenter.work'] },
          { key: 'support', permissions: ['tickets.view'] },
        ],
        handlerRequires: ['orders.override'],
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { message: expect.stringContaining('CALL_AGENT and SUPPORT') },
      });
    });
  });
});
