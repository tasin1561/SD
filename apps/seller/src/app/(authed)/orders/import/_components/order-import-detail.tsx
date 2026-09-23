'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileWarning,
  PackagePlus,
  SkipForward,
  Upload,
  XCircle,
} from 'lucide-react';
import type { BulkUploadStatus } from '@skydrop/db';
import { uploadStatusKind, uploadStatusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { isOrderImportRunning, useOrderImport } from '@/lib/order-import-hooks';
import {
  BackLink,
  Facts,
  LinkButton,
  MetaFact,
  Notice,
  OrdSection,
} from '../../_components/orders-parts';

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

/** Where the parachute line stands, from the status alone. */
function runState(status: BulkUploadStatus, running: boolean): ParachuteState {
  if (running) return 'running';
  return status === 'FAILED' || status === 'CANCELLED' ? 'failed' : 'done';
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
      // Re-thrown so the button's label ends on the real outcome; the
      // verdict above is what the seller reads.
      throw err;
    }
  }

  // Rows the worker has dealt with so far — made an order, refused, or
  // skipped as already sent. The same three counts as the tiles.
  const handled = job === undefined ? 0 : job.ordersCreated + job.rowsFailed + job.rowsSkipped;

  return (
    <div className="ord-page">
      <BackLink href="/orders/import" icon={<ArrowLeft size={14} aria-hidden />}>
        Bulk order import
      </BackLink>

      {detail.isLoading ? (
        // Shaped like the page that is coming — four tiles over a card
        // — so nothing jumps when the numbers land.
        <div className="ord-stack" role="status" aria-live="polite" aria-label="Loading import…">
          <Skeleton width="40%" height={24} />
          <div className="ord-kpis">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={86} rounded="md" />
            ))}
          </div>
          <Skeleton height={140} rounded="md" />
        </div>
      ) : detail.isError ? (
        <ErrorState
          message={serverVerdict(detail.error, 'Failed to load this import.')}
          retry={() => void detail.refetch()}
        />
      ) : job === undefined ? (
        <ErrorState message="This import could not be found." />
      ) : (
        <>
          <PageHeader
            breadcrumbs={[
              { label: 'Seller console' },
              { label: 'Fulfilment' },
              { label: 'Orders', href: '/orders' },
              { label: 'CSV import', href: '/orders/import' },
              { label: job.fileName },
            ]}
            Link={Link}
            title={<span className="sk-ident">{job.fileName}</span>}
            subtitle={outcomeProse(job.status)}
            meta={
              <span className="ord-meta">
                <StatusChip
                  kind={uploadStatusKind(job.status)}
                  label={uploadStatusLabel(job.status)}
                  pulse={running}
                  size="sm"
                />
                <MetaFact tone="accent">
                  {job.rowCount} {job.rowCount === 1 ? 'row' : 'rows'}
                </MetaFact>
                {job.rowsFailed > 0 && <MetaFact tone="bad">{job.rowsFailed} refused</MetaFact>}
              </span>
            }
          />

          {/* The run itself, drawn from the same record the tiles read.
              The fill is rows handled over rows in the file; a queued run
              has handled nothing yet, so it shows no number at all. */}
          <div className="ord-card">
            <ParachuteProgress
              label={`Importing ${job.fileName}`}
              state={runState(job.status, running)}
              value={
                !running
                  ? 100
                  : job.status === 'PENDING' || job.rowCount === 0
                    ? null
                    : Math.min(100, Math.max(0, (handled / job.rowCount) * 100))
              }
              doneLabel="Import finished"
              failedLabel="Import stopped"
              detail={`${handled} of ${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'} handled`}
            />
          </div>

          <div className="ord-kpis">
            <KpiCard
              label="Rows in file"
              icon={<FileSpreadsheet size={14} />}
              value={job.rowCount}
              unit={job.rowCount === 1 ? 'row' : 'rows'}
              tone="neutral"
            />
            <KpiCard
              label="Orders created"
              icon={<PackagePlus size={14} />}
              value={job.ordersCreated}
              unit={job.ordersCreated === 1 ? 'order' : 'orders'}
              tone={job.ordersCreated > 0 ? 'credit' : 'neutral'}
              hint={running ? 'Still counting.' : undefined}
            />
            <KpiCard
              label="Rows refused"
              icon={<XCircle size={14} />}
              value={job.rowsFailed}
              unit={job.rowsFailed === 1 ? 'row' : 'rows'}
              tone={job.rowsFailed > 0 ? 'debit' : 'neutral'}
              hint={job.rowsFailed > 0 ? 'Listed in the error report.' : undefined}
            />
            <KpiCard
              label="Rows skipped"
              icon={<SkipForward size={14} />}
              value={job.rowsSkipped}
              unit={job.rowsSkipped === 1 ? 'row' : 'rows'}
              tone="neutral"
              hint={
                job.rowsSkipped > 0
                  ? 'Already sent under the same reference — not duplicated.'
                  : undefined
              }
            />
          </div>

          <OrdSection title="This run" note="When it ran, and for how long.">
            <Facts
              columns={2}
              items={[
                { label: 'Status', value: <span className="sk-ident">{job.status}</span> },
                { label: 'Uploaded', value: stamp(job.createdAt) },
                { label: 'Started', value: stamp(job.startedAt) },
                { label: 'Finished', value: stamp(job.completedAt) },
                {
                  label: running ? 'Running for' : 'Took',
                  value: duration(job.startedAt, job.completedAt),
                },
                {
                  label: 'Import ID',
                  value: <span className="sk-ident">{job.id}</span>,
                },
              ]}
            />
          </OrdSection>

          {downloadError !== null && (
            <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
              <span>{downloadError}</span>
            </Notice>
          )}

          {/* Every terminal state needs somewhere to go next: the
                  orders this made, the rows it refused, or another file. */}
          <div className="ord-row">
            {job.errorReportKey !== null && (
              <AsyncButton
                variant="secondary"
                icon={<Download size={14} />}
                labels={{
                  idle: 'Error report CSV',
                  busy: 'Downloading…',
                  done: 'Downloaded',
                  error: 'Download failed',
                }}
                onAction={() => downloadErrorReport()}
              />
            )}
            {job.ordersCreated > 0 && (
              <LinkButton href="/orders" variant="ghost">
                View orders
              </LinkButton>
            )}
            <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
              Import another file
            </LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
