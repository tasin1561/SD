'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  Button,
  BandBody,
  SectionBand,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useApiClient } from '@skydrop/auth/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { serverVerdict } from '@/lib/server-verdict';

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
    return serverVerdict(err, 'Upload failed');
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
      <div>
        <SectionBand
          index="01"
          title="Upload"
          note={`One row is one ${kind === 'orders' ? 'order' : 'product or variant'}.`}
          action={
            <Button variant="ghost" size="sm" onClick={() => void downloadTemplate()}>
              Download template
            </Button>
          }
        />
        <BandBody>
          <p className="text-text-muted mb-3 text-xs">
            Download the template, fill it in, then upload here. Nothing is imported until you have
            seen what we matched.
          </p>

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
            <div className="text-critical mt-3 rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-3 py-2 text-xs">
              {error}
            </div>
          )}
        </BandBody>
      </div>

      {/* Nothing has been imported yet. This is the step that was
          missing: the file went straight to process, so a column we
          could not map became rows that failed one at a time into an
          error report read afterwards. */}
      {pending !== null && (
        <div>
          <SectionBand
            index="02"
            title="Check before importing"
            note={
              <span className="font-mono">
                {pending.fileName} · {pending.preview.rowCount} row
                {pending.preview.rowCount === 1 ? '' : 's'}
              </span>
            }
          />
          <BandBody>
            <p className="text-text-muted mb-3 text-xs">
              Nothing has been imported yet. Check what we matched, then import.
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
          </BandBody>
        </div>
      )}

      <div>
        <SectionBand
          index={pending === null ? '02' : '03'}
          title="Recent imports"
          note={
            list.data === undefined ? undefined : `${list.data.items.length} shown, newest first`
          }
        />
        <BandBody flush>
          {list.isLoading ? (
            <div className="p-3">
              <SkeletonRows rows={3} cols={4} />
            </div>
          ) : list.isError ? (
            <div className="p-3">
              <ErrorState
                message={serverVerdict(list.error, 'Failed to load uploads.')}
                retry={() => void list.refetch()}
              />
            </div>
          ) : !list.data || list.data.items.length === 0 ? (
            <div className="p-3">
              <EmptyState
                title="No imports yet"
                description="Upload a CSV above to start your first import."
              />
            </div>
          ) : (
            <Table>
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
                      <Td className="text-text-bright text-xs font-mono truncate max-w-[160px]">
                        {detailHrefBase === undefined ? (
                          u.fileName
                        ) : (
                          <Link
                            href={`${detailHrefBase}/${u.id}`}
                            className="text-accent hover:text-accent-hover"
                            title={u.fileName}
                          >
                            {u.fileName}
                          </Link>
                        )}
                      </Td>
                      <Td className="text-text-muted font-mono text-xs uppercase">{u.status}</Td>
                      <Td align="right" className="font-mono">
                        {u.rowCount}
                      </Td>
                      <Td align="right" className="font-mono">
                        {created}
                      </Td>
                      <Td align="right" className="text-text-muted font-mono">
                        {u.rowsFailed ?? 0}
                      </Td>
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
        </BandBody>
      </div>
    </div>
  );
}
