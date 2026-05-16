import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvService } from '../../config/env.service';

export interface ObjectHead {
  size: number;
  contentType: string | null;
}

const MOCK_ROOT = '/tmp/skydrop-spaces-mock';

/**
 * Thin S3-compatible storage wrapper over DigitalOcean Spaces.
 *
 * Two modes, chosen at module init from DEV_MOCK_SPACES:
 *  - real: AWS SDK v3 against the configured Spaces endpoint.
 *  - mock: files under /tmp/skydrop-spaces-mock/<bucket>/, presigned
 *    "upload URLs" are stubbed `mock://` strings (e2e simulates the
 *    client upload by calling putObject directly). Lets tests + local
 *    dev run with no DO credentials.
 *
 * Keys are always the canonical Spaces key (no leading slash).
 */
@Injectable()
export class SpacesService implements OnModuleInit {
  private readonly logger = new Logger(SpacesService.name);
  private readonly mock: boolean;
  private readonly bucket: string;
  private client: S3Client | null = null;

  constructor(private readonly env: EnvService) {
    this.mock = env.devMockSpaces;
    this.bucket = env.spacesBucket;
  }

  onModuleInit(): void {
    if (this.mock) {
      this.logger.warn(
        `SpacesService in MOCK mode — objects under ${MOCK_ROOT}/${this.bucket}`,
      );
      return;
    }
    this.client = new S3Client({
      region: this.env.spacesRegion,
      endpoint: this.env.spacesEndpoint,
      forcePathStyle: false,
      credentials: {
        accessKeyId: this.env.spacesAccessKeyId,
        secretAccessKey: this.env.spacesSecretAccessKey,
      },
    });
    this.logger.log(
      `SpacesService ready (endpoint=${this.env.spacesEndpoint}, bucket=${this.bucket})`,
    );
  }

  /** Presigned PUT URL the client uses to upload directly to Spaces. */
  async presignPutUrl(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<string> {
    if (this.mock) return `mock://${this.bucket}/${key}?ct=${encodeURIComponent(contentType)}`;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.requireClient(), cmd, { expiresIn: ttlSeconds });
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    if (this.mock) {
      try {
        const st = await fs.stat(this.mockPath(key));
        return { size: st.size, contentType: null };
      } catch {
        return null;
      }
    }
    try {
      const res = await this.requireClient().send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: typeof res.ContentLength === 'number' ? res.ContentLength : 0,
        contentType: res.ContentType ?? null,
      };
    } catch {
      return null;
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.mock) {
      const p = this.mockPath(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
      return;
    }
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    if (this.mock) {
      try {
        return await fs.readFile(this.mockPath(key));
      } catch {
        return null;
      }
    }
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res = await this.requireClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      return Buffer.from(await body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.mock) {
      await Promise.all(
        keys.map(async (k) => {
          try {
            await fs.unlink(this.mockPath(k));
          } catch {
            /* already gone — deletion is idempotent */
          }
        }),
      );
      return;
    }
    await this.requireClient().send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  /** List object keys under a prefix (used by orphan cleanup). */
  async listKeys(prefix: string): Promise<string[]> {
    if (this.mock) {
      const base = this.mockPath(prefix);
      const root = path.join(MOCK_ROOT, this.bucket);
      const out: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else out.push(path.relative(root, full).split(path.sep).join('/'));
        }
      };
      // prefix may be a partial path; walk from its directory then filter.
      await walk(path.dirname(base));
      return out.filter((k) => k.startsWith(prefix));
    }
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.requireClient().send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) keys.push(o.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /** Public (CDN) URL for a stored object. */
  publicUrl(key: string): string {
    const cdn = this.env.spacesCdnUrl;
    if (cdn) return `${cdn.replace(/\/$/, '')}/${key}`;
    if (this.mock) return `mock://${this.bucket}/${key}`;
    return `${this.env.spacesEndpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error('SpacesService S3 client not initialized (mock mode or init failure)');
    }
    return this.client;
  }

  private mockPath(key: string): string {
    return path.join(MOCK_ROOT, this.bucket, key);
  }
}
