import {
  CanActivate,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../modules/auth-common/services/audit-log.service';
import { TokenHashService } from '../../modules/auth-common/services/token-hash.service';
import { storeMayBeUsed } from './store-jwt.guard';

/** A store key's visible prefix. Distinct from a seller key's `skd_`. */
export const STORE_API_KEY_PREFIX = 'sks_';

/**
 * Programmatic reseller-store authentication — `Authorization: Bearer sks_…`
 * (RS-5). The seller `ApiKeyGuard`'s twin for the third identity:
 *
 *   - the key is looked up by its SHA-256 hash (the plaintext is never
 *     stored); an unknown, revoked, expired or deleted key is one generic
 *     401, audited so a scan is visible;
 *   - the store behind it must be usable RIGHT NOW (`storeMayBeUsed` —
 *     the SAME rule sign-in and `StoreJwtGuard` use: RESELLER,
 *     ACTIVE/PAUSED, under an APPROVED seller), so closing a store or
 *     suspending its seller stops its integration on the next call;
 *   - `req.storeApiKey.storeId` is what every handler scopes by, in the
 *     WHERE clause. A store key cannot name another store, and it never
 *     reaches anything the seller owns.
 *
 * `lastUsedAt` is updated fire-and-forget: the request never waits on it.
 */
@Injectable()
export class StoreApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(StoreApiKeyGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const presented = extractStoreApiKey(req.header('authorization'));
    if (presented === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Store API key required' });
    }
    const row = await this.prisma.client.storeApiKey.findUnique({
      where: { keyHash: this.hashes.sha256Hex(presented) },
      select: {
        id: true,
        storeId: true,
        sellerId: true,
        keyPrefix: true,
        expiresAt: true,
        revokedAt: true,
        deletedAt: true,
        store: {
          select: {
            kind: true,
            status: true,
            deletedAt: true,
            seller: { select: { status: true, deletedAt: true } },
          },
        },
      },
    });
    const invalid =
      row === null
        ? 'not_found'
        : row.deletedAt !== null
          ? 'deleted'
          : row.revokedAt !== null
            ? 'revoked'
            : row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()
              ? 'expired'
              : null;
    if (row === null || invalid !== null) {
      await this.audit.log({
        actorType: ActorType.API,
        ...(row === null ? {} : { sellerId: row.sellerId }),
        action: 'security.store_api_key.invalid',
        entityType: 'store_api_key',
        entityId: null,
        metadata: {
          reason: invalid,
          keyPrefix: row?.keyPrefix ?? presented.slice(0, 12),
          path: req.url,
          method: req.method,
          ipAddress: req.ip ?? null,
        },
        severity: 'LOW',
      });
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    const usable = storeMayBeUsed({
      kind: row.store.kind,
      status: row.store.status,
      deletedAt: row.store.deletedAt,
      sellerStatus: row.store.seller.status,
      sellerDeletedAt: row.store.seller.deletedAt,
    });
    if (!usable) {
      await this.audit.log({
        actorType: ActorType.API,
        actorId: row.id,
        sellerId: row.sellerId,
        action: 'store.api_key.access_denied_status',
        entityType: 'seller_store',
        entityId: row.storeId,
        metadata: { status: row.store.status, path: req.url, method: req.method },
        severity: 'MEDIUM',
      });
      throw new ForbiddenException({
        code: 'STORE_NOT_ACTIVE',
        message: 'This store is not open. Contact the seller you resell for.',
      });
    }

    req.storeApiKey = {
      id: row.id,
      storeId: row.storeId,
      sellerId: row.sellerId,
      keyPrefix: row.keyPrefix,
    };
    this.prisma.client.storeApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) =>
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to update store_api_keys.lastUsedAt',
        ),
      );
    return true;
  }
}

function extractStoreApiKey(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(sks_[A-Za-z0-9_-]{20,})$/.exec(header);
  return match?.[1]?.trim() ?? null;
}
