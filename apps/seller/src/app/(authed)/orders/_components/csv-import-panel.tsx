'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Download, FileSpreadsheet, FileWarning, Upload } from 'lucide-react';
import { BulkUploadStatus } from '@skydrop/db';
import { uploadStatusKind, uploadStatusLabel } from '@skydrop/ui/status';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { ParachuteProgress, type ParachuteState } from '@skydrop/ui/app/parachute-progress';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useApiClient } from '@skydrop/auth/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { serverVerdict } from '@/lib/server-verdict';
import { Notice, OrdSection } from './orders-parts';

/**
 * Shared CSV import widget — drives:
 *   1. Download template (GET endpointBase/template)
 *   2. Upload — POST endpointBase/presign → PUT to Spaces → POST
 *      endpointBase/process
 *   3. Recent imports table — GET endpointBase, polls every 5s while
 *      any row is RUNNING / QUEUED
 *   4. Per-row "Errors CSV" link if errorReportKey is set
 *
 * Both the orders import (POST /seller/order-imports) and the
 * catalog import (POST /seller/csv-imports) follow the same shape;
 * pages set `endpointBase` accordingly.
 */
export interface CsvUploadJob {
  readonly id: string;
  readonly fileName: string;
  readonly status: string;
  readonly rowCount: number;
  readonly rowsFailed?: number;
  readonly rowsSkipped?: number;
  readonly errorReportKey?: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  /** orders import returns this; catalog returns its own variant. */
  readonly ordersCreated?: number;
  readonly productsCreated?: number;
  readonly variantsCreated?: number;
}

type Kind = 'orders' | 'catalog';

interface UploadsResponse {
  readonly items: ReadonlyArray<CsvUploadJob>;
  readonly total: number;
}

/**
 * What the server says about a file BEFORE any of it is imported.
 *
 * The same shape for both importers — order and catalog previews return
 * identical fields, so one panel serves both.
 */
interface CsvPreview {
  readonly rowCount: number;
  readonly headers: readonly string[];
  readonly sampleRows: ReadonlyArray<Record<string, string>>;
  readonly mapping: Readonly<Record<string, string | undefined>>;
  readonly missingRequired: readonly string[];
  readonly unmatchedHeaders: ReadonlyArray<{ header: string; suggestion: string | null }>;
  readonly exceedsRowLimit: boolean;
  readonly rowLimit: number;
}

export function CsvImportPanel({
  kind,
  endpointBase,
  templateFileName,
  detailHrefBase,
}: {
  readonly kind: Kind;
  readonly endpointBase: string;
  readonly templateFileName: string;
  readonly previewSampleSize?: number;
  /**
   * Where a row goes when clicked — the PREFIX, `<base>/<id>`.
   * Optional because only the orders importer has a per-run detail
   * screen (GET endpointBase/:id); passing nothing leaves the table
   * exactly as it was rather than linking somewhere that 404s.
   *
   * ── WHY A STRING AND NOT A FUNCTION (2026-09-20) ──────────────────
   * It was `(uploadId: string) => string`, and `/orders/import` is a
   * SERVER component, so React refused the render outright:
   * "Functions cannot be passed directly to Client Components". The
   * page returned a 500 and an error boundary — the whole bulk order
   * import was unreachable, in production, and nothing caught it
   * because a server-component boundary error is invisible to
   * typecheck, to lint and to a jsdom test. It surfaced the first time
   * the page was opened in a real browser.
   */
  readonly detailHrefBase?: string;
}): ReactElement {
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * The file the seller chose — by the button OR by dropping it on the
   * zone. A dropped file never reaches the input's own `files`, so the
   * upload reads this first and the input second.
   */
  const pickedFile = useRef<File | null>(null);
  /** Bumped after an upload so the drop zone starts empty again. */
  const [zoneKey, setZoneKey] = useState(0);

  const [busy, setBusy] = useState<'uploading' | 'processing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');
  /**
   * The uploaded-but-not-yet-imported file.
   *
   * The preview endpoint existed on both importers and was never called:
   * the panel went presign → PUT → process, committing the file before
   * the seller could see what we made of it. A CSV with a column we
   * cannot map does not fail loudly — it imports every row wrong, or
   * fails one row at a time into an error report read after the fact.
   */
  const [pending, setPending] = useState<{
    spacesKey: string;
    fileName: string;
    preview: CsvPreview;
  } | null>(null);

  const list = useQuery<UploadsResponse>({
    queryKey: ['seller-csv-uploads', kind],
    queryFn: () => client.request<UploadsResponse>(`${endpointBase}?page=1&pageSize=10`),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      // Both importers write `BulkUploadStatus`, whose only non-terminal
      // values are PENDING and PROCESSING. This used to also test for
      // RUNNING and QUEUED, which that enum has never had — so polling
      // stopped the moment the worker claimed the job and the table
      // sat on PROCESSING until someone reloaded the page.
      const stillRunning = items.some(
        (it) => it.status === 'PENDING' || it.status === 'PROCESSING',
      );
      return stillRunning ? 5_000 : false;
    },
  });

  /**
   * The newest run, once we have seen it running — so its progress line
   * stays on screen when it finishes and lands, rather than vanishing the
   * moment the poll reads a terminal status.
   */
  const [watching, setWatching] = useState<string | null>(null);
  const newest = list.data?.items[0];
  useEffect(() => {
    if (newest !== undefined && (newest.status === 'PENDING' || newest.status === 'PROCESSING')) {
      setWatching(newest.id);
    }
  }, [newest]);

  function fmtError(err: unknown): string {
    return serverVerdict(err, 'Upload failed');
  }

  /** The template download for the rolling-label button: it records the
   *  same verdict, then rethrows so the label ends on the real outcome. */
  async function downloadTemplateOrThrow(): Promise<void> {
    const ok = await downloadTemplate();
    if (!ok) throw new Error('Template download failed');
  }

  async function downloadTemplate(): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`${endpointBase}/template`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Template download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = templateFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      setError(fmtError(err));
      return false;
    }
  }

  function onPickFiles(files: File[]): void {
    const f = files[0];
    pickedFile.current = f ?? null;
    setSelectedName(f ? f.name : '');
  }

  async function upload(): Promise<void> {
    setError(null);
    const f = pickedFile.current ?? fileRef.current?.files?.[0];
    if (!f) {
      setError('Pick a CSV file first.');
      return;
    }
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('File must be a .csv');
      return;
    }
    setBusy('uploading');
    try {
      const presign = await client.request<{
        spacesKey: string;
        uploadUrl: string;
      }>(`${endpointBase}/presign`, {
        method: 'POST',
        body: { fileName: f.name },
      });

      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/csv' },
        body: f,
      });
      if (!put.ok) {
        throw new Error(`PUT to Spaces failed: ${put.status}`);
      }

      // Look at it BEFORE committing it. The file is in Spaces either
      // way; this only decides whether we create orders from it.
      const preview = await client.request<CsvPreview>(`${endpointBase}/preview`, {
        method: 'POST',
        body: { spacesKey: presign.spacesKey },
      });
      setPending({ spacesKey: presign.spacesKey, fileName: f.name, preview });
      if (fileRef.current) fileRef.current.value = '';
      pickedFile.current = null;
      setZoneKey((k) => k + 1);
      setSelectedName('');
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport(): Promise<void> {
    if (pending === null) return;
    setError(null);
    setBusy('processing');
    try {
      await client.request<CsvUploadJob>(`${endpointBase}/process`, {
        method: 'POST',
        body: { spacesKey: pending.spacesKey, fileName: pending.fileName },
      });
      toast.success('Import queued — refresh to track progress.');
      setPending(null);
      void queryClient.invalidateQueries({
        queryKey: ['seller-csv-uploads', kind],
      });
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadErrorReport(uploadId: string): Promise<void> {
    try {
      const res = await fetch(`${endpointBase}/${uploadId}/error-report`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error report download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error-report-${uploadId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(fmtError(err));
    }
  }

  const items = list.data?.items ?? [];
  const latest = items[0];

  return (
    <div className="ord-stack">
      <OrdSection
        title="Upload"
        note={`One row is one ${kind === 'orders' ? 'order' : 'product or variant'}.`}
        action={
          <AsyncButton
            variant="ghost"
            size="sm"
            icon={<Download size={14} />}
            labels={{ idle: 'Download template', busy: 'Downloading…', done: 'Downloaded' }}
            onAction={() => downloadTemplateOrThrow()}
          />
        }
      >
        <div className="ord-stack ord-stack--tight">
          <p className="ord-p">
            Download the template, fill it in, then upload here. Nothing is imported until you have
            seen what we matched.
          </p>

          <DropZone
            key={zoneKey}
            ref={fileRef}
            accept=".csv,text/csv"
            label={selectedName || 'Drop your CSV here'}
            buttonText="Choose CSV…"
            showFiles={false}
            onFiles={onPickFiles}
            disabled={busy !== null}
          />

          <div className="ord-row">
            <AsyncButton
              variant="primary"
              icon={<Upload size={15} />}
              state={busy === 'uploading' ? 'busy' : undefined}
              labels={{ idle: 'Upload and check', busy: 'Checking…' }}
              onClick={() => void upload()}
              disabled={busy !== null || !selectedName}
            />
          </div>

          {error && (
            <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
              <span>{error}</span>
            </Notice>
          )}
        </div>
      </OrdSection>

      {/* Nothing has been imported yet. This is the step that was
          missing: the file went straight to process, so a column we
          could not map became rows that failed one at a time into an
          error report read afterwards. */}
      {pending !== null && (
        <OrdSection
          title="Check before importing"
          note={
            <span>
              <span className="sk-ident">{pending.fileName}</span> · {pending.preview.rowCount} row
              {pending.preview.rowCount === 1 ? '' : 's'}
            </span>
          }
        >
          <div className="ord-stack ord-stack--tight">
            <p className="ord-p">
              Nothing has been imported yet. Check what we matched, then import.
            </p>

            {pending.preview.missingRequired.length > 0 && (
              <Notice tone="bad" icon={<FileWarning size={16} />} title="Missing columns">
                <span>
                  {pending.preview.missingRequired.join(', ')}. Add them to your file and upload
                  again — every row would fail without them.
                </span>
              </Notice>
            )}

            {pending.preview.exceedsRowLimit && (
              <Notice tone="bad" icon={<FileWarning size={16} />}>
                <span>
                  Too many rows — the limit is {pending.preview.rowLimit}. Split the file.
                </span>
              </Notice>
            )}

            {pending.preview.unmatchedHeaders.length > 0 && (
              <p className="ord-p">
                <strong className="ord-strong">Columns we will ignore:</strong>{' '}
                {pending.preview.unmatchedHeaders
                  .map((u) =>
                    // The suggestion is the useful half — "Phone No is
                    // ignored" is a shrug; "did you mean customerPhone"
                    // is a fix.
                    u.suggestion !== null
                      ? `${u.header} (did you mean ${u.suggestion}?)`
                      : u.header,
                  )
                  .join(', ')}
              </p>
            )}

            <div className="ord-stack ord-stack--tight">
              <span className="ord-strong">What we matched</span>
              <div className="ord-mapping">
                {Object.entries(pending.preview.mapping).map(([field, header]) => (
                  <span key={field}>
                    <span className="sk-ident">{field}</span> <span className="ord-faint">←</span>{' '}
                    <span className="sk-ident ord-strong">{header}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="ord-row">
              <AsyncButton
                variant="primary"
                icon={<FileSpreadsheet size={15} />}
                state={busy === 'processing' ? 'busy' : undefined}
                labels={{
                  idle: `Import ${pending.preview.rowCount} row${pending.preview.rowCount === 1 ? '' : 's'}`,
                  busy: 'Queuing…',
                }}
                disabled={
                  busy !== null ||
                  pending.preview.missingRequired.length > 0 ||
                  pending.preview.exceedsRowLimit
                }
                onClick={() => void confirmImport()}
              />
              <Button variant="secondary" disabled={busy !== null} onClick={() => setPending(null)}>
                Discard
              </Button>
            </div>
          </div>
        </OrdSection>
      )}

      {latest !== undefined && watching === latest.id && (
        <ImportRunProgress job={latest} kind={kind} />
      )}

      <OrdSection
        title="Recent imports"
        note={list.data === undefined ? undefined : `${list.data.items.length} shown, newest first`}
        flush={list.data !== undefined && list.data.items.length > 0}
      >
        {list.isLoading ? (
          <SkeletonRows rows={3} cols={4} label="Loading recent imports…" />
        ) : list.isError ? (
          <ErrorState
            message={serverVerdict(list.error, 'Failed to load uploads.')}
            retry={() => void list.refetch()}
          />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            bare
            icon={<FileSpreadsheet size={20} />}
            title="No imports yet"
            description="Upload a CSV above to start your first import."
          />
        ) : (
          <Table caption="Recent imports">
            <THead>
              <Tr>
                <Th>File</Th>
                <Th>Status</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Created</Th>
                <Th align="right">Failed</Th>
                <Th>When</Th>
                <Th aria-label="Error report" />
              </Tr>
            </THead>
            <TBody>
              {list.data.items.map((u) => {
                const created =
                  u.ordersCreated ?? (u.productsCreated ?? 0) + (u.variantsCreated ?? 0);
                return (
                  <Tr key={u.id}>
                    <Td>
                      {detailHrefBase === undefined ? (
                        <span className="sk-ident ord-file-name" title={u.fileName}>
                          {u.fileName}
                        </span>
                      ) : (
                        <Link
                          href={`${detailHrefBase}/${u.id}`}
                          className="ord-link sk-ident ord-file-name"
                          title={u.fileName}
                        >
                          {u.fileName}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <UploadStatusChip status={u.status} />
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{u.rowCount}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{created}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{u.rowsFailed ?? 0}</span>
                    </Td>
                    <Td>
                      <span className="sk-figure ord-nowrap ord-muted">
                        {new Date(u.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                      </span>
                    </Td>
                    <Td>
                      {u.errorReportKey && (
                        <button
                          type="button"
                          onClick={() => void downloadErrorReport(u.id)}
                          className="ord-expand"
                        >
                          <Download size={14} aria-hidden />
                          Errors CSV
                        </button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </OrdSection>
    </div>
  );
}

const UPLOAD_STATUSES: readonly string[] = Object.values(BulkUploadStatus);
const RUNNING: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

/** The run's status as a chip, in the shared words; an unknown value prints as itself. */
function UploadStatusChip({ status }: { readonly status: string }): ReactElement {
  if (!UPLOAD_STATUSES.includes(status)) {
    return <StatusChip kind="neutral" label={status} size="sm" />;
  }
  const s = status as BulkUploadStatus;
  return (
    <StatusChip
      kind={uploadStatusKind(s)}
      label={uploadStatusLabel(s)}
      size="sm"
      pulse={RUNNING.has(status)}
    />
  );
}

/**
 * The run the seller is watching, as the parachute progress line.
 *
 * The fill is the REAL count of rows the worker has dealt with (made an
 * order, refused, or skipped as already sent) over the rows in the file,
 * from the same record the table polls. A catalogue import does not
 * report rows handled, so it is honest about not knowing (no value).
 */
function ImportRunProgress({
  job,
  kind,
}: {
  readonly job: CsvUploadJob;
  readonly kind: Kind;
}): ReactElement {
  const handled =
    kind === 'orders' && job.ordersCreated !== undefined
      ? job.ordersCreated + (job.rowsFailed ?? 0) + (job.rowsSkipped ?? 0)
      : null;
  const value =
    job.status === 'PENDING' || handled === null || job.rowCount === 0
      ? null
      : Math.min(100, Math.max(0, (handled / job.rowCount) * 100));
  const state: ParachuteState = RUNNING.has(job.status)
    ? 'running'
    : job.status === 'FAILED' || job.status === 'CANCELLED'
      ? 'failed'
      : 'done';
  return (
    <div className="ord-card">
      <ParachuteProgress
        label={`Importing ${job.fileName}`}
        value={state === 'running' ? value : 100}
        state={state}
        doneLabel="Import finished"
        failedLabel="Import stopped"
        detail={
          handled === null
            ? `${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'} in the file`
            : `${handled} of ${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'} handled`
        }
      />
    </div>
  );
}
