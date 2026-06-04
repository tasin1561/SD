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
