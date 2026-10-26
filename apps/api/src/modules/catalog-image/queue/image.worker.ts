import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import sharp from 'sharp';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { deriveThumbnailKey } from '../image-key';
import { OrphanCleanupService } from '../services/orphan-cleanup.service';
import {
  IMAGE_QUEUE_NAME,
  ImageQueue,
  JOB_DELETE_OBJECTS,
  JOB_FETCH_IMAGE,
  JOB_GENERATE_THUMBNAIL,
  JOB_ORPHAN_SWEEP,
  type DeleteObjectsJob,
  type FetchImageJob,
  type GenerateThumbnailJob,
} from './image.queue';
import { assertPublicHttpsUrl } from '../../../common/net/ssrf-guard';
import { buildOriginalKey } from '../image-key';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

const THUMB_WIDTH_PX = 400;
/** Three seconds is plenty for an image host, and the worker has other
 *  rows waiting behind this one. */
const FETCH_TIMEOUT_MS = 10_000;
/** Measured from the bytes we actually received — `content-length` is
 *  the remote end's claim, not a measurement. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The decode ceiling, in PIXELS.
 *
 * `IMAGE_MAX_SIZE_BYTES` (10 MB) bounds the bytes a seller may register
 * and says nothing about what they decode to: a highly-compressible PNG
 * of a few hundred KB can be 20000×20000, and sharp's own default
 * ceiling is ~268 MP — around 1 GB of decode buffer, demanded inside the
 * process that also serves HTTP and runs every other BullMQ worker
 * (SCALE-1). The failure arrives as an out-of-memory, not a failed job.
 *
 * 50 MP is ~8600×5800 — far beyond any product photograph, so nothing a
 * seller would legitimately upload is refused; an image above it fails
 * its job (visible, retried, then reported) instead of taking the API
 * with it.
 */
const MAX_DECODE_PIXELS = 50_000_000;

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
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    // Its own queue, to hand a fetched picture straight to the
    // thumbnail job that already exists rather than growing a second
    // path to the same work.
    private readonly queue: ImageQueue,
  ) {}

  onModuleInit(): void {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(ImageWorker.name)) return;
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
        if (job.name === JOB_FETCH_IMAGE) {
          await this.fetchImage(job.data as FetchImageJob);
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
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(ImageWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, name: job?.name, err: err?.message },
        'Image job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(ImageWorker.name, err);
      this.logger.error({ err: err.message }, 'Image worker error');
    });
    this.logger.log(`Image worker ready (queue=${IMAGE_QUEUE_NAME}, concurrency=3)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }

  /**
   * Fetch one picture a seller named by URL in a product CSV.
   *
   * ── EVERY URL HERE IS A STRANGER'S ──────────────────────────────────
   * It arrives in a spreadsheet cell, so it is as untrusted as anything
   * gets: `assertPublicHttpsUrl` is what stops a row reading
   * `http://169.254.169.254/latest/meta-data/` and handing a seller the
   * droplet's credentials. Re-checked HERE rather than at import time,
   * because DNS can change between the two and the fetch is what
   * matters.
   *
   * ── BOUNDED, BECAUSE THE OTHER END IS NOT OURS ──────────────────────
   * A timeout, a byte ceiling read from the stream rather than trusted
   * from a header, and a decode ceiling. A seller who points a row at a
   * 2 GB file must not take the worker down with them, and
   * `content-length` is a claim, not a measurement.
   *
   * ── IT NEVER COSTS THE PRODUCT ──────────────────────────────────────
   * The variant was committed by the import; this adds its photograph.
   * A picture that cannot be had is logged and dropped — one row with
   * a broken link must not make a seller re-upload a catalogue.
   */
  private async fetchImage(data: FetchImageJob): Promise<void> {
    const exists = await this.prisma.client.productImage.findFirst({
      where: { variantId: data.variantId, deletedAt: null },
      select: { id: true },
    });
    // Already has one. A re-uploaded CSV must not stack duplicates of
    // the same photograph on a variant.
    if (exists) return;

    const url = await assertPublicHttpsUrl(data.url);
    const res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'image/*' },
    });
    if (!res.ok) throw new Error(`image fetch ${res.status} for variant ${data.variantId}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`image is ${buf.byteLength} bytes, over the ${MAX_IMAGE_BYTES} ceiling`);
    }

    // What it IS, not what it said it was: a content-type header is the
    // remote end's claim, and the decode is the only proof.
    const meta = await sharp(buf, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
    const mime =
      meta.format === 'jpeg'
        ? 'image/jpeg'
        : meta.format === 'png'
          ? 'image/png'
          : meta.format === 'webp'
            ? 'image/webp'
            : null;
    if (mime === null) throw new Error(`unsupported image format: ${String(meta.format)}`);

    const key = buildOriginalKey(data.sellerId, data.variantId, mime);
    await this.spaces.putObject(key, buf, mime);

    const image = await this.prisma.client.productImage.create({
      data: {
        variantId: data.variantId,
        spacesKey: key,
        url: key,
        mimeType: mime,
        sizeBytes: buf.byteLength,
        widthPx: meta.width ?? null,
        heightPx: meta.height ?? null,
        // The first picture a variant gets is the one every screen
        // shows, so a CSV-imported one has to be primary or the
        // catalogue would import pictures nothing displays.
        isPrimary: true,
        uploadedBySellerId: data.sellerId,
      },
      select: { id: true },
    });
    await this.queue.enqueueThumbnail({ imageId: image.id });
    this.logger.log(
      { variantId: data.variantId, bytes: buf.byteLength, format: meta.format },
      'Fetched a product picture named in a CSV',
    );
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

    // ONE instance, read twice: `metadata()` does not consume the
    // pipeline, and constructing a second sharp over the same buffer
    // decoded the image twice for no reason.
    const image = sharp(original, { limitInputPixels: MAX_DECODE_PIXELS });
    const meta = await image.metadata();
    const webp = await image
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
