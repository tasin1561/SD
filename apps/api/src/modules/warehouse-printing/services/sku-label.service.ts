import { Injectable, NotFoundException } from '@nestjs/common';
import { printableBarcode } from '../../../common/barcode/printable-barcode';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface SkuLabel {
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  /** What the symbol encodes — the seller's own barcode when they have
   *  one, otherwise the SKU code. See `scannableCodeFor`. */
  readonly value: string;
  /** True when we fell back to the SKU code because the seller has no
   *  barcode of their own. Shown on screen so it is a visible choice. */
  readonly usedSkuCode: boolean;
  readonly barcodeWidths: readonly number[] | null;
  /** How many stickers of this label to print. */
  readonly quantity: number;
}

export interface SkuLabelSheet {
  readonly title: string;
  readonly labels: readonly SkuLabel[];
  readonly totalStickers: number;
}

/**
 * What a scanner should read off a product: the seller's own barcode if
 * they have one, otherwise the SKU code.
 *
 * NOT a generated code, and nothing is persisted. Minting an
 * `SDS-XXXX` and saving it to `product_variants.barcode` was the
 * obvious first design and it has a trap in it: the day a seller adds
 * the real EAN from their supplier, every sticker already on a shelf
 * silently stops resolving. The SKU code is a value the seller already
 * owns, already unique per seller, and already printed on their own
 * paperwork — so a label made today still scans after they fill the
 * barcode field in, because the bench accepts BOTH.
 */
export function scannableCodeFor(v: { barcode: string | null; skuCode: string }): {
  value: string;
  usedSkuCode: boolean;
} {
  const own = v.barcode?.trim();
  if (own !== undefined && own.length > 0) return { value: own, usedSkuCode: false };
  return { value: v.skuCode, usedSkuCode: true };
}

/**
 * Stickers for the products themselves — every product, both inventory
 * modes.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The packing bench verifies a box by scanning what goes into it, and
 * it resolves a scan to a serial (STRICT) or to the product's barcode
 * (NORMAL). Nothing ever PRINTED the second one. So a seller whose
 * goods carry no manufacturer barcode — which was all five variants in
 * production — had nothing on the item for a packer to scan, and the
 * contents check could not run at all.
 *
 * STRICT units get their own unique serial from the consignment label
 * sheet. This is the other half: one sticker per physical unit carrying
 * the SKU-level code, so every product in the building can be scanned
 * whichever mode it runs in. A NORMAL scan proves "this is the right
 * product"; a STRICT scan additionally proves "this is the right ONE".
 *
 * Returns DATA, not a PDF — same reasoning as the consignment sheet: a
 * warehouse prints to whatever label stock the bench has, and a
 * server-rendered sheet would need its size, orientation and DPI as
 * parameters to be wrong in a different way each time.
 */
@Injectable()
export class SkuLabelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Labels for everything on a goods receipt, one sticker per unit
   * counted in.
   *
   * Receiving is the moment to label: the goods are in front of
   * somebody, the counts are known, and every later step assumes the
   * sticker is already on. Uses the RECEIVED quantity, not the expected
   * one — labelling what was ordered rather than what turned up puts
   * spare stickers in a drawer, and a spare sticker is a duplicate
   * waiting to be stuck on the wrong thing.
   */
  async forGoodsReceipt(goodsReceiptId: string): Promise<SkuLabelSheet> {
    const receipt = await this.prisma.client.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      select: {
        receiptNumber: true,
        lines: {
          select: {
            receivedQty: true,
            variant: {
              select: {
                id: true,
                skuCode: true,
                barcode: true,
                variantLabel: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (receipt === null) {
      throw new NotFoundException({
        code: 'GOODS_RECEIPT_NOT_FOUND',
        message: `Goods receipt ${goodsReceiptId} not found`,
      });
    }

    const labels = receipt.lines
      .filter((l) => l.receivedQty > 0)
      .map((l) => this.toLabel(l.variant, l.receivedQty));

    return {
      title: `Product labels — ${receipt.receiptNumber}`,
      labels,
      totalStickers: labels.reduce((n, l) => n + l.quantity, 0),
    };
  }

  /** Ad-hoc: reprint for a chosen SKU, for the sticker that fell off. */
  async forVariants(
    input: ReadonlyArray<{ variantId: string; quantity: number }>,
  ): Promise<SkuLabelSheet> {
    const ids = input.map((i) => i.variantId);
    const variants = await this.prisma.client.productVariant.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        skuCode: true,
        barcode: true,
        variantLabel: true,
        product: { select: { name: true } },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    const labels: SkuLabel[] = [];
    for (const want of input) {
      const v = byId.get(want.variantId);
      if (v === undefined) {
        throw new NotFoundException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant ${want.variantId} not found`,
        });
      }
      labels.push(this.toLabel(v, want.quantity));
    }
    return {
      title: 'Product labels',
      labels,
      totalStickers: labels.reduce((n, l) => n + l.quantity, 0),
    };
  }

  private toLabel(
    v: {
      id: string;
      skuCode: string;
      barcode: string | null;
      variantLabel: string | null;
      product: { name: string };
    },
    quantity: number,
  ): SkuLabel {
    const { value, usedSkuCode } = scannableCodeFor(v);
    return {
      variantId: v.id,
      skuCode: v.skuCode,
      productName: v.product.name,
      variantLabel: v.variantLabel,
      value,
      usedSkuCode,
      barcodeWidths: printableBarcode(value).widths,
      quantity,
    };
  }
}
