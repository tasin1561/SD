import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenHashService } from '../auth-common/services/token-hash.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import type {
  ApiKeyListItemDto,
  CreateApiKeyDto,
  CreatedApiKeyDto,
} from './dto/create.dto';
import type { ClientContext } from '../staff-auth/staff-auth.service';

@Injectable()
export class SellerApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    sellerId: string,
    input: CreateApiKeyDto,
    ctx: ClientContext,
  ): Promise<CreatedApiKeyDto> {
    const { plaintext, prefix, hash } = this.hashes.generateApiKey();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const row = await this.prisma.client.sellerApiKey.create({
      data: {
        sellerId,
        name: input.name,
        keyPrefix: prefix,
        keyHash: hash,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.api_key.created',
      entityType: 'seller_api_key',
      entityId: row.id,
      metadata: {
        name: input.name,
        keyPrefix: prefix,
        expiresAt: expiresAt?.toISOString() ?? null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      plaintext,
    };
  }

  async list(sellerId: string): Promise<ApiKeyListItemDto[]> {
    const rows = await this.prisma.client.sellerApiKey.findMany({
      where: { sellerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    return rows;
  }

  async revoke(sellerId: string, apiKeyId: string, ctx: ClientContext): Promise<void> {
    const row = await this.prisma.client.sellerApiKey.findFirst({
      where: { id: apiKeyId, sellerId, deletedAt: null },
      select: { id: true, name: true, revokedAt: true, keyPrefix: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found' });
    }
    if (row.revokedAt !== null) {
      throw new BadRequestException({
        code: 'ALREADY_REVOKED',
        message: 'API key is already revoked',
      });
    }

    await this.prisma.client.sellerApiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.api_key.revoked',
      entityType: 'seller_api_key',
      entityId: apiKeyId,
      metadata: {
        name: row.name,
        keyPrefix: row.keyPrefix,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }
}
