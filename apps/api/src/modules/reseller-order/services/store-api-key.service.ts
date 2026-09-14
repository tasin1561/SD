import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { STORE_API_KEY_PREFIX } from '../../../common/guards/store-api-key.guard';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';

export interface StoreApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface CreatedStoreApiKey extends StoreApiKeyView {
  /** Shown ONCE. Only its SHA-256 hash is stored. */
  readonly plaintext: string;
}

const SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

function view(r: {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): StoreApiKeyView {
  return {
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * RS-5 — a reseller store's API keys. The ONLY writer of `store_api_keys`.
 * The plaintext is generated here, returned once and never stored; the
 * hash is what `StoreApiKeyGuard` looks up. Scoped by the TOKEN's store in
 * every WHERE, so one store cannot list or revoke another's keys.
 */
@Injectable()
export class StoreApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
  ) {}

  async list(storeId: string): Promise<StoreApiKeyView[]> {
    const rows = await this.prisma.client.storeApiKey.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });
    return rows.map(view);
  }

  async create(
    user: { readonly id: string; readonly storeId: string; readonly sellerId: string },
    input: { readonly name: string; readonly expiresInDays?: number },
  ): Promise<CreatedStoreApiKey> {
    const name = input.name.trim();
    if (name === '') {
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Name the key' });
    }
    const body = randomBytes(24).toString('base64url').slice(0, 32);
    const plaintext = `${STORE_API_KEY_PREFIX}${body}`;
    const row = await this.prisma.client.storeApiKey.create({
      data: {
        storeId: user.storeId,
        sellerId: user.sellerId,
        name,
        keyPrefix: plaintext.slice(0, 12),
        keyHash: this.hashes.sha256Hex(plaintext),
        createdByStoreUserId: user.id,
        expiresAt:
          input.expiresInDays === undefined
            ? null
            : new Date(Date.now() + input.expiresInDays * 86_400_000),
      },
      select: SELECT,
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.api_key.created',
      entityType: 'store_api_key',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: { storeId: user.storeId, name, keyPrefix: row.keyPrefix },
    });
    return { ...view(row), plaintext };
  }

  async revoke(
    user: { readonly id: string; readonly storeId: string; readonly sellerId: string },
    keyId: string,
  ): Promise<void> {
    const changed = await this.prisma.client.storeApiKey.updateMany({
      where: { id: keyId, storeId: user.storeId, deletedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count === 0) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'No live key with that id',
      });
    }
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.api_key.revoked',
      entityType: 'store_api_key',
      entityId: keyId,
      severity: 'MEDIUM',
      metadata: { storeId: user.storeId },
    });
  }
}
