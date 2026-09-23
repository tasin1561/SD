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
import { serverVerdict } from '@/lib/server-verdict';
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
  const me = useStoreIdentity();
  const catalogue = useStoreCatalogue();
  const [search, setSearch] = useState('');
  const seller = me?.seller.companyName ?? 'The seller';

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = catalogue.data?.items ?? [];
    return q === ''
      ? all
      : all.filter((i) => i.title.toLowerCase().includes(q) || i.skuCode.toLowerCase().includes(q));
  }, [catalogue.data, search]);

  const header = (
    <PageHeader
      title="Catalogue"
      subtitle={`The products ${seller} lets you sell, what you pay for each, and how many are available.`}
    />
  );

  if (catalogue.isPending) {
    return (
      <div className="rm-page">
        {header}
        <SkeletonRows rows={6} cols={5} label="Loading the catalogue" />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="rm-page">
        {header}
        <ErrorState
          message={serverVerdict(catalogue.error)}
          retry={() => void catalogue.refetch()}
        />
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
            label: 'Search by name or SKU',
            placeholder: 'Search name or SKU',
          }}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={
              catalogue.data.items.length === 0 ? <PackageOpen size={22} /> : <SearchX size={22} />
            }
            title={
              catalogue.data.items.length === 0 ? 'No products yet' : 'Nothing matches that search'
            }
            description={
              catalogue.data.items.length === 0
                ? `${seller} has not given this store any products yet. Ask them to turn some on.`
                : undefined
            }
          />
        ) : (
          <Table caption="Products">
            <THead>
              <Tr>
                <Th>Product</Th>
                {/* The header carries its own label: the tooltip card's text sits
                    inside the <th>, and the mobile card layout stamps each
                    column's header onto its cells. */}
                <Th data-label="You pay">
                  <GlossaryTerm
                    title="Transfer price"
                    description={`What your store pays ${seller} for each unit you sell. The difference between it and the retail price you charge is yours, before your share of Skydrop’s fees.`}
                  >
                    You pay
                  </GlossaryTerm>
                </Th>
                <Th>Sell between</Th>
                <Th>Suggested</Th>
                <Th>Available</Th>
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
          'Any price'
        ) : (
          <span className="rm-range">
            {i.minRetailInr === null ? 'up to ' : <Money amount={i.minRetailInr} convert={false} />}
            {i.minRetailInr !== null && i.maxRetailInr !== null ? ' – ' : null}
            {i.maxRetailInr === null ? (
              ' or more'
            ) : (
              <Money amount={i.maxRetailInr} convert={false} />
            )}
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
