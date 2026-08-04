'use client';

import Link from 'next/link';
import { Check, Circle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useOrdersList, useProductsList, useSellerProfile } from '@/lib/api-hooks';
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
import { can } from '@/lib/page-access';

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
  // This is the ONE page open to everybody, so it is where a permission
  // gap shows first. A viewer holds `orders.view` and nothing else, and
  // the page was fetching the profile and the catalogue regardless —
  // serving them their own landing page with two refusals on it.
  //
  // Each query is gated on the permission its DATA needs, and the same
  // answer drives the section, so a request nobody may make is never
  // sent rather than sent and hidden.
  const canOrders = can(identity, 'orders.view');
  const canProfile = can(identity, 'profile.view');
  const canCatalog = can(identity, 'catalog.view');

  const recent = useOrdersList({ page: 1, pageSize: 5 }, { enabled: canOrders });
  const profile = useSellerProfile({ enabled: canProfile });
  const products = useProductsList(
    { page: 1, pageSize: 1, status: 'ACTIVE' },
    { enabled: canCatalog },
  );
  const companyName = identity?.companyName ?? 'there';

  // Onboarding checklist — show only when at least one step is unmet.
  const profileComplete = Boolean(
    profile.data &&
    profile.data.companyName &&
    profile.data.contactPersonName &&
    profile.data.phone,
  );
  const bankDetailsComplete = Boolean(
    profile.data &&
    profile.data.bankName &&
    profile.data.bankAccountName &&
    profile.data.bankAccountNumber,
  );
  const hasProduct = (products.data?.total ?? 0) > 0;
  const hasOrder = (recent.data?.total ?? 0) > 0;
  const onboardingDone = profileComplete && bankDetailsComplete && hasProduct && hasOrder;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Hello, ${companyName}`}
        subtitle="Your most recent orders + quick navigation."
      />

      {canProfile && canCatalog && !onboardingDone && (
        <Section title="Get started">
          <Card>
            <CardBody>
              <p className="text-text-muted text-xs mb-3">
                Complete these to be ready for your first delivered order.
              </p>
              <ul className="space-y-1.5">
                <ChecklistItem
                  done={profileComplete}
                  label="Complete your profile"
                  hint="Company name, contact person, and phone"
                  href="/profile"
                />
                <ChecklistItem
                  done={bankDetailsComplete}
                  label="Add bank details"
                  hint="Required before we can remit your COD collections"
                  href="/profile"
                />
                <ChecklistItem
                  done={hasProduct}
                  label="Add your first product"
                  hint="At least one ACTIVE product + variant"
                  href="/catalog"
                />
                <ChecklistItem
                  done={hasOrder}
                  label="Place your first order"
                  hint="Manually or via CSV upload"
                  href="/orders/new"
                />
              </ul>
            </CardBody>
          </Card>
        </Section>
      )}

      {canOrders && (
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
              retry={() => void recent.refetch()}
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
                  // Stacked on a phone. Side by side, the fixed 176px
                  // order number and a status badge as long as "Awaiting
                  // Seller Decision" (177px) cannot both fit in 320px,
                  // and neither is allowed to shrink.
                  <li
                    key={o.id}
                    className="hover:bg-surface-hover flex flex-col gap-1 px-4 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:py-3"
                  >
                    <Link
                      href={`/orders/${o.id}`}
                      className="text-text-bright flex min-h-[30px] items-center font-mono text-xs hover:underline sm:min-h-0 sm:w-44 sm:shrink-0"
                    >
                      {o.orderNumber}
                    </Link>
                    <div className="text-text-body min-w-0 flex-1 truncate text-sm">
                      {o.recipientName}
                      <span className="text-text-faint ml-1">· {o.recipientCity}</span>
                    </div>
                    <div className="min-w-0 sm:shrink-0">
                      <OrderStatusBadge status={o.status} />
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </Section>
      )}

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

function ChecklistItem({
  done,
  label,
  hint,
  href,
}: {
  readonly done: boolean;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}): ReactElement {
  return (
    <li className="flex items-start gap-3 py-1">
      <div className={done ? 'text-accent mt-0.5' : 'text-text-faint mt-0.5'}>
        {done ? <Check size={16} /> : <Circle size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={
              done ? 'text-text-muted text-sm line-through' : 'text-text-bright text-sm font-medium'
            }
          >
            {label}
          </span>
          {!done && (
            <Link href={href} className="text-accent hover:underline text-xs shrink-0">
              Go →
            </Link>
          )}
        </div>
        <div className="text-text-faint text-xs mt-0.5">{hint}</div>
      </div>
    </li>
  );
}
