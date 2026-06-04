import {
  CanActivate,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType, SellerStatus } from '@skydrop/db';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenHashService } from '../../modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SELLER_AUTH_ALLOW_SUSPENDED_KEY } from '../decorators/seller-auth-allow-suspended.decorator';

/**
 * Programmatic seller authentication via `Authorization: Bearer skd_*`.
 *
 *   - Validates the key hash against seller_api_keys.
 *   - Rejects expired / revoked keys.
 *   - Default behavior: rejects keys belonging to non-APPROVED sellers.
 *     Read-only B2B endpoints can opt in via @SellerAuthAllowSuspended()
 *     to let SUSPENDED sellers continue reading their data via API key.
 *     PENDING/REJECTED are always rejected.
 *   - Audit-logs invalid attempts so a brute-force scan is visible.
 *   - Updates seller_api_keys.lastUsedAt asynchronously — the HTTP path
 *     never waits on this write.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: TokenHashService,
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
    const presented = extractApiKey(req.header('authorization'));
    if (!presented) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'API key required' });
    }

    const keyHash = this.hashes.sha256Hex(presented);

    const row = await this.prisma.client.sellerApiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        sellerId: true,
        keyPrefix: true,
        expiresAt: true,
        revokedAt: true,
        deletedAt: true,
        seller: { select: { id: true, status: true, deletedAt: true } },
      },
    });

    if (!row || row.deletedAt !== null) {
      await this.auditInvalid('not_found', presented.slice(0, 12), req);
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    if (row.revokedAt !== null) {
      await this.auditInvalid('revoked', row.keyPrefix, req, row.sellerId);
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      await this.auditInvalid('expired', row.keyPrefix, req, row.sellerId);
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    if (!row.seller || row.seller.deletedAt !== null) {
      await this.auditInvalid('seller_deleted', row.keyPrefix, req, row.sellerId);
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }

    const allowSuspended =
      this.reflector.getAllAndOverride<boolean>(SELLER_AUTH_ALLOW_SUSPENDED_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true;
    const statusOk =
      row.seller.status === SellerStatus.APPROVED ||
      (allowSuspended && row.seller.status === SellerStatus.SUSPENDED);

    if (!statusOk) {
      await this.audit.log({
        actorType: ActorType.API,
        actorId: row.id,
        sellerId: row.sellerId,
        action: 'seller.api_key.access_denied_status',
        entityType: 'seller_api_key',
        entityId: row.id,
        metadata: {
          status: row.seller.status,
          keyPrefix: row.keyPrefix,
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

    req.apiKey = { id: row.id, sellerId: row.sellerId, keyPrefix: row.keyPrefix };
    req.seller = {
      id: row.sellerId,
      email: '', // not loaded for API-key auth; controllers that need it should query
      status: row.seller.status,
      emailVerifiedAt: null,
      jti: row.id, // surface the api-key id as the "jti" for downstream audits
      // API-key auth doesn't have a person — synthesise an ADMIN-equivalent
      // attribution. Endpoints that want fine-grained per-person attribution
      // should use bearer-token auth instead.
      userId: row.id,
      role: 'ADMIN',
      fullName: 'API Key',
    };

    // Fire-and-forget lastUsedAt update — don't block the request on this.
    this.prisma.client.sellerApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((err) => this.logger.warn({ err: err?.message }, 'failed to update api_key.lastUsedAt'));

    return true;
  }

  private async auditInvalid(
    reason: string,
    keyPrefix: string,
    req: Request,
    sellerId: string | null = null,
  ): Promise<void> {
    await this.audit.log({
      actorType: ActorType.API,
      ...(sellerId ? { sellerId } : {}),
      action: 'security.api_key.invalid',
      entityType: 'seller_api_key',
      entityId: null,
      metadata: {
        reason,
        keyPrefix,
        path: req.url,
        method: req.method,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
      severity: 'LOW',
    });
  }
}

function extractApiKey(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(skd_[A-Za-z0-9_-]{20,})$/.exec(header);
  return match?.[1]?.trim() ?? null;
}
