'use client';

import Link from 'next/link';
import { useRef, useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  UploadStatusBadge,
  TBody,
  THead,
  Table,
  Td,
  TablePaginator,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import type { BulkUploadStatus } from '@skydrop/db';
import { serverVerdict } from '@/lib/server-verdict';

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
  readonly headers: readonly string[];
  readonly missingRequired: readonly string[];
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
 * RS-5 — upload a CSV of orders. Each row becomes one of THIS store's
 * orders through the same checks the order form makes (your catalogue,
 * the retail range, what is available). The file is checked before
 * anything is imported; a row that fails lands in the error report, and
 * a reference already placed is refused rather than changed — cancel it
 * and upload again to change it.
 */
export default function StoreOrderImportPage(): ReactElement {
  const client = useApiClient();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState<'checking' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    spacesKey: string;
    fileName: string;
    preview: Preview;
  } | null>(null);
  const [uploadsPage, setUploadsPage] = useState(1);

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
    try {
      const body = await client.request<unknown>(path);
      save(typeof body === 'string' ? body : JSON.stringify(body), fileName);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function check(): Promise<void> {
    setError(null);
    const f = fileRef.current?.files?.[0];
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
      await client.request(`${BASE}/process`, {
        method: 'POST',
        body: { spacesKey: pending.spacesKey, fileName: pending.fileName },
      });
      toast.success('Import started. Rows become orders in a moment.');
      setPending(null);
      setPicked('');
      if (fileRef.current) fileRef.current.value = '';
      setUploadsPage(1);
      void qc.invalidateQueries({ queryKey: ['store-order-imports'] });
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
    } catch (err) {
      setError(serverVerdict(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Orders
      </Link>
      <PageHeader
        title="Upload orders"
        subtitle="One row is one order. Every row needs a Retail Price — what you sell the product for."
      />
      <Section title="Upload">
        <Card>
          <CardBody>
            <div className="space-y-3">
              <Button
                variant="ghost"
                size="md"
                onClick={() =>
                  void downloadText(`${BASE}/template`, 'skydrop-store-order-template.csv')
                }
              >
                Download the template
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Order CSV"
                  onChange={(e) => {
                    setPicked(e.target.files?.[0]?.name ?? '');
                    setPending(null);
                  }}
                  disabled={busy !== null}
                  className="text-sm"
                />
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => void check()}
                  disabled={busy !== null || picked === ''}
                >
                  {busy === 'checking' ? 'Checking…' : 'Upload and check'}
                </Button>
              </div>
              {pending !== null ? (
                <div className="border-border rounded-lg border p-3 text-sm">
                  <p>
                    {pending.fileName}: {pending.preview.rowCount} row
                    {pending.preview.rowCount === 1 ? '' : 's'}.
                  </p>
                  {pending.preview.missingRequired.length > 0 ? (
                    <p className="text-critical mt-1">
                      Missing columns: {pending.preview.missingRequired.join(', ')}. Fix the file
                      and upload it again.
                    </p>
                  ) : pending.preview.exceedsRowLimit ? (
                    <p className="text-critical mt-1">
                      More than {pending.preview.rowLimit} rows. Split the file.
                    </p>
                  ) : (
                    <Button
                      className="mt-2"
                      variant="primary"
                      size="md"
                      onClick={() => void importIt()}
                      disabled={busy !== null}
                    >
                      {busy === 'importing'
                        ? 'Importing…'
                        : `Import ${pending.preview.rowCount} orders`}
                    </Button>
                  )}
                </div>
              ) : null}
              {error !== null ? (
                <p role="alert" className="text-critical text-sm">
                  {error}
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </Section>
      <Section title="Recent uploads">
        {uploads.isPending ? (
          <LoadingState label="Loading uploads" rows={3} />
        ) : uploads.isError ? (
          <ErrorState message={serverVerdict(uploads.error)} retry={() => void uploads.refetch()} />
        ) : uploads.data.items.length === 0 ? (
          <EmptyState
            title="No uploads yet"
            description="Upload a CSV above to place many orders at once."
          />
        ) : (
          <>
            <Table>
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
                    <Td>{u.fileName}</Td>
                    <Td>
                      <UploadStatusBadge status={u.status} />
                    </Td>
                    <Td align="right">{u.ordersCreated}</Td>
                    <Td align="right">{u.rowsFailed}</Td>
                    <Td align="right">
                      {u.errorReportKey !== null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void downloadText(
                              `${BASE}/${u.id}/error-report`,
                              `errors-${u.fileName}`,
                            )
                          }
                        >
                          Error report
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-2">
              <TablePaginator
                page={uploadsPage}
                pageSize={UPLOADS_PAGE_SIZE}
                total={uploads.data.total}
                onPageChange={setUploadsPage}
              />
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
