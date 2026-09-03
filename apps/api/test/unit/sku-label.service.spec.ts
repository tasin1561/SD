import { NotFoundException } from '@nestjs/common';
import {
  SkuLabelService,
  scannableCodeFor,
} from '../../src/modules/warehouse-printing/services/sku-label.service';
import { encodeCode128B } from '../../src/common/barcode/code128';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function variant(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'v-1',
    skuCode: 'W-1-STD',
    barcode: null,
    variantLabel: 'Standard',
    product: { name: 'Widget' },
    ...over,
  };
}

function make(receipt: AnyArgs | null, variants: AnyArgs[] = []) {
  const client = {
    goodsReceipt: { findUnique: jest.fn(async () => receipt) },
    productVariant: { findMany: jest.fn(async () => variants) },
  };
  return new SkuLabelService({ client } as unknown as PrismaService);
}

describe('scannableCodeFor — what goes on the sticker', () => {
  it('uses the seller’s own barcode when they have one', () => {
    expect(scannableCodeFor({ barcode: '5012345678900', skuCode: 'W-1' })).toEqual({
      value: '5012345678900',
      usedSkuCode: false,
    });
  });

  it('falls back to the SKU CODE, and never mints a new one', () => {
    // Minting `SDS-XXXX` and saving it was the obvious first design. It
    // has a trap: the day the seller adds their real EAN, every sticker
    // already on a shelf stops resolving. The SKU code is a value they
    // already own and the bench accepts BOTH, so a label printed today
    // survives that.
    expect(scannableCodeFor({ barcode: null, skuCode: 'W-1-STD' })).toEqual({
      value: 'W-1-STD',
      usedSkuCode: true,
    });
  });

  it('treats a blank barcode as absent', () => {
    expect(scannableCodeFor({ barcode: '   ', skuCode: 'W-1' }).usedSkuCode).toBe(true);
  });
});

describe('SkuLabelService.forGoodsReceipt', () => {
  it('prints one sticker per unit RECEIVED, not per unit expected', async () => {
    // Labelling what was ordered rather than what turned up leaves
    // spare stickers in a drawer, and a spare sticker is a duplicate
    // waiting to be stuck on the wrong thing.
    const svc = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 7, variant: variant() }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1');
    expect(sheet.totalStickers).toBe(7);
    expect(sheet.labels[0]).toMatchObject({ value: 'W-1-STD', usedSkuCode: true, quantity: 7 });
  });

  it('skips a line nobody counted in', async () => {
    const svc = make({
      receiptNumber: 'GR-1',
      lines: [
        { receivedQty: 0, variant: variant({ id: 'v-none' }) },
        { receivedQty: 2, variant: variant({ id: 'v-yes' }) },
      ],
    });
    const sheet = await svc.forGoodsReceipt('gr-1');
    expect(sheet.labels).toHaveLength(1);
    expect(sheet.labels[0]?.variantId).toBe('v-yes');
  });

  it('encodes the barcode ON THE SERVER — the client only draws', async () => {
    const svc = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 1, variant: variant({ barcode: '5012345678900' }) }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1');
    expect(sheet.labels[0]?.barcodeWidths).toEqual(encodeCode128B('5012345678900'));
  });

  it('an unencodable code yields NULL widths rather than failing the sheet', async () => {
    // One bad SKU must not cost the warehouse the other forty labels.
    const svc = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 1, variant: variant({ skuCode: 'CAFÉ-1' }) }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1');
    expect(sheet.labels[0]?.barcodeWidths).toBeNull();
    expect(sheet.labels[0]?.value).toBe('CAFÉ-1');
  });

  it('404s a receipt that does not exist', async () => {
    const svc = make(null);
    await expect(svc.forGoodsReceipt('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SkuLabelService.forVariants — the reprint', () => {
  it('returns the asked-for quantity per SKU', async () => {
    const svc = make(null, [variant({ id: 'v-1' }), variant({ id: 'v-2', skuCode: 'W-2' })]);
    const sheet = await svc.forVariants([
      { variantId: 'v-1', quantity: 3 },
      { variantId: 'v-2', quantity: 1 },
    ]);
    expect(sheet.totalStickers).toBe(4);
  });

  it('404s an unknown variant rather than silently printing fewer', async () => {
    const svc = make(null, []);
    await expect(svc.forVariants([{ variantId: 'ghost', quantity: 1 }])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
