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

/**
 * Bearer-token auth for seller routes. Crucially, this guard re-checks
 * sellers.status on every request — if a seller is suspended mid-session,
 * the next request after suspension fails with 403 + audit
 * "seller.access_denied_status". One DB lookup per guarded request is the
 * Phase-1A cost; cache in Redis later if it becomes noticeable.
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

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, email: true, status: true, emailVerifiedAt: true },
    });
    if (!seller) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Seller session no longer valid' });
    }

    // Status recheck — only APPROVED sellers can access guarded endpoints.
    if (seller.status !== SellerStatus.APPROVED) {
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
      emailVerifiedAt: seller.emailVerifiedAt,
      jti: claims.jti,
    };
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
