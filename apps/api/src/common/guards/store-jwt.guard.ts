import {
  CanActivate,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType, ResellerStoreStatus, SellerStatus, SellerStoreKind } from '@skydrop/db';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth-common/services/jwt.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALL_STORE_PERMISSION_KEYS, type StorePermissionKey } from '../auth/store-permissions';
import {
  REQUIRE_STORE_PERMISSIONS_KEY,
  STORE_SELF_SERVICE_KEY,
} from '../auth/require-store-permissions.decorator';
import { resolveRoles, roleNamesFor } from '../auth/role-union';
import {
  currentImpersonation,
  type ImpersonationContext,
} from '../impersonation/impersonation-context';

/** Every role this person holds, oldest grant first — see the staff guard. */
const STORE_ROLE_ASSIGNMENTS = {
  orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
  select: {
    role: {
      select: {
        key: true,
        name: true,
        isOwner: true,
        deletedAt: true,
        permissions: { select: { permission: true } },
      },
    },
  },
};

/**
 * Whether a reseller store may be used by its own team right now.
 *
 * ACTIVE and PAUSED — PAUSED blocks NEW orders (RS-1), not the portal.
 * PENDING_SELLER_APPROVAL has not been agreed to by the seller, and
 * REJECTED / CLOSED are terminal. The seller behind it must be APPROVED:
 * a store resells that seller's stock, so a suspended seller stops it.
 *
 * Exported because sign-in, the cookie /me and this guard must agree,
 * and three copies of "which statuses may sign in" is how they come not
 * to.
 */
export function storeMayBeUsed(input: {
  readonly kind: SellerStoreKind;
  readonly status: ResellerStoreStatus | null;
  readonly deletedAt: Date | null;
  readonly sellerStatus: SellerStatus;
  readonly sellerDeletedAt: Date | null;
}): boolean {
  if (input.kind !== SellerStoreKind.RESELLER) return false;
  if (input.deletedAt !== null || input.sellerDeletedAt !== null) return false;
  if (input.sellerStatus !== SellerStatus.APPROVED) return false;
  switch (input.status) {
    case ResellerStoreStatus.ACTIVE:
    case ResellerStoreStatus.PAUSED:
      return true;
    case ResellerStoreStatus.PENDING_SELLER_APPROVAL:
    case ResellerStoreStatus.CLOSED:
    case ResellerStoreStatus.REJECTED:
    case null:
      return false;
  }
}

/**
 * Bearer-token auth for reseller store routes (RS-2).
 *
 * The seller guard's twin for the third identity:
 *   - the token must carry the `skydrop-store` audience, so a seller or
 *     staff token is refused at the signature check;
 *   - the store user, their role and their store are re-read on EVERY
 *     request, so a removed member, a closed store or a suspended seller
 *     takes effect on the next call rather than when the token expires;
 *   - the permission gate FAILS CLOSED on reads and writes alike: an
 *     endpoint that declares neither `@RequireStorePermissions` nor
 *     `@StoreSelfService` is refused (`store-permission-surface.spec.ts`
 *     fails the build first).
 *
 * `req.storeUser.storeId` is what every store endpoint then scopes by, in
 * the WHERE clause. The token's own `storeId` claim is not trusted for
 * that: the store is read off the user row.
 *
 * IMPERSONATION (support sessions): the seller guard's arrangement,
 * exactly. When a support session's context is open, the only extra
 * question this guard answers is WHICH StoreUser the request is about;
 * everything after — the store's usability, the seller behind it, the
 * roles, the permission gate — is the same code over the SUBJECT STORE's
 * own roles. The staff member's permissions are never loaded here to be
 * unioned with or to override them: `support.impersonate` buys the
 * session, not a wider account.
 */
@Injectable()
export class StoreJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req.header('authorization'));

    // ── A SUPPORT SESSION, which short-circuits the bearer token ─────
    // Checked first and exclusively: one request carries one identity,
    // and a header that could win over the session cookie would mean two.
    // `jti` is the ACCESS token's id, which a support session has no
    // equivalent of — it is attribution, not authority, and the session
    // it belongs to is the impersonation row instead.
    const impersonation = currentImpersonation();
    let claims: { sub: string; jti: string | null };
    if (impersonation !== null) {
      claims = { sub: await this.impersonatedStoreUserId(impersonation), jti: null };
    } else {
      if (token === null) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });
      }
      claims = this.jwt.verifyStoreAccess(token);
    }

    // Everything below is shared by both paths, so a second way in cannot
    // skip the store's status, the seller behind it, or the RBAC gate.
    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        roles: STORE_ROLE_ASSIGNMENTS,
        store: {
          select: {
            id: true,
            kind: true,
            status: true,
            deletedAt: true,
            sellerId: true,
            seller: { select: { status: true, deletedAt: true } },
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Store session no longer valid',
      });
    }
    // Every role gone is nobody to be — the staff guard's answer, asked
    // of the union.
    const resolved = resolveRoles(user.roles, ALL_STORE_PERMISSION_KEYS);
    if (resolved.roles.length === 0) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Store session no longer valid',
      });
    }

    const store = user.store;
    const usable = storeMayBeUsed({
      kind: store.kind,
      status: store.status,
      deletedAt: store.deletedAt,
      sellerStatus: store.seller.status,
      sellerDeletedAt: store.seller.deletedAt,
    });
    if (!usable) {
      // Audit first so the event survives even if response delivery fails.
      await this.audit.log({
        actorType: ActorType.STORE,
        actorId: user.id,
        sellerId: store.sellerId,
        action: 'store.access_denied_status',
        entityType: 'seller_store',
        entityId: store.id,
        metadata: {
          status: store.status,
          sellerStatus: store.seller.status,
          path: req.url,
          method: req.method,
          ipAddress: req.ip ?? null,
        },
        severity: 'MEDIUM',
      });
      throw new ForbiddenException({
        code: 'STORE_NOT_ACTIVE',
        message: 'This store is not open. Contact the seller you resell for.',
      });
    }

    // The UNION of every role held; an OWNER role among them grants the
    // whole catalogue (see `role-union.ts`).
    const held: readonly string[] = resolved.permissions;

    const selfService =
      this.reflector.getAllAndOverride<boolean>(STORE_SELF_SERVICE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true;

    if (!selfService) {
      const required = this.reflector.getAllAndOverride<readonly StorePermissionKey[] | undefined>(
        REQUIRE_STORE_PERMISSIONS_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      if (required === undefined || required.length === 0) {
        throw new ForbiddenException({
          code: 'ENDPOINT_NOT_AUTHORIZED',
          message:
            'This endpoint declares no permission and is refused by default. ' +
            'Add @RequireStorePermissions(...) or @StoreSelfService() to it.',
        });
      }
      if (!required.some((perm) => held.includes(perm))) {
        await this.audit.log({
          actorType: ActorType.STORE,
          actorId: user.id,
          sellerId: store.sellerId,
          action: 'store.access_denied_permission',
          entityType: 'store_user',
          entityId: user.id,
          metadata: {
            storeId: store.id,
            roles: resolved.roles.map((r) => r.key),
            required: [...required],
            path: req.url,
            method: req.method,
          },
          severity: 'LOW',
        });
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSION',
          message: `${roleNamesFor(resolved.roles)} does not hold: ${required.join(' or ')}`,
        });
      }
    }

    req.storeUser = {
      id: user.id,
      storeId: store.id,
      sellerId: store.sellerId,
      email: user.email,
      fullName: user.fullName,
      emailVerifiedAt: user.emailVerifiedAt,
      jti: claims.jti,
      roleKey: resolved.primary?.key ?? '',
      roleName: resolved.primary?.name ?? '',
      roleKeys: resolved.roles.map((r) => r.key),
      roleNames: resolved.roles.map((r) => r.name),
      permissions: held,
    };
    return true;
  }

  /**
   * Which StoreUser a support session acts as.
   *
   * ── WHY A USER AT ALL, WHEN THE SESSION NAMES A STORE ───────────────
   * `impersonation_sessions` records the STORE, because a store is what
   * support is asked to look at. Permissions, though, hang off a USER's
   * roles — so "what this store can do" has to resolve to somebody's
   * actual grants, or it becomes a second authorisation model with its
   * own bugs and its own blind spots. The store's OWNER user is that
   * somebody: the one whose answer to "may I?" is the store's answer and
   * not one member's narrower view of it.
   *
   * Refuses rather than falling back to any other member when there is no
   * owner. A store support cannot enter is a ticket somebody fixes; a
   * store support entered as the wrong person is an audit trail nobody
   * can read straight afterwards.
   *
   * Only the ID is returned, on purpose: the store's status, the seller
   * behind it and the permission gate are then applied by the SAME code
   * the ordinary path runs.
   */
  private async impersonatedStoreUserId(ctx: ImpersonationContext): Promise<string> {
    if (ctx.subject.kind !== 'STORE') {
      throw new ForbiddenException({
        code: 'IMPERSONATION_WRONG_SUBJECT',
        message: 'This support session is inside a seller account, not a store.',
      });
    }
    const owner = await this.prisma.client.storeUser.findFirst({
      where: {
        storeId: ctx.subject.id,
        deletedAt: null,
        roles: { some: { role: { isOwner: true, deletedAt: null } } },
      },
      // Oldest first, so the session resolves to the same person on every
      // request even where a store has more than one owner.
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (owner === null) {
      throw new UnauthorizedException({
        code: 'IMPERSONATION_SUBJECT_UNAVAILABLE',
        message: 'This store has no owner account to act as, so the session cannot be used.',
      });
    }
    return owner.id;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
