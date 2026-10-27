'use client';

import { useRef, useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileWarning,
  Inbox,
  PauseCircle,
  Upload,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CsvColumnGuide, type CsvColumnGuideColumn } from '@skydrop/ui/app/csv-column-guide';
import { useApiClient, useStoreIdentity } from '@skydrop/auth/client';
// The shell mounts the legacy <Toaster>; the app `useToast` would throw
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
import { ordersPaused } from '@/lib/orders-paused';
import { BackLink, Notice, Section } from '../../_components/parts';
import '../../_components/as.css';

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
 * ASSOC-1 capability 2 — place many orders from a CSV.
 *
 * The same machinery and the same checks as the one-order form: each row
 * becomes one of YOUR orders, at YOUR price, and the file is checked
 * before anything is imported. Rows sharing a reference become one order
 * with several lines (ORD-9). A reference already used comes back as an
 * error row rather than changing an order you have already placed.
 */
export default function OrderImportPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const me = useStoreIdentity();
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
  const paused = ordersPaused(me);

  // Required/optional columns come from the API (the importer's own sets),
  // never from a list in this file; see CsvColumnGuide.
  const columnGuide = useQuery<{ columns: CsvColumnGuideColumn[] }>({
    queryKey: ['store-order-csv-columns'],
    queryFn: () => client.request<{ columns: CsvColumnGuideColumn[] }>(`${BASE}/template/columns`),
    staleTime: 60_000,
  });

  const uploads = useQuery({
    queryKey: ['my-order-imports', uploadsPage],
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

  async function check(): Promise<void> {
    setError(null);
    const f = pickedFile ?? fileRef.current?.files?.[0];
    if (f === undefined) {
      setError(t('import.chooseFirst'));
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
        headers: { 'Content-Type': 'text/csv' },
        body: f,
      });
      if (!put.ok) throw new Error(t('import.uploadFailed', { status: put.status }));
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
      toast.success(t('import.started'));
      setWatching(typeof started?.id === 'string' ? started.id : null);
      setPending(null);
      setPicked('');
      setPickedFile(null);
      setZoneKey((k) => k + 1);
      if (fileRef.current) fileRef.current.value = '';
      setUploadsPage(1);
      void qc.invalidateQueries({ queryKey: ['my-order-imports'] });
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setBusy(null);
    }
  }

  const run =
    watching === null ? undefined : (uploads.data?.items ?? []).find((u) => u.id === watching);

  return (
    <div className="as-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('nav.myOrders')}
      </BackLink>
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} />

      {/* Importing creates orders, so the same pause applies. The form
          stays usable and the server's refusal is the honest one. */}
      {paused ? (
        <Notice
          tone="warn"
          icon={<PauseCircle size={16} />}
          title={t('import.paused.title')}
          role="status"
        >
          <span>{t('import.paused.body')}</span>
        </Notice>
      ) : null}

      <Section
        title={t('import.upload')}
        action={
          <AsyncButton
            variant="ghost"
            size="sm"
            icon={<Download size={14} />}
            state={downloading === `${BASE}/template` ? 'busy' : undefined}
            labels={{ idle: t('import.template'), busy: t('import.downloading') }}
            onClick={() => void downloadText(`${BASE}/template`, 'skydrop-order-template.csv')}
          />
        }
      >
        <div className="as-stack as-stack--tight">
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
            accept=".csv,text/csv"
            aria-label={t('import.dropAria')}
            label={picked !== '' ? picked : t('import.dropLabel')}
            buttonText={t('import.choose')}
            showFiles={false}
            disabled={busy !== null}
            onFiles={(files) => {
              const f = files[0];
              setPickedFile(f ?? null);
              setPicked(f?.name ?? '');
              setPending(null);
            }}
          />
          <div className="as-row">
            <AsyncButton
              variant="primary"
              icon={<Upload size={15} />}
              state={busy === 'checking' ? 'busy' : undefined}
              labels={{ idle: t('import.check'), busy: t('import.checking') }}
              onClick={() => void check()}
              disabled={busy !== null || picked === ''}
            />
          </div>

          {pending !== null ? (
            <div className="as-card">
              <div className="as-stack as-stack--tight">
                <p className="as-body">
                  {richMessage(
                    t(
                      pending.preview.orderCount !== pending.preview.rowCount
                        ? 'import.preview.making'
                        : 'import.preview.same',
                    ),
                    {
                      file: <span className="as-file-name">{pending.fileName}</span>,
                      rows: t(
                        pending.preview.rowCount === 1 ? 'import.rows.one' : 'import.rows.other',
                        { n: pending.preview.rowCount },
                      ),
                      orders: t(
                        pending.preview.orderCount === 1
                          ? 'import.orders.one'
                          : 'import.orders.other',
                        { n: pending.preview.orderCount },
                      ),
                    },
                  )}
                </p>
                {pending.preview.rowsWithProblems > 0 && (
                  <Notice tone="warn" icon={<FileWarning size={15} />}>
                    <span>
                      {t(
                        pending.preview.rowsWithProblems === 1
                          ? 'import.problems.one'
                          : 'import.problems.other',
                        {
                          n: pending.preview.rowsWithProblems,
                          list: pending.preview.problems
                            .map((p) =>
                              t('import.problem.row', { n: p.rowNumber, reason: p.reason }),
                            )
                            .join(' · '),
                        },
                      )}
                    </span>
                  </Notice>
                )}
                {pending.preview.missingRequired.length > 0 ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>
                      {t('import.missing', { columns: pending.preview.missingRequired.join(', ') })}
                    </span>
                  </Notice>
                ) : pending.preview.exceedsRowLimit ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>{t('import.tooMany', { limit: pending.preview.rowLimit })}</span>
                  </Notice>
                ) : (
                  <div className="as-row">
                    <AsyncButton
                      variant="primary"
                      icon={<FileSpreadsheet size={15} />}
                      state={busy === 'importing' ? 'busy' : undefined}
                      labels={{
                        idle: t('import.importN', {
                          orders: t('import.orders.other', { n: pending.preview.orderCount }),
                        }),
                        busy: t('import.importing'),
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
      </Section>

      {run !== undefined ? <ImportRunProgress job={run} /> : null}

      <Section title={t('import.recent')} bare>
        {uploads.isPending ? (
          <SkeletonRows rows={3} cols={5} label={t('import.recentLoading')} />
        ) : uploads.isError ? (
          <ErrorState message={verdict(uploads.error, t)} retry={() => void uploads.refetch()} />
        ) : uploads.data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title={t('import.empty.title')}
            description={t('import.empty.body')}
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption={t('import.recent')}>
              <THead>
                <Tr>
                  <Th>{t('import.col.file')}</Th>
                  <Th>{t('import.col.status')}</Th>
                  <Th align="right">{t('import.col.orders')}</Th>
                  <Th align="right">{t('import.col.failed')}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {uploads.data.items.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <span className="as-file-name">{u.fileName}</span>
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
                        <AsyncButton
                          variant="ghost"
                          size="sm"
                          icon={<Download size={14} />}
                          state={
                            downloading === `${BASE}/${u.id}/error-report` ? 'busy' : undefined
                          }
                          labels={{ idle: t('import.errorReport'), busy: t('import.downloading') }}
                          onClick={() =>
                            void downloadText(
                              `${BASE}/${u.id}/error-report`,
                              `errors-${u.fileName}`,
                            )
                          }
                        />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="as-table-foot">
              <Pagination
                page={uploadsPage}
                pageSize={UPLOADS_PAGE_SIZE}
                total={uploads.data.total}
                onPageChange={setUploadsPage}
                label={t('import.pages')}
              />
            </div>
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={confirmImport}
        onOpenChange={setConfirmImport}
        title={t('import.confirm.title')}
        entity={pending?.fileName ?? ''}
        amount={
          pending === null
            ? undefined
            : t(pending.preview.orderCount === 1 ? 'import.orders.one' : 'import.orders.other', {
                n: pending.preview.orderCount,
              })
        }
        consequence={t('import.confirm.consequence')}
        confirmLabel={
          pending === null
            ? t('import.confirm.import')
            : t('import.importN', {
                orders: t('import.orders.other', { n: pending.preview.orderCount }),
              })
        }
        cancelLabel={t('import.confirm.notYet')}
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
    <div className="as-card">
      <ParachuteProgress
        label={t('import.run.label', { file: job.fileName })}
        value={state === 'running' ? value : 100}
        state={state}
        doneLabel={t('import.run.finished')}
        failedLabel={t('import.run.stopped')}
        detail={t(job.rowCount === 1 ? 'import.run.detail.one' : 'import.run.detail.other', {
          handled,
          total: job.rowCount,
        })}
      />
    </div>
  );
}
