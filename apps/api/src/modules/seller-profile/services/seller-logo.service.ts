import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Phase 1B — seller company logo (one per seller).
 *
 * Flow:
 *   1. POST /seller/profile/logo/presign — returns presigned PUT URL +
 *      storageKey. Client PUTs the file directly to Spaces.
 *   2. POST /seller/profile/logo/register — client passes back the same
 *      storageKey; server verifies the key path matches the seller
 *      and writes the URL into the seller row.
 *   3. DELETE /seller/profile/logo — clears the row + deletes the
 *      Spaces object best-effort.
 *
 * Logos are small (the UI client-side compresses to ≤ 256x256 / 200 KB
 * for the preview before upload). No worker pipeline needed.
 */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PresignResult {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  readonly maxSizeBytes: number;
}

export interface LogoView {
  readonly logoUrl: string | null;
  readonly logoMimeType: string | null;
}

@Injectable()
export class SellerLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
  ) {}

  async presign(sellerId: string, mimeType: string): Promise<PresignResult> {
    if (!ALLOWED.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
    // Use a per-seller deterministic key so a re-upload overwrites the
    // old object cleanly; CDN-cached old version will still serve via
    // the URL until purged. We bust the cache by including the upload
    // timestamp as a token.
    const token = Date.now().toString(36);
    const storageKey = `sellers/${sellerId}/logo/${token}.${ext}`;
    const uploadUrl = await this.spaces.presignPutUrl(storageKey, mimeType, 300);
    return {
      storageKey,
      uploadUrl,
      expiresInSeconds: 300,
      maxSizeBytes: 1_048_576, // 1 MB cap
    };
  }

  async register(
    sellerId: string,
    storageKey: string,
    mimeType: string,
    ctx: ClientContext,
  ): Promise<LogoView> {
    if (!ALLOWED.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
    if (!storageKey.startsWith(`sellers/${sellerId}/logo/`)) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'storageKey must match sellers/<your-id>/logo/...',
      });
    }
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, logoStorageKey: true },
    });
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'Seller not found',
      });
    }

    const previousKey = seller.logoStorageKey;
    // Pointer, not a link — logo objects are private like everything
    // else in the bucket. Readers presign from `logoStorageKey`.
    const url = this.spaces.canonicalObjectUrl(storageKey);

    await this.prisma.client.seller.update({
      where: { id: sellerId },
      data: {
        logoStorageKey: storageKey,
        logoMimeType: mimeType,
        logoUrl: url,
      },
    });

    // Audit (LOW — logo change isn't sensitive).
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.logo.uploaded',
      entityType: 'seller',
      entityId: sellerId,
      severity: 'LOW',
      changes: { previousStorageKey: previousKey, newStorageKey: storageKey },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    // Best-effort delete the old logo object — never fails the write.
    if (previousKey && previousKey !== storageKey) {
      this.spaces.deleteObjects([previousKey]).catch(() => undefined);
    }

    return {
      logoUrl: await this.spaces.presignGetUrl(storageKey),
      logoMimeType: mimeType,
    };
  }

  async remove(sellerId: string, ctx: ClientContext): Promise<LogoView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, logoStorageKey: true },
    });
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'Seller not found',
      });
    }
    const previousKey = seller.logoStorageKey;
    await this.prisma.client.seller.update({
      where: { id: sellerId },
      data: { logoStorageKey: null, logoMimeType: null, logoUrl: null },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.logo.removed',
      entityType: 'seller',
      entityId: sellerId,
      severity: 'LOW',
      changes: { previousStorageKey: previousKey },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    if (previousKey) {
      this.spaces.deleteObjects([previousKey]).catch(() => undefined);
    }
    return { logoUrl: null, logoMimeType: null };
  }
}
