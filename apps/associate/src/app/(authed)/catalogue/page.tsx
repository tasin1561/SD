'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { PackageSearch, PackageX, Search, Tag, TriangleAlert } from 'lucide-react';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
  const t = useT();
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
      title={t('catalogue.title')}
      subtitle={t('catalogue.subtitle')}
      action={
        <LinkButton href="/orders/new" variant="primary">
          {t('catalogue.newOrder')}
        </LinkButton>
      }
    />
  );

  if (catalogue.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={6} cols={4} label={t('catalogue.loading')} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState message={verdict(catalogue.error, t)} retry={() => void catalogue.refetch()} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="as-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title={t('catalogue.empty.title')}
          description={t('catalogue.empty.body')}
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
        <Notice tone="info" icon={<Tag size={16} />} title={t('catalogue.unpriced.title')}>
          <span>
            {unpricedCount === 1
              ? t('catalogue.unpriced.one')
              : t('catalogue.unpriced.many', { n: unpricedCount })}
          </span>
        </Notice>
      ) : null}

      <section className="as-section">
        <SectionHeading
          title={t('catalogue.products')}
          note={
            shown.length === items.length
              ? t(items.length === 1 ? 'catalogue.count.one' : 'catalogue.count.other', {
                  n: items.length,
                })
              : t('catalogue.countOf', { shown: shown.length, total: items.length })
          }
        />
        <TableToolbar
          search={{
            value: query,
            onChange: setQuery,
            label: t('catalogue.search.label'),
            placeholder: t('catalogue.search.placeholder'),
          }}
        />
        {shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title={t('catalogue.noMatch.title')}
            description={t('catalogue.noMatch.body')}
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption={t('catalogue.title')}>
              <THead>
                <Tr>
                  <Th>{t('catalogue.col.product')}</Th>
                  <Th align="right">{t('catalogue.col.price')}</Th>
                  <Th align="right">{t('catalogue.col.available')}</Th>
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
                    {/* The two facts somebody reads out mid-call, and the
                        two states that end the sale. Both were the page's
                        quietest text in a numeric column; a blocking state
                        has to read as one. Only ZERO is named — a "low
                        stock" line would be a threshold nobody set. */}
                    <Td align="right">
                      {i.retailPriceInr === null ? (
                        <span className="as-flag" data-tone="warn">
                          <TriangleAlert size={12} aria-hidden />
                          {t('catalogue.noPrice')}
                        </span>
                      ) : (
                        <Money amount={i.retailPriceInr} convert={false} />
                      )}
                    </Td>
                    <Td align="right">
                      {i.availableQuantity === 0 ? (
                        <span className="as-flag" data-tone="bad">
                          <PackageX size={12} aria-hidden />
                          {t('catalogue.noneLeft')}
                        </span>
                      ) : (
                        <span className="sk-figure">{i.availableQuantity}</span>
                      )}
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
