'use client';

import type { ReactElement } from 'react';
import { Money, Num, ProductThumb } from '@skydrop/ui/components';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcSection } from '../../../settings/_components/ac-parts';
import { serverVerdict } from '@/lib/server-verdict';
import { useAdminResellerCatalogue } from '@/lib/reseller-catalogue-hooks';

const REASON_WORDS = {
  NOT_ENABLED: 'Not sold',
  NO_TRANSFER_PRICE: 'No price',
  VARIANT_NOT_RESELLABLE: 'Product archived',
} as const;

/** RS-3 — the store's catalogue terms, read-only (the seller sets them). */
export function CatalogueTerms({ storeId }: { storeId: string }): ReactElement {
  const terms = useAdminResellerCatalogue(storeId);
  const body = ((): ReactElement => {
    if (terms.isPending) return <SkeletonRows rows={4} cols={6} label="Loading catalogue terms" />;
    if (terms.isError) {
      return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
    }
    const rows = terms.data.rows.filter((r) => r.enabled || r.stockMode === 'SET_ASIDE');
    if (rows.length === 0) {
      return (
        <EmptyState
          bare
          title="The seller has not given this store any products yet"
          description="Products appear here once the seller turns them on for the store."
        />
      );
    }
    return (
      <Table caption="Catalogue terms">
        <THead>
          <Tr>
            <Th>Product</Th>
            <Th>Sold</Th>
            <Th align="right">Transfer price</Th>
            <Th>Stock</Th>
            <Th align="right">Available (real)</Th>
            <Th align="right">Store sees</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.variantId}>
              <Td>
                <div className="ac-inline">
                  <ProductThumb src={r.thumbnailUrl} size={32} alt={r.productName} />
                  <div>
                    <span className="ac-cell-main">{r.overlayTitle ?? r.productName}</span>
                    <span className="ac-cell-sub sk-ident">{r.skuCode}</span>
                  </div>
                </div>
              </Td>
              <Td>
                <StatusChip
                  kind={r.sellable ? 'delivered' : 'neutral'}
                  label={r.sellable ? 'Yes' : REASON_WORDS[r.notSellableReason ?? 'NOT_ENABLED']}
                  size="sm"
                />
              </Td>
              <Td align="right">
                {r.effective === null ? (
                  '—'
                ) : (
                  <span>
                    <Money amount={r.effective.transferPriceInr} convert={false} />
                    <span className="ac-cell-sub">
                      {r.priceSource === 'OVERRIDE' ? ' (store’s own)' : ' (default)'}
                    </span>
                  </span>
                )}
              </Td>
              <Td>
                {r.stockMode === 'SET_ASIDE' ? `Set aside ${r.setAsideQty ?? 0}` : 'Shared'}
                {r.hiddenPercent > 0 ? ` · ${r.hiddenPercent}% hidden` : ''}
              </Td>
              <Td align="right">
                <Num value={r.realAvailable} />
              </Td>
              <Td align="right">
                <Num value={r.visibleQty} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  })();
  return (
    <AcSection
      title="Catalogue terms"
      note="What the seller lets this store sell, at what price, and how much stock it is shown."
      flush
    >
      {body}
    </AcSection>
  );
}
