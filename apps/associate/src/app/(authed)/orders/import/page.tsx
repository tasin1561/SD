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
import { serverVerdict } from '@/lib/server-verdict';
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
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
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
      setError(serverVerdict(err));
    } finally {
      setDownloading(null);
    }
  }

  async function check(): Promise<void> {
    setError(null);
    const f = pickedFile ?? fileRef.current?.files?.[0];
    if (f === undefined) {
      setError('Choose a CSV file first.');
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
      if (!put.ok) throw new Error(`The upload failed (${put.status}). Try again.`);
      const preview = await client.request<Preview>(`${BASE}/preview`, {
        method: 'POST',
        body: { spacesKey: presign.spacesKey },
      });
      setPending({ spacesKey: presign.spacesKey, fileName: f.name, preview });
    } catch (err) {
      setError(serverVerdict(err));
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
      toast.success('Import started. Rows become orders in a moment.');
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
      setError(serverVerdict(err));
    } finally {
      setBusy(null);
    }
  }

  const run =
    watching === null ? undefined : (uploads.data?.items ?? []).find((u) => u.id === watching);

  return (
    <div className="as-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        My orders
      </BackLink>
      <PageHeader
        title="Upload orders"
        subtitle="One row is one product line — give two rows the same reference and they become one order with two items. You do not set a price in the file: each product is sold at the price your store set for you. A reference you have already used comes back as an error row; re-uploading never changes an order you have already placed."
      />

      {/* Importing creates orders, so the same pause applies. The form
          stays usable and the server's refusal is the honest one. */}
      {paused ? (
        <Notice
          tone="warn"
          icon={<PauseCircle size={16} />}
          title="Your store has paused new orders from you"
          role="status"
        >
          <span>
            An upload will be refused until it is switched back on. Everything you have already
            placed carries on.
          </span>
        </Notice>
      ) : null}

      <Section
        title="Upload"
        action={
          <AsyncButton
            variant="ghost"
            size="sm"
            icon={<Download size={14} />}
            state={downloading === `${BASE}/template` ? 'busy' : undefined}
            labels={{ idle: 'Download the template', busy: 'Downloading…' }}
            onClick={() => void downloadText(`${BASE}/template`, 'skydrop-order-template.csv')}
          />
        }
      >
        <div className="as-stack as-stack--tight">
          <DropZone
            key={zoneKey}
            ref={fileRef}
            accept=".csv,text/csv"
            aria-label="Order CSV"
            label={picked !== '' ? picked : 'Drop your CSV here'}
            buttonText="Choose CSV…"
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
              labels={{ idle: 'Upload and check', busy: 'Checking…' }}
              onClick={() => void check()}
              disabled={busy !== null || picked === ''}
            />
          </div>

          {pending !== null ? (
            <div className="as-card">
              <div className="as-stack as-stack--tight">
                <p className="as-body">
                  <span className="as-file-name">{pending.fileName}</span>:{' '}
                  {pending.preview.rowCount} row{pending.preview.rowCount === 1 ? '' : 's'}
                  {pending.preview.orderCount !== pending.preview.rowCount
                    ? `, making ${pending.preview.orderCount} order${
                        pending.preview.orderCount === 1 ? '' : 's'
                      }`
                    : ''}
                  .
                </p>
                {pending.preview.rowsWithProblems > 0 && (
                  <Notice tone="warn" icon={<FileWarning size={15} />}>
                    <span>
                      {pending.preview.rowsWithProblems} row
                      {pending.preview.rowsWithProblems === 1 ? '' : 's'} will not import ·{' '}
                      {pending.preview.problems
                        .map((p) => `Row ${p.rowNumber}: ${p.reason}`)
                        .join(' · ')}
                    </span>
                  </Notice>
                )}
                {pending.preview.missingRequired.length > 0 ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>
                      Missing columns: {pending.preview.missingRequired.join(', ')}. Fix the file
                      and upload it again.
                    </span>
                  </Notice>
                ) : pending.preview.exceedsRowLimit ? (
                  <Notice tone="bad" icon={<FileWarning size={16} />}>
                    <span>More than {pending.preview.rowLimit} rows. Split the file.</span>
                  </Notice>
                ) : (
                  <div className="as-row">
                    <AsyncButton
                      variant="primary"
                      icon={<FileSpreadsheet size={15} />}
                      state={busy === 'importing' ? 'busy' : undefined}
                      labels={{
                        idle: `Import ${pending.preview.orderCount} orders`,
                        busy: 'Importing…',
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

      <Section title="Recent uploads" bare>
        {uploads.isPending ? (
          <SkeletonRows rows={3} cols={5} label="Loading uploads" />
        ) : uploads.isError ? (
          <ErrorState message={serverVerdict(uploads.error)} retry={() => void uploads.refetch()} />
        ) : uploads.data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title="No uploads yet"
            description="Upload a CSV above to place many orders at once."
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption="Recent uploads">
              <THead>
                <Tr>
                  <Th>File</Th>
                  <Th>Status</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Failed</Th>
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
                        label={uploadStatusLabel(u.status)}
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
                          labels={{ idle: 'Error report', busy: 'Downloading…' }}
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
                label="Upload pages"
              />
            </div>
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={confirmImport}
        onOpenChange={setConfirmImport}
        title="Import these orders?"
        entity={pending?.fileName ?? ''}
        amount={
          pending === null
            ? undefined
            : `${pending.preview.orderCount} ${
                pending.preview.orderCount === 1 ? 'order' : 'orders'
              }`
        }
        consequence="Each row becomes one of your orders and goes to Skydrop's call centre to be confirmed. A row that fails lands in the error report; nothing else is changed."
        confirmLabel={pending === null ? 'Import' : `Import ${pending.preview.orderCount} orders`}
        cancelLabel="Not yet"
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
        label={`Importing ${job.fileName}`}
        value={state === 'running' ? value : 100}
        state={state}
        doneLabel="Import finished"
        failedLabel="Import stopped"
        detail={`${handled} of ${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'} handled`}
      />
    </div>
  );
}
