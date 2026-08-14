'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { useApiClient } from '@skydrop/auth/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  detailHref,
}: {
  readonly kind: Kind;
  readonly endpointBase: string;
  readonly templateFileName: string;
  readonly previewSampleSize?: number;
  /**
   * Where a row goes when clicked. Optional because only the orders
   * importer has a per-run detail screen (GET endpointBase/:id) —
   * passing nothing leaves the table exactly as it was rather than
   * linking somewhere that 404s.
   */
  readonly detailHref?: (uploadId: string) => string;
}): ReactElement {
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

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

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Upload failed';
  }

  async function downloadTemplate(): Promise<void> {
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
    } catch (err) {
      setError(fmtError(err));
    }
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    setSelectedName(f ? f.name : '');
  }

  async function upload(): Promise<void> {
    setError(null);
    const f = fileRef.current?.files?.[0];
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

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Upload</h2>
          <p className="text-text-muted text-xs mb-3">
            Download the template, fill it in, then upload here. Each row is a separate{' '}
            {kind === 'orders' ? 'order' : 'product / variant'}.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" size="md" onClick={() => void downloadTemplate()}>
              Download template
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-[5px] border border-border bg-surface hover:border-border-strong text-text-body text-sm">
              <span>{selectedName || 'Choose CSV…'}</span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onPickFile}
                disabled={busy !== null}
              />
            </label>
            <Button
              variant="primary"
              size="md"
              onClick={() => void upload()}
              disabled={busy !== null || !selectedName}
            >
              {busy === 'uploading' ? 'Checking…' : 'Upload and check'}
            </Button>
          </div>

          {error && (
            <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mt-3">
              {error}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Nothing has been imported yet. This is the step that was
          missing: the file went straight to process, so a column we
          could not map became rows that failed one at a time into an
          error report read afterwards. */}
      {pending !== null && (
        <Card>
          <CardBody>
            <h2 className="text-text-bright mb-1 text-sm font-medium">
              Before we import {pending.fileName}
            </h2>
            <p className="text-text-muted mb-3 text-xs">
              {pending.preview.rowCount} row{pending.preview.rowCount === 1 ? '' : 's'} found.
              Nothing has been imported yet.
            </p>

            {pending.preview.missingRequired.length > 0 && (
              <div className="text-critical bg-[var(--color-critical-tint)] border-[var(--color-critical-ring)] mb-3 rounded-[5px] border px-3 py-2 text-xs">
                <strong>Missing columns:</strong> {pending.preview.missingRequired.join(', ')}. Add
                them to your file and upload again — every row would fail without them.
              </div>
            )}

            {pending.preview.exceedsRowLimit && (
              <div className="text-critical bg-[var(--color-critical-tint)] border-[var(--color-critical-ring)] mb-3 rounded-[5px] border px-3 py-2 text-xs">
                Too many rows — the limit is {pending.preview.rowLimit}. Split the file.
              </div>
            )}

            {pending.preview.unmatchedHeaders.length > 0 && (
              <div className="text-text-muted mb-3 text-xs">
                <strong className="text-text-body">Columns we will ignore:</strong>{' '}
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
              </div>
            )}

            <div className="mb-3">
              <div className="text-text-faint mb-1 text-xs uppercase tracking-wide">
                What we matched
              </div>
              <div className="text-text-muted flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
                {Object.entries(pending.preview.mapping).map(([field, header]) => (
                  <span key={field}>
                    {field} <span className="text-text-faint">←</span>{' '}
                    <span className="text-text-body">{header}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="md"
                disabled={
                  busy !== null ||
                  pending.preview.missingRequired.length > 0 ||
                  pending.preview.exceedsRowLimit
                }
                onClick={() => void confirmImport()}
              >
                {busy === 'processing'
                  ? 'Queuing…'
                  : `Import ${pending.preview.rowCount} row${pending.preview.rowCount === 1 ? '' : 's'}`}
              </Button>
              <Button
                variant="secondary"
                size="md"
                disabled={busy !== null}
                onClick={() => setPending(null)}
              >
                Discard
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <h2 className="text-text-bright text-sm font-medium mt-5">Recent imports</h2>
      {list.isLoading ? (
        <Card>
          <CardBody>Loading…</CardBody>
        </Card>
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load uploads.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No imports yet"
          description="Upload a CSV above to start your first import."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>File</Th>
              <Th>Status</Th>
              <Th className="text-right">Rows</Th>
              <Th className="text-right">Created</Th>
              <Th className="text-right">Failed</Th>
              <Th>When</Th>
              <Th></Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((u) => {
              const created =
                u.ordersCreated ?? (u.productsCreated ?? 0) + (u.variantsCreated ?? 0);
              return (
                <Tr key={u.id}>
                  <Td className="text-text-bright text-xs font-mono truncate max-w-[160px]">
                    {detailHref === undefined ? (
                      u.fileName
                    ) : (
                      <Link
                        href={detailHref(u.id)}
                        className="text-accent hover:text-accent-hover"
                        title={u.fileName}
                      >
                        {u.fileName}
                      </Link>
                    )}
                  </Td>
                  <Td className="text-text-muted text-xs uppercase">{u.status}</Td>
                  <Td className="text-right font-mono">{u.rowCount}</Td>
                  <Td className="text-right font-mono">{created}</Td>
                  <Td className="text-right font-mono text-text-muted">{u.rowsFailed ?? 0}</Td>
                  <Td className="text-text-faint text-xs font-mono">
                    {new Date(u.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </Td>
                  <Td>
                    {u.errorReportKey && (
                      <button
                        type="button"
                        onClick={() => void downloadErrorReport(u.id)}
                        className="text-accent hover:text-accent-hover text-xs"
                      >
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
    </div>
  );
}
