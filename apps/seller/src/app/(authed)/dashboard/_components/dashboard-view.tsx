'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useOrdersList } from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
  PageHeader,
  Section,
} from '@skydrop/ui/components';

/**
 * Seller dashboard synthesis — Recent orders + nav pivot. The shell
 * topbar already shows companyName + email, so this page surfaces
 * activity-level synthesis rather than identity.
 *
 * Phase 1A keeps it intentionally lean: a single Recent Orders card
 * (latest 5) so the load-bearing case (sellers see their newest
 * orders at-a-glance) is covered without a dedicated stats endpoint.
 * Future panels (low stock, recent dispatches, NDR count) plug into
 * the same grid once catalog + tracking pages ship.
 *
 * `useSellerIdentity` returns SellerMe | null; the (authed) layout
 * guarantees non-null by SSR construction so we read .companyName
 * with a fallback for the typecheck (the fallback path is unreachable
 * in practice — the SSR gate redirects to /login on null identity).
 */
export function DashboardView(): ReactElement {
  const identity = useSellerIdentity();
  const recent = useOrdersList({ page: 1, pageSize: 5 });
  const companyName = identity?.companyName ?? 'there';

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Hello, ${companyName}`}
        subtitle="Your most recent orders + quick navigation."
      />

      <Section
        title="Recent orders"
        action={
          <Link
            href="/orders"
            className="text-text-muted hover:text-text-body text-xs transition-colors"
          >
            See all →
          </Link>
        }
      >
        {recent.isLoading ? (
          <LoadingState label="Loading recent orders…" />
        ) : recent.isError ? (
          <ErrorState
            message={recent.error?.message ?? 'Failed to load recent orders.'}
          />
        ) : !recent.data || recent.data.items.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Once you create an order or import a CSV, they show up here."
          />
        ) : (
          <Card>
            <ol className="divide-y divide-border">
              {recent.data.items.map((o) => (
                <li
                  key={o.id}
                  className="px-4 py-3 flex items-center gap-4 hover:bg-surface-hover transition-colors"
                >
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-mono text-xs text-text-bright hover:underline shrink-0 w-44"
                  >
                    {o.orderNumber}
                  </Link>
                  <div className="text-text-body text-sm min-w-0 flex-1 truncate">
                    {o.recipientName}
                    <span className="text-text-faint ml-1">
                      · {o.recipientCity}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <OrderStatusBadge status={o.status} />
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </Section>

      <Section title="Next steps">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NavCard
            href="/catalog"
            title="Manage catalog"
            description="Products + variants + images. CP2.B."
          />
          <NavCard
            href="/orders"
            title="View orders"
            description="Lifecycle, NDR reasons, tracking timeline."
          />
        </div>
      </Section>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}): ReactElement {
  return (
    <Link href={href}>
      <Card className="hover:bg-surface-hover transition-colors">
        <CardHeader title={title} subtitle={description} />
        <CardBody className="py-2">
          <span className="text-text-muted text-xs">Go →</span>
        </CardBody>
      </Card>
    </Link>
  );
}
