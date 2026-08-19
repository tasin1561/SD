'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type ReactElement } from 'react';
import { ArrowLeft, Upload } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingState,
  PageHeader,
  TBody,
  THead,
  Table,
  TablePaginator,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    <div>
      <Link
        href="/products/import"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={13} />
        Bulk catalog import
      </Link>

      <PageHeader
        title="Import history"
        subtitle="Every CSV you have sent, newest first. Open one to see what it wrote and what it refused."
        action={
          <Link href="/products/import">
            <Button variant="ghost" size="md">
              <Upload size={14} /> New import
            </Button>
          </Link>
        }
      />

      {list.isLoading ? (
        <LoadingState label="Loading imports…" />
      ) : list.isError ? (
        <ErrorNote
          message={serverVerdict(list.error, 'Could not load your imports.')}
          retry={() => void list.refetch()}
        />
      ) : list.data === undefined || list.data.items.length === 0 ? (
        <EmptyState
          title="No imports yet"
          description="Nothing has been uploaded from this account. The import screen has the template to start from."
          action={
            <Link href="/products/import">
              <Button variant="primary" size="md">
                <Upload size={14} /> Import a CSV
              </Button>
            </Link>
          }
        />
      ) : (
        <Table>
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
              <Tr key={job.id} onActivate={() => router.push(`/products/import/jobs/${job.id}`)}>
                <Td>
                  <Link
                    href={`/products/import/jobs/${job.id}`}
                    className="text-text-bright font-mono text-xs hover:underline"
                  >
                    {job.fileName}
                  </Link>
                </Td>
                <Td>
                  <ImportStatusBadge status={job.status} />
                </Td>
                <Td align="right" className="text-text-muted font-mono text-xs">
                  {job.rowCount ?? '—'}
                </Td>
                {/* Created and updated are shown together because a
                    re-upload is the normal way to edit a catalogue —
                    "0 created" on a correct import reads as a failure
                    unless the updates are next to it. */}
                <Td align="right" className="text-text-muted font-mono text-xs">
                  {written(job.productsCreated, job.productsUpdated)}
                </Td>
                <Td align="right" className="text-text-muted font-mono text-xs">
                  {written(job.variantsCreated, job.variantsUpdated)}
                </Td>
                <Td
                  align="right"
                  className={
                    job.rowsFailed > 0
                      ? 'text-[var(--color-critical)] font-mono text-xs'
                      : 'text-text-faint font-mono text-xs'
                  }
                >
                  {job.rowsFailed}
                </Td>
                <Td className="text-text-faint font-mono text-xs">{formatDate(job.createdAt)}</Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={7} className="p-0">
                <TablePaginator
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={goToPage}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}

function written(created: number, updated: number): string {
  return updated === 0 ? String(created) : `${created} + ${updated}`;
}

function formatDate(value: CsvImportView['createdAt']): string {
  return new Date(value).toLocaleString('en-IN');
}
