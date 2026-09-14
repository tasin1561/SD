'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Money,
  Num,
  PageHeader,
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
import { useStoreCatalogue, type StoreCatalogueItem } from '@/lib/catalogue-hooks';

/**
 * RS-3 — the products this store may sell: what it pays the seller for
 * each (the transfer price), the retail range it may sell at, the
 * seller's suggestion, and how many are available to it. Only what the
 * seller turned on for this store; nothing about the seller's own cost
 * or stock.
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
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading the catalogue" rows={6} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          message={serverVerdict(catalogue.error)}
          retry={() => void catalogue.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Section
        title="Products"
        action={
          <Input
            aria-label="Search by name or SKU"
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      >
        {items.length === 0 ? (
          <EmptyState
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
          <Table>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th>You pay</Th>
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
      </Section>
    </div>
  );
}

function ItemRow({ item: i }: { item: StoreCatalogueItem }): ReactElement {
  return (
    <Tr>
      <Td>
        <div className="flex items-start gap-3">
          <ProductThumb src={i.imageUrls[0] ?? null} size={44} alt={i.title} />
          <div>
            <div>{i.title}</div>
            <div className="text-text-muted text-xs">
              {i.skuCode}
              {i.variantLabel ? ` · ${i.variantLabel}` : ''}
            </div>
            {i.description ? (
              <div className="text-text-muted mt-1 line-clamp-2 text-xs">{i.description}</div>
            ) : null}
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
          <span className="whitespace-nowrap">
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
