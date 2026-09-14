'use client';

import type { ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Num,
  ProductThumb,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    if (terms.isPending) return <LoadingState label="Loading catalogue terms" rows={4} />;
    if (terms.isError) {
      return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
    }
    const rows = terms.data.rows.filter((r) => r.enabled || r.stockMode === 'SET_ASIDE');
    if (rows.length === 0) {
      return (
        <EmptyState
          title="The seller has not given this store any products yet"
          description="Products appear here once the seller turns them on for the store."
        />
      );
    }
    return (
      <Table>
        <THead>
          <Tr>
            <Th>Product</Th>
            <Th>Sold</Th>
            <Th>Transfer price</Th>
            <Th>Stock</Th>
            <Th>Available (real)</Th>
            <Th>Store sees</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.variantId}>
              <Td>
                <div className="flex items-center gap-3">
                  <ProductThumb src={r.thumbnailUrl} size={32} alt={r.productName} />
                  <div>
                    <div>{r.overlayTitle ?? r.productName}</div>
                    <div className="text-text-muted text-xs">{r.skuCode}</div>
                  </div>
                </div>
              </Td>
              <Td>{r.sellable ? 'Yes' : REASON_WORDS[r.notSellableReason ?? 'NOT_ENABLED']}</Td>
              <Td>
                {r.effective === null ? (
                  '—'
                ) : (
                  <span className="whitespace-nowrap">
                    <Money amount={r.effective.transferPriceInr} convert={false} />
                    <span className="text-text-muted text-xs">
                      {r.priceSource === 'OVERRIDE' ? ' (store’s own)' : ' (default)'}
                    </span>
                  </span>
                )}
              </Td>
              <Td>
                {r.stockMode === 'SET_ASIDE' ? `Set aside ${r.setAsideQty ?? 0}` : 'Shared'}
                {r.hiddenPercent > 0 ? ` · ${r.hiddenPercent}% hidden` : ''}
              </Td>
              <Td>
                <Num value={r.realAvailable} />
              </Td>
              <Td>
                <Num value={r.visibleQty} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  })();
  return (
    <Section
      title="Catalogue terms"
      subtitle="What the seller lets this store sell, at what price, and how much stock it is shown."
    >
      {body}
    </Section>
  );
}
