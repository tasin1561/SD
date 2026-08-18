'use client';

import type { ReactElement } from 'react';
import type { OrderStatus } from '@skydrop/db';
import type { SellerOrderEventView } from '@skydrop/api-client';
import { Card, CardBody, OrderStatusBadge } from '@skydrop/ui/components';

/**
 * Seller-visible lifecycle timeline. Renders the events returned by
 * `/seller/orders/:id/events` — already filtered to
 * `isVisibleToSeller=true` server-side (M6 listEvents).
 *
 * Each row shows the event timestamp, the status transition (if any)
 * via OrderStatusBadge tokens (FE-6 — never hardcode hex), and the
 * server-provided description (if any). Events are returned in
 * createdAt ASC; we render top-to-bottom in the same order so the
 * latest event is at the bottom (matches the "recent activity"
 * reading direction familiar from admin tooling).
 */
export function OrderTimeline({
  events,
}: {
  events: readonly SellerOrderEventView[];
}): ReactElement {
  return (
    <Card>
      <CardBody className="p-0">
        <ol className="divide-y divide-border">
          {events.map((evt) => (
            <li key={evt.id} className="px-4 py-3 flex items-start gap-4">
              <div className="text-text-faint text-xs font-mono shrink-0 w-32 pt-0.5">
                {formatTimestamp(evt.createdAt)}
              </div>
              <div className="min-w-0 flex-1 flex items-start gap-2 flex-wrap">
                <div className="text-text-muted text-xs uppercase tracking-wide shrink-0 pt-0.5">
                  {humanizeType(evt.type)}
                </div>
                {evt.fromStatus && evt.toStatus && (
                  <div className="flex items-center gap-1 shrink-0">
                    <OrderStatusBadge status={evt.fromStatus as OrderStatus} />
                    <span className="text-text-faint">→</span>
                    <OrderStatusBadge status={evt.toStatus as OrderStatus} />
                  </div>
                )}
                {evt.description && (
                  <div className="text-text-body text-sm flex-1 min-w-0">{evt.description}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function formatTimestamp(iso: string): string {
  // YYYY-MM-DD HH:mm UTC — operators read this; precision over
  // localization for Phase 1A. A timezone preference UI is Phase 2.
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function humanizeType(type: string): string {
  return String(type)
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
