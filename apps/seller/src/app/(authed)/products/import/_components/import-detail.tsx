'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowLeft, Boxes, Download, FileSpreadsheet, Layers, XCircle } from 'lucide-react';
import { Ident } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import {
  AreaPage,
  AreaSection,
  BackLink as AreaBackLink,
  Facts,
  InlineError,
  KpiGrid,
  MetaFact,
  MetaFacts,
  Note,
  Panel,
  mutationPhase,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
import { BulkUploadStatus } from '@skydrop/db';
import {
  useCsvImport,
  useErrorReportDownload,
  isImportInFlight,
  type CsvImportView,
} from '@/lib/csv-import-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ImportStatusBadge, humaniseStatus } from './import-status';

/**
 * One catalog import, opened.
 *
 * The panel's table answers "did it finish". This answers "what did it
 * do to my catalogue", which is a different question and was
 * unanswerable: the ten-row list showed a total and a failure count, and
 * `GET /seller/csv-imports/:id` — the only way to reach an import older
 * than those ten — had no caller anywhere in the product.
 *
 * The numbers COUNT OBJECTS, not rows, and the page says so. One row can
 * create a product and a variant, so created + updated + refused does
 * not add up to the row count, and a seller doing that arithmetic on a
 * correct import would conclude rows went missing.
 */
export function ImportDetail({ importId }: { readonly importId: string }): ReactElement {
  const query = useCsvImport(importId);

  if (query.isLoading) return <DetailSkeleton />;

  if (query.isError || query.data === undefined) {
    return (
      <AreaPage>
        <BackLink />
        <PageHeader title="Import" />
        <Panel>
          <div className="inv-stack">
            {/* FE-2 — the server's verdict verbatim. A wrong id and
                another seller's import both come back UPLOAD_NOT_FOUND,
                which is the whole message worth showing. */}
            <InlineError
              message={serverVerdict(query.error, 'Could not load this import.')}
              retry={() => void query.refetch()}
            />
            <Note>
              Imports are scoped to the account that uploaded them. If a colleague sent this file
              from their own login, it is on their history, not yours.
            </Note>
          </div>
        </Panel>
      </AreaPage>
    );
  }

  const job = query.data;
  const inFlight = isImportInFlight(job.status);

  return (
    <AreaPage>
      <BackLink />

      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Stock & WMS' },
          { label: 'Products', href: '/products' },
          { label: 'History', href: '/products/import/jobs' },
          { label: job.fileName },
        ]}
        Link={Link}
        title={<span className="sk-ident">{job.fileName}</span>}
        subtitle={`Uploaded ${formatDateTime(job.createdAt)}`}
        meta={
          <MetaFacts>
            <MetaFact tone="accent">
              {job.rowCount ?? '—'} {job.rowCount === 1 ? 'row' : 'rows'}
            </MetaFact>
            {inFlight && <MetaFact dot>Running now</MetaFact>}
            {job.rowsFailed > 0 && <MetaFact tone="bad">{job.rowsFailed} refused</MetaFact>}
          </MetaFacts>
        }
        action={<ImportStatusBadge status={job.status} />}
      />

      {/* ── What it wrote ────────────────────────────────────────────
             OBJECTS, not rows: one row can create a product AND its
             first variant, so these deliberately do not add up to the
             row count — each tile's footer says which half is new. */}
      <KpiGrid>
        {job.rowCount === null ? (
          <KpiCard
            label="Rows in file"
            icon={<FileSpreadsheet size={14} />}
            figure={<span className="inv-faint">—</span>}
            tone="neutral"
          />
        ) : (
          <KpiCard
            label="Rows in file"
            icon={<FileSpreadsheet size={14} />}
            value={job.rowCount}
            format={rawCount}
            unit={job.rowCount === 1 ? 'row' : 'rows'}
            tone="neutral"
          />
        )}
        <KpiCard
          label="Products"
          icon={<Boxes size={14} />}
          value={job.productsCreated + job.productsUpdated}
          format={rawCount}
          tone="neutral"
          foot={[
            { label: 'New', value: job.productsCreated },
            { label: 'Updated', value: job.productsUpdated },
          ]}
        />
        <KpiCard
          label="Variants"
          icon={<Layers size={14} />}
          value={job.variantsCreated + job.variantsUpdated}
          format={rawCount}
          unit="SKUs"
          tone="neutral"
          foot={[
            { label: 'New', value: job.variantsCreated },
            { label: 'Updated', value: job.variantsUpdated },
          ]}
        />
        <KpiCard
          label="Refused"
          icon={<XCircle size={14} />}
          value={job.rowsFailed}
          format={rawCount}
          unit={job.rowsFailed === 1 ? 'row' : 'rows'}
          tone={job.rowsFailed > 0 ? 'debit' : 'neutral'}
          hint={
            job.rowsSkipped > 0
              ? `${job.rowsSkipped} row${job.rowsSkipped === 1 ? '' : 's'} also skipped as unchanged.`
              : 'Rows we could not write.'
          }
        />
      </KpiGrid>

      <AreaSection title="Outcome" note="What this upload did to your catalogue.">
        <Panel>
          <div className="inv-stack">
            {/* The run itself. The file's row progress is not reported
                by the server, so while it runs the parachute is honest
                about not knowing (no percentage); it lands on the
                status the server reports, in the status's own words. */}
            <ParachuteProgress
              label={`Importing ${job.fileName}`}
              state={runState(job.status)}
              doneLabel={humaniseStatus(job.status)}
              failedLabel={humaniseStatus(job.status)}
              detail={
                job.rowCount === null
                  ? undefined
                  : `${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'} in the file`
              }
            />
            <p className="inv-note" style={{ color: 'var(--fg-body)' }}>
              {OUTCOME_COPY[job.status]}
            </p>
            {inFlight && <Note>This page refreshes itself while it runs — nothing to reload.</Note>}
          </div>
        </Panel>
      </AreaSection>

      {job.errorReportKey !== null && <ErrorReport job={job} />}

      <AreaSection title="Timing" note="When it ran.">
        <Panel>
          <Facts
            columns={3}
            items={[
              { label: 'Uploaded', value: formatDateTime(job.createdAt) },
              {
                label: 'Started',
                value: job.startedAt === null ? <Waiting /> : formatDateTime(job.startedAt),
              },
              {
                label: 'Finished',
                value: job.completedAt === null ? <Waiting /> : formatDateTime(job.completedAt),
              },
              { label: 'Took', value: duration(job) },
              { label: 'Import id', value: <Ident value={job.id} /> },
            ]}
          />
        </Panel>
      </AreaSection>
    </AreaPage>
  );
}

/** Where the run is, in the parachute's three states. F2-exhaustive. */
function runState(status: BulkUploadStatus): ParachuteState {
  switch (status) {
    case BulkUploadStatus.PENDING:
    case BulkUploadStatus.PROCESSING:
      return 'running';
    case BulkUploadStatus.COMPLETED:
    case BulkUploadStatus.COMPLETED_WITH_ERRORS:
      return 'done';
    case BulkUploadStatus.FAILED:
    case BulkUploadStatus.CANCELLED:
      return 'failed';
  }
}

/**
 * The refused rows, as the file to fix.
 *
 * The report lists each rejected row WITH its reason, which makes it the
 * artefact to correct and re-upload — a re-upload updates by
 * `(sellerId, externalRef)` for products and `(sellerId, skuCode)` for
 * variants, so sending the corrected rows again touches only them.
 */
function ErrorReport({ job }: { readonly job: CsvImportView }): ReactElement {
  const download = useErrorReportDownload();

  return (
    <AreaSection title="Refused rows" note={`${job.rowsFailed} to fix`}>
      <Panel>
        <div className="inv-stack">
          <p className="inv-note" style={{ color: 'var(--fg-body)' }}>
            {job.rowsFailed} row{job.rowsFailed === 1 ? '' : 's'} could not be written. The report
            below carries each one with the reason it was refused — fix those rows and upload the
            file again; re-importing updates what already exists rather than duplicating it.
          </p>
          <div>
            <AsyncButton
              variant="secondary"
              size="md"
              icon={<Download size={15} />}
              labels={{ idle: 'Download the report', busy: 'Preparing…' }}
              state={mutationPhase(download)}
              disabled={download.isPending}
              onClick={() => download.mutate({ id: job.id, fileName: job.fileName })}
            />
          </div>
          {download.error !== null && <InlineError message={serverVerdict(download.error)} />}
        </div>
      </Panel>
    </AreaSection>
  );
}

/**
 * What each status MEANT for the seller's catalogue.
 *
 * Describes what already happened; it does not predict what the server
 * would allow (FE-2) — nothing on this page writes.
 */
const OUTCOME_COPY: Readonly<Record<BulkUploadStatus, string>> = {
  [BulkUploadStatus.PENDING]: 'Queued. The file is with us and nothing has been read from it yet.',
  [BulkUploadStatus.PROCESSING]: 'Running now. The counts below climb as rows are written.',
  [BulkUploadStatus.COMPLETED]: 'Every row was written. Your catalogue matches this file.',
  [BulkUploadStatus.COMPLETED_WITH_ERRORS]:
    'The rows we could write are in your catalogue; the rest were refused and are listed in the error report below. Nothing that was written needs undoing.',
  [BulkUploadStatus.FAILED]:
    'The import stopped before it finished. Anything counted below was already written and stands — re-uploading the file updates those rows rather than duplicating them.',
  [BulkUploadStatus.CANCELLED]: 'This import was cancelled. Anything counted below was written.',
};

function BackLink(): ReactElement {
  return (
    <AreaBackLink href="/products/import/jobs">
      <ArrowLeft size={14} />
      Import history
    </AreaBackLink>
  );
}

function Waiting(): ReactElement {
  return <span className="inv-faint">not yet</span>;
}

/** Wall-clock time the worker held the file. Unknown until both ends
 *  exist — an elapsed-so-far figure on a running job would tick without
 *  the page having asked the server anything. */
function duration(job: CsvImportView): string {
  if (job.startedAt === null || job.completedAt === null) return '—';
  const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-IN');
}

function DetailSkeleton(): ReactElement {
  return (
    <AreaPage>
      <BackLink />
      <div className="inv-stack inv-stack--tight">
        <Skeleton width="60%" height={28} />
        <Skeleton width="30%" height={14} />
      </div>
      <KpiGrid>
        {Array.from({ length: 4 }, (_, i) => (
          <Panel key={i}>
            <div className="inv-stack inv-stack--tight">
              <Skeleton width={80} height={12} />
              <Skeleton width={56} height={24} />
            </div>
          </Panel>
        ))}
      </KpiGrid>
      <Panel>
        <div className="inv-stack">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} width="75%" height={16} />
          ))}
        </div>
      </Panel>
    </AreaPage>
  );
}
