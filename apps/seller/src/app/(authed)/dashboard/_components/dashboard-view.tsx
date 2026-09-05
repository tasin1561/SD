'use client';

import Link from 'next/link';
import {
  Check,
  Circle,
  Hourglass,
  LifeBuoy,
  ListOrdered,
  Package,
  Plus,
  Ship,
  Truck,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  useOrdersList,
  useProductsList,
  useMoneyInFlight,
  useSellerProfile,
  useWalletBalances,
} from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  OrderStatusBadge,
  Section,
  Skeleton,
  SkeletonRows,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
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
/**
 * Whether the setup checklist has anything TRUE to say yet.
 *
 * It reads three queries, and while they are in flight every step is
 * `false` — so the card rendered "0 of 4 done" as a full-width call to
 * action on the account of a seller who finished months ago, then
 * vanished a second later. Nothing was wrong with the steps; the
 * absence of three responses had simply been rendered as a fact about
 * this seller.
 *
 * `known` must therefore mean ANSWERED, not "no longer loading": a
 * failed catalogue request is not evidence that somebody has no
 * products, and telling them to add their first one is the same
 * mistake wearing an error's clothes.
 */
export function onboardingVisible(
  known: boolean,
  steps: ReadonlyArray<{ readonly done: boolean }>,
): boolean {
  if (!known) return false;
  return steps.some((s) => !s.done);
}

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
  const canWallet = can(identity, 'wallet.view');

  const recent = useOrdersList({ page: 1, pageSize: 5 }, { enabled: canOrders });
  const profile = useSellerProfile({ enabled: canProfile });
  const products = useProductsList(
    { page: 1, pageSize: 1, status: 'ACTIVE' },
    { enabled: canCatalog },
  );
  const balances = useWalletBalances({ enabled: canWallet });
  // Gated on the ORDERS permission, not the wallet one: these are order
  // figures shown in money, and a viewer who may read orders may know
  // what their own orders are worth.
  const inFlight = useMoneyInFlight({ enabled: canOrders });
  const companyName = identity?.companyName ?? 'there';
  // The header pill names the wallet's own currency, read from the same
  // place the card reads it — `isConverted` false is the real balance,
  // everything else is a restatement of it.
  const canonicalCurrency =
    (balances.data?.balances ?? []).find((b) => !b.isConverted)?.currency ?? null;

  // Onboarding checklist — show only when at least one step is unmet.
  const profileComplete = Boolean(
    profile.data &&
    profile.data.companyName &&
    profile.data.contactPersonName &&
    profile.data.phone,
  );
  // All SIX, matching what the server now enforces on save. Checking
  // three of them would tick this row off for a seller whose next save
  // the API refuses — a checklist that disagrees with the form it points
  // at is worse than no checklist.
  const bankDetailsComplete = Boolean(
    profile.data &&
    profile.data.bankName &&
    profile.data.bankBranchName &&
    profile.data.bankAccountName &&
    profile.data.bankAccountNumber &&
    profile.data.bankRoutingNumber &&
    profile.data.bankSwiftCode,
  );
  const hasProduct = (products.data?.total ?? 0) > 0;
  const hasOrder = (recent.data?.total ?? 0) > 0;
  // Every query the checklist reads must have ANSWERED before it can
  // claim anything. A disabled query never succeeds, so a seller who
  // may not read orders cannot be shown a four-step list whose fourth
  // step is unknowable — the section simply does not appear.
  const onboardingKnown = profile.isSuccess && products.isSuccess && recent.isSuccess;

  // One list rather than four hand-written items, so the progress count
  // and the "which is next" decision cannot drift from what is rendered.
  const steps = [
    {
      done: profileComplete,
      label: 'Complete your profile',
      hint: 'Company name, contact person, and phone',
      href: '/profile',
    },
    {
      done: bankDetailsComplete,
      label: 'Add bank details',
      hint: 'Required before we can remit your COD collections',
      href: '/profile',
    },
    {
      done: hasProduct,
      label: 'Add your first product',
      hint: 'At least one ACTIVE product + variant',
      href: '/products/new',
    },
    {
      done: hasOrder,
      label: 'Place your first order',
      hint: 'Manually or via CSV upload',
      href: '/orders/new',
    },
  ];
  const STEPS_TOTAL = steps.length;
  const completedSteps = steps.filter((s) => s.done).length;
  const firstIncomplete = steps.findIndex((s) => !s.done);

  return (
    <div className="space-y-1">
      {/* ── the greeting, and what state the account is in ───────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="bg-status-delivered-bg text-status-delivered-fg flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
              <span
                className="bg-status-delivered-fg h-1.5 w-1.5 rounded-full"
                aria-hidden="true"
              />
              Account active
            </span>
            {canWallet && canonicalCurrency !== null && (
              <span className="bg-accent-tint text-accent rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                {canonicalCurrency} wallet
              </span>
            )}
          </div>
          <h1 className="text-text-bright text-2xl font-bold tracking-tight">
            Hello, {companyName}
          </h1>
          <p className="text-text-muted mt-1 text-sm">
            Your most recent orders, what you are owed, and where to go next.
          </p>
        </div>
        {canOrders && (
          <Link
            href="/orders/new"
            className="bg-accent-fill text-accent-fg hover:bg-accent-fill-hover inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-semibold transition-colors"
          >
            <Plus size={15} /> Create order
          </Link>
        )}
      </div>

      {canProfile && canCatalog && onboardingVisible(onboardingKnown, steps) && (
        <Section title="Finish setting up">
          <Card>
            <CardBody>
              <div className="text-text-muted mb-2 text-xs">
                {completedSteps} of {STEPS_TOTAL} done
              </div>
              <ol className="space-y-1.5">
                {steps.map((step, i) => (
                  <li key={step.label} className="flex items-center gap-2 text-sm">
                    {step.done ? (
                      <Check size={14} className="text-status-delivered-fg shrink-0" />
                    ) : (
                      <Circle size={14} className="text-text-faint shrink-0" />
                    )}
                    {step.done ? (
                      <span className="text-text-muted line-through">{step.label}</span>
                    ) : (
                      <Link
                        href={step.href}
                        className={i === firstIncomplete ? 'text-accent font-medium' : ''}
                      >
                        {step.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </Section>
      )}

      {/* ── 01 // money ───────────────────────────────────────────────── */}
      {(canWallet || canOrders) && (
        <>
          <SectionHead
            index="01"
            title="Treasury & liquidity"
            note={
              canWallet ? (
                <Link href="/wallet" className="text-accent font-medium">
                  Ledger and top-ups →
                </Link>
              ) : undefined
            }
          />
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
            {canWallet && <WalletBalanceCard query={balances} />}
            {canOrders && (
              <>
                {/* Two figures the seller cannot get anywhere else: what
                    is moving, and what has landed but not been paid. Both
                    are GROSS — our fees and the withheld GST are still
                    inside them, which the caption says rather than
                    leaving somebody to discover at settlement. */}
                <MoneyTile
                  label="On its way"
                  icon={<Truck size={13} />}
                  iconTone="info"
                  amount={inFlight.data?.inTransit.codInr}
                  count={inFlight.data?.inTransit.count}
                  countLabel="orders"
                  hint="Confirmed and dispatched, not yet delivered. Before our charges."
                  loading={inFlight.isLoading}
                />
                <MoneyTile
                  label="Clearing"
                  icon={<Hourglass size={13} />}
                  iconTone="warn"
                  amount={inFlight.data?.processing.codInr}
                  count={inFlight.data?.processing.count}
                  countLabel="delivered"
                  hint="Delivered; waiting on the courier to remit the cash to us."
                  loading={inFlight.isLoading}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* ── 02 // orders ──────────────────────────────────────────────── */}
      {canOrders && (
        <>
          <SectionHead
            index="02"
            title="Recent orders"
            note={
              <Link href="/orders" className="text-accent font-medium">
                See all orders →
              </Link>
            }
          />
          <Card>
            {recent.isLoading ? (
              <CardBody>
                <LoadingState label="Loading your orders…" />
              </CardBody>
            ) : recent.isError ? (
              <CardBody>
                <ErrorState
                  message={recent.error?.message ?? 'Could not load your orders.'}
                  retry={() => void recent.refetch()}
                />
              </CardBody>
            ) : (recent.data?.items ?? []).length === 0 ? (
              <CardBody>
                <EmptyState
                  title="No orders yet"
                  description="Your most recent orders appear here once you create one."
                />
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Order</Th>
                    <Th>Recipient</Th>
                    <Th>Stage</Th>
                    <Th>Payment</Th>
                    <Th>Open</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(recent.data?.items ?? []).map((o) => (
                    <Tr key={o.id}>
                      <Td>
                        <Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium">
                          {o.orderNumber}
                        </Link>
                      </Td>
                      <Td>
                        <div className="truncate">{o.recipientName}</div>
                        <div className="text-text-faint truncate text-xs">
                          {o.recipientCity === ''
                            ? (o.recipientStateProvince ?? '—')
                            : o.recipientCity}
                        </div>
                      </Td>
                      <Td>
                        <OrderStatusBadge status={o.status} />
                      </Td>
                      <Td>
                        {o.codAmountInr === null ? (
                          <span className="text-text-muted text-xs">Prepaid</span>
                        ) : (
                          <Money amount={o.codAmountInr} />
                        )}
                      </Td>
                      <Td>
                        <Link href={`/orders/${o.id}`} className="text-accent text-xs font-medium">
                          View →
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {/* ── 03 // where to go next ────────────────────────────────────── */}
      <SectionHead index="03" title="Next steps" />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {canCatalog && (
          <ShortcutCard
            href="/catalog"
            icon={<Package size={16} />}
            title="Manage catalogue"
            body="Products, variants, images and SKU codes."
            foot={
              products.data === undefined
                ? undefined
                : `${products.data.total} active ${products.data.total === 1 ? 'product' : 'products'}`
            }
          />
        )}
        {canOrders && (
          <ShortcutCard
            href="/orders"
            icon={<ListOrdered size={16} />}
            title="View orders"
            body="Full lifecycle, failed deliveries and the tracking timeline."
            foot={recent.data === undefined ? undefined : `${recent.data.total} in total`}
          />
        )}
        <ShortcutCard
          href="/inbound"
          icon={<Ship size={16} />}
          title="Inbound freight"
          body="Send stock to the warehouse and track what is on the water."
        />
        <ShortcutCard
          href="/tickets"
          icon={<LifeBuoy size={16} />}
          title="Support tickets"
          body="Damage claims, missing items and anything that needs a person."
        />
      </div>
    </div>
  );
}

/** The numbered section rule, matching the admin console. */
function SectionHead({
  index,
  title,
  note,
}: {
  index: string;
  title: string;
  note?: ReactNode;
}): ReactElement {
  return (
    <div className="mt-7 mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-text-muted text-xs font-semibold tracking-[0.09em] uppercase">
        <span className="text-accent" aria-hidden="true">
          {`${index} / `}
        </span>
        {title}
      </h2>
      {note !== undefined && <div className="text-xs">{note}</div>}
    </div>
  );
}

/**
 * A figure that is MOVING — money out in the world rather than money in
 * the wallet. The icon carries the difference: on-its-way is blue,
 * waiting-on-somebody is amber.
 */
function MoneyTile({
  label,
  icon,
  iconTone,
  amount,
  count,
  countLabel,
  hint,
  loading,
}: {
  label: string;
  icon: ReactNode;
  iconTone: 'info' | 'warn';
  amount: string | undefined;
  count: number | undefined;
  countLabel: string;
  hint: string;
  loading: boolean;
}): ReactElement {
  const iconClass =
    iconTone === 'info'
      ? 'text-status-confirmed-fg bg-status-confirmed-bg'
      : 'text-status-pending-fg bg-status-pending-bg';
  const chipClass =
    iconTone === 'info'
      ? 'bg-status-confirmed-bg text-status-confirmed-fg'
      : 'bg-status-pending-bg text-status-pending-fg';

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <div className="text-text-muted text-xs font-medium tracking-wide uppercase">{label}</div>
          <span className={`grid h-6 w-6 place-items-center rounded ${iconClass}`}>{icon}</span>
        </div>
        <div className="text-text-bright mt-2 text-2xl font-bold">
          {loading || amount === undefined ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <Money amount={amount} size="md" />
          )}
        </div>
        {count !== undefined && (
          <div className="mt-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${chipClass}`}>
              {count} {countLabel}
            </span>
          </div>
        )}
        <p className="text-text-muted mt-2 text-xs leading-snug">{hint}</p>
      </CardBody>
    </Card>
  );
}

function ShortcutCard({
  href,
  icon,
  title,
  body,
  foot,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
  foot?: string | undefined;
}): ReactElement {
  return (
    <Link
      href={href}
      className="border-border bg-surface hover:border-border-strong block rounded-lg border p-3 transition-colors"
    >
      <span className="bg-accent-tint text-accent grid h-8 w-8 place-items-center rounded">
        {icon}
      </span>
      <div className="text-text-strong mt-2.5 text-sm font-semibold">{title}</div>
      <p className="text-text-muted mt-1 text-xs leading-snug">{body}</p>
      <div className="border-border mt-2.5 flex items-center justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-text-faint">{foot ?? ''}</span>
        <span className="text-accent font-medium">Go →</span>
      </div>
    </Link>
  );
}

export function WalletBalanceCard({
  query,
}: {
  readonly query: ReturnType<typeof useWalletBalances>;
}): ReactElement {
  if (query.isLoading) return <SkeletonRows rows={1} />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? 'Failed to load your balance.'}
        retry={() => void query.refetch()}
      />
    );
  }

  // The rupee row is the one that is not a restatement. Picking by
  // currency name would break the day a seller is billed in anything
  // else; picking by `isConverted` asks the question that matters.
  const canonical = (query.data?.balances ?? []).find((b) => !b.isConverted);
  if (canonical === undefined) {
    return (
      <EmptyState
        title="No wallet activity yet"
        description="Your balance appears here once an order delivers or you top up."
      />
    );
  }

  const value = Number(canonical.balance);
  const caption = value === 0 ? 'No activity yet' : value > 0 ? 'Owed to you' : 'You owe';

  // The restatement, when the API sent one. Its rate is what makes it
  // checkable rather than a second number to take on trust — and an
  // absent rate is stated as absent rather than quietly dropped, since
  // a figure whose rate nobody can see is the one to distrust.
  const restated = (query.data?.balances ?? []).find((b) => b.isConverted);

  return (
    <Card>
      <CardBody>
        <div className="text-text-faint mb-1 text-xs tracking-wide uppercase">
          {canonical.currency}
        </div>
        <div className="text-text-bright">
          <Money
            amount={canonical.balance}
            currency={canonical.currency === 'BDT' ? 'BDT' : 'INR'}
            convert={false}
            size="lg"
          />
        </div>
        <div className="text-text-muted mt-1 text-xs">{caption}</div>
        {restated !== undefined && (
          <div className="text-text-faint mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs">
            <span aria-hidden>≈</span>
            <Money
              amount={restated.balance}
              currency={restated.currency === 'BDT' ? 'BDT' : 'INR'}
              convert={false}
            />
            {restated.fxRate !== null && <span>· ₹1 = ৳{Number(restated.fxRate).toFixed(2)}</span>}
            <span className="sr-only">the same balance in {restated.currency}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
