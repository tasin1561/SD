'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { PackageSearch, Search, Tag } from 'lucide-react';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { itemThumb, useSellCatalogue } from '@/lib/catalogue-hooks';
import { LinkButton, Notice } from '../_components/parts';
import '../_components/as.css';

/**
 * What this person may sell, and for how much.
 *
 * ── WHY A READ-ONLY LIST EARNS ITS PLACE ────────────────────────────
 * The order form's picker carries the same figures, so this is not a
 * gap it fills — it is the act. A sales person on the phone to a
 * customer checking a price and whether there is any left, without
 * starting an order they may not place, is the thing this role does most
 * in a day. Making them open a half-finished order form to read a price
 * is making them do paperwork to answer a question.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────
 * Nothing is editable. The price is the store's to set
 * (`associate_prices`, by hand, per person) and there is no markup rule
 * and no fallback, so an unpriced product is NAMED rather than shown at
 * a figure nobody chose. And nothing on this page says what the store
 * pays for a product or earns on it — `GET /store/catalogue/sell`
 * carries neither, which is the whole reason it is a second endpoint
 * behind a second permission rather than a filter inside the one the
 * store's own team reads.
 *
 * The search filters what is LOADED, and that is honest here in a way it
 * would not be on a paged list: this endpoint answers with the whole
 * catalogue in one call.
 */
export default function CataloguePage(): ReactElement {
  const catalogue = useSellCatalogue();
  const [query, setQuery] = useState('');

  const items = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);
  const unpriced = useMemo(() => items.filter((i) => i.retailPriceInr === null), [items]);
  // The SERVER's count, not a re-derivation: two ways of counting the
  // same thing eventually disagree.
  const unpricedCount = catalogue.data?.unpricedCount ?? unpriced.length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((i) =>
      `${i.title} ${i.variantLabel ?? ''} ${i.skuCode}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const header = (
    <PageHeader
      title="What I sell"
      subtitle="The products your store has given you, what you sell each for, and how many are left. Your store sets these prices."
      action={
        <LinkButton href="/orders/new" variant="primary">
          New order
        </LinkButton>
      }
    />
  );

  if (catalogue.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={6} cols={4} label="Loading what you can sell" />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState
          message={serverVerdict(catalogue.error)}
          retry={() => void catalogue.refetch()}
        />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="as-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title="Nothing to sell yet"
          description="Your store has not given you any products to sell. Ask whoever runs it to add some."
        />
      </div>
    );
  }

  return (
    <div className="as-page">
      {header}

      {/* NAMED, with what to do about it. A product silently absent is
          how somebody stops being able to sell it without learning why —
          and here it is listed in the table too, marked, because this is
          the screen somebody checks a price on. */}
      {unpricedCount > 0 ? (
        <Notice tone="info" icon={<Tag size={16} />} title="Waiting for a price">
          <span>
            {unpricedCount === 1 ? 'One product has' : `${unpricedCount} products have`} no price
            set for you, so {unpricedCount === 1 ? 'it cannot' : 'they cannot'} go on an order yet.
            Ask whoever runs your store to set one.
          </span>
        </Notice>
      ) : null}

      <section className="as-section">
        <SectionHeading
          title="Your products"
          note={
            shown.length === items.length
              ? `${items.length} ${items.length === 1 ? 'product' : 'products'}`
              : `${shown.length} of ${items.length}`
          }
        />
        <TableToolbar
          search={{
            value: query,
            onChange: setQuery,
            label: 'Search what you sell',
            placeholder: 'Product, variant or SKU',
          }}
        />
        {shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nothing matches"
            description="Try a different product name or SKU."
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption="What I sell">
              <THead>
                <Tr>
                  <Th>Product</Th>
                  <Th align="right">You sell it for</Th>
                  <Th align="right">Available</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map((i) => (
                  <Tr key={i.variantId}>
                    <Td>
                      <span className="as-sell-cell">
                        <ProductThumb src={itemThumb(i)} size={40} alt="" />
                        <span className="as-sell-cell__body">
                          <span className="as-strong">
                            {i.variantLabel === null ? i.title : `${i.title} · ${i.variantLabel}`}
                          </span>
                          <span className="as-sub sk-ident">{i.skuCode}</span>
                        </span>
                      </span>
                    </Td>
                    <Td align="right">
                      {i.retailPriceInr === null ? (
                        <span className="as-sub">No price set — ask your store</span>
                      ) : (
                        <Money amount={i.retailPriceInr} convert={false} />
                      )}
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{i.availableQuantity}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
