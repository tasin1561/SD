'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { PackageOpen, SearchX } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money, Num, ProductThumb } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { useStoreCatalogue, type StoreCatalogueItem } from '@/lib/catalogue-hooks';
import { RmSection } from '../wallet/_components/rm-parts';

/**
 * RS-3 — the products this store may sell: what it pays the seller for
 * each (the transfer price), the retail range it may sell at, the
 * seller's suggestion, and how many are available to it. Only what the
 * seller turned on for this store; nothing about the seller's own cost
 * or stock — those columns are not in the response, so they are simply
 * absent here.
 */
export default function CataloguePage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const catalogue = useStoreCatalogue();
  const [search, setSearch] = useState('');
  const seller = me?.seller.companyName ?? t('cat.clientFallback');

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = catalogue.data?.items ?? [];
    return q === ''
      ? all
      : all.filter((i) => i.title.toLowerCase().includes(q) || i.skuCode.toLowerCase().includes(q));
  }, [catalogue.data, search]);

  const header = <PageHeader title={t('cat.title')} subtitle={t('cat.subtitle', { seller })} />;

  if (catalogue.isPending) {
    return (
      <div className="rm-page">
        {header}
        <SkeletonRows rows={6} cols={5} label={t('cat.loading')} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="rm-page">
        {header}
        <ErrorState message={verdict(catalogue.error, t)} retry={() => void catalogue.refetch()} />
      </div>
    );
  }

  return (
    <div className="rm-page">
      {header}
      <RmSection>
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: t('cat.search.label'),
            placeholder: t('cat.search.placeholder'),
          }}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={
              catalogue.data.items.length === 0 ? <PackageOpen size={22} /> : <SearchX size={22} />
            }
            title={catalogue.data.items.length === 0 ? t('cat.empty.none') : t('cat.empty.noMatch')}
            description={
              catalogue.data.items.length === 0 ? t('cat.empty.body', { seller }) : undefined
            }
          />
        ) : (
          <Table caption={t('cat.caption')}>
            <THead>
              <Tr>
                <Th>{t('cat.col.product')}</Th>
                {/* The header carries its own label: the tooltip card's text sits
                    inside the <th>, and the mobile card layout stamps each
                    column's header onto its cells. */}
                <Th data-label={t('cat.col.youPay')}>
                  <GlossaryTerm
                    title={t('cat.transfer.title')}
                    description={t('cat.transfer.body', { seller })}
                  >
                    {t('cat.col.youPay')}
                  </GlossaryTerm>
                </Th>
                <Th>{t('cat.col.sellBetween')}</Th>
                <Th>{t('cat.col.suggested')}</Th>
                <Th>{t('cat.col.available')}</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((i) => (
                <ItemRow key={i.variantId} item={i} />
              ))}
            </TBody>
          </Table>
        )}
      </RmSection>
    </div>
  );
}

function ItemRow({ item: i }: { item: StoreCatalogueItem }): ReactElement {
  const t = useT();
  return (
    <Tr>
      <Td>
        <div className="rm-product">
          <ProductThumb src={i.imageUrls[0] ?? null} size={44} alt={i.title} />
          <div className="rm-product__text">
            <div className="rm-product__title">{i.title}</div>
            <div className="rm-faint">
              <span className="sk-ident">{i.skuCode}</span>
              {i.variantLabel ? ` · ${i.variantLabel}` : ''}
            </div>
            {i.description ? <div className="rm-product__desc">{i.description}</div> : null}
          </div>
        </div>
      </Td>
      <Td>
        <Money amount={i.transferPriceInr} convert={false} />
      </Td>
      <Td>
        {i.minRetailInr === null && i.maxRetailInr === null ? (
          t('cat.range.any')
        ) : (
          <span className="rm-range">
            {i.minRetailInr !== null && i.maxRetailInr !== null
              ? richMessage(t('cat.range.between'), {
                  min: <Money amount={i.minRetailInr} convert={false} />,
                  max: <Money amount={i.maxRetailInr} convert={false} />,
                })
              : i.minRetailInr === null
                ? richMessage(t('cat.range.upTo'), {
                    max: <Money amount={i.maxRetailInr ?? '0'} convert={false} />,
                  })
                : richMessage(t('cat.range.atLeast'), {
                    min: <Money amount={i.minRetailInr} convert={false} />,
                  })}
          </span>
        )}
      </Td>
      <Td>
        {i.suggestedRetailInr === null ? (
          '—'
        ) : (
          <Money amount={i.suggestedRetailInr} convert={false} />
        )}
      </Td>
      <Td>
        <Num value={i.availableQty} />
      </Td>
    </Tr>
  );
}
