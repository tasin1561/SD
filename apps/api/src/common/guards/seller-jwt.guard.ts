import {
  CanActivate,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType, SellerStatus, SellerUserRole } from '@skydrop/db';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth-common/services/jwt.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SELLER_AUTH_ALLOW_SUSPENDED_KEY } from '../decorators/seller-auth-allow-suspended.decorator';
import { SELLER_ROLES_KEY } from '../decorators/seller-roles.decorator';

/** Methods that only READ. VIEWER is documented as "read-only access to
 *  everything visible to the company", so these are open to every role
 *  unless an endpoint narrows them explicitly. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Default allow-list for MUTATING methods when an endpoint declares no
 *  `@SellerRoles`. Deliberately the narrowest useful set — see the
 *  fail-closed note on the decorator. */
const DEFAULT_WRITE_ROLES: readonly SellerUserRole[] = [
  SellerUserRole.OWNER,
  SellerUserRole.ADMIN,
];

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
 *      declaration — open to every role. VIEWER is defined as
 *      "read-only access to everything visible to the company".
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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req.header('authorization'));
    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Bearer token required' });
    }

    const claims = this.jwt.verifySellerAccess(token);

    // Phase 1B RBAC — token.sub is the SellerUser id; join Seller for status.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        emailVerifiedAt: true,
        seller: {
          select: { id: true, email: true, status: true, deletedAt: true },
        },
      },
    });
    if (!user || user.seller.deletedAt !== null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Seller session no longer valid' });
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

    // ── RBAC: role gate (see the policy note in the class doc).
    const handlerRoles = this.reflector.get<SellerUserRole[] | undefined>(
      SELLER_ROLES_KEY,
      ctx.getHandler(),
    );
    const classRoles = this.reflector.get<SellerUserRole[] | undefined>(
      SELLER_ROLES_KEY,
      ctx.getClass(),
    );
    const isRead = SAFE_METHODS.has(req.method.toUpperCase());

    // A HANDLER-level declaration is absolute — it applies to reads and
    // writes alike, so a specific endpoint can always be locked down.
    // A CLASS-level declaration is the domain's WRITE allow-list only;
    // reads stay open to every company role, because VIEWER is defined
    // as "read-only access to everything visible to the company". A
    // domain controller therefore does NOT accidentally lock VIEWER out
    // of its GETs just by declaring who may mutate.
    const allowedRoles =
      handlerRoles ?? (isRead ? null : (classRoles ?? DEFAULT_WRITE_ROLES));

    if (allowedRoles !== null && !allowedRoles.includes(user.role)) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        actorId: user.id,
        action: 'seller.access_denied_role',
        entityType: 'seller_user',
        entityId: user.id,
        metadata: {
          role: user.role,
          allowedRoles: [...allowedRoles],
          path: req.url,
          method: req.method,
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        },
        severity: 'LOW',
      });
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `Role ${user.role} not permitted; required one of: ${allowedRoles.join(', ')}`,
      });
    }

    req.seller = {
      id: seller.id,
      email: seller.email,
      status: seller.status,
      emailVerifiedAt: user.emailVerifiedAt,
      jti: claims.jti,
      userId: user.id,
      role: user.role,
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
