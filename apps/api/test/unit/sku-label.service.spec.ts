import { NotFoundException } from '@nestjs/common';
import {
  SKU_LABELS_BUILT_ACTION,
  SkuLabelService,
  scannableCodeFor,
} from '../../src/modules/warehouse-printing/services/sku-label.service';
import { encodeCode128B } from '../../src/common/barcode/code128';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

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

function make(receipt: AnyArgs | null, variants: AnyArgs[] = [], auditRows: AnyArgs[] = []) {
  const client = {
    goodsReceipt: { findUnique: jest.fn(async () => receipt) },
    productVariant: { findMany: jest.fn(async () => variants) },
    auditLog: { findMany: jest.fn(async () => auditRows) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new SkuLabelService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { svc, audit, client };
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
    const { svc } = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 7, variant: variant() }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1', 'staff-1');
    expect(sheet.totalStickers).toBe(7);
    expect(sheet.labels[0]).toMatchObject({ value: 'W-1-STD', usedSkuCode: true, quantity: 7 });
  });

  it('skips a line nobody counted in', async () => {
    const { svc } = make({
      receiptNumber: 'GR-1',
      lines: [
        { receivedQty: 0, variant: variant({ id: 'v-none' }) },
        { receivedQty: 2, variant: variant({ id: 'v-yes' }) },
      ],
    });
    const sheet = await svc.forGoodsReceipt('gr-1', 'staff-1');
    expect(sheet.labels).toHaveLength(1);
    expect(sheet.labels[0]?.variantId).toBe('v-yes');
  });

  it('encodes the barcode ON THE SERVER — the client only draws', async () => {
    const { svc } = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 1, variant: variant({ barcode: '5012345678900' }) }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1', 'staff-1');
    expect(sheet.labels[0]?.barcodeWidths).toEqual(encodeCode128B('5012345678900'));
  });

  it('an unencodable code yields NULL widths rather than failing the sheet', async () => {
    // One bad SKU must not cost the warehouse the other forty labels.
    const { svc } = make({
      receiptNumber: 'GR-1',
      lines: [{ receivedQty: 1, variant: variant({ skuCode: 'CAFÉ-1' }) }],
    });
    const sheet = await svc.forGoodsReceipt('gr-1', 'staff-1');
    expect(sheet.labels[0]?.barcodeWidths).toBeNull();
    expect(sheet.labels[0]?.value).toBe('CAFÉ-1');
  });

  it('404s a receipt that does not exist, and records nothing', async () => {
    const { svc, audit } = make(null);
    await expect(svc.forGoodsReceipt('nope', 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('records who built the sheet, from which receipt, and every SKU with its quantity', async () => {
    const { svc, audit } = make({
      receiptNumber: 'GR-2026-09-0001',
      lines: [
        { receivedQty: 3, variant: variant({ id: 'v-1', skuCode: 'AVIATO-BLAC-BLAC' }) },
        { receivedQty: 2, variant: variant({ id: 'v-2', skuCode: 'AVIATO-GREE-BLAC' }) },
      ],
    });
    await svc.forGoodsReceipt('gr-1', 'staff-1');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SKU_LABELS_BUILT_ACTION,
        staffUserId: 'staff-1',
        entityType: 'goods_receipt',
        entityId: 'gr-1',
        severity: 'LOW',
        metadata: {
          source: 'GOODS_RECEIPT',
          receiptNumber: 'GR-2026-09-0001',
          totalStickers: 5,
          lines: [
            {
              variantId: 'v-1',
              skuCode: 'AVIATO-BLAC-BLAC',
              code: 'AVIATO-BLAC-BLAC',
              quantity: 3,
            },
            {
              variantId: 'v-2',
              skuCode: 'AVIATO-GREE-BLAC',
              code: 'AVIATO-GREE-BLAC',
              quantity: 2,
            },
          ],
        },
      }),
    );
  });
});

describe('SkuLabelService.forVariants — the reprint', () => {
  it('returns the asked-for quantity per SKU', async () => {
    const { svc } = make(null, [variant({ id: 'v-1' }), variant({ id: 'v-2', skuCode: 'W-2' })]);
    const sheet = await svc.forVariants(
      [
        { variantId: 'v-1', quantity: 3 },
        { variantId: 'v-2', quantity: 1 },
      ],
      'staff-1',
    );
    expect(sheet.totalStickers).toBe(4);
  });

  it('404s an unknown variant rather than silently printing fewer, and records nothing', async () => {
    const { svc, audit } = make(null, []);
    await expect(
      svc.forVariants([{ variantId: 'ghost', quantity: 1 }], 'staff-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('records a shelf reprint as FIND_A_PRODUCT, naming the one variant', async () => {
    const { svc, audit } = make(null, [variant({ id: 'v-1', skuCode: 'AVIATO-BLAC-BLAC' })]);
    await svc.forVariants([{ variantId: 'v-1', quantity: 102 }], 'staff-2');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SKU_LABELS_BUILT_ACTION,
        staffUserId: 'staff-2',
        entityType: 'product_variant',
        entityId: 'v-1',
        metadata: expect.objectContaining({
          source: 'FIND_A_PRODUCT',
          receiptNumber: null,
          totalStickers: 102,
        }),
      }),
    );
  });
});

describe('SkuLabelService.history — what was printed', () => {
  it('reads the audit rows back, newest first, with who and each SKU', async () => {
    const at = new Date('2026-09-15T16:00:00Z');
    const { svc, client } = make(
      null,
      [],
      [
        {
          createdAt: at,
          staffUser: { emailDisplay: 'packer@skydrop.online' },
          metadata: {
            source: 'FIND_A_PRODUCT',
            receiptNumber: null,
            totalStickers: 102,
            lines: [{ variantId: 'v-1', skuCode: 'AVIATO-BLAC-BLAC', code: 'x', quantity: 102 }],
          },
        },
      ],
    );
    const prints = await svc.history();
    expect(client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: SKU_LABELS_BUILT_ACTION },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(prints).toEqual([
      {
        at: at.toISOString(),
        by: 'packer@skydrop.online',
        source: 'FIND_A_PRODUCT',
        receiptNumber: null,
        totalStickers: 102,
        lines: [{ skuCode: 'AVIATO-BLAC-BLAC', quantity: 102 }],
      },
    ]);
  });

  it('survives a row with odd metadata rather than failing the list', async () => {
    const { svc } = make(
      null,
      [],
      [{ createdAt: new Date('2026-09-15T16:00:00Z'), staffUser: null, metadata: null }],
    );
    const [p] = await svc.history();
    expect(p).toMatchObject({ by: null, source: null, totalStickers: 0, lines: [] });
  });
});
