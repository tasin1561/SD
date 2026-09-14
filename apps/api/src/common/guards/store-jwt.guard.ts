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
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });
    }
    const claims = this.jwt.verifyStoreAccess(token);

    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        role: {
          select: {
            key: true,
            name: true,
            isOwner: true,
            deletedAt: true,
            permissions: { select: { permission: true } },
          },
        },
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
    if (!user || user.role.deletedAt !== null) {
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

    const held: readonly string[] = user.role.isOwner
      ? ALL_STORE_PERMISSION_KEYS
      : user.role.permissions.map((p) => p.permission);

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
            role: user.role.key,
            required: [...required],
            path: req.url,
            method: req.method,
          },
          severity: 'LOW',
        });
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSION',
          message: `${user.role.name} does not hold: ${required.join(' or ')}`,
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
      roleKey: user.role.key,
      roleName: user.role.name,
      permissions: held,
    };
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
