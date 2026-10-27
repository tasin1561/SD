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
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const REASON_WORDS = (t: Translate<MessageKey>) =>
  ({
    NOT_ENABLED: t('resellerStoresStoreIdCatalogueTerms.notSold'),
    NO_TRANSFER_PRICE: t('resellerStoresStoreIdCatalogueTerms.noPrice'),
    VARIANT_NOT_RESELLABLE: t('resellerStoresStoreIdCatalogueTerms.productArchived'),
  }) as const;

/** RS-3 — the store's catalogue terms, read-only (the seller sets them). */
export function CatalogueTerms({ storeId }: { storeId: string }): ReactElement {
  const t = useT();
  const terms = useAdminResellerCatalogue(storeId);
  const body = ((): ReactElement => {
    if (terms.isPending)
      return (
        <SkeletonRows
          rows={4}
          cols={6}
          label={t('resellerStoresStoreIdCatalogueTerms.loadingCatalogueTerms')}
        />
      );
    if (terms.isError) {
      return <ErrorState message={serverVerdict(terms.error)} retry={() => void terms.refetch()} />;
    }
    const rows = terms.data.rows.filter((r) => r.enabled || r.stockMode === 'SET_ASIDE');
    if (rows.length === 0) {
      return (
        <EmptyState
          bare
          title={t('resellerStoresStoreIdCatalogueTerms.theClientHasNotGiven')}
          description={t('resellerStoresStoreIdCatalogueTerms.productsAppearHereOnceThe')}
        />
      );
    }
    return (
      <Table caption={t('resellerStoresStoreIdCatalogueTerms.catalogueTerms')}>
        <THead>
          <Tr>
            <Th>{t('resellerStoresStoreIdCatalogueTerms.product')}</Th>
            <Th>{t('resellerStoresStoreIdCatalogueTerms.sold')}</Th>
            <Th align="right">{t('resellerStoresStoreIdCatalogueTerms.transferPrice')}</Th>
            <Th>{t('resellerStoresStoreIdCatalogueTerms.stock')}</Th>
            <Th align="right">{t('resellerStoresStoreIdCatalogueTerms.availableReal')}</Th>
            <Th align="right">{t('resellerStoresStoreIdCatalogueTerms.storeSees')}</Th>
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
                  label={
                    r.sellable
                      ? t('resellerStoresStoreIdCatalogueTerms.yes')
                      : REASON_WORDS(t)[r.notSellableReason ?? 'NOT_ENABLED']
                  }
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
                      {r.priceSource === 'OVERRIDE'
                        ? t('resellerStoresStoreIdCatalogueTerms.storeSOwn')
                        : ' (default)'}
                    </span>
                  </span>
                )}
              </Td>
              <Td>
                {r.stockMode === 'SET_ASIDE'
                  ? t('resellerStoresStoreIdCatalogueTerms.setAside', { value: r.setAsideQty ?? 0 })
                  : t('resellerStoresStoreIdCatalogueTerms.shared')}
                {r.hiddenPercent > 0
                  ? t('resellerStoresStoreIdCatalogueTerms.hidden', {
                      hiddenPercent: r.hiddenPercent,
                    })
                  : ''}
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
      title={t('resellerStoresStoreIdCatalogueTerms.catalogueTerms')}
      note={t('resellerStoresStoreIdCatalogueTerms.whatTheClientLetsThis')}
      flush
    >
      {body}
    </AcSection>
  );
}
