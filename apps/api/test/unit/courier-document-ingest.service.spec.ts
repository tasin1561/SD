import { CourierDocumentType } from '@skydrop/db';
import { CourierDocumentIngestService } from '../../src/modules/tracking-ingestion/services/courier-document-ingest.service';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]).toString(
  'base64',
);

function make(overrides: { shipmentId?: string | null } = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const putObject = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    client: {
      shipment: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.shipmentId === undefined
              ? { id: 'ship-1' }
              : overrides.shipmentId === null
                ? null
                : { id: overrides.shipmentId },
          ),
      },
      courierDocument: { upsert },
    },
  };
  const service = new CourierDocumentIngestService(
    prisma as never,
    { putObject } as never,
    { spacesBucket: 'skydrop-test' } as never,
  );
  return { service, upsert, putObject, prisma };
}

describe('CourierDocumentIngestService', () => {
  describe('extract — the field names are theirs, not ours', () => {
    it('reads the AWB whatever they capitalise it as', () => {
      const { service } = make();
      for (const key of ['waybill', 'Waybill', 'waybillId', 'AWB']) {
        const got = service.extract(CourierDocumentType.EPOD, { [key]: ' 38061110518534 ' });
        expect(got.awbNumber).toBe('38061110518534');
      }
    });

    it('reads the image out of the field each document type uses', () => {
      const { service } = make();
      expect(service.extract(CourierDocumentType.EPOD, { EPOD: 'a' }).payload).toBe('a');
      expect(
        service.extract(CourierDocumentType.SORTER_IMAGE, { Weight_images: 'b' }).payload,
      ).toBe('b');
      expect(service.extract(CourierDocumentType.QC_IMAGE, { Image: 'c' }).payload).toBe('c');
    });
  });

  describe('ingest', () => {
    it('stores the bytes and links the shipment', async () => {
      const { service, upsert, putObject } = make();
      const out = await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.EPOD,
        body: { waybill: '38061110518534', EPOD: JPEG },
        webhookId: 'wh-1',
      });

      expect(out).toEqual({ stored: true, awbNumber: '38061110518534' });
      const [key, , mime] = putObject.mock.calls[0] as [string, Buffer, string];
      // Sniffed from the bytes, not from what they claimed.
      expect(mime).toBe('image/jpeg');
      expect(key).toBe('courier-documents/delhivery/epod/38061110518534.jpg');
      expect(upsert.mock.calls[0][0].create).toMatchObject({
        shipmentId: 'ship-1',
        spacesKey: key,
        storeError: null,
      });
    });

    it('keeps a document for an AWB we do not know — an orphan is still evidence', async () => {
      const { service, upsert } = make({ shipmentId: null });
      await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.QC_IMAGE,
        body: { waybill: '999', Image: JPEG },
        webhookId: null,
      });
      expect(upsert.mock.calls[0][0].create).toMatchObject({ shipmentId: null });
    });

    it('records the reason when the file could not be kept, rather than dropping the fact', async () => {
      const { service, upsert, putObject } = make();
      putObject.mockRejectedValueOnce(new Error('spaces is down'));
      const out = await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.EPOD,
        body: { waybill: '123', EPOD: JPEG },
        webhookId: 'wh-2',
      });
      // Never throws at the courier: a retry storm is worse than a
      // missing image, and the raw payload is already in the ledger.
      expect(out.stored).toBe(false);
      expect(upsert.mock.calls[0][0].create.storeError).toBe('spaces is down');
    });

    it('does not fetch a URL they sent instead of bytes', async () => {
      const { service, upsert, putObject } = make();
      await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.SORTER_IMAGE,
        body: { waybill: '123', Weight_images: 'https://delhivery.example/img/123.jpg' },
        webhookId: null,
      });
      expect(putObject).not.toHaveBeenCalled();
      expect(upsert.mock.calls[0][0].create.storeError).toContain('reference, not image bytes');
    });

    it('writes nothing at all when there is no AWB to attach it to', async () => {
      const { service, upsert, putObject } = make();
      const out = await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.EPOD,
        body: { EPOD: JPEG },
        webhookId: 'wh-3',
      });
      expect(out).toEqual({ stored: false, awbNumber: null });
      expect(upsert).not.toHaveBeenCalled();
      expect(putObject).not.toHaveBeenCalled();
    });

    it('upserts on the natural key so a re-send updates rather than duplicates', async () => {
      const { service, upsert } = make();
      await service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.EPOD,
        body: { waybill: '123', EPOD: JPEG },
        webhookId: null,
      });
      expect(upsert.mock.calls[0][0].where).toEqual({
        courierCode_awbNumber_docType: {
          courierCode: 'delhivery',
          awbNumber: '123',
          docType: CourierDocumentType.EPOD,
        },
      });
    });
  });
});

describe('CourierDocumentIngestService — never throws at the courier', () => {
  it('survives a database error on the shipment lookup', async () => {
    const { service, upsert, prisma } = make();
    prisma.client.shipment.findFirst.mockRejectedValueOnce(new Error('connection reset'));
    const out = await service.ingest({
      courierCode: 'delhivery',
      docType: CourierDocumentType.EPOD,
      body: { waybill: '123', EPOD: JPEG },
      webhookId: null,
    });
    // The link is lost, the evidence is not.
    expect(out.awbNumber).toBe('123');
    expect(upsert.mock.calls[0][0].create.shipmentId).toBeNull();
  });

  it('survives a database error on the write itself', async () => {
    const { service, upsert } = make();
    upsert.mockRejectedValueOnce(new Error('deadlock detected'));
    // A 500 here means the courier retries — the outcome this design
    // exists to avoid. The raw payload is already in courier_webhooks.
    await expect(
      service.ingest({
        courierCode: 'delhivery',
        docType: CourierDocumentType.EPOD,
        body: { waybill: '123', EPOD: JPEG },
        webhookId: null,
      }),
    ).resolves.toEqual({ stored: false, awbNumber: '123' });
  });
});
