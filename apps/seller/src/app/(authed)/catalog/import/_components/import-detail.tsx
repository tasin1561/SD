'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  DescriptionList,
  ErrorNote,
  Ident,
  PageHeader,
  Section,
  Skeleton,
  Stat,
} from '@skydrop/ui/components';
import { BulkUploadStatus } from '@skydrop/db';
import {
  useCsvImport,
  useErrorReportDownload,
  isImportInFlight,
  type CsvImportView,
} from '@/lib/csv-import-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ImportStatusBadge } from './import-status';

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
      <div>
        <BackLink />
        <PageHeader title="Import" />
        <Card>
          <CardBody>
            {/* FE-2 — the server's verdict verbatim. A wrong id and
                another seller's import both come back UPLOAD_NOT_FOUND,
                which is the whole message worth showing. */}
            <ErrorNote
              message={serverVerdict(query.error, 'Could not load this import.')}
              retry={() => void query.refetch()}
            />
            <p className="text-text-muted mt-3 text-xs">
              Imports are scoped to the account that uploaded them. If a colleague sent this file
              from their own login, it is on their history, not yours.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const job = query.data;
  const inFlight = isImportInFlight(job.status);

  return (
    <div>
      <BackLink />

      <PageHeader
        title={<span className="font-mono">{job.fileName}</span>}
        subtitle={`Uploaded ${formatDateTime(job.createdAt)}`}
        action={<ImportStatusBadge status={job.status} />}
      />

      <Card className="mb-6">
        <CardBody>
          <p className="text-text-body text-sm leading-relaxed">{OUTCOME_COPY[job.status]}</p>
          {inFlight && (
            <p className="text-text-faint mt-1 text-xs">
              This page refreshes itself while it runs — nothing to reload.
            </p>
          )}
        </CardBody>
      </Card>

      <Section
        title="What it wrote"
        subtitle="Objects, not rows: a single row can create a product AND its first variant, so these will not add up to the row count."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Rows in file" value={job.rowCount ?? '—'} />
          <Stat
            label="Products"
            value={job.productsCreated + job.productsUpdated}
            hint={`${job.productsCreated} new · ${job.productsUpdated} updated`}
          />
          <Stat
            label="Variants"
            value={job.variantsCreated + job.variantsUpdated}
            hint={`${job.variantsCreated} new · ${job.variantsUpdated} updated`}
          />
          <Stat
            label="Refused"
            value={job.rowsFailed}
            tone={job.rowsFailed > 0 ? 'bad' : 'neutral'}
            hint={
              job.rowsSkipped > 0
                ? `${job.rowsSkipped} row${job.rowsSkipped === 1 ? '' : 's'} also skipped as unchanged`
                : 'Rows we could not write'
            }
          />
        </div>
      </Section>

      {job.errorReportKey !== null && <ErrorReport job={job} />}

      <Section title="Timing">
        <Card>
          <CardBody>
            <DescriptionList
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
          </CardBody>
        </Card>
      </Section>
    </div>
  );
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
    <Section title="Refused rows">
      <Card>
        <CardBody>
          <p className="text-text-body text-sm leading-relaxed">
            {job.rowsFailed} row{job.rowsFailed === 1 ? '' : 's'} could not be written. The report
            below carries each one with the reason it was refused — fix those rows and upload the
            file again; re-importing updates what already exists rather than duplicating it.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="md"
              disabled={download.isPending}
              onClick={() => download.mutate({ id: job.id, fileName: job.fileName })}
            >
              <Download size={14} />
              {download.isPending ? 'Preparing…' : 'Download the report'}
            </Button>
          </div>
          {download.error !== null && (
            <ErrorNote className="mt-3" message={serverVerdict(download.error)} />
          )}
        </CardBody>
      </Card>
    </Section>
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
    <Link
      href="/catalog/import/jobs"
      className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
    >
      <ArrowLeft size={13} />
      Import history
    </Link>
  );
}

function Waiting(): ReactElement {
  return <span className="text-text-faint">not yet</span>;
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
    <div>
      <BackLink />
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-2/3 max-w-sm" />
        <Skeleton className="h-3.5 w-1/3 max-w-[14rem]" />
      </div>
      <Card className="mb-6">
        <CardBody>
          <Skeleton className="h-4 w-3/4" />
        </CardBody>
      </Card>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardBody>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-5 w-12" />
            </CardBody>
          </Card>
        ))}
      </div>
      <Card>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
