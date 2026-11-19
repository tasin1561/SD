'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import type { SellerProductView } from '@skydrop/api-client';
import { useT } from '@/i18n/client';

/** How many SKUs a row shows before the rest fold into "+N more". */
export const SKU_CHIPS_SHOWN = 4;

type Sku = NonNullable<SellerProductView['skus']>[number];

/** A draft or archived variant is shown quieter than one that can be sold. */
function isQuiet(sku: Sku): boolean {
  return sku.status === 'DRAFT' || sku.status === 'ARCHIVED';
}

/**
 * The SKUs of one product, under its name in the catalogue list.
 *
 * A seller looks a product up by the code printed on its label as often
 * as by its name, so the codes are on the row instead of one click in.
 * Each is a small chip with its variant after it ("AV-BLK · Black").
 * Four are shown; the rest are a "+N more" link to the product, where
 * every SKU is listed. Nothing is drawn for a product without SKUs, or
 * for an answer from before the list carried them.
 */
export function ProductSkus({
  productId,
  skus,
}: {
  readonly productId: string;
  readonly skus: SellerProductView['skus'];
}): ReactElement | null {
  const t = useT();
  if (skus === undefined || skus.length === 0) return null;
  const shown = skus.slice(0, SKU_CHIPS_SHOWN);
  const rest = skus.length - shown.length;
  return (
    <ul className="prd-skus" aria-label={t('productList.skuList')}>
      {shown.map((sku) => {
        const quiet = isQuiet(sku);
        return (
          <li
            key={sku.skuCode}
            className={quiet ? 'prd-sku prd-sku--quiet' : 'prd-sku'}
            {...(quiet ? { 'data-status': sku.status } : {})}
          >
            <span className="prd-sku__code">{sku.skuCode}</span>
            {sku.variantLabel !== null && sku.variantLabel !== '' && (
              <span className="prd-sku__label">
                <span aria-hidden> · </span>
                {sku.variantLabel}
              </span>
            )}
            {/* Quieter colour alone says nothing to a screen reader, or to
                someone who cannot tell the two greys apart. */}
            {quiet && (
              <span className="prd-sku__state">
                {sku.status === 'DRAFT' ? t('productList.skuDraft') : t('productList.skuArchived')}
              </span>
            )}
          </li>
        );
      })}
      {rest > 0 && (
        <li className="prd-sku prd-sku--more">
          <Link href={`/products/${productId}`}>{t('productList.moreSkus', { n: rest })}</Link>
        </li>
      )}
    </ul>
  );
}
