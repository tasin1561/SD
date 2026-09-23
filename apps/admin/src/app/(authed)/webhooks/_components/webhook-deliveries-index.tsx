'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import type { StatusKind } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import './webhooks.css';
import { useRetryWebhookDelivery, useWebhookDeliveriesList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

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
  const canRetry = usePermission('webhooks.retry');
  const [status, setStatus] = useState<string>('');
  const list = useWebhookDeliveriesList({
    page: 1,
    pageSize: 100,
    ...(status ? { status } : {}),
  });
  const retry = useRetryWebhookDelivery();
  const toast = useToast();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // A retry re-sends a signed POST to the seller's endpoint, so it asks
  // first; Confirm sends the same request as before.
  const [confirming, setConfirming] = useState<{
    id: string;
    event: string;
    url: string;
    seller: string;
  } | null>(null);

  async function onRetry(id: string): Promise<void> {
    setRetryingId(id);
    try {
      const res = await retry.mutateAsync({ id });
      toast.success(`Re-enqueued (job ${res.jobId.slice(0, 8)}…)`);
    } catch (e) {
      toast.error(serverVerdict(e, 'Retry failed'));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'System' }, { label: 'Webhook deliveries' }]}
        Link={Link}
        title="Webhook deliveries"
        subtitle="Outbound HMAC-signed POSTs to seller-configured endpoints. Read-only diagnostic view."
      />

      <AfCard>
        <div className="wh-filter">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All' : s}
              </option>
            ))}
          </Select>
        </div>
      </AfCard>

      {list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={6} cols={6} label="Loading deliveries…" />
        </AfCard>
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed.'} retry={() => void list.refetch()} />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No webhook deliveries match the filter."
          description="Deliveries appear here as sellers' endpoints are sent events."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Seller</Th>
              <Th>Event</Th>
              <Th>URL</Th>
              <Th align="right">Attempt</Th>
              <Th>Status</Th>
              <Th align="right">HTTP</Th>
              <Th align="right">Time</Th>
              <Th align="right">Action</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <span className="af-small sk-figure af-nowrap">
                    {new Date(d.createdAt).toLocaleString()}
                  </span>
                </Td>
                <Td>
                  <Link href={`/sellers/${d.sellerId}`} className="af-link af-small">
                    {d.sellerCompany}
                  </Link>
                </Td>
                <Td>
                  <span className="sk-ident af-small">{d.eventType}</span>
                </Td>
                <Td>
                  <span className="sk-ident af-small wh-url" title={d.endpointUrl}>
                    {d.endpointUrl}
                  </span>
                </Td>
                <Td align="right">
                  <span className="sk-figure af-small">
                    {d.attemptNumber}/{d.maxAttempts}
                  </span>
                </Td>
                <Td>
                  <StatusChip
                    size="sm"
                    kind={statusKind(d.status)}
                    label={d.status.replaceAll('_', ' ')}
                  />
                </Td>
                <Td align="right">
                  <span className="sk-figure af-small">
                    {d.responseStatus ?? (d.errorCode ? d.errorCode : '—')}
                  </span>
                </Td>
                <Td align="right">
                  <span className="sk-figure af-small af-nowrap">
                    {d.responseTimeMs !== null ? `${d.responseTimeMs} ms` : '—'}
                  </span>
                </Td>
                <Td align="right">
                  {(d.status === 'FAILED' ||
                    d.status === 'ABANDONED' ||
                    d.status === 'ENDPOINT_DISABLED') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={retryingId === d.id}
                      disabled={retryingId === d.id || !canRetry}
                      onClick={() =>
                        setConfirming({
                          id: d.id,
                          event: d.eventType,
                          url: d.endpointUrl,
                          seller: d.sellerCompany,
                        })
                      }
                    >
                      Retry
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title="Retry this webhook delivery?"
        entity={confirming === null ? '' : `${confirming.event} · ${confirming.seller}`}
        consequence={
          confirming === null
            ? ''
            : `The signed event is queued to be POSTed again to ${confirming.url}; the seller's system may act on it a second time.`
        }
        confirmLabel="Retry"
        onConfirm={() => {
          if (confirming === null) return;
          const id = confirming.id;
          // Fire as before: the toast reports the job or the verdict.
          void onRetry(id);
        }}
      />
    </div>
  );
}

/** The delivery status → a semantic kind; the word stays the status itself. */
function statusKind(s: string): StatusKind {
  switch (s) {
    case 'DELIVERED':
      return 'delivered';
    case 'FAILED':
    case 'ABANDONED':
    case 'ENDPOINT_DISABLED':
      return 'failed';
    case 'IN_FLIGHT':
      return 'in-transit';
    case 'SCHEDULED':
      return 'pending';
    default:
      return 'draft';
  }
}
