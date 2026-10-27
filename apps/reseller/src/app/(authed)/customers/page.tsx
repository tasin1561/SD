'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { formatDate } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useStoreCustomers } from '@/lib/order-hooks';
import './_components/customers.css';

/**
 * RS-5 (ORD-7 generalised) — the people THIS store has sold to.
 *
 * NO OTHER STORE sees them, and that half is enforced: a store's list is
 * `listForStore`, scoped to its own id. **The SELLER does see them**, by
 * the owner's decision of 2026-09-16 — `CustomerService.list` filters on
 * `{ sellerId }` alone, "their own and their reseller stores'", because
 * the order is the seller's (their stock, their warehouse slot, their
 * courier, their money at risk) and a seller who cannot see who a parcel
 * is going to cannot ring about a failed delivery or answer the call
 * centre.
 *
 * This file said the opposite for weeks — "the seller whose stock you
 * sell never sees their names or numbers" — on the subtitle AND here,
 * while `customers/[id]` one click away said "Your client sees them too".
 * A promise the platform deliberately does not make is worse than no
 * promise: the shopkeeper acts on it. The detail page was right.
 *
 * The search still COMMITS on Enter (the form's submit), exactly as it
 * did: the box holds what is being typed, the list reads what was asked.
 */
export default function CustomersPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useStoreCustomers({ ...(search === '' ? {} : { search }), page });

  return (
    <div className="rc-cst-page">
      <PageHeader title={t('cst.title')} subtitle={t('cst.subtitle')} />
      <section className="rc-cst-section">
        <SectionHeading title={t('cst.section')} />
        <form
          className="rc-cst-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(input.trim());
            setPage(1);
          }}
        >
          <TableToolbar
            search={{
              value: input,
              onChange: setInput,
              label: t('cst.search.label'),
              placeholder: t('cst.search.placeholder'),
            }}
          />
        </form>
        {list.isPending ? (
          <SkeletonRows rows={5} cols={5} label={t('cst.loading')} />
        ) : list.isError ? (
          <ErrorState message={verdict(list.error, t)} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            title={search === '' ? t('cst.empty.none') : t('cst.empty.noMatch')}
            description={search === '' ? t('cst.empty.noneBody') : t('cst.empty.noMatchBody')}
          />
        ) : (
          <>
            <Table caption={t('cst.caption')}>
              <THead>
                <Tr>
                  <Th>{t('cst.col.name')}</Th>
                  <Th>{t('cst.col.phone')}</Th>
                  <Th>{t('cst.col.email')}</Th>
                  <Th align="right">{t('cst.col.orders')}</Th>
                  <Th>{t('cst.col.lastOrder')}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((c) => (
                  <Tr key={c.id} onActivate={() => router.push(`/customers/${c.id}`)}>
                    <Td>
                      <Link href={`/customers/${c.id}`} className="rc-cst-name">
                        {c.name ?? t('cst.noName')}
                      </Link>
                    </Td>
                    <Td>
                      <span className="rc-cst-phone sk-ident">{c.phoneE164}</span>
                    </Td>
                    <Td>
                      <span className="rc-cst-muted">{c.email ?? '—'}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{c.totalOrdersCount}</span>
                    </Td>
                    <Td>
                      <span className="rc-cst-muted sk-figure">
                        {c.lastOrderAt === null ? '—' : formatDate(c.lastOrderAt, locale)}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageSize={20}
              total={list.data.total}
              onPageChange={setPage}
              label={t('cst.pages')}
            />
          </>
        )}
      </section>
    </div>
  );
}
