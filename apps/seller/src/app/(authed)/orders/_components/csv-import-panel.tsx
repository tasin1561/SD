'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
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

export function CsvImportPanel({
  kind,
  endpointBase,
  templateFileName,
}: {
  readonly kind: Kind;
  readonly endpointBase: string;
  readonly templateFileName: string;
  readonly previewSampleSize?: number;
}): ReactElement {
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<'uploading' | 'processing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');

  const list = useQuery<UploadsResponse>({
    queryKey: ['seller-csv-uploads', kind],
    queryFn: () =>
      client.request<UploadsResponse>(`${endpointBase}?page=1&pageSize=10`),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      const stillRunning = items.some(
        (it) =>
          it.status === 'RUNNING' ||
          it.status === 'QUEUED' ||
          it.status === 'PENDING',
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

      setBusy('processing');
      await client.request<CsvUploadJob>(`${endpointBase}/process`, {
        method: 'POST',
        body: { spacesKey: presign.spacesKey, fileName: f.name },
      });

      toast.success('Import queued — refresh to track progress.');
      if (fileRef.current) fileRef.current.value = '';
      setSelectedName('');
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
            Download the template, fill it in, then upload here. Each row is
            a separate {kind === 'orders' ? 'order' : 'product / variant'}.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              size="md"
              onClick={() => void downloadTemplate()}
            >
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
              {busy === 'uploading'
                ? 'Uploading…'
                : busy === 'processing'
                  ? 'Queuing…'
                  : 'Upload + process'}
            </Button>
          </div>

          {error && (
            <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mt-3">
              {error}
            </div>
          )}
        </CardBody>
      </Card>

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
                u.ordersCreated ??
                (u.productsCreated ?? 0) + (u.variantsCreated ?? 0);
              return (
                <Tr key={u.id}>
                  <Td className="text-text-bright text-xs font-mono truncate max-w-[160px]">
                    {u.fileName}
                  </Td>
                  <Td className="text-text-muted text-xs uppercase">{u.status}</Td>
                  <Td className="text-right font-mono">{u.rowCount}</Td>
                  <Td className="text-right font-mono">{created}</Td>
                  <Td className="text-right font-mono text-text-muted">
                    {u.rowsFailed ?? 0}
                  </Td>
                  <Td className="text-text-faint text-xs font-mono">
                    {new Date(u.createdAt)
                      .toISOString()
                      .slice(0, 16)
                      .replace('T', ' ')}
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

