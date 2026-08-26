import { UnauthorizedException } from '@nestjs/common';
import { CourierDocumentType } from '@skydrop/db';
import { PublicDocumentWebhookController } from '../../src/modules/tracking-ingestion/controllers/public-document-webhook.controller';

const SECRET = 'the-static-shared-secret-delhivery-sends';
const BIG_IMAGE = 'A'.repeat(4096);

function make(valid = true) {
  const create = jest.fn().mockResolvedValue({ id: 'wh-1' });
  const ingest = jest.fn().mockResolvedValue({ stored: true, awbNumber: '123' });
  const controller = new PublicDocumentWebhookController(
    { verify: jest.fn().mockResolvedValue({ valid, reason: valid ? undefined : 'X' }) } as never,
    { ingest } as never,
    {
      client: {
        courierWebhook: { create },
        courier: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      },
    } as never,
  );
  const req = {
    method: 'POST',
    originalUrl: '/public/tracking/documents/epod/delhivery',
    ip: '13.229.195.68',
    headers: {
      'x-skydrop-signature': SECRET,
      'user-agent': 'Delhivery',
      'content-type': 'application/json',
    },
    rawBody: Buffer.from(JSON.stringify({ waybill: '123', EPOD: BIG_IMAGE })),
  };
  return { controller, create, ingest, req };
}

describe('PublicDocumentWebhookController', () => {
  it('refuses an unauthenticated push and writes NOTHING (TRK-1)', async () => {
    const { controller, create, ingest, req } = make(false);
    await expect(
      controller.epod('delhivery', req as never, { waybill: '123' }, 'wrong'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // The raw ledger is reserved for payloads we know came from the
    // courier — a table anyone can append to is not evidence.
    expect(create).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('never writes the shared secret into the database', async () => {
    const { controller, create, req } = make();
    await controller.epod('delhivery', req as never, { waybill: '123', EPOD: BIG_IMAGE }, SECRET);

    const row = create.mock.calls[0][0].data;
    const serialised = JSON.stringify(row);
    // Under SHARED_SECRET the header value IS the credential (CUR-1:
    // key in env, never in a row).
    expect(serialised).not.toContain(SECRET);
    expect(row.headers['x-skydrop-signature']).toBe('[redacted]');
    // The dedup identity is a hash of the body, not the header — the
    // header is a constant, so it identifies nothing.
    expect(row.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signature).not.toBe(SECRET);
  });

  it('keeps the image out of Postgres but keeps the facts', async () => {
    const { controller, create, req } = make();
    await controller.epod('delhivery', req as never, { waybill: '123', EPOD: BIG_IMAGE }, SECRET);

    const row = create.mock.calls[0][0].data;
    // A multi-megabyte base64 per document would eat a 10GB managed
    // disk in weeks, and the bytes are already in Spaces.
    expect(row.rawBody).not.toContain(BIG_IMAGE);
    expect(row.rawBody.length).toBeLessThan(500);
    expect(row.parsedBody.EPOD).toContain('image omitted');
    // What is needed to understand what arrived still survives.
    expect(row.parsedBody.waybill).toBe('123');
  });

  it('hands the FULL image to the ingest service, not the redacted copy', async () => {
    const { controller, ingest, req } = make();
    await controller.epod('delhivery', req as never, { waybill: '123', EPOD: BIG_IMAGE }, SECRET);
    expect(ingest.mock.calls[0][0].body.EPOD).toBe(BIG_IMAGE);
    expect(ingest.mock.calls[0][0].docType).toBe(CourierDocumentType.EPOD);
  });

  it('routes each path to its own document type', async () => {
    const { controller, ingest, req } = make();
    await controller.sorter('delhivery', req as never, { waybill: '1' }, SECRET);
    await controller.qc('delhivery', req as never, { waybill: '1' }, SECRET);
    expect(ingest.mock.calls[0][0].docType).toBe(CourierDocumentType.SORTER_IMAGE);
    expect(ingest.mock.calls[1][0].docType).toBe(CourierDocumentType.QC_IMAGE);
  });
});

describe('PublicDocumentWebhookController — courier registry', () => {
  it('refuses a courier code that is not registered, before authenticating', async () => {
    const create = jest.fn();
    const ingest = jest.fn();
    const controller = new PublicDocumentWebhookController(
      { verify: jest.fn().mockResolvedValue({ valid: true }) } as never,
      { ingest } as never,
      {
        client: {
          courierWebhook: { create },
          courier: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      } as never,
    );
    const req = {
      method: 'POST',
      originalUrl: '/x',
      ip: '1.1.1.1',
      headers: {},
      rawBody: Buffer.from('{}'),
    };

    await expect(
      controller.epod('not-a-real-courier', req as never, { waybill: '1' }, SECRET),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });
});
