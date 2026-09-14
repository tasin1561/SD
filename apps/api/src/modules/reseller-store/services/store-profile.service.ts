import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, SellerStoreKind, type ResellerStoreStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

const LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOGO_MAX_BYTES = 1_048_576;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StoreProfileView {
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatus | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly logoUrl: string | null;
  readonly sellerCompanyName: string;
}

export interface StoreLogoPresign {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  readonly maxSizeBytes: number;
}

/**
 * RS-1 / RS-10 — how a reseller store presents itself: the display name
 * the customer will see, the logo, the contact details.
 *
 * Scoped by the store on the caller's TOKEN, in every WHERE. The logo is
 * a Spaces KEY under `stores/<storeId>/logo/`, uploaded by presigned PUT
 * and read by presigned GET — nothing in the bucket is public, and no URL
 * is ever stored (security round 3).
 */
@Injectable()
export class StoreProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
  ) {}

  async get(storeId: string): Promise<StoreProfileView> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: {
        name: true,
        displayName: true,
        status: true,
        contactEmail: true,
        contactPhone: true,
        logoKey: true,
        seller: { select: { companyName: true } },
      },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    return {
      name: store.name,
      displayName: store.displayName,
      status: store.status,
      contactEmail: store.contactEmail,
      contactPhone: store.contactPhone,
      logoUrl: store.logoKey === null ? null : await this.presignSafe(store.logoKey),
      sellerCompanyName: store.seller.companyName,
    };
  }

  async update(
    user: AuthenticatedStoreUser,
    input: { displayName?: string; contactEmail?: string; contactPhone?: string },
  ): Promise<StoreProfileView> {
    const data: {
      displayName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
    } = {};
    if (input.displayName !== undefined) data.displayName = input.displayName.trim() || null;
    if (input.contactEmail !== undefined) {
      const v = input.contactEmail.trim();
      if (v !== '' && !EMAIL.test(v)) {
        throw new BadRequestException({
          code: 'INVALID_EMAIL',
          message: 'contactEmail must be a valid address',
        });
      }
      data.contactEmail = v || null;
    }
    if (input.contactPhone !== undefined) {
      const v = input.contactPhone.trim();
      if (v !== '' && !E164.test(v)) {
        throw new BadRequestException({
          code: 'INVALID_PHONE',
          message: 'contactPhone must be E.164, e.g. +919812345678',
        });
      }
      data.contactPhone = v || null;
    }
    const changed = await this.prisma.client.sellerStore.updateMany({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      data,
    });
    if (changed.count === 0) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.profile.updated',
      entityType: 'seller_store',
      entityId: user.storeId,
      severity: 'LOW',
      changes: data,
    });
    return this.get(user.storeId);
  }

  async presignLogo(storeId: string, mimeType: string): Promise<StoreLogoPresign> {
    if (!LOGO_MIME.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
    const storageKey = `stores/${storeId}/logo/${Date.now().toString(36)}.${ext}`;
    return {
      storageKey,
      uploadUrl: await this.spaces.presignPutUrl(storageKey, mimeType, 300),
      expiresInSeconds: 300,
      maxSizeBytes: LOGO_MAX_BYTES,
    };
  }

  async registerLogo(
    user: AuthenticatedStoreUser,
    storageKey: string,
    mimeType: string,
  ): Promise<StoreProfileView> {
    if (!LOGO_MIME.has(mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
    // The key must be under THIS store's prefix — a key from another
    // store's upload is refused, not adopted.
    if (!storageKey.startsWith(`stores/${user.storeId}/logo/`) || storageKey.includes('..')) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'storageKey must be one this store was given by /logo/presign',
      });
    }
    const head = await this.spaces.headObject(storageKey);
    if (head === null) {
      throw new BadRequestException({
        code: 'LOGO_NOT_UPLOADED',
        message: 'Upload the file first',
      });
    }
    if (head.size > LOGO_MAX_BYTES) {
      throw new BadRequestException({
        code: 'LOGO_TOO_LARGE',
        message: 'A logo may be at most 1 MB',
      });
    }

    const before = await this.prisma.client.sellerStore.findFirst({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { logoKey: true },
    });
    if (before === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    await this.prisma.client.sellerStore.updateMany({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER },
      data: { logoKey: storageKey, logoMimeType: mimeType },
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.logo.uploaded',
      entityType: 'seller_store',
      entityId: user.storeId,
      severity: 'LOW',
      changes: { previousStorageKey: before.logoKey, newStorageKey: storageKey },
    });
    if (before.logoKey !== null && before.logoKey !== storageKey) {
      this.spaces.deleteObjects([before.logoKey]).catch(() => undefined);
    }
    return this.get(user.storeId);
  }

  async removeLogo(user: AuthenticatedStoreUser): Promise<StoreProfileView> {
    const before = await this.prisma.client.sellerStore.findFirst({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { logoKey: true },
    });
    if (before === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such store' });
    }
    await this.prisma.client.sellerStore.updateMany({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER },
      data: { logoKey: null, logoMimeType: null },
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.logo.removed',
      entityType: 'seller_store',
      entityId: user.storeId,
      severity: 'LOW',
      changes: { previousStorageKey: before.logoKey },
    });
    if (before.logoKey !== null) this.spaces.deleteObjects([before.logoKey]).catch(() => undefined);
    return this.get(user.storeId);
  }

  private async presignSafe(key: string): Promise<string | null> {
    try {
      return await this.spaces.presignGetUrl(key);
    } catch {
      return null;
    }
  }
}
