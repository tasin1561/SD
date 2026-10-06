import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResellerStoreStatus, SellerStatus, SellerStoreKind } from '@skydrop/db';
import { StoreJwtGuard, storeMayBeUsed } from '../../src/common/guards/store-jwt.guard';
import {
  REQUIRE_STORE_PERMISSIONS_KEY,
  STORE_SELF_SERVICE_KEY,
} from '../../src/common/auth/require-store-permissions.decorator';

/**
 * RS-2 — the store guard: the right token, a usable store, and a
 * permission gate that FAILS CLOSED on reads and writes alike.
 */

interface Row {
  roleKey?: string;
  isOwner?: boolean;
  perms?: string[];
  status?: ResellerStoreStatus | null;
  kind?: SellerStoreKind;
  sellerStatus?: SellerStatus;
  /**
   * A SECOND role, for the multi-role cases. The fixture carries a
   * `roles` LIST because `store_user_roles` is the only authority: a
   * person holds as many roles as were granted, never just one.
   */
  second?: { key: string; perms?: string[]; isOwner?: boolean; deleted?: boolean };
  /** Every role soft-deleted — a person with nothing to reason about. */
  roleDeleted?: boolean;
}

function assignment(
  key: string,
  name: string,
  perms: readonly string[],
  opts: { isOwner?: boolean; deleted?: boolean } = {},
) {
  return {
    role: {
      key,
      name,
      isOwner: opts.isOwner ?? false,
      deletedAt: opts.deleted === true ? new Date() : null,
      permissions: perms.map((permission) => ({ permission })),
    },
  };
}

function userRow(r: Row) {
  return {
    id: 'u1',
    email: 'a@b.in',
    fullName: 'A',
    emailVerifiedAt: null,
    roles: [
      assignment(r.roleKey ?? 'viewer', 'Viewer', r.perms ?? [], {
        isOwner: r.isOwner ?? false,
        deleted: r.roleDeleted === true,
      }),
      ...(r.second === undefined
        ? []
        : [
            assignment(r.second.key, r.second.key.toUpperCase(), r.second.perms ?? [], {
              isOwner: r.second.isOwner ?? false,
              deleted: r.second.deleted === true,
            }),
          ]),
    ],
    store: {
      id: 's1',
      kind: r.kind ?? SellerStoreKind.RESELLER,
      status: r.status === undefined ? ResellerStoreStatus.ACTIVE : r.status,
      deletedAt: null,
      sellerId: 'sel1',
      seller: { status: r.sellerStatus ?? SellerStatus.APPROVED, deletedAt: null },
    },
  };
}

function ctxFor(meta: Record<string, unknown>, headers: Record<string, string>) {
  const req: Record<string, unknown> = {
    header: (n: string) => headers[n.toLowerCase()],
    url: '/store/x',
    method: 'GET',
    ip: '1.1.1.1',
  };
  const handler = () => undefined;
  class K {}
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  const ctx = {
    getHandler: () => handler,
    getClass: () => K,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function guardWith(row: ReturnType<typeof userRow> | null) {
  const jwt = {
    verifyStoreAccess: jest.fn().mockReturnValue({ sub: 'u1', jti: 'j1' }),
  };
  const prisma = { client: { storeUser: { findFirst: jest.fn().mockResolvedValue(row) } } };
  const audit = { log: jest.fn().mockResolvedValue(null) };
  const guard = new StoreJwtGuard(jwt as any, prisma as any, audit as any, new Reflector());
  return { guard, jwt, audit };
}

const BEARER = { authorization: 'Bearer t' };

describe('StoreJwtGuard (RS-2)', () => {
  it('refuses a request with no bearer token', async () => {
    const { guard } = guardWith(userRow({}));
    const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.view'] }, {});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifies the token against the STORE audience', async () => {
    const { guard, jwt } = guardWith(userRow({ perms: ['team.view'] }));
    const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.view'] }, BEARER);
    await guard.canActivate(ctx);
    expect(jwt.verifyStoreAccess).toHaveBeenCalledWith('t');
  });

  it('refuses a removed user', async () => {
    const { guard } = guardWith(null);
    const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.view'] }, BEARER);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('FAILS CLOSED: an endpoint declaring nothing is refused, even a read', async () => {
    const { guard } = guardWith(userRow({ isOwner: true }));
    const { ctx } = ctxFor({}, BEARER);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ENDPOINT_NOT_AUTHORIZED' },
    });
  });

  it('refuses a missing permission and audits it', async () => {
    const { guard, audit } = guardWith(userRow({ perms: ['team.view'] }));
    const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.manage'] }, BEARER);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_PERMISSION' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'store.access_denied_permission' }),
    );
  });

  it('lets a holder through and scopes the request to THEIR store', async () => {
    const { guard } = guardWith(userRow({ perms: ['team.view'] }));
    const { ctx, req } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.view'] }, BEARER);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req['storeUser']).toMatchObject({ id: 'u1', storeId: 's1', sellerId: 'sel1' });
  });

  it('an owner holds every permission', async () => {
    const { guard } = guardWith(userRow({ isOwner: true }));
    const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['store.profile.manage'] }, BEARER);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('self-service needs no permission', async () => {
    const { guard } = guardWith(userRow({}));
    const { ctx } = ctxFor({ [STORE_SELF_SERVICE_KEY]: true }, BEARER);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses a store that is not open, whatever the permission', async () => {
    for (const status of [
      ResellerStoreStatus.PENDING_SELLER_APPROVAL,
      ResellerStoreStatus.CLOSED,
      ResellerStoreStatus.REJECTED,
    ]) {
      const { guard } = guardWith(userRow({ isOwner: true, status }));
      const { ctx } = ctxFor({ [STORE_SELF_SERVICE_KEY]: true }, BEARER);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('storeMayBeUsed', () => {
  const base = {
    kind: SellerStoreKind.RESELLER,
    status: ResellerStoreStatus.ACTIVE as ResellerStoreStatus | null,
    deletedAt: null,
    sellerStatus: SellerStatus.APPROVED,
    sellerDeletedAt: null,
  };
  it('ACTIVE and PAUSED only — PAUSED stops new orders, not the portal', () => {
    const open = Object.values(ResellerStoreStatus).filter((status) =>
      storeMayBeUsed({ ...base, status }),
    );
    expect(open.sort()).toEqual([ResellerStoreStatus.ACTIVE, ResellerStoreStatus.PAUSED].sort());
  });
  it('never a channel store, a deleted store, or behind a seller who is not approved', () => {
    expect(storeMayBeUsed({ ...base, kind: SellerStoreKind.CHANNEL, status: null })).toBe(false);
    expect(storeMayBeUsed({ ...base, deletedAt: new Date() as never })).toBe(false);
    expect(storeMayBeUsed({ ...base, sellerStatus: SellerStatus.SUSPENDED })).toBe(false);
  });

  // ── Multi-role ───────────────────────────────────────────────────
  describe('several roles', () => {
    it('admits on a permission the SECOND role grants', async () => {
      const { guard } = guardWith(
        userRow({
          roleKey: 'viewer',
          perms: ['orders.view'],
          second: { key: 'finance', perms: ['wallet.view'] },
        }),
      );
      const { ctx, req } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['wallet.view'] }, BEARER);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect([...(req as any).storeUser.permissions].sort()).toEqual([
        'orders.view',
        'wallet.view',
      ]);
      expect((req as any).storeUser.roleKeys).toEqual(['viewer', 'finance']);
    });

    it('an OWNER role among several grants the whole catalogue', async () => {
      const { guard } = guardWith(
        userRow({
          roleKey: 'viewer',
          perms: ['orders.view'],
          second: { key: 'owner', isOwner: true },
        }),
      );
      const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['team.manage'] }, BEARER);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('a soft-deleted role among several grants nothing of its own', async () => {
      const { guard } = guardWith(
        userRow({
          roleKey: 'viewer',
          perms: ['orders.view'],
          second: { key: 'finance', perms: ['wallet.view'], deleted: true },
        }),
      );
      const { ctx } = ctxFor({ [REQUIRE_STORE_PERMISSIONS_KEY]: ['wallet.view'] }, BEARER);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * Every role gone is nobody to be. The guard answers UNAUTHORIZED —
     * the same answer the single-role version gave — rather than
     * carrying on with an empty grant set, which would reach every
     * self-service endpoint while reading as a working login.
     */
    it('EVERY role soft-deleted is UNAUTHORIZED, even on a self-service route', async () => {
      const { guard } = guardWith(userRow({ roleDeleted: true }));
      const { ctx } = ctxFor({ [STORE_SELF_SERVICE_KEY]: true }, BEARER);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
