import { ALLOW_COOKIE_AUTH_KEY } from '../decorators/allow-cookie-auth.decorator';
import { SELLER_REFRESH_COOKIE } from '../cookies/auth-cookies';
import { RefreshTokenService } from '../../modules/auth-common/services/refresh-token.service';
import {
  CanActivate,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType, SellerStatus } from '@skydrop/db';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth-common/services/jwt.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SELLER_AUTH_ALLOW_SUSPENDED_KEY } from '../decorators/seller-auth-allow-suspended.decorator';
import { ALL_SELLER_PERMISSION_KEYS, type SellerPermissionKey } from '../auth/seller-permissions';
import {
  REQUIRE_SELLER_PERMISSIONS_KEY,
  SELLER_SELF_SERVICE_KEY,
} from '../auth/require-seller-permissions.decorator';

/**
 * Bearer-token auth for seller routes. Crucially, this guard re-checks
 * sellers.status on every request — if a seller is suspended mid-session,
 * the next request after suspension fails with 403 + audit
 * "seller.access_denied_status". One DB lookup per guarded request is the
 * Phase-1A cost; cache in Redis later if it becomes noticeable.
 *
 * Routes decorated with @SellerAuthAllowSuspended() additionally accept
 * SUSPENDED sellers (read-only endpoints — profile view, addresses list,
 * notification preferences view). PENDING/REJECTED are always rejected.
 *
 * RBAC (Phase 1B seller-team roles): this guard is also where
 * SellerUserRole is enforced, because doing it per-controller left ~110
 * endpoints ungated — a VIEWER could call every seller write endpoint.
 * Policy, in precedence order:
 *   1. `@SellerRoles(...)` on the HANDLER — absolute, applies to reads
 *      and writes alike (use it to lock down one specific endpoint, or
 *      to open a self-service POST to every role).
 *   2. Read-only methods (GET/HEAD/OPTIONS) with no handler-level
 *      declaration — open to every role EXCEPT VIEWER. VIEWER's reads
 *      are an allow-list: the controller opts in with
 *      `@SellerViewerReadable()`, and anything unmarked is closed.
 *   3. `@SellerRoles(...)` on the CLASS — the domain's WRITE allow-list
 *      (e.g. catalog controllers add INVENTORY, order controllers add
 *      OPS). Declaring it does NOT restrict that controller's GETs.
 *   4. Nothing declared, mutating method — OWNER + ADMIN only.
 * Rule 4 is deliberately FAIL-CLOSED: an endpoint that forgets the
 * decorator is over-restrictive, never accidentally open. Widening is
 * always the explicit act.
 */
@Injectable()
export class SellerJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly reflector: Reflector,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req.header('authorization'));

    // ── NO BEARER: a browser NAVIGATION, not a fetch ─────────────────
    // The access token lives in JS memory (FE-1) and the ApiClient
    // sends it as a header, which a plain <a href> cannot do. A route
    // that opts in with @AllowCookieAuth may fall back to the refresh
    // cookie — validated READ-ONLY, never rotated (FE-4), because
    // rotating here would race the client's silent refresh and burn a
    // legitimate session.
    let subjectId: string;
    if (token === null) {
      const allowsCookie = this.reflector.getAllAndOverride<boolean>(ALLOW_COOKIE_AUTH_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      const cookie = allowsCookie === true ? readSellerRefreshCookie(req) : null;
      if (cookie === null) {
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'Bearer token required',
        });
      }
      const validated = await this.refreshTokens.validateByPlaintext('seller', cookie);
      if (validated === null) {
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
        });
      }
      subjectId = validated.userId;
    } else {
      subjectId = this.jwt.verifySellerAccess(token).sub;
    }

    // Everything below is unchanged and shared by both paths: the
    // suspended-seller check, the status gate and the RBAC policy live
    // here precisely so a second way in cannot skip them.
    // `jti` identifies the ACCESS token, which the cookie path does not
    // have — null there, and the session it belongs to is the refresh
    // row instead. Nothing downstream requires it to be present.
    const claims: { sub: string; jti: string | null } =
      token === null
        ? { sub: subjectId, jti: null }
        : { sub: subjectId, jti: this.jwt.verifySellerAccess(token).jti };

    // Phase 1B RBAC — token.sub is the SellerUser id; join Seller for status.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        emailVerifiedAt: true,
        sellerRole: {
          select: {
            key: true,
            name: true,
            isOwner: true,
            deletedAt: true,
            permissions: { select: { permission: true } },
          },
        },
        seller: {
          select: { id: true, email: true, status: true, deletedAt: true },
        },
      },
    });
    // A soft-deleted role is not a role: somebody whose role was removed
    // under them has nothing to reason about permission-wise, and
    // leaving them with a live session and an empty grant set is a worse
    // state than asking them to sign in again.
    if (!user || user.seller.deletedAt !== null || user.sellerRole.deletedAt !== null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Seller session no longer valid',
      });
    }
    const seller = user.seller;

    const allowSuspended =
      this.reflector.getAllAndOverride<boolean>(SELLER_AUTH_ALLOW_SUSPENDED_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true;

    // Status recheck. APPROVED always passes. SUSPENDED passes only when
    // the route opts in via @SellerAuthAllowSuspended(). PENDING/REJECTED
    // never pass — those statuses are unused in Phase 1A but the enum
    // exists, so this is a defensive guardrail.
    const statusOk =
      seller.status === SellerStatus.APPROVED ||
      (allowSuspended && seller.status === SellerStatus.SUSPENDED);

    if (!statusOk) {
      // Audit first so the event survives even if response delivery fails.
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        action: 'seller.access_denied_status',
        entityType: 'seller',
        entityId: seller.id,
        metadata: {
          status: seller.status,
          path: req.url,
          method: req.method,
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        },
        severity: 'MEDIUM',
      });
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: 'Account not active. Contact support.',
      });
    }

    // ── RBAC: permission gate ────────────────────────────────────
    // The role gate this replaces was fail-closed on WRITES only —
    // reads stayed open to five of the six roles, so "may not change
    // the wallet" and "may not see the wallet" could not be told apart.
    // Both are closed by default now, and an endpoint that declares
    // nothing is refused rather than allowed.
    const held: readonly string[] = user.sellerRole.isOwner
      ? ALL_SELLER_PERMISSION_KEYS
      : user.sellerRole.permissions.map((p) => p.permission);

    const selfService =
      this.reflector.getAllAndOverride<boolean>(SELLER_SELF_SERVICE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true;

    if (!selfService) {
      const required = this.reflector.getAllAndOverride<readonly SellerPermissionKey[] | undefined>(
        REQUIRE_SELLER_PERMISSIONS_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );

      if (required === undefined || required.length === 0) {
        throw new ForbiddenException({
          code: 'ENDPOINT_NOT_AUTHORIZED',
          message:
            'This endpoint declares no permission and is refused by default. ' +
            'Add @RequireSellerPermissions(...) or @SellerSelfService() to it.',
        });
      }

      if (!required.some((perm) => held.includes(perm))) {
        await this.audit.log({
          actorType: ActorType.SELLER,
          sellerId: seller.id,
          actorId: user.id,
          action: 'seller.access_denied_permission',
          entityType: 'seller_user',
          entityId: user.id,
          metadata: {
            role: user.sellerRole.key,
            required: [...required],
            path: req.url,
            method: req.method,
            ipAddress: req.ip ?? null,
            userAgent: req.header('user-agent') ?? null,
          },
          severity: 'LOW',
        });
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSION',
          message: `${user.sellerRole.name} does not hold: ${required.join(' or ')}`,
        });
      }
    }

    req.seller = {
      id: seller.id,
      email: seller.email,
      status: seller.status,
      emailVerifiedAt: user.emailVerifiedAt,
      jti: claims.jti,
      userId: user.id,
      role: user.role,
      roleKey: user.sellerRole.key,
      roleName: user.sellerRole.name,
      permissions: held,
      fullName: user.fullName,
    };
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

/** The refresh cookie, when a browser NAVIGATION sent one. */
function readSellerRefreshCookie(req: Request): string | null {
  const jar = (req as unknown as { cookies?: Record<string, unknown> }).cookies ?? {};
  const raw = jar[SELLER_REFRESH_COOKIE];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
