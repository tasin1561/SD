import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import {
  runImpersonated,
  type ImpersonationContext,
} from '../../src/common/impersonation/impersonation-context';
import { SellerAuthController } from '../../src/modules/seller-auth/seller-auth.controller';
import { StoreAuthController } from '../../src/modules/store-auth/store-auth.controller';

/**
 * GET /auth/{seller,store}/me are @Public, so the JWT guards (which know
 * about support sessions) never run. These pin that the routes consult the
 * session themselves, FIRST, and refuse by name.
 */
const sellerCtx: ImpersonationContext = {
  sessionId: 's1',
  staffUserId: 'staff1',
  subject: { kind: 'SELLER', id: 'seller1' },
  mayWrite: false,
};
const storeCtx: ImpersonationContext = {
  sessionId: 's2',
  staffUserId: 'staff1',
  subject: { kind: 'STORE', id: 'store1' },
  mayWrite: false,
};

function req(headers: Record<string, string> = {}): Request {
  return {
    header: (n: string) => headers[n.toLowerCase()],
    cookies: {},
    url: '/auth/seller/me',
    method: 'GET',
  } as unknown as Request;
}

function sellerHarness(opts: { owner: boolean; status?: string; deleted?: boolean }) {
  const jwt = { verifySellerAccess: jest.fn().mockReturnValue({ sub: 'bearer-user' }) };
  const refresh = { validateByPlaintext: jest.fn() };
  const prisma = {
    client: {
      sellerUser: {
        findFirst: jest.fn(async (args: { where: { sellerId?: string; id?: string } }) => {
          if (args.where.sellerId !== undefined) return opts.owner ? { id: 'owner1' } : null;
          return {
            id: args.where.id,
            seller: {
              id: 'seller1',
              status: opts.status ?? 'APPROVED',
              deletedAt: opts.deleted ? new Date() : null,
            },
          };
        }),
      },
    },
  };
  const svc = { getMe: jest.fn(async (id: string) => ({ id })) };
  const audit = { log: jest.fn() };
  const c = new SellerAuthController(
    svc as never,
    jwt as never,
    refresh as never,
    prisma as never,
    audit as never,
  );
  return { c, jwt, svc, prisma };
}

describe('GET /auth/seller/me with a support session', () => {
  it('resolves to the owner with only the impersonation context', async () => {
    const { c, svc } = sellerHarness({ owner: true });
    const out = await runImpersonated(sellerCtx, () => c.me(req()));
    expect(svc.getMe).toHaveBeenCalledWith('owner1');
    expect(out).toEqual({ id: 'owner1' });
  });

  it('impersonation WINS over a bearer', async () => {
    const { c, jwt, svc } = sellerHarness({ owner: true });
    await runImpersonated(sellerCtx, () => c.me(req({ authorization: 'Bearer abc' })));
    expect(jwt.verifySellerAccess).not.toHaveBeenCalled();
    expect(svc.getMe).toHaveBeenCalledWith('owner1');
  });

  it('refuses a STORE-subject session by name', async () => {
    const { c } = sellerHarness({ owner: true });
    await expect(runImpersonated(storeCtx, () => c.me(req()))).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_WRONG_SUBJECT' },
    });
    await expect(runImpersonated(storeCtx, () => c.me(req()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a seller with no owner by name', async () => {
    const { c } = sellerHarness({ owner: false });
    const p = runImpersonated(sellerCtx, () => c.me(req()));
    await expect(p).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_SUBJECT_UNAVAILABLE' },
    });
    await expect(p).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a SUSPENDED seller still 403s through a support session', async () => {
    const { c } = sellerHarness({ owner: true, status: 'SUSPENDED' });
    await expect(runImpersonated(sellerCtx, () => c.me(req()))).rejects.toMatchObject({
      response: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('a deleted seller still 401s', async () => {
    const { c } = sellerHarness({ owner: true, deleted: true });
    await expect(runImpersonated(sellerCtx, () => c.me(req()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('no credential at all is the unchanged 401', async () => {
    const { c } = sellerHarness({ owner: true });
    await expect(c.me(req())).rejects.toMatchObject({
      response: {
        code: 'UNAUTHORIZED',
        message: 'Bearer token or __Host-sellerRefresh cookie required',
      },
    });
  });
});

describe('GET /auth/store/me with a support session', () => {
  function storeHarness(owner: boolean) {
    const jwt = { verifyStoreAccess: jest.fn() };
    const prisma = {
      client: {
        storeUser: { findFirst: jest.fn(async () => (owner ? { id: 'sowner1' } : null)) },
      },
    };
    const svc = {
      assertMayUse: jest.fn(),
      getMe: jest.fn(async (id: string) => ({ id })),
    };
    const c = new StoreAuthController(svc as never, jwt as never, {} as never, prisma as never);
    return { c, jwt, svc };
  }

  it('resolves to the store owner, ignoring a bearer', async () => {
    const { c, jwt, svc } = storeHarness(true);
    await runImpersonated(storeCtx, () => c.me(req({ authorization: 'Bearer abc' })));
    expect(jwt.verifyStoreAccess).not.toHaveBeenCalled();
    expect(svc.assertMayUse).toHaveBeenCalledWith('sowner1');
    expect(svc.getMe).toHaveBeenCalledWith('sowner1');
  });

  it('refuses a SELLER-subject session by name', async () => {
    const { c } = storeHarness(true);
    await expect(runImpersonated(sellerCtx, () => c.me(req()))).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_WRONG_SUBJECT' },
    });
  });

  it('refuses a store with no owner by name', async () => {
    const { c } = storeHarness(false);
    await expect(runImpersonated(storeCtx, () => c.me(req()))).rejects.toMatchObject({
      response: { code: 'IMPERSONATION_SUBJECT_UNAVAILABLE' },
    });
  });
});
