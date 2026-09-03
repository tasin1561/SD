import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NON_PICKABLE_BIN_TYPES } from '../../inventory-shared/bin-policy.service';
import type { BinType } from '@skydrop/db';

export interface ProductLocationRow {
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly barcode: string | null;
  readonly sellerCompanyName: string | null;
  readonly locations: ReadonlyArray<{
    warehouseName: string;
    zoneName: string | null;
    binCode: string;
    binType: string;
    qtyOnHand: number;
    pickable: boolean;
  }>;
}

/**
 * "Where is this thing?"
 *
 * The question a picker asks when a line on the sheet cannot be found,
 * or when somebody is putting stock away and wants to know where the
 * rest of it lives. Searchable by product name, SKU or barcode, because
 * those are the three things printed on what they are holding.
 *
 * Every bin is shown, INCLUDING the non-pickable ones (returns bench,
 * damaged, quarantine) — marked as such. Hiding them answers the
 * question wrongly: the stock IS there, it just cannot be sold from
 * there (BIN-2), and somebody hunting a missing unit needs to know it is
 * sitting on the returns bench rather than believe it is gone.
 */
@Injectable()
export class ProductLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit = 20): Promise<ProductLocationRow[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    const variants = await this.prisma.client.productVariant.findMany({
      where: {
        deletedAt: null,
        OR: [
          { skuCode: { contains: q, mode: 'insensitive' } },
          { barcode: { contains: q, mode: 'insensitive' } },
          { variantLabel: { contains: q, mode: 'insensitive' } },
          { product: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      take: Math.min(limit, 50),
      select: {
        id: true,
        skuCode: true,
        barcode: true,
        variantLabel: true,
        product: { select: { name: true } },
        seller: { select: { companyName: true } },
      },
    });
    if (variants.length === 0) return [];

    const levels = await this.prisma.client.stockLevel.findMany({
      where: {
        variantId: { in: variants.map((v) => v.id) },
        // A bin holding nothing is not a location, it is an empty shelf.
        qtyOnHand: { gt: 0 },
      },
      select: {
        variantId: true,
        qtyOnHand: true,
        warehouse: { select: { name: true } },
        bin: { select: { code: true, type: true, zone: { select: { name: true } } } },
      },
      orderBy: { qtyOnHand: 'desc' },
    });

    const byVariant = new Map<string, ProductLocationRow['locations'][number][]>();
    for (const l of levels) {
      const list = byVariant.get(l.variantId) ?? [];
      const binType = l.bin?.type ?? 'FLOOR';
      list.push({
        warehouseName: l.warehouse?.name ?? '—',
        zoneName: l.bin?.zone?.name ?? null,
        binCode: l.bin?.code ?? 'FLOOR',
        binType,
        qtyOnHand: l.qtyOnHand,
        // The ONE shared constant (BIN-2), never a second list.
        pickable: !NON_PICKABLE_BIN_TYPES.includes(binType as BinType),
      });
      byVariant.set(l.variantId, list);
    }

    return variants.map((v) => ({
      variantId: v.id,
      skuCode: v.skuCode,
      productName: v.product?.name ?? '—',
      variantLabel: v.variantLabel,
      barcode: v.barcode,
      sellerCompanyName: v.seller?.companyName ?? null,
      locations: byVariant.get(v.id) ?? [],
    }));
  }
}
