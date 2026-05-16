import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { parseOriginalKey } from '../image-key';

const SCAN_PREFIX = 'sellers/';
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface OrphanSweepResult {
  scanned: number;
  candidates: number;
  deleted: number;
}

/**
 * Deletes Spaces objects that were uploaded via a presigned URL but never
 * registered (no product_images row), and are older than 24h. The age
 * gate avoids racing a just-uploaded object the seller is about to
 * register. Thumbnails are skipped (derivative — they are deleted
 * alongside their original via the per-image delete job). Every deletion
 * is audited as `catalog.image.orphan_deleted` (SYSTEM actor).
 */
@Injectable()
export class OrphanCleanupService {
  private readonly logger = new Logger(OrphanCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditLogService,
  ) {}

  async sweep(now: number = Date.now()): Promise<OrphanSweepResult> {
    const objects = await this.spaces.listObjects(SCAN_PREFIX);
    let candidates = 0;
    let deleted = 0;

    for (const obj of objects) {
      // In-code thumbnails exclusion (not a prefix exclude): thumbnails
      // are derivatives, cleaned up with their original.
      if (obj.key.includes('/thumbnails/')) continue;

      // Only consider keys that match the canonical original layout.
      const parsed = parseOriginalKey(obj.key);
      if (!parsed) continue;

      // Age gate — skip anything younger than 24h.
      if (now - obj.lastModified.getTime() <= MIN_AGE_MS) continue;
      candidates += 1;

      // Any product_images row (even soft-deleted) means the object is
      // "known" — not an orphan. Orphans have zero rows.
      const row = await this.prisma.client.productImage.findFirst({
        where: { spacesKey: obj.key },
        select: { id: true },
      });
      if (row) continue;

      await this.spaces.deleteObjects([obj.key]);
      deleted += 1;
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'catalog.image.orphan_deleted',
        entityType: 'product_image',
        entityId: null,
        metadata: {
          spacesKey: obj.key,
          sellerId: parsed.sellerId,
          variantId: parsed.variantId,
          ageHours: Math.floor((now - obj.lastModified.getTime()) / 3_600_000),
        },
        severity: 'LOW',
      });
      this.logger.log({ spacesKey: obj.key }, 'Deleted orphan image object');
    }

    return { scanned: objects.length, candidates, deleted };
  }
}
