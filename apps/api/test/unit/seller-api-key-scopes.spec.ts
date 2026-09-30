import type { ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ApiKeyGuard } from '../../src/common/guards/api-key.guard';
import {
  ALL_SELLER_API_KEY_SCOPES,
  SELLER_API_KEY_SCOPES,
  permissionsForScopes,
} from '../../src/common/auth/seller-api-key-scopes';
import { ALL_SELLER_PERMISSION_KEYS } from '../../src/common/auth/seller-permissions';
import {
  REQUIRE_SELLER_PERMISSIONS_KEY,
  SELLER_SELF_SERVICE_KEY,
} from '../../src/common/auth/require-seller-permissions.decorator';

/**
 * A seller API key used to arrive holding the built-in Admin role —
 * every seller permission bar `roles.manage`. It was never reachable
 * (no controller carries `@UseGuards(ApiKeyGuard)`), which is exactly
 * why it could sit there: the keys the seller UI mints authenticate
 * nothing, so nothing failed. These are the two properties that have to
 * hold before the first controller is attached — a key reaches only
 * what its scopes name, and the endpoint's own declaration is enforced.
 */
describe('Seller API key scopes', () => {
  it('every scope grants only real permission keys', () => {
    for (const scope of SELLER_API_KEY_SCOPES) {
      for (const permission of scope.permissions) {
        expect(ALL_SELLER_PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  /**
   * The ceiling, named rather than implied. These are the permissions a
   * machine credential must never carry however many boxes are ticked:
   * money moving out, the account it moves to, who may sign in, and
   * anything that can widen itself.
   */
  it('NO scope reaches money or identity — the ceiling is the absence of a scope', () => {
    const forbidden = [
      'wallet.view',
      'wallet.topup',
      'wallet.withdraw',
      'charges.view',
      'freight.view',
      'profile.manage',
      'team.view',
      'team.manage',
      'roles.manage',
      'api_keys.manage',
      'webhooks.manage',
      'stores.manage',
      'stores.pricing',
      'stores.wallet',
      'stores.reports',
    ];
    const everything = permissionsForScopes(ALL_SELLER_API_KEY_SCOPES);
    for (const key of forbidden) expect(everything).not.toContain(key);
  });

  it('is a union, deduped, and never wider than what was asked for', () => {
    expect(permissionsForScopes(['orders:read'])).toEqual(['orders.view']);
    expect(permissionsForScopes(['orders:read', 'orders:read'])).toEqual(['orders.view']);
    const both = permissionsForScopes(['catalog:read', 'catalog:write']);
    expect(both).toEqual(expect.arrayContaining(['catalog.view', 'catalog.manage']));
    expect(both).toHaveLength(3);
  });

  it('drops a scope it does not recognise rather than widening', () => {
    // A scope retired in a later release leaves rows naming it. The safe
    // reading of a name we no longer understand is that it grants
    // nothing.
    expect(permissionsForScopes(['orders:read', 'orders:everything'])).toEqual(['orders.view']);
    expect(permissionsForScopes(['nonsense'])).toEqual([]);
  });

  /**
   * The seller console draws a box per scope, so the vocabulary exists
   * twice — here, and as labels in `@skydrop/api-client`. Compared as
   * WHOLE SETS in both directions, the way the wallet-direction check
   * is: asserting that one value appears in both files passes while the
   * two disagree about any other (WAL-1's lesson, which cost a credit
   * being drawn as a debit).
   *
   * A scope the client offers and the server does not know is a box that
   * fails on submit; one the server has and the client does not is a
   * capability nobody can ever grant — invisible, and identical to never
   * having built it.
   */
  it('the client\u2019s picker offers exactly the scopes the server knows', () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'api-client',
        'src',
        'endpoints',
        'seller-api-keys.ts',
      ),
      'utf8',
    );
    const offered = [...src.matchAll(/key: '([a-z]+:[a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(offered)).toEqual(new Set(ALL_SELLER_API_KEY_SCOPES));
    expect(offered).toHaveLength(ALL_SELLER_API_KEY_SCOPES.length);
  });

  /**
   * The regression that would cost the most and show the least: somebody
   * restoring the blanket grant. It reads as a one-line simplification
   * and hands a pasted credential the power to move money.
   */
  it('the guard does not grant the whole catalogue — a source scan', () => {
    const src = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'common', 'guards', 'api-key.guard.ts'),
      'utf8',
    );
    // Comments explain the history and name it; strip them before
    // looking, or the prose passes for the code (the lesson from the
    // `@SellerRoles` spec that asserted on a docblock).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('ALL_SELLER_PERMISSION_KEYS');
    expect(code).toContain('permissionsForScopes');
  });
});

describe('ApiKeyGuard — what a key may reach', () => {
  const KEY = 'skd_abcdefghijklmnopqrstuvwxyz';

  /**
   * The CODE, not the prose. FE-2 surfaces `[CODE] message` verbatim and
   * the code is what a caller branches on, so that is what a spec should
   * hold still — a message is free to be reworded.
   */
  async function refusalCode(run: Promise<unknown>): Promise<string> {
    try {
      await run;
    } catch (e) {
      const body = (e as ForbiddenException).getResponse();
      return typeof body === 'object' && body !== null && 'code' in body
        ? String((body as { code: unknown }).code)
        : 'NO_CODE';
    }
    return 'NO_REFUSAL';
  }

  function makeGuard(opts: {
    scopes: string[];
    required?: readonly string[];
    selfService?: boolean;
  }) {
    const audit = { log: jest.fn(async () => undefined) };
    const prisma = {
      client: {
        sellerApiKey: {
          findUnique: jest.fn(async () => ({
            id: 'key-1',
            sellerId: 'sel-1',
            keyPrefix: 'skd_abcdefgh',
            expiresAt: null,
            revokedAt: null,
            deletedAt: null,
            scopes: opts.scopes,
            seller: { id: 'sel-1', status: 'APPROVED', deletedAt: null },
          })),
          update: jest.fn(() => ({ catch: () => undefined })),
        },
      },
    };
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === SELLER_SELF_SERVICE_KEY) return opts.selfService === true;
        if (key === REQUIRE_SELLER_PERMISSIONS_KEY) return opts.required;
        return undefined;
      }),
    };
    const guard = new ApiKeyGuard(
      prisma as never,
      { sha256Hex: () => 'hash' } as never,
      audit as never,
      reflector as never,
    );
    const req: Record<string, unknown> = {
      url: '/seller/orders',
      method: 'GET',
      ip: '1.2.3.4',
      header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${KEY}` : undefined),
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    };
    return { guard, ctx: ctx as never, req, audit };
  }

  it('admits a key whose scopes cover the endpoint, with exactly those permissions', async () => {
    const { guard, ctx, req } = makeGuard({ scopes: ['orders:read'], required: ['orders.view'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req['seller'] as { permissions: string[] }).permissions).toEqual(['orders.view']);
  });

  it('refuses a key whose scopes do NOT cover the endpoint', async () => {
    const { guard, ctx, audit } = makeGuard({
      scopes: ['orders:read'],
      required: ['catalog.manage'],
    });
    await expect(refusalCode(guard.canActivate(ctx))).resolves.toBe('INSUFFICIENT_PERMISSION');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seller.api_key.access_denied_permission' }),
    );
  });

  it('refuses an endpoint that declares nothing — fail-closed, as RBAC-1 says', async () => {
    // The hole this closes: the guard returned true the moment the key
    // checked out, so a handler's declaration was enforced for a browser
    // session and ignored for an API key.
    const { guard, ctx } = makeGuard({ scopes: ['orders:read'] });
    await expect(refusalCode(guard.canActivate(ctx))).resolves.toBe('ENDPOINT_NOT_AUTHORIZED');
  });

  it('refuses a key with no scopes BY NAME, so the answer is “mint a new one”', async () => {
    const { guard, ctx } = makeGuard({ scopes: [], required: ['orders.view'] });
    await expect(refusalCode(guard.canActivate(ctx))).resolves.toBe('API_KEY_NO_SCOPES');
  });

  it('a key whose every scope has been retired is the same refusal, not a wider grant', async () => {
    const { guard, ctx } = makeGuard({ scopes: ['orders:everything'], required: ['orders.view'] });
    await expect(refusalCode(guard.canActivate(ctx))).resolves.toBe('API_KEY_NO_SCOPES');
  });

  it('self-service still short-circuits the permission gate, as it does for a session', async () => {
    const { guard, ctx } = makeGuard({ scopes: ['orders:read'], selfService: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
