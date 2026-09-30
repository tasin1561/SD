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
import type { SellerPermissionKey } from '../auth/seller-permissions';
import { permissionsForScopes } from '../auth/seller-api-key-scopes';
import {
  ENDPOINT_NOT_AUTHORIZED_MESSAGE,
  sellerAuthorizationVerdict,
} from '../auth/seller-authorization';
import {
  REQUIRE_SELLER_PERMISSIONS_KEY,
  SELLER_SELF_SERVICE_KEY,
} from '../auth/require-seller-permissions.decorator';

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
 *
 * ── WHAT A KEY MAY REACH, AND WHO DECIDES ────────────────────────────
 * Its SCOPES, chosen when the key was minted and stored on the row
 * (`seller-api-key-scopes.ts` is the one place a scope becomes
 * permissions). Before that this guard synthesised the built-in Admin
 * role — every seller permission bar `roles.manage` — for every key, so
 * a credential a seller pastes into third-party software could have
 * requested a withdrawal, changed the bank account it is paid into,
 * invited a colleague and minted more keys.
 *
 * A key whose scopes resolve to NOTHING is refused here, by name, rather
 * than left to 403 on each endpoint in turn: that is a key issued before
 * scopes existed, or one whose every scope has since been retired, and
 * the answer to both is to mint a new one.
 *
 * ── AND IT AUTHORISES, NOT ONLY AUTHENTICATES ────────────────────────
 * The endpoint's `@RequireSellerPermissions` / `@SellerSelfService` is
 * enforced HERE, through the same `sellerAuthorizationVerdict` that
 * `SellerJwtGuard` reads. It previously returned true the moment the key
 * checked out, so the handler's declaration was enforced for a browser
 * session and ignored for an API key — the RBAC-1 fail-closed rule with
 * a second door cut into it. Nothing surfaced because nothing was wired:
 * no controller carries `@UseGuards(ApiKeyGuard)` yet, which is exactly
 * why both halves are fixed before one does.
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
        scopes: true,
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

    // What this key may do, derived from its own scopes and nothing else.
    const held = permissionsForScopes(row.scopes);
    if (held.length === 0) {
      await this.auditInvalid('no_scopes', row.keyPrefix, req, row.sellerId);
      throw new ForbiddenException({
        code: 'API_KEY_NO_SCOPES',
        message:
          'This API key grants nothing. It was created before scopes existed, or its scopes ' +
          'are no longer recognised. Create a new key and choose what it may reach.',
      });
    }

    await this.assertPermitted(ctx, req, row, held);

    req.apiKey = { id: row.id, sellerId: row.sellerId, keyPrefix: row.keyPrefix };
    req.seller = {
      id: row.sellerId,
      email: '', // not loaded for API-key auth; controllers that need it should query
      status: row.seller.status,
      emailVerifiedAt: null,
      jti: row.id, // surface the api-key id as the "jti" for downstream audits
      // API-key auth doesn't have a person — `role` and `fullName` are a
      // synthetic attribution, kept so downstream audit rows read
      // sensibly. Endpoints that want per-person attribution should use
      // bearer-token auth instead.
      //
      // `role: 'ADMIN'` is a legacy enum field and grants NOTHING: the
      // permission set below is the only thing anything reads, and it
      // comes from the key's scopes.
      roleKey: 'api_key',
      roleName: 'API key',
      permissions: held,
      userId: row.id,
      role: 'ADMIN',
      fullName: 'API Key',
    };

    // Fire-and-forget lastUsedAt update — don't block the request on this.
    this.prisma.client.sellerApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((err) =>
        this.logger.warn({ err: err?.message }, 'failed to update api_key.lastUsedAt'),
      );

    return true;
  }

  /**
   * The endpoint's own declaration, through the SHARED verdict — so an
   * API key and a browser session cannot be admitted to different
   * places. Refusal is audited as the KEY (`ActorType.API`, the key's
   * id), never as a person, because no person made this request.
   */
  private async assertPermitted(
    ctx: ExecutionContext,
    req: Request,
    row: { id: string; sellerId: string; keyPrefix: string },
    held: readonly SellerPermissionKey[],
  ): Promise<void> {
    const selfService =
      this.reflector.getAllAndOverride<boolean>(SELLER_SELF_SERVICE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) === true;
    const required = this.reflector.getAllAndOverride<readonly SellerPermissionKey[] | undefined>(
      REQUIRE_SELLER_PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const verdict = sellerAuthorizationVerdict({ selfService, required, held });
    if (verdict.kind === 'ALLOW') return;

    if (verdict.kind === 'ENDPOINT_NOT_AUTHORIZED') {
      throw new ForbiddenException({
        code: 'ENDPOINT_NOT_AUTHORIZED',
        message: ENDPOINT_NOT_AUTHORIZED_MESSAGE,
      });
    }

    await this.audit.log({
      actorType: ActorType.API,
      actorId: row.id,
      sellerId: row.sellerId,
      action: 'seller.api_key.access_denied_permission',
      entityType: 'seller_api_key',
      entityId: row.id,
      metadata: {
        keyPrefix: row.keyPrefix,
        required: [...verdict.required],
        held: [...held],
        path: req.url,
        method: req.method,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
      severity: 'LOW',
    });
    throw new ForbiddenException({
      code: 'INSUFFICIENT_PERMISSION',
      message: `This API key does not hold: ${verdict.required.join(' or ')}`,
    });
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
