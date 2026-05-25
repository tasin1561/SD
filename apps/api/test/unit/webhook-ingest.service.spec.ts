import { UnauthorizedException } from '@nestjs/common';
import { WebhookStatus } from '@skydrop/db';
import { WebhookIngestService } from '../../src/modules/tracking-ingestion/services/webhook-ingest.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { WebhookAuthService } from '../../src/modules/tracking-ingestion/services/webhook-auth.service';
import type { TrackingWebhookQueue } from '../../src/modules/tracking-ingestion/queue/tracking-webhook.queue';

const COURIER = 'delhivery';
const BODY = '{"awb":"DLV-123","status":"DLV-DELIVERED"}';
const SIG = 'a'.repeat(64); // 64 hex chars

function baseInput(over: Partial<Record<string, unknown>> = {}) {
  return {
    courierCode: COURIER,
    rawBody: BODY,
    parsedBody: { awb: 'DLV-123', status: 'DLV-DELIVERED' },
    signatureHeader: SIG,
    httpMethod: 'POST',
    endpoint: '/public/tracking/webhooks/delhivery',
    headers: { 'content-type': 'application/json' },
    remoteIp: '203.0.113.5',
    userAgent: 'TestCourier/1.0',
    ...over,
  } as Parameters<WebhookIngestService['ingest']>[0];
}

function makeService(
  opts: {
    courierExists?: boolean;
    courierDeleted?: boolean;
    authValid?: boolean;
    authReason?: string;
    duplicateWebhookId?: string | null;
    enqueueThrows?: Error;
  } = {},
) {
  const courierFindUnique = jest.fn(async () => {
    if (opts.courierExists === false) return null;
    return {
      code: COURIER,
      deletedAt: opts.courierDeleted ? new Date() : null,
    };
  });
  const webhookFindFirst = jest.fn(async () =>
    opts.duplicateWebhookId ? { id: opts.duplicateWebhookId } : null,
  );
  const webhookCreate = jest.fn(async () => ({ id: 'wh-NEW-1' }));
  const client = {
    courier: { findUnique: courierFindUnique },
    courierWebhook: { findFirst: webhookFindFirst, create: webhookCreate },
  };

  const verify = jest.fn(async () =>
    opts.authValid === false
      ? {
          valid: false as const,
          reason: (opts.authReason ?? 'SIGNATURE_MISMATCH') as
            | 'SIGNATURE_MISSING'
            | 'SIGNATURE_MISMATCH',
        }
      : {
          valid: true as const,
          secretRefEnvKey: 'TRACKING_WEBHOOK_SECRET_DELHIVERY',
        },
  );
  const auth = { verify };

  const enqueueWebhook = jest.fn(async (id: string) => {
    if (opts.enqueueThrows) throw opts.enqueueThrows;
    return `job-${id}`;
  });
  const queue = { enqueueWebhook };

  const svc = new WebhookIngestService(
    { client } as unknown as PrismaService,
    auth as unknown as WebhookAuthService,
    queue as unknown as TrackingWebhookQueue,
  );
  return { svc, courierFindUnique, webhookFindFirst, webhookCreate, verify, enqueueWebhook };
}

describe('WebhookIngestService.ingest', () => {
  it('valid + new → STORED, row inserted with RECEIVED + signatureValid=true, enqueued', async () => {
    const { svc, webhookCreate, enqueueWebhook } = makeService();
    const r = await svc.ingest(baseInput());
    expect(r).toEqual({ status: 'STORED', webhookId: 'wh-NEW-1' });
    expect(webhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courierCode: COURIER,
          rawBody: BODY,
          signature: SIG.toLowerCase(),
          signatureValid: true,
          status: WebhookStatus.RECEIVED,
        }),
      }),
    );
    expect(enqueueWebhook).toHaveBeenCalledWith('wh-NEW-1');
  });

  it('TRK-2 dedup: same (courierCode, signature) → DUPLICATE no-op, no create, no enqueue', async () => {
    const { svc, webhookCreate, enqueueWebhook } = makeService({
      duplicateWebhookId: 'wh-EXISTING-1',
    });
    const r = await svc.ingest(baseInput());
    expect(r).toEqual({ status: 'DUPLICATE', webhookId: 'wh-EXISTING-1' });
    expect(webhookCreate).not.toHaveBeenCalled();
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });

  it('TRK-1 unknown courier → 401, NEVER stored', async () => {
    const { svc, webhookCreate, verify } = makeService({ courierExists: false });
    await expect(svc.ingest(baseInput())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(webhookCreate).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled(); // short-circuit before auth
  });

  it('TRK-1 soft-deleted courier → 401, NEVER stored', async () => {
    const { svc, webhookCreate } = makeService({ courierDeleted: true });
    await expect(svc.ingest(baseInput())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(webhookCreate).not.toHaveBeenCalled();
  });

  it('TRK-1 invalid HMAC → 401, NEVER stored (the raw ledger stays clean)', async () => {
    const { svc, webhookCreate, enqueueWebhook } = makeService({
      authValid: false,
      authReason: 'SIGNATURE_MISMATCH',
    });
    await expect(svc.ingest(baseInput())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(webhookCreate).not.toHaveBeenCalled();
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });

  it('TRK-1 missing signature → 401, NEVER stored', async () => {
    const { svc, webhookCreate } = makeService({
      authValid: false,
      authReason: 'SIGNATURE_MISSING',
    });
    await expect(svc.ingest(baseInput({ signatureHeader: undefined }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(webhookCreate).not.toHaveBeenCalled();
  });

  it('enqueue failure does NOT fail the request — the stored row is the source of truth', async () => {
    const { svc, webhookCreate } = makeService({
      enqueueThrows: new Error('Redis unavailable'),
    });
    const r = await svc.ingest(baseInput());
    // Still STORED — ops can manually re-enqueue (jobId=webhookId dedups).
    expect(r).toEqual({ status: 'STORED', webhookId: 'wh-NEW-1' });
    expect(webhookCreate).toHaveBeenCalled();
  });

  it('signature normalized lowercase in dedup key (uppercase request → same dedup bucket)', async () => {
    const { svc, webhookFindFirst } = makeService();
    await svc.ingest(baseInput({ signatureHeader: SIG.toUpperCase() }));
    // The findFirst was called with the lowercased signature so the
    // dedup is case-insensitive.
    expect(webhookFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ signature: SIG.toLowerCase() }),
      }),
    );
  });
});
