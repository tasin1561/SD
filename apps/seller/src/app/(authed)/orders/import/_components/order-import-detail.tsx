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
import { verdict } from '@/i18n/verdict';
import { isOrderImportRunning, useOrderImport } from '@/lib/order-import-hooks';
import {
  BackLink,
  Facts,
  LinkButton,
  MetaFact,
  Notice,
  OrdSection,
} from '../../_components/orders-parts';
import { useT, useLocale } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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
function outcomeProse(t: Translate<MessageKey>, status: BulkUploadStatus): string {
  switch (status) {
    case 'PENDING':
      return t('orderImport.queuedAWorkerWill');
    case 'PROCESSING':
      return t('orderImport.runningNowTheCounts');
    case 'COMPLETED':
      return t('orderImport.finishedEveryRowIn');
    case 'COMPLETED_WITH_ERRORS':
      return t('orderImport.finishedButSomeRows');
    case 'FAILED':
      return t('orderImport.theImportStoppedBefore');
    case 'CANCELLED':
      return t('orderImport.cancelledAnyRowsAlready');
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
  const locale = useLocale();
  const t = useT();
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
      if (!res.ok)
        throw new Error(t('orderImport.errorReportDownloadFailed', { status: res.status }));
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
      setDownloadError(verdict(err, t, t('orderImport.couldNotDownloadThe')));
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
        {t('orderImport.bulkOrderImport')}
      </BackLink>

      {detail.isLoading ? (
        // Shaped like the page that is coming — four tiles over a card
        // — so nothing jumps when the numbers land.
        <div
          className="ord-stack"
          role="status"
          aria-live="polite"
          aria-label={t('orderImport.loadingImport')}
        >
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
          message={verdict(detail.error, t, t('orderImport.failedToLoadThis'))}
          retry={() => void detail.refetch()}
        />
      ) : job === undefined ? (
        <ErrorState message={t('orderImport.thisImportCouldNot')} />
      ) : (
        <>
          <PageHeader
            breadcrumbs={[
              { label: t('orderImport.clientConsole') },
              { label: t('orderImport.fulfilment') },
              { label: t('orderImport.orders'), href: '/orders' },
              { label: t('orderImport.csvImport'), href: '/orders/import' },
              { label: job.fileName },
            ]}
            Link={Link}
            title={<span className="sk-ident">{job.fileName}</span>}
            subtitle={outcomeProse(t, job.status)}
            meta={
              <span className="ord-meta">
                <StatusChip
                  kind={uploadStatusKind(job.status)}
                  label={uploadStatusLabel(job.status, locale)}
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
              label={t('orderImport.importing', { fileName: job.fileName })}
              state={runState(job.status, running)}
              value={
                !running
                  ? 100
                  : job.status === 'PENDING' || job.rowCount === 0
                    ? null
                    : Math.min(100, Math.max(0, (handled / job.rowCount) * 100))
              }
              doneLabel={t('orderImport.importFinished')}
              failedLabel={t('orderImport.importStopped')}
              detail={t(job.rowCount === 1 ? 'orderImport.rowHandled' : 'orderImport.rowsHandled', {
                handled,
                count: job.rowCount,
              })}
            />
          </div>

          <div className="ord-kpis">
            <KpiCard
              label={t('orderImport.rowsInFile')}
              icon={<FileSpreadsheet size={14} />}
              value={job.rowCount}
              unit={job.rowCount === 1 ? 'row' : 'rows'}
              tone="neutral"
            />
            <KpiCard
              label={t('orderImport.ordersCreated')}
              icon={<PackagePlus size={14} />}
              value={job.ordersCreated}
              unit={job.ordersCreated === 1 ? 'order' : 'orders'}
              tone={job.ordersCreated > 0 ? 'credit' : 'neutral'}
              hint={running ? t('orderImport.stillCounting') : undefined}
            />
            <KpiCard
              label={t('orderImport.rowsRefused')}
              icon={<XCircle size={14} />}
              value={job.rowsFailed}
              unit={job.rowsFailed === 1 ? 'row' : 'rows'}
              tone={job.rowsFailed > 0 ? 'debit' : 'neutral'}
              hint={job.rowsFailed > 0 ? t('orderImport.listedInTheError') : undefined}
            />
            <KpiCard
              label={t('orderImport.rowsSkipped')}
              icon={<SkipForward size={14} />}
              value={job.rowsSkipped}
              unit={job.rowsSkipped === 1 ? 'row' : 'rows'}
              tone="neutral"
              hint={job.rowsSkipped > 0 ? t('orderImport.alreadySentUnderThe') : undefined}
            />
          </div>

          <OrdSection title={t('orderImport.thisRun')} note={t('orderImport.whenItRanAnd')}>
            <Facts
              columns={2}
              items={[
                {
                  label: t('orderImport.status'),
                  value: <span className="sk-ident">{job.status}</span>,
                },
                { label: t('orderImport.uploaded'), value: stamp(job.createdAt) },
                { label: t('orderImport.started'), value: stamp(job.startedAt) },
                { label: t('orderImport.finished'), value: stamp(job.completedAt) },
                {
                  label: running ? t('orderImport.runningFor') : t('orderImport.took'),
                  value: duration(job.startedAt, job.completedAt),
                },
                {
                  label: t('orderImport.importId'),
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
                  idle: t('orderImport.errorReportCsv'),
                  busy: t('orderImport.downloading'),
                  done: t('orderImport.downloaded'),
                  error: t('orderImport.downloadFailed'),
                }}
                onAction={() => downloadErrorReport()}
              />
            )}
            {job.ordersCreated > 0 && (
              <LinkButton href="/orders" variant="ghost">
                {t('orderImport.viewOrders')}
              </LinkButton>
            )}
            <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
              {t('orderImport.importAnotherFile')}
            </LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
