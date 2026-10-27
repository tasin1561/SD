'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type ReactElement } from 'react';
import { ArrowLeft, Upload } from 'lucide-react';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  AreaPage,
  AreaSection,
  BackLink,
  LinkButton,
  MetaFact,
  Panel,
  PanelPad,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { useCsvImports, type CsvImportView } from '@/lib/csv-import-hooks';
import { verdict } from '@/i18n/verdict';
import { ImportStatusBadge } from './import-status';
import { useT } from '@/i18n/client';

/**
 * Every catalog import this seller has sent.
 *
 * The panel on /products/import shows the last ten and polls them while
 * they run — the right thing for the file you just uploaded, and no help
 * at all for the one from March that a stock discrepancy has just made
 * relevant. This is the full list, and it is the only route into an
 * individual import.
 *
 * Page lives in the URL so a link to page 3 is a link to page 3, and
 * the browser's back button walks the pages rather than leaving the
 * screen.
 */

const PAGE_SIZE = 20;

export function ImportJobsIndex(): ReactElement {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const page = useMemo(() => Math.max(1, Number(sp.get('page')) || 1), [sp]);

  const list = useCsvImports(page, PAGE_SIZE);

  function goToPage(next: number): void {
    router.replace(next === 1 ? '/products/import/jobs' : `/products/import/jobs?page=${next}`);
  }

  return (
    <AreaPage>
      <BackLink href="/products/import">
        <ArrowLeft size={14} />
        {t('productImport.bulkCatalogImport')}
      </BackLink>

      <PageHeader
        breadcrumbs={[
          { label: t('productImport.clientConsole') },
          { label: t('productImport.stockWms') },
          { label: t('productImport.products'), href: '/products' },
          { label: t('productImport.csvImport'), href: '/products/import' },
          { label: t('productImport.history') },
        ]}
        Link={Link}
        title={t('productImport.importHistory')}
        subtitle={t('productImport.everyCsvYouHave')}
        meta={
          list.data === undefined ? undefined : (
            <MetaFact tone="accent">
              {list.data.total} {list.data.total === 1 ? 'import' : 'imports'}
            </MetaFact>
          )
        }
        action={
          <LinkButton href="/products/import" variant="ghost" icon={<Upload size={15} />}>
            {t('productImport.newImport')}
          </LinkButton>
        }
      />

      <AreaSection
        title={t('productImport.uploads')}
        note={
          list.data === undefined
            ? undefined
            : t('productImport.inTotalNewestFirst', { total: list.data.total })
        }
      >
        <Panel flush>
          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={7} label={t('productImport.loadingImports')} />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={verdict(list.error, t, t('productImport.couldNotLoadYour'))}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : list.data === undefined || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                bare
                title={t('productImport.noImportsYet')}
                description={t('productImport.nothingHasBeenUploaded')}
                action={
                  <LinkButton href="/products/import" variant="primary" icon={<Upload size={15} />}>
                    {t('productImport.importACsv')}
                  </LinkButton>
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption={t('productImport.uploads')}>
                <THead>
                  <Tr>
                    <Th>{t('productImport.file')}</Th>
                    <Th>{t('productImport.status')}</Th>
                    <Th align="right">{t('productImport.rows')}</Th>
                    <Th align="right">{t('productImport.products')}</Th>
                    <Th align="right">{t('productImport.variants')}</Th>
                    <Th align="right">{t('productImport.refused')}</Th>
                    <Th>{t('productImport.uploaded2')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.data.items.map((job) => (
                    <Tr
                      key={job.id}
                      onActivate={() => router.push(`/products/import/jobs/${job.id}`)}
                    >
                      <Td>
                        <Link
                          href={`/products/import/jobs/${job.id}`}
                          className="inv-strong-link sk-ident"
                        >
                          {job.fileName}
                        </Link>
                      </Td>
                      <Td>
                        <ImportStatusBadge status={job.status} />
                      </Td>
                      <Td align="right">
                        <span className="sk-figure inv-muted">{job.rowCount ?? '—'}</span>
                      </Td>
                      {/* Created and updated are shown together because a
                        re-upload is the normal way to edit a catalogue —
                        "0 created" on a correct import reads as a failure
                        unless the updates are next to it. */}
                      <Td align="right">
                        <span className="sk-figure inv-muted">
                          {written(job.productsCreated, job.productsUpdated)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="sk-figure inv-muted">
                          {written(job.variantsCreated, job.variantsUpdated)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          className="sk-figure inv-num"
                          data-tone={job.rowsFailed > 0 ? 'bad' : 'faint'}
                        >
                          {job.rowsFailed}
                        </span>
                      </Td>
                      <Td>
                        <span className="sk-figure inv-faint">{formatDate(job.createdAt)}</span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <PanelPad>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={goToPage}
                  label={t('productImport.importPages')}
                />
              </PanelPad>
            </>
          )}
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}

function written(created: number, updated: number): string {
  return updated === 0 ? String(created) : `${created} + ${updated}`;
}

function formatDate(value: CsvImportView['createdAt']): string {
  return new Date(value).toLocaleString('en-IN');
}
