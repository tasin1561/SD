import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  buildOriginalKey,
  deriveThumbnailKey,
  isAllowedImageMime,
  parseOriginalKey,
  type AllowedImageMime,
} from '../image-key';
import { ImageQueue } from '../queue/image.queue';
import type { PresignImageDto } from '../dto/presign-image.dto';
import type { RegisterImageDto } from '../dto/register-image.dto';

const PRESIGN_TTL_SECONDS = 15 * 60;

export interface PresignResult {
  spacesKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
  maxSizeBytes: number;
}

export interface ImageView {
  id: string;
  variantId: string;
  spacesKey: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  widthPx: number | null;
  heightPx: number | null;
  altText: string | null;
  isPrimary: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  variantId: true,
  spacesKey: true,
  url: true,
  thumbnailUrl: true,
  mimeType: true,
  sizeBytes: true,
  widthPx: true,
  heightPx: true,
  altText: true,
  isPrimary: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CatalogImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly queue: ImageQueue,
  ) {}

  async presignUpload(
    sellerId: string,
    variantId: string,
    input: PresignImageDto,
  ): Promise<PresignResult> {
    if (!isAllowedImageMime(input.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }
    await this.requireVariant(sellerId, variantId);

    const key = buildOriginalKey(sellerId, variantId, input.mimeType as AllowedImageMime);
    const uploadUrl = await this.spaces.presignPutUrl(key, input.mimeType, PRESIGN_TTL_SECONDS);
    return {
      spacesKey: key,
      uploadUrl,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
      maxSizeBytes: this.env.imageMaxSizeBytes,
    };
  }

  async register(
    sellerId: string,
    variantId: string,
    input: RegisterImageDto,
    ctx: ClientContext,
  ): Promise<ImageView> {
    if (!isAllowedImageMime(input.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME',
        message: 'mimeType must be image/jpeg, image/png, or image/webp',
      });
    }

    // Key-path strictness: the key must be the canonical layout AND its
    // sellerId/variantId segments must match the authenticated seller and
    // the path variant. This stops a seller registering an object under
    // another seller's (or another variant's) prefix.
    const parsed = parseOriginalKey(input.spacesKey);
    if (!parsed) {
      throw new BadRequestException({
        code: 'INVALID_SPACES_KEY',
        message: 'spacesKey does not match the expected layout',
      });
    }
    if (parsed.sellerId !== sellerId) {
      throw new ForbiddenException({
        code: 'KEY_OWNERSHIP_MISMATCH',
        message: 'spacesKey does not belong to the authenticated seller',
      });
    }
    if (parsed.variantId !== variantId) {
      throw new BadRequestException({
        code: 'KEY_VARIANT_MISMATCH',
        message: 'spacesKey variant segment does not match the URL variant',
      });
    }

    await this.requireVariant(sellerId, variantId);

    const head = await this.spaces.headObject(input.spacesKey);
    if (!head) {
      throw new BadRequestException({
        code: 'OBJECT_NOT_FOUND',
        message: 'No uploaded object found at spacesKey — upload before registering',
      });
    }
    if (head.size !== input.sizeBytes) {
      throw new BadRequestException({
        code: 'SIZE_MISMATCH',
        message: `Reported sizeBytes (${input.sizeBytes}) does not match the stored object (${head.size})`,
      });
    }
    if (head.size > this.env.imageMaxSizeBytes) {
      throw new BadRequestException({
        code: 'IMAGE_TOO_LARGE',
        message: `Image exceeds the ${this.env.imageMaxSizeBytes}-byte limit`,
      });
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx.productImage.updateMany({
          where: { variantId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const row = await tx.productImage.create({
        data: {
          variantId,
          spacesKey: input.spacesKey,
          spacesBucket: this.env.spacesBucket,
          // A pointer to the object, not a working link — see toView().
          url: this.spaces.canonicalObjectUrl(input.spacesKey),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          altText: input.altText ?? null,
          isPrimary: input.isPrimary ?? false,
          displayOrder: input.displayOrder ?? 0,
          uploadedBySellerId: sellerId,
        },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.image.registered',
          entityType: 'product_image',
          entityId: row.id,
          metadata: {
            variantId,
            spacesKey: input.spacesKey,
            sizeBytes: input.sizeBytes,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });

    await this.queue.enqueueThumbnail({ imageId: created.id });
    return this.toView(created);
  }

  /**
   * Swap the stored object pointers for short-lived presigned URLs.
   *
   * The `url` / `thumbnailUrl` COLUMNS record where the object lives;
   * they are not fetchable, because every object in the bucket is
   * private. Only a caller who got past `requireVariant` — i.e. owns the
   * variant — reaches this, so this is the point at which a readable URL
   * may legitimately be minted.
   *
   * This also fixes a live bug: originals are uploaded by the browser
   * through a presigned PUT, which does not make them public, so the
   * stored `url` has never actually resolved. Only the thumbnail
   * rendered.
   */
  private async toView(row: ImageView): Promise<ImageView> {
    const thumbKey = row.thumbnailUrl ? deriveThumbnailKey(row.spacesKey) : null;
    return {
      ...row,
      url: await this.spaces.presignGetUrl(row.spacesKey),
      thumbnailUrl: thumbKey ? await this.spaces.presignGetUrl(thumbKey) : null,
    };
  }

  async listForVariant(sellerId: string, variantId: string): Promise<ImageView[]> {
    await this.requireVariant(sellerId, variantId);
    const rows = await this.prisma.client.productImage.findMany({
      where: { variantId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: VIEW_SELECT,
    });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  async delete(
    sellerId: string,
    variantId: string,
    imageId: string,
    ctx: ClientContext,
  ): Promise<void> {
    await this.requireVariant(sellerId, variantId);
    const image = await this.prisma.client.productImage.findFirst({
      where: { id: imageId, variantId, deletedAt: null },
      select: { id: true, spacesKey: true },
    });
    if (!image) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: 'Image not found' });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.productImage.update({
        where: { id: imageId },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.image.deleted',
          entityType: 'product_image',
          entityId: imageId,
          metadata: {
            variantId,
            spacesKey: image.spacesKey,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });

    // Delete BOTH the original and its derivable thumbnail in one job.
    const keys = [image.spacesKey];
    const thumb = deriveThumbnailKey(image.spacesKey);
    if (thumb) keys.push(thumb);
    await this.queue.enqueueDelete({
      keys,
      sellerId,
      reason: 'image_deleted',
    });
  }

  // ---------- internal ----------

  private async requireVariant(sellerId: string, variantId: string): Promise<void> {
    const v = await this.prisma.client.productVariant.findFirst({
      where: { id: variantId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!v) {
      throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Variant not found' });
    }
  }
}
