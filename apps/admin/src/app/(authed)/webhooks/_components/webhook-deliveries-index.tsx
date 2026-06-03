'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ApiError } from '@skydrop/api-client';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
  useToast,
} from '@skydrop/ui/components';
import {
  useRetryWebhookDelivery,
  useWebhookDeliveriesList,
} from '@/lib/api-hooks';

const STATUSES = [
  '',
  'SCHEDULED',
  'IN_FLIGHT',
  'DELIVERED',
  'FAILED',
  'ABANDONED',
  'ENDPOINT_DISABLED',
] as const;

export function WebhookDeliveriesIndex(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const list = useWebhookDeliveriesList({
    page: 1,
    pageSize: 100,
    ...(status ? { status } : {}),
  });
  const retry = useRetryWebhookDelivery();
  const toast = useToast();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function onRetry(id: string): Promise<void> {
    setRetryingId(id);
    try {
      const res = await retry.mutateAsync({ id });
      toast.success(`Re-enqueued (job ${res.jobId.slice(0, 8)}…)`);
    } catch (e) {
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : e.message;
        toast.error(code ? `[${code}] ${msg}` : msg);
      } else {
        toast.error(e instanceof Error ? e.message : 'Retry failed');
      }
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Webhook deliveries"
        subtitle="Outbound HMAC-signed POSTs to seller-configured endpoints. Read-only diagnostic view."
      />

      <Card>
        <CardBody>
          <div className="flex items-end gap-3">
            <div>
              <div className="text-text-muted text-xs mb-1">Status</div>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === '' ? 'All' : s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="mt-4">
        {list.isLoading ? (
          <LoadingState label="Loading deliveries…" />
        ) : list.isError ? (
          <ErrorState message={list.error?.message ?? 'Failed.'} />
        ) : !list.data || list.data.items.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-text-muted text-sm py-2">
                No webhook deliveries match the filter.
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <table className="w-full text-sm">
              <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Seller</th>
                  <th className="text-left px-3 py-2 font-medium">Event</th>
                  <th className="text-left px-3 py-2 font-medium">URL</th>
                  <th className="text-right px-3 py-2 font-medium">Attempt</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">HTTP</th>
                  <th className="text-right px-3 py-2 font-medium">Time</th>
                  <th className="text-right px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.items.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-text-body font-mono text-xs">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-text-body text-xs">
                      <Link
                        href={`/sellers/${d.sellerId}`}
                        className="text-accent hover:underline"
                      >
                        {d.sellerCompany}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-text-body font-mono text-xs">
                      {d.eventType}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-[11px] max-w-[260px] truncate">
                      {d.endpointUrl}
                    </td>
                    <td className="px-3 py-2 text-right text-text-body font-mono text-xs">
                      {d.attemptNumber}/{d.maxAttempts}
                    </td>
                    <td className={`px-3 py-2 text-xs uppercase tracking-wide ${statusColor(d.status)}`}>
                      {d.status}
                    </td>
                    <td className="px-3 py-2 text-right text-text-body font-mono text-xs">
                      {d.responseStatus ?? (d.errorCode ? d.errorCode : '—')}
                    </td>
                    <td className="px-3 py-2 text-right text-text-muted font-mono text-xs">
                      {d.responseTimeMs !== null ? `${d.responseTimeMs} ms` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(d.status === 'FAILED' ||
                        d.status === 'ABANDONED' ||
                        d.status === 'ENDPOINT_DISABLED') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={retryingId === d.id}
                          onClick={() => void onRetry(d.id)}
                        >
                          {retryingId === d.id ? 'Retrying…' : 'Retry'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case 'DELIVERED':
      return 'text-accent';
    case 'FAILED':
    case 'ABANDONED':
    case 'ENDPOINT_DISABLED':
      return 'text-critical';
    case 'IN_FLIGHT':
    case 'SCHEDULED':
      return 'text-pending';
    default:
      return 'text-text-body';
  }
}
