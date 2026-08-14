'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import type { BulkUploadStatus } from '@skydrop/db';
import {
  Button,
  Card,
  CardBody,
  DescriptionList,
  ErrorNote,
  Section,
  Skeleton,
  Stat,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { isOrderImportRunning, useOrderImport } from '@/lib/order-import-hooks';

/**
 * One order CSV import, by id.
 *
 * The import panel's "Recent imports" table shows the last ten runs and
 * four of the row's numbers. This is the same record with the rest of
 * it — how long it took, how many rows were skipped as already-imported
 * (ORD-9 keys on `sellerOrderRef`, so a re-upload is a no-op rather
 * than a duplicate), and what the outcome means in words. It is also
 * the only way to reach an import that has fallen off that ten-row
 * list, and the only URL you can send someone while a job is running.
 */

/**
 * What the status MEANS, and what to do about it.
 *
 * Exhaustive over `BulkUploadStatus` — a new value fails to compile
 * here until somebody decides what a seller should be told, which is
 * the right person to make that call and the wrong thing to discover
 * as a blank line on a screen.
 */
function outcomeProse(status: BulkUploadStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Queued. A worker will pick this up shortly; the counts below start moving when it does.';
    case 'PROCESSING':
      return 'Running now — the counts below refresh every few seconds while you watch.';
    case 'COMPLETED':
      return 'Finished. Every row in the file was accepted.';
    case 'COMPLETED_WITH_ERRORS':
      return 'Finished, but some rows were rejected. The error report lists each one with its reason — fix those rows and upload just them again.';
    case 'FAILED':
      return 'The import stopped before it could finish. Nothing more will be created from this file; correct it and upload again.';
    case 'CANCELLED':
      return 'Cancelled. Any rows already imported stayed imported — the rest were never read.';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** UTC, to the minute — matching how the imports table stamps a row. */
function stamp(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function duration(startedAt: string | null, completedAt: string | null): string {
  if (startedAt === null) return '—';
  const end = completedAt === null ? Date.now() : new Date(completedAt).getTime();
  const ms = end - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function OrderImportDetail({ importId }: { readonly importId: string }): ReactElement {
  const detail = useOrderImport(importId);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const job = detail.data;
  const running = job !== undefined && isOrderImportRunning(job.status);

  async function downloadErrorReport(): Promise<void> {
    setDownloadError(null);
    try {
      // Not through the ApiClient: this endpoint answers with a CSV
      // body and a Content-Disposition, so it wants a blob and a
      // synthesized anchor rather than JSON parsing. Same-origin via
      // the proxy (FE-3); the cookie carries the session.
      const res = await fetch(`/api/seller/order-imports/${importId}/error-report`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error report download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error-report-${importId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(serverVerdict(err, 'Could not download the error report.'));
    }
  }

  return (
    <div>
      <Link
        href="/orders/import"
        className="text-text-muted hover:text-text-body mb-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} /> Bulk order import
      </Link>

      {detail.isLoading ? (
        // Shaped like the page that is coming — four tiles over a card
        // — so nothing jumps when the numbers land.
        <div role="status" aria-live="polite" aria-label="Loading import…">
          <Skeleton className="mb-5 h-6 w-[40%]" />
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[86px]" />
            ))}
          </div>
          <Skeleton className="h-[140px]" />
        </div>
      ) : detail.isError ? (
        <ErrorNote
          message={serverVerdict(detail.error, 'Failed to load this import.')}
          retry={() => void detail.refetch()}
        />
      ) : job === undefined ? (
        <ErrorNote message="This import could not be found." />
      ) : (
        <>
          <div className="mb-5">
            <h1 className="text-text-bright truncate font-mono text-lg font-semibold tracking-tight sm:text-xl">
              {job.fileName}
            </h1>
            <p className="text-text-muted mt-1 text-sm">{outcomeProse(job.status)}</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Rows in file" value={job.rowCount} />
            <Stat
              label="Orders created"
              value={job.ordersCreated}
              tone={job.ordersCreated > 0 ? 'good' : 'neutral'}
              hint={running ? 'Still counting.' : undefined}
            />
            <Stat
              label="Rows failed"
              value={job.rowsFailed}
              tone={job.rowsFailed > 0 ? 'bad' : 'neutral'}
              hint={job.rowsFailed > 0 ? 'Listed in the error report.' : undefined}
            />
            <Stat
              label="Rows skipped"
              value={job.rowsSkipped}
              hint={
                job.rowsSkipped > 0
                  ? 'Already imported under the same reference — not duplicated.'
                  : undefined
              }
            />
          </div>

          <Section title="This run">
            <Card>
              <CardBody>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: 'Status', value: <span className="uppercase">{job.status}</span> },
                    { label: 'Uploaded', value: stamp(job.createdAt) },
                    { label: 'Started', value: stamp(job.startedAt) },
                    { label: 'Finished', value: stamp(job.completedAt) },
                    {
                      label: running ? 'Running for' : 'Took',
                      value: duration(job.startedAt, job.completedAt),
                    },
                    {
                      label: 'Import ID',
                      value: <span className="font-mono text-xs">{job.id}</span>,
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </Section>

          {downloadError !== null && (
            <ErrorNote
              className="mb-4"
              message={downloadError}
              retry={() => void downloadErrorReport()}
            />
          )}

          {/* Every terminal state needs somewhere to go next: the
                  orders this made, the rows it refused, or another file. */}
          <div className="flex flex-wrap items-center gap-2">
            {job.errorReportKey !== null && (
              <Button variant="secondary" size="md" onClick={() => void downloadErrorReport()}>
                <Download size={12} /> Error report CSV
              </Button>
            )}
            {job.ordersCreated > 0 && (
              <Link href="/orders">
                <Button variant="ghost" size="md">
                  View orders
                </Button>
              </Link>
            )}
            <Link href="/orders/import">
              <Button variant="ghost" size="md">
                Import another file
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
