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
import { serverVerdict } from '@/lib/server-verdict';
import { ImportStatusBadge } from './import-status';

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
        Bulk catalog import
      </BackLink>

      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Stock & WMS' },
          { label: 'Products', href: '/products' },
          { label: 'CSV import', href: '/products/import' },
          { label: 'History' },
        ]}
        Link={Link}
        title="Import history"
        subtitle="Every CSV you have sent, newest first. Open one to see what it wrote and what it refused."
        meta={
          list.data === undefined ? undefined : (
            <MetaFact tone="accent">
              {list.data.total} {list.data.total === 1 ? 'import' : 'imports'}
            </MetaFact>
          )
        }
        action={
          <LinkButton href="/products/import" variant="ghost" icon={<Upload size={15} />}>
            New import
          </LinkButton>
        }
      />

      <AreaSection
        title="Uploads"
        note={list.data === undefined ? undefined : `${list.data.total} in total, newest first`}
      >
        <Panel flush>
          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={6} cols={7} label="Loading imports…" />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <ErrorState
                message={serverVerdict(list.error, 'Could not load your imports.')}
                retry={() => void list.refetch()}
              />
            </PanelPad>
          ) : list.data === undefined || list.data.items.length === 0 ? (
            <PanelPad>
              <EmptyState
                bare
                title="No imports yet"
                description="Nothing has been uploaded from this account. The import screen has the template to start from."
                action={
                  <LinkButton href="/products/import" variant="primary" icon={<Upload size={15} />}>
                    Import a CSV
                  </LinkButton>
                }
              />
            </PanelPad>
          ) : (
            <>
              <Table caption="Uploads">
                <THead>
                  <Tr>
                    <Th>File</Th>
                    <Th>Status</Th>
                    <Th align="right">Rows</Th>
                    <Th align="right">Products</Th>
                    <Th align="right">Variants</Th>
                    <Th align="right">Refused</Th>
                    <Th>Uploaded</Th>
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
                  label="Import pages"
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
