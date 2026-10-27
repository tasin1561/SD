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
import { verdict } from '@/i18n/verdict';
import { ImportStatusBadge, humaniseStatus } from './import-status';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { dateTag } from '@/i18n/format';
import type { Locale } from '@skydrop/ui/app/i18n';

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
  const locale = useLocale();
  const t = useT();
  const query = useCsvImport(importId);

  if (query.isLoading) return <DetailSkeleton />;

  if (query.isError || query.data === undefined) {
    return (
      <AreaPage>
        <BackLink />
        <PageHeader title={t('productImport.import')} />
        <Panel>
          <div className="inv-stack">
            {/* FE-2 — the server's verdict verbatim. A wrong id and
                another seller's import both come back UPLOAD_NOT_FOUND,
                which is the whole message worth showing. */}
            <InlineError
              message={verdict(query.error, t, t('productImport.couldNotLoadThis'))}
              retry={() => void query.refetch()}
            />
            <Note>{t('productImport.importsAreScopedTo')}</Note>
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
          { label: t('productImport.clientConsole') },
          { label: t('productImport.stockWms') },
          { label: t('productImport.products'), href: '/products' },
          { label: t('productImport.history'), href: '/products/import/jobs' },
          { label: job.fileName },
        ]}
        Link={Link}
        title={<span className="sk-ident">{job.fileName}</span>}
        subtitle={t('productImport.uploaded', { createdAt: formatDateTime(job.createdAt, locale) })}
        meta={
          <MetaFacts>
            <MetaFact tone="accent">
              {job.rowCount ?? '—'} {job.rowCount === 1 ? 'row' : 'rows'}
            </MetaFact>
            {inFlight && <MetaFact dot>{t('productImport.runningNow')}</MetaFact>}
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
            label={t('productImport.rowsInFile')}
            icon={<FileSpreadsheet size={14} />}
            figure={<span className="inv-faint">—</span>}
            tone="neutral"
          />
        ) : (
          <KpiCard
            label={t('productImport.rowsInFile')}
            icon={<FileSpreadsheet size={14} />}
            value={job.rowCount}
            format={rawCount}
            unit={job.rowCount === 1 ? 'row' : 'rows'}
            tone="neutral"
          />
        )}
        <KpiCard
          label={t('productImport.products')}
          icon={<Boxes size={14} />}
          value={job.productsCreated + job.productsUpdated}
          format={rawCount}
          tone="neutral"
          foot={[
            { label: t('productImport.new'), value: job.productsCreated },
            { label: t('productImport.updated'), value: job.productsUpdated },
          ]}
        />
        <KpiCard
          label={t('productImport.variants')}
          icon={<Layers size={14} />}
          value={job.variantsCreated + job.variantsUpdated}
          format={rawCount}
          unit={t('productImport.skus')}
          tone="neutral"
          foot={[
            { label: t('productImport.new'), value: job.variantsCreated },
            { label: t('productImport.updated'), value: job.variantsUpdated },
          ]}
        />
        <KpiCard
          label={t('productImport.refused')}
          icon={<XCircle size={14} />}
          value={job.rowsFailed}
          format={rawCount}
          unit={job.rowsFailed === 1 ? 'row' : 'rows'}
          tone={job.rowsFailed > 0 ? 'debit' : 'neutral'}
          hint={
            job.rowsSkipped > 0
              ? t('productImport.rowAlsoSkippedAs', {
                  rowsSkipped: job.rowsSkipped,
                  plural: job.rowsSkipped === 1 ? '' : 's',
                })
              : t('productImport.rowsWeCouldNot')
          }
        />
      </KpiGrid>

      <AreaSection title={t('productImport.outcome')} note={t('productImport.whatThisUploadDid')}>
        <Panel>
          <div className="inv-stack">
            {/* The run itself. The file's row progress is not reported
                by the server, so while it runs the parachute is honest
                about not knowing (no percentage); it lands on the
                status the server reports, in the status's own words. */}
            <ParachuteProgress
              label={t('productImport.importing', { fileName: job.fileName })}
              state={runState(job.status)}
              doneLabel={humaniseStatus(job.status)}
              failedLabel={humaniseStatus(job.status)}
              detail={
                job.rowCount === null
                  ? undefined
                  : t(
                      job.rowCount === 1 ? 'productImport.rowInFile' : 'productImport.rowsInFile2',
                      {
                        count: job.rowCount,
                      },
                    )
              }
            />
            <p className="inv-note" style={{ color: 'var(--fg-body)' }}>
              {outcomeCopyOf(t)[job.status]}
            </p>
            {inFlight && <Note>{t('productImport.thisPageRefreshesItself')}</Note>}
          </div>
        </Panel>
      </AreaSection>

      {job.errorReportKey !== null && <ErrorReport job={job} />}

      <AreaSection title={t('productImport.timing')} note={t('productImport.whenItRan')}>
        <Panel>
          <Facts
            columns={3}
            items={[
              { label: t('productImport.uploaded2'), value: formatDateTime(job.createdAt, locale) },
              {
                label: t('productImport.started'),
                value: job.startedAt === null ? <Waiting /> : formatDateTime(job.startedAt, locale),
              },
              {
                label: t('productImport.finished'),
                value:
                  job.completedAt === null ? <Waiting /> : formatDateTime(job.completedAt, locale),
              },
              { label: t('productImport.took'), value: duration(job) },
              { label: t('productImport.importId'), value: <Ident value={job.id} /> },
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
  const t = useT();
  const download = useErrorReportDownload();

  return (
    <AreaSection
      title={t('productImport.refusedRows')}
      note={t('productImport.toFix', { rowsFailed: job.rowsFailed })}
    >
      <Panel>
        <div className="inv-stack">
          <p className="inv-note" style={{ color: 'var(--fg-body)' }}>
            {richMessage(t('productImport.rowCouldNotBe'), {
              rowsFailed: job.rowsFailed,
              plural: job.rowsFailed === 1 ? '' : 's',
            })}
          </p>
          <div>
            <AsyncButton
              variant="secondary"
              size="md"
              icon={<Download size={15} />}
              labels={{
                idle: t('productImport.downloadTheReport'),
                busy: t('productImport.preparing'),
              }}
              state={mutationPhase(download)}
              disabled={download.isPending}
              onClick={() => download.mutate({ id: job.id, fileName: job.fileName })}
            />
          </div>
          {download.error !== null && <InlineError message={verdict(download.error, t)} />}
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
const outcomeCopyOf = (t: Translate<MessageKey>): Readonly<Record<BulkUploadStatus, string>> => ({
  [BulkUploadStatus.PENDING]: t('productImport.queuedTheFileIs'),
  [BulkUploadStatus.PROCESSING]: t('productImport.runningNowTheCounts'),
  [BulkUploadStatus.COMPLETED]: t('productImport.everyRowWasWritten'),
  [BulkUploadStatus.COMPLETED_WITH_ERRORS]: t('productImport.theRowsWeCould'),
  [BulkUploadStatus.FAILED]: t('productImport.theImportStoppedBefore'),
  [BulkUploadStatus.CANCELLED]: t('productImport.thisImportWasCancelled'),
});

function BackLink(): ReactElement {
  const t = useT();
  return (
    <AreaBackLink href="/products/import/jobs">
      <ArrowLeft size={14} />
      {t('productImport.importHistory')}
    </AreaBackLink>
  );
}

function Waiting(): ReactElement {
  const t = useT();
  return <span className="inv-faint">{t('productImport.notYet')}</span>;
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

function formatDateTime(value: string, locale: Locale = 'en'): string {
  return new Date(value).toLocaleString(dateTag(locale, 'en-IN'));
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
