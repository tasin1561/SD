import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import sharp from 'sharp';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { deriveThumbnailKey } from '../image-key';
import { OrphanCleanupService } from '../services/orphan-cleanup.service';
import {
  IMAGE_QUEUE_NAME,
  JOB_DELETE_OBJECTS,
  JOB_GENERATE_THUMBNAIL,
  JOB_ORPHAN_SWEEP,
  type DeleteObjectsJob,
  type GenerateThumbnailJob,
} from './image.queue';

const THUMB_WIDTH_PX = 400;

/**
 * In-process worker for catalog image jobs (Phase 1A pattern, same as the
 * email worker). Two job types:
 *  - generate-thumbnail: sharp → webp, idempotent (skips if thumbnailUrl
 *    already set or the image row was deleted).
 *  - delete-objects: removes the given keys from Spaces (idempotent —
 *    missing objects are a no-op).
 */
@Injectable()
export class ImageWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly orphanCleanup: OrphanCleanupService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      IMAGE_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_GENERATE_THUMBNAIL) {
          await this.generateThumbnail(job.data as GenerateThumbnailJob);
          return;
        }
        if (job.name === JOB_DELETE_OBJECTS) {
          await this.deleteObjects(job.data as DeleteObjectsJob);
          return;
        }
        if (job.name === JOB_ORPHAN_SWEEP) {
          const result = await this.orphanCleanup.sweep();
          this.logger.log(result, 'Orphan sweep complete');
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown image job name; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 3 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Image job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Image worker error');
    });
    this.logger.log(`Image worker ready (queue=${IMAGE_QUEUE_NAME}, concurrency=3)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }

  private async generateThumbnail(data: GenerateThumbnailJob): Promise<void> {
    const row = await this.prisma.client.productImage.findUnique({
      where: { id: data.imageId },
      select: {
        id: true,
        spacesKey: true,
        thumbnailUrl: true,
        deletedAt: true,
      },
    });
    if (!row) return; // image gone — nothing to do
    if (row.deletedAt) return; // image deleted — skip
    if (row.thumbnailUrl) return; // idempotent — already generated

    const original = await this.spaces.getObject(row.spacesKey);
    if (!original) {
      // Object not present yet/anymore — throw so BullMQ retries; a
      // permanently-missing object will eventually exhaust attempts.
      throw new Error(`Original object missing for image ${row.id} (${row.spacesKey})`);
    }

    const meta = await sharp(original).metadata();
    const webp = await sharp(original)
      .resize({ width: THUMB_WIDTH_PX, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbKey = deriveThumbnailKey(row.spacesKey);
    if (!thumbKey) {
      throw new Error(`Cannot derive thumbnail key from ${row.spacesKey}`);
    }
    await this.spaces.putObject(thumbKey, webp, 'image/webp');

    await this.prisma.client.productImage.update({
      where: { id: row.id },
      data: {
        // A pointer, and the "thumbnail exists" marker the gate above
        // reads. Not fetchable — CatalogImageService.toView() presigns
        // the real URL for a caller that owns the variant.
        thumbnailUrl: this.spaces.canonicalObjectUrl(thumbKey),
        widthPx: typeof meta.width === 'number' ? meta.width : null,
        heightPx: typeof meta.height === 'number' ? meta.height : null,
      },
    });
  }

  private async deleteObjects(data: DeleteObjectsJob): Promise<void> {
    await this.spaces.deleteObjects(data.keys);
  }
}
