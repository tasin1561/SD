'use client';

import { useRef, useState, type ReactElement } from 'react';
import { ArrowLeft, Download, FileSpreadsheet, FileWarning, Inbox, Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CsvColumnGuide, type CsvColumnGuideColumn } from '@skydrop/ui/app/csv-column-guide';
import { useApiClient } from '@skydrop/auth/client';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { useToast } from '@skydrop/ui/components';
import { uploadStatusKind, uploadStatusLabel } from '@skydrop/ui/status';
import type { BulkUploadStatus } from '@skydrop/db';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { BackLink, Notice, RoSection } from '../_components/orders-parts';

const BASE = '/api/store/order-imports';
const UPLOADS_PAGE_SIZE = 10;

interface UploadRow {
  readonly id: string;
  readonly fileName: string;
  readonly status: BulkUploadStatus;
  readonly rowCount: number;
  readonly ordersCreated: number;
  readonly rowsFailed: number;
  readonly errorReportKey: string | null;
  readonly createdAt: string;
}

interface Preview {
  readonly rowCount: number;
  /** Rows sharing a reference are LINES of one order (ORD-9), so these differ. */
  readonly orderCount: number;
  readonly headers: readonly string[];
  readonly missingRequired: readonly string[];
  /** Rows the importer's own grouping says will fail, and the first few reasons. */
  readonly rowsWithProblems: number;
  readonly problems: ReadonlyArray<{ rowNumber: number; field: string; reason: string }>;
  readonly exceedsRowLimit: boolean;
  readonly rowLimit: number;
}

/** Save text the API returned as a file. The request carried the bearer token (FE-1). */
function save(text: string, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', text.replace(/^\uFEFF/, '')], { type: 'text/csv' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * RS-5 — upload a CSV of orders. Each row becomes one of THIS store's
 * orders through the same checks the order form makes (your catalogue,
 * the retail range, what is available). The file is checked before
 * anything is imported; a row that fails lands in the error report, and
 * a reference already placed is refused rather than changed — cancel it
 * and upload again to change it.
 *
 * Importing asks once (the file, how many orders, what happens), and the
 * run it started is then followed by the parachute, driven by the same
 * uploads list that already refreshes itself every five seconds while a
 * run is going — no second poll, no invented percentage.
 */
export default function StoreOrderImportPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState('');
  /** The chosen file — held here because a DROPPED file never reaches the input. */
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  /** Remounts the drop zone to clear its own list when the form resets. */
  const [zoneKey, setZoneKey] = useState(0);
  const [busy, setBusy] = useState<'checking' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    spacesKey: string;
    fileName: string;
    preview: Preview;
  } | null>(null);
  const [uploadsPage, setUploadsPage] = useState(1);
  const [confirmImport, setConfirmImport] = useState(false);
  /** The upload this page started, followed by the parachute. */
  const [watching, setWatching] = useState<string | null>(null);
  /** Which download is running — drives its button's busy label only. */
  const [downloading, setDownloading] = useState<string | null>(null);

  // Required/optional columns come from the API (the importer's own sets),
  // never from a list in this file; see CsvColumnGuide.
  const columnGuide = useQuery<{ columns: CsvColumnGuideColumn[] }>({
    queryKey: ['store-order-csv-columns'],
    queryFn: () => client.request<{ columns: CsvColumnGuideColumn[] }>(`${BASE}/template/columns`),
    staleTime: 60_000,
  });

  const uploads = useQuery({
    queryKey: ['store-order-imports', uploadsPage],
    queryFn: () =>
      client.request<{ items: readonly UploadRow[]; total: number }>(
        `${BASE}?page=${uploadsPage}&pageSize=${UPLOADS_PAGE_SIZE}`,
      ),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((u) => u.status === 'PENDING' || u.status === 'PROCESSING')
        ? 5_000
        : false,
  });

  async function downloadText(path: string, fileName: string): Promise<void> {
    setError(null);
    setDownloading(path);
    try {
      const body = await client.request<unknown>(path);
      save(typeof body === 'string' ? body : JSON.stringify(body), fileName);
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setDownloading(null);
    }
  }

  /** A binary download (`.xlsx`): `request` reads text and would corrupt a zip. */
  async function downloadBlob(path: string, fileName: string): Promise<void> {
    setError(null);
    setDownloading(path);
    try {
      const blob = await client.requestBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setDownloading(null);
    }
  }

  async function check(): Promise<void> {
    setError(null);
    const f = pickedFile ?? fileRef.current?.files?.[0];
    if (f === undefined) {
      setError(t('ordimp.chooseFirst'));
      return;
    }
    setBusy('checking');
    try {
      const presign = await client.request<{ spacesKey: string; uploadUrl: string }>(
        `${BASE}/presign`,
        { method: 'POST', body: { fileName: f.name } },
      );
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': f.name.toLowerCase().endsWith('.xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
        },
        body: f,
      });
      if (!put.ok) throw new Error(t('ordimp.uploadFailed', { status: put.status }));
      const preview = await client.request<Preview>(`${BASE}/preview`, {
        method: 'POST',
        body: { spacesKey: presign.spacesKey },
      });
      setPending({ spacesKey: presign.spacesKey, fileName: f.name, preview });
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function importIt(): Promise<void> {
    if (pending === null) return;
    setError(null);
    setBusy('importing');
    try {
      const started = await client.request<{ id?: string } | null>(`${BASE}/process`, {
        method: 'POST',
        body: { spacesKey: pending.spacesKey, fileName: pending.fileName },
      });
      toast.success(t('ordimp.toast.started'));
      setWatching(typeof started?.id === 'string' ? started.id : null);
      setPending(null);
      setPicked('');
      setPickedFile(null);
      setZoneKey((k) => k + 1);
      if (fileRef.current) fileRef.current.value = '';
      setUploadsPage(1);
      void qc.invalidateQueries({ queryKey: ['store-order-imports'] });
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setBusy(null);
    }
  }

  const run =
    watching === null ? undefined : (uploads.data?.items ?? []).find((u) => u.id === watching);

  return (
    <div className="ro-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('ordimp.back')}
      </BackLink>
      <PageHeader title={t('ordimp.title')} subtitle={t('ordimp.subtitle')} />

      <RoSection
        title={t('ordimp.upload')}
        action={
          <>
            <AsyncButton
              variant="primary"
              size="sm"
              icon={<Download size={14} />}
              state={downloading === `${BASE}/template/xlsx` ? 'busy' : undefined}
              labels={{ idle: t('ordimp.templateXlsx'), busy: t('ordimp.downloading') }}
              onClick={() =>
                void downloadBlob(`${BASE}/template/xlsx`, 'skydrop-store-order-template.xlsx')
              }
            />
            <AsyncButton
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              state={downloading === `${BASE}/template` ? 'busy' : undefined}
              labels={{ idle: t('ordimp.templateCsv'), busy: t('ordimp.downloading') }}
              onClick={() =>
                void downloadText(`${BASE}/template`, 'skydrop-store-order-template.csv')
              }
            />
          </>
        }
      >
        <div className="ro-stack ro-stack--tight">
          {columnGuide.data !== undefined ? (
            <CsvColumnGuide
              columns={columnGuide.data.columns}
              notes={{
                externalRef: t('csvcols.d.externalRef'),
                paymentMode: t('csvcols.d.paymentMode'),
                customerName: t('csvcols.d.customerName'),
                customerPhone: t('csvcols.d.customerPhone'),
                addressLine1: t('csvcols.d.addressLine1'),
                city: t('csvcols.d.city'),
                state: t('csvcols.d.state'),
                pinCode: t('csvcols.d.pinCode'),
                productSku: t('csvcols.d.productSku'),
                quantity: t('csvcols.d.quantity'),
                retailUnitPrice: t('csvcols.d.retailUnitPrice'),
                advanceAmount: t('csvcols.d.advanceAmount'),
                codAmount: t('csvcols.d.codAmount'),
                deliveryFee: t('csvcols.d.deliveryFee'),
                discountValue: t('csvcols.d.discountValue'),
                discountType: t('csvcols.d.discountType'),
                declaredValue: t('csvcols.d.declaredValue'),
                productName: t('csvcols.d.productName'),
                productExternalRef: t('csvcols.d.productExternalRef'),
                variantSkuCode: t('csvcols.d.variantSkuCode'),
                weightGrams: t('csvcols.d.weightGrams'),
                lengthCm: t('csvcols.d.lengthCm'),
                widthCm: t('csvcols.d.widthCm'),
                heightCm: t('csvcols.d.heightCm'),
                declaredValueInr: t('csvcols.d.declaredValueInr'),
                barcode: t('csvcols.d.barcode'),
                variantAttributes: t('csvcols.d.variantAttributes'),
                addressLine2: t('csvcols.landmarkNote'),
              }}
              labels={{
                title: t('csvcols.title'),
                colTitle: t('csvcols.colTitle'),
                colMandatory: t('csvcols.colMandatory'),
                colDescription: t('csvcols.colDescription'),
                colSample: t('csvcols.colSample'),
                yes: t('csvcols.yes'),
                no: t('csvcols.no'),
                notUsed: t('csvcols.notUsed'),
                everyRow: t('csvcols.everyRow'),
                everyRowHint: t('csvcols.everyRowHint'),
                oncePerOrder: t('csvcols.oncePerOrder'),
                oncePerOrderHint: t('csvcols.oncePerOrderHint'),
                uat: t('csvcols.uat'),
              }}
            />
          ) : null}
          <DropZone
            key={zoneKey}
            ref={fileRef}
            accept=".csv,.xlsx,text/csv"
            aria-label={t('ordimp.zone.aria')}
            label={picked !== '' ? picked : t('ordimp.zone.label')}
            buttonText={t('ordimp.zone.button')}
            showFiles={false}
            disabled={busy !== null}
            onFiles={(files) => {
              const f = files[0];
              setPickedFile(f ?? null);
              setPicked(f?.name ?? '');
              setPending(null);
            }}
          />
          <div className="ro-row">
            <AsyncButton
              variant="primary"
              icon={<Upload size={15} />}
              state={busy === 'checking' ? 'busy' : undefined}
              labels={{ idle: t('ordimp.check'), busy: t('ordimp.checking') }}
              onClick={() => void check()}
              disabled={busy !== null || picked === ''}
            />
          </div>

          {pending !== null ? (
            <div className="ro-card">
              <div className="ro-stack ro-stack--tight">
                <p className="ro-body">
                  {richMessage(
                    t('ordimp.preview', {
                      rows: t(
                        pending.preview.rowCount === 1 ? 'ordimp.rows.one' : 'ordimp.rows.other',
                        { n: pending.preview.rowCount },
                      ),
                      making:
                        pending.preview.orderCount !== pending.preview.rowCount
                          ? t(
                              pending.preview.orderCount === 1
                                ? 'ordimp.making.one'
                                : 'ordimp.making.other',
                              { n: pending.preview.orderCount },
                            )
                          : '',
                    }),
                    { file: <span className="ro-file-name">{pending.fileName}</span> },
                  )}
                </p>
                {pending.preview.rowsWithProblems > 0 && (
                  <Notice tone="warn" icon={<FileWarning size={15} />}>
                    <span>
                      {t('ordimp.problems', {
                        rows: t(
                          pending.preview.rowsWithProblems === 1
                            ? 'ordimp.rows.one'
                            : 'ordimp.rows.other',
                          { n: pending.preview.rowsWithProblems },
                        ),
                        list: pending.preview.problems
                          .map((p) => t('ordimp.problemRow', { n: p.rowNumber, reason: p.reason }))
                          .join(' · '),
                      })}
                    </span>
                  </Notice>
                )}
                {pending.preview.missingRequired.length > 0 ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>
                      {t('ordimp.missing', { columns: pending.preview.missingRequired.join(', ') })}
                    </span>
                  </Notice>
                ) : pending.preview.exceedsRowLimit ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>{t('ordimp.tooMany', { n: pending.preview.rowLimit })}</span>
                  </Notice>
                ) : (
                  <div className="ro-row">
                    <AsyncButton
                      variant="primary"
                      icon={<FileSpreadsheet size={15} />}
                      state={busy === 'importing' ? 'busy' : undefined}
                      labels={{
                        idle: t('ordimp.import', { n: pending.preview.orderCount }),
                        busy: t('ordimp.importing'),
                      }}
                      onClick={() => setConfirmImport(true)}
                      disabled={busy !== null}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {error !== null ? (
            <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
              <span>{error}</span>
            </Notice>
          ) : null}
        </div>
      </RoSection>

      {run !== undefined ? <ImportRunProgress job={run} /> : null}

      <RoSection title={t('ordimp.recent')} bare>
        {uploads.isPending ? (
          <SkeletonRows rows={3} cols={5} label={t('ordimp.loading')} />
        ) : uploads.isError ? (
          <ErrorState message={verdict(uploads.error, t)} retry={() => void uploads.refetch()} />
        ) : uploads.data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title={t('ordimp.empty.title')}
            description={t('ordimp.empty.body')}
          />
        ) : (
          <div className="ro-card" data-flush="1">
            <Table caption={t('ordimp.recent')}>
              <THead>
                <Tr>
                  <Th>{t('ordimp.col.file')}</Th>
                  <Th>{t('ordimp.col.status')}</Th>
                  <Th align="right">{t('ordimp.col.orders')}</Th>
                  <Th align="right">{t('ordimp.col.failed')}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {uploads.data.items.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <span className="ro-file-name">{u.fileName}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={uploadStatusKind(u.status)}
                        label={uploadStatusLabel(u.status, locale)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{u.ordersCreated}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{u.rowsFailed}</span>
                    </Td>
                    <Td align="right">
                      {u.errorReportKey !== null ? (
                        <>
                          <AsyncButton
                            variant="ghost"
                            size="sm"
                            icon={<Download size={14} />}
                            state={
                              downloading === `${BASE}/${u.id}/error-report?format=xlsx`
                                ? 'busy'
                                : undefined
                            }
                            labels={{
                              idle: t('ordimp.errorReportXlsx'),
                              busy: t('ordimp.downloading'),
                            }}
                            onClick={() =>
                              void downloadBlob(
                                `${BASE}/${u.id}/error-report?format=xlsx`,
                                `errors-${u.fileName.replace(/\.(csv|xlsx)$/i, '')}.xlsx`,
                              )
                            }
                          />
                          <AsyncButton
                            variant="ghost"
                            size="sm"
                            icon={<Download size={14} />}
                            state={
                              downloading === `${BASE}/${u.id}/error-report` ? 'busy' : undefined
                            }
                            labels={{
                              idle: t('ordimp.errorReport'),
                              busy: t('ordimp.downloading'),
                            }}
                            onClick={() =>
                              void downloadText(
                                `${BASE}/${u.id}/error-report`,
                                `errors-${u.fileName}`,
                              )
                            }
                          />
                        </>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="ro-table-foot">
              <Pagination
                page={uploadsPage}
                pageSize={UPLOADS_PAGE_SIZE}
                total={uploads.data.total}
                onPageChange={setUploadsPage}
                label={t('ordimp.pages')}
              />
            </div>
          </div>
        )}
      </RoSection>

      <ConfirmDialog
        open={confirmImport}
        onOpenChange={setConfirmImport}
        title={t('ordimp.confirm.title')}
        entity={pending?.fileName ?? ''}
        amount={
          pending === null
            ? undefined
            : t(
                pending.preview.orderCount === 1
                  ? 'ordimp.confirm.orders.one'
                  : 'ordimp.confirm.orders.other',
                { n: pending.preview.orderCount },
              )
        }
        consequence={t('ordimp.confirm.consequence')}
        confirmLabel={
          pending === null
            ? t('ordimp.confirm.import')
            : t('ordimp.import', { n: pending.preview.orderCount })
        }
        cancelLabel={t('ordimp.confirm.notYet')}
        // Closes at once: the import button on the page carries the busy
        // state (importIt() never throws — it reports on the page).
        onConfirm={() => {
          void importIt();
        }}
      />
    </div>
  );
}

/**
 * The run this page started, as a parachute. The percentage is the rows
 * the upload reports as handled — orders created plus rows failed — over
 * the rows in the file; while it is still PENDING nothing has been
 * counted, so the parachute says it does not know rather than guessing.
 */
function ImportRunProgress({ job }: { readonly job: UploadRow }): ReactElement {
  const t = useT();
  const handled = job.ordersCreated + job.rowsFailed;
  const running = job.status === 'PENDING' || job.status === 'PROCESSING';
  const state: ParachuteState = running
    ? 'running'
    : job.status === 'FAILED' || job.status === 'CANCELLED'
      ? 'failed'
      : 'done';
  const value =
    job.status === 'PENDING' || job.rowCount === 0
      ? null
      : Math.min(100, Math.max(0, (handled / job.rowCount) * 100));
  return (
    <div className="ro-card">
      <ParachuteProgress
        label={t('ordimp.run.label', { file: job.fileName })}
        value={state === 'running' ? value : 100}
        state={state}
        doneLabel={t('ordimp.run.done')}
        failedLabel={t('ordimp.run.failed')}
        detail={t(job.rowCount === 1 ? 'ordimp.run.detail.one' : 'ordimp.run.detail.other', {
          handled,
          total: job.rowCount,
        })}
      />
    </div>
  );
}
