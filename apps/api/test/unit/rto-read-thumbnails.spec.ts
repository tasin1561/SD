import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { RtoReadService } from '../../src/modules/warehouse-rto/services/rto-read.service';
import { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';

/**
 * The product picture on the RTO inspect screen.
 *
 * The inspector judges a returned item's condition with the box open; a
 * photograph settles "is this the right thing" before the SKU does. The
 * properties pinned here: the picture is a presigned THUMBNAIL minted for
 * this response (never a stored URL — the bucket is private), it is
 * resolved through the catalogue boundary in ONE query for every line,
 * only the variants on THIS parcel are presigned, and a failed lookup
 * costs the picture and never the screen.
 */

interface FakeImage {
  variantId: string;
  spacesKey: string;
  thumbnailUrl: string | null;
}

const SHIP = '01900000-0000-7000-8000-000000000001';

function line(id: string, variantId: string, productName = `Product ${variantId}`) {
  return {
    id,
    orderItemId: `oi-${id}`,
    skuCode: `SKU-${variantId}`,
    productName,
    variantLabel: null,
    quantity: 1,
    rtoCondition: null,
    rtoDisposition: null,
    rtoInspectionNotes: null,
    orderItem: { variantId },
  };
}

// The whole image table, INCLUDING a variant that is not on this parcel,
// so "only this parcel's variants are presigned" is a claim with
// something to be false about.
const IMAGES: FakeImage[] = [
  {
    variantId: 'v-sunglass',
    spacesKey: 'sellers/s1/variants/v-sunglass/tok.jpg',
    thumbnailUrl: 'stored',
  },
  {
    variantId: 'v-elsewhere',
    spacesKey: 'sellers/s1/variants/v-elsewhere/tok.jpg',
    thumbnailUrl: 'stored',
  },
];

function make(opts: { items?: ReturnType<typeof line>[] | null; catalogFails?: boolean } = {}) {
  const items = opts.items === undefined ? [line('si-1', 'v-sunglass')] : opts.items;
  const shipmentFindFirst = jest.fn(async () =>
    items === null
      ? null
      : {
          id: SHIP,
          shipmentNumber: 'SH-1',
          awbNumber: 'AWB-1',
          rtoReceivedAt: new Date('2026-09-13T05:00:00Z'),
          orderShipments: [{ order: { id: 'order-1', status: OrderStatus.RTO_RECEIVED } }],
          items,
        },
  );
  // Applies the where-clause, as the database would.
  const imageFindMany = jest.fn(async ({ where }: { where: { variantId: { in: string[] } } }) => {
    if (opts.catalogFails) throw new Error('catalogue down');
    return IMAGES.filter((i) => where.variantId.in.includes(i.variantId));
  });
  const variantFindMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, product: { description: null } })),
  );
  const presignGetUrl = jest.fn(async (key: string) => `signed:${key}`);

  const prisma = {
    client: {
      shipment: { findFirst: shipmentFindFirst },
      productImage: { findMany: imageFindMany },
      productVariant: { findMany: variantFindMany },
    },
  } as unknown as PrismaService;
  const catalog = new CatalogReadService(prisma, { presignGetUrl } as unknown as SpacesService);
  const thumbSpy = jest.spyOn(catalog, 'thumbnailUrlsByVariant');
  const svc = new RtoReadService(prisma, catalog);
  return { svc, imageFindMany, presignGetUrl, thumbSpy };
}

describe('RtoReadService.loadShipment — line thumbnails', () => {
  it('carries a presigned THUMBNAIL per line', async () => {
    const { svc } = make();
    const detail = await svc.loadShipment(SHIP);
    expect(detail.items[0]?.thumbnailUrl).toBe(
      'signed:sellers/s1/variants/v-sunglass/thumbnails/tok.webp',
    );
  });

  it('is null for a variant with no image, and the line is still there', async () => {
    const { svc } = make({ items: [line('si-1', 'v-sunglass'), line('si-2', 'v-no-photo')] });
    const detail = await svc.loadShipment(SHIP);
    expect(detail.items).toHaveLength(2);
    expect(detail.items[1]?.thumbnailUrl).toBeNull();
  });

  it("presigns only the variants on THIS parcel, never another's", async () => {
    const { svc, imageFindMany, presignGetUrl } = make({
      items: [line('si-1', 'v-sunglass'), line('si-2', 'v-no-photo')],
    });
    await svc.loadShipment(SHIP);
    expect(imageFindMany.mock.calls[0]?.[0].where.variantId.in).toEqual([
      'v-sunglass',
      'v-no-photo',
    ]);
    expect(presignGetUrl.mock.calls.map((c) => c[0])).toEqual([
      'sellers/s1/variants/v-sunglass/thumbnails/tok.webp',
    ]);
  });

  it('is ONE catalogue query for every line, not one per line', async () => {
    const { svc, imageFindMany, thumbSpy } = make({
      items: [
        line('si-1', 'v-sunglass'),
        line('si-2', 'v-no-photo'),
        // Two lines of the same product must not ask twice.
        line('si-3', 'v-sunglass'),
      ],
    });
    const detail = await svc.loadShipment(SHIP);
    expect(thumbSpy).toHaveBeenCalledTimes(1);
    expect(imageFindMany).toHaveBeenCalledTimes(1);
    expect(detail.items[2]?.thumbnailUrl).toBe(detail.items[0]?.thumbnailUrl);
  });

  it('fails OPEN: a catalogue failure costs the pictures, never the screen', async () => {
    const { svc } = make({ catalogFails: true });
    const detail = await svc.loadShipment(SHIP);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.thumbnailUrl).toBeNull();
  });

  it('asks the catalogue nothing for a shipment that does not exist', async () => {
    const { svc, thumbSpy, presignGetUrl } = make({ items: null });
    await expect(svc.loadShipment(SHIP)).rejects.toBeInstanceOf(NotFoundException);
    expect(thumbSpy).not.toHaveBeenCalled();
    expect(presignGetUrl).not.toHaveBeenCalled();
  });
});
