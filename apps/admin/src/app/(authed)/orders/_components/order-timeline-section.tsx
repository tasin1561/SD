'use client';

import type { ReactElement } from 'react';
import type { OrderStatus } from '@skydrop/db';
import {
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
} from '@skydrop/ui/components';
import { useAdminOrderEvents } from '@/lib/api-hooks';

/**
 * Admin lifecycle timeline — every event (incl. internal-only the
 * seller never sees). Uses the admin /admin/orders/:id/events
 * endpoint (M12 deferral close).
 */
export function OrderTimelineSection({
  orderId,
}: {
  readonly orderId: string;
}): ReactElement {
  const events = useAdminOrderEvents(orderId);

  if (events.isLoading) return <LoadingState label="Loading timeline…" />;
  if (events.isError)
    return (
      <ErrorState message={events.error?.message ?? 'Failed to load timeline.'} />
    );
  if (!events.data || events.data.length === 0)
    return (
      <Card>
        <CardBody className="text-text-muted text-sm">
          No events yet.
        </CardBody>
      </Card>
    );

  return (
    <Card>
      <CardBody className="p-0">
        <ol className="divide-y divide-border">
          {events.data.map((evt) => (
            <li key={evt.id} className="px-4 py-3 flex items-start gap-4">
              <div className="text-text-faint text-xs font-mono shrink-0 w-32 pt-0.5">
                {new Date(evt.createdAt)
                  .toISOString()
                  .slice(0, 16)
                  .replace('T', ' ')}
              </div>
              <div className="min-w-0 flex-1 flex items-start gap-2 flex-wrap">
                <div className="text-text-muted text-[11px] uppercase tracking-wide shrink-0 pt-0.5">
                  {humanize(evt.type)}
                </div>
                {evt.fromStatus && evt.toStatus && (
                  <div className="flex items-center gap-1 shrink-0">
                    <OrderStatusBadge status={evt.fromStatus as OrderStatus} />
                    <span className="text-text-faint">→</span>
                    <OrderStatusBadge status={evt.toStatus as OrderStatus} />
                  </div>
                )}
                {evt.description && (
                  <div className="text-text-body text-sm flex-1 min-w-0">
                    {evt.description}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function humanize(type: string): string {
  return String(type)
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
