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
  Wallet,
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
  BandBody,
  Card,
  CardBody,
  Crumbs,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaChip,
  Money,
  OrderStatusBadge,
  PageHeader,
  SectionBand,
  Skeleton,
  SkeletonRows,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';

/**
 * The seller dashboard.
 *
 * ── THE 2026-09-19 REDESIGN (PRECISION LOGISTICS) ────────────────────
 * Rebuilt against `SkY_DrOp_ThEme/Dashboard_{Light,Dark}`. What was
 * taken from the comps: the breadcrumb + chip header, numbered section
 * BANDS over each dense region, and stat tiles that carry their own
 * breakdown under a hairline rather than one figure and a caption.
 *
 * What was NOT taken, and why — a comp can draw a reading the system
 * does not have, and a dashboard is exactly where an invented figure
 * is believed:
 *
 *   - "Net Realized Month · +18.4% MoM". There is no month-over-month
 *     revenue figure on any seller endpoint. The P&L is Skydrop's own
 *     and is not the seller's money.
 *   - The SLA strip — "Pre-Dispatch Call Verification 94.6%",
 *     "Delivery Success SLA 86.4%", "RTO Ceiling Control 8.2%". No
 *     seller-facing metrics endpoint computes any of the three.
 *   - "FEMA Trade Rail: Synced", "Dhaka bonded pickup active", the
 *     corridor telemetry and the gateway uptime. None of it is a fact
 *     the system holds per account.
 *   - The four "Operational launchpad" instrument panels (SAFTA
 *     tariffs, linehaul vector, bonded gate, trade liaison desk). The
 *     SHAPE survives as the shortcut row at the bottom, pointed at
 *     pages that exist; the readings inside them do not.
 *
 * Everything that remains is read from an endpoint.
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
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs items={[{ label: 'Seller console' }, { label: 'Dashboard' }]} Link={Link} />
        }
        title={`Hello, ${companyName}`}
        subtitle="Your most recent orders, what you are owed, and where to go next."
        meta={
          <>
            <MetaChip tone="good" dot>
              Account active
            </MetaChip>
            {canWallet && canonicalCurrency !== null && (
              <MetaChip tone="accent">{canonicalCurrency} wallet</MetaChip>
            )}
            {canOrders && recent.data !== undefined && (
              <MetaChip>
                {recent.data.total} {recent.data.total === 1 ? 'order' : 'orders'} placed
              </MetaChip>
            )}
          </>
        }
        action={
          canOrders ? (
            <Link
              href="/orders/new"
              className="bg-accent-fill text-accent-fg hover:bg-accent-fill-hover inline-flex items-center gap-1.5 rounded-[var(--radius-2)] px-3 py-2 text-sm font-semibold transition-colors"
            >
              <Plus size={15} aria-hidden /> Create order
            </Link>
          ) : undefined
        }
      />

      {canProfile && canCatalog && onboardingVisible(onboardingKnown, steps) && (
        <div className="mb-5">
          <SectionBand
            index="00"
            title="Finish setting up"
            note={`${completedSteps} of ${STEPS_TOTAL} done`}
          />
          <BandBody>
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li key={step.label} className="flex items-center gap-2 text-sm">
                  {step.done ? (
                    <Check size={14} className="text-[var(--status-delivered-fg)] shrink-0" />
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
          </BandBody>
        </div>
      )}

      {/* ── 01 // money ───────────────────────────────────────────────── */}
      {(canWallet || canOrders) && (
        <div className="mb-5">
          <SectionBand
            index="01"
            title="Treasury & liquidity"
            action={
              canWallet ? (
                <Link href="/wallet" className="text-accent text-xs font-medium">
                  Ledger and top-ups →
                </Link>
              ) : undefined
            }
          />
          <BandBody className="grid grid-cols-1 gap-3 lg:grid-cols-3">
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
                  icon={<Truck size={13} aria-hidden />}
                  amount={inFlight.data?.inTransit.codInr}
                  count={inFlight.data?.inTransit.count}
                  countLabel="orders dispatched"
                  hint="Confirmed and dispatched, not yet delivered. Before our charges."
                  loading={inFlight.isLoading}
                />
                <MoneyTile
                  label="Clearing"
                  icon={<Hourglass size={13} aria-hidden />}
                  tone="warn"
                  amount={inFlight.data?.processing.codInr}
                  count={inFlight.data?.processing.count}
                  countLabel="delivered, unpaid"
                  hint="Delivered; waiting on the courier to remit the cash to us."
                  loading={inFlight.isLoading}
                />
              </>
            )}
          </BandBody>
        </div>
      )}

      {/* ── 02 // orders ──────────────────────────────────────────────── */}
      {canOrders && (
        <div className="mb-5">
          <SectionBand
            index="02"
            title="Recent orders"
            action={
              <Link href="/orders" className="text-accent text-xs font-medium">
                See all orders →
              </Link>
            }
          />
          {recent.isLoading ? (
            <BandBody>
              <LoadingState label="Loading your orders…" />
            </BandBody>
          ) : recent.isError ? (
            <BandBody>
              <ErrorState
                message={recent.error?.message ?? 'Could not load your orders.'}
                retry={() => void recent.refetch()}
              />
            </BandBody>
          ) : (recent.data?.items ?? []).length === 0 ? (
            <BandBody>
              <EmptyState
                title="No orders yet"
                description="Your most recent orders appear here once you create one."
                bare
              />
            </BandBody>
          ) : (
            <BandBody flush>
              <Table>
                <THead>
                  <Tr>
                    <Th>Order</Th>
                    <Th>Recipient</Th>
                    <Th>Stage</Th>
                    <Th align="right">COD</Th>
                    <Th>Open</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(recent.data?.items ?? []).map((o) => (
                    <Tr key={o.id}>
                      <Td>
                        <Link href={`/orders/${o.id}`} className="text-accent font-mono text-xs">
                          {o.orderNumber}
                        </Link>
                      </Td>
                      <Td>
                        <div className="truncate">{o.recipientName}</div>
                        <div className="text-text-faint truncate font-mono text-xs">
                          {o.recipientCity === ''
                            ? (o.recipientStateProvince ?? '—')
                            : o.recipientCity}
                        </div>
                      </Td>
                      <Td>
                        <OrderStatusBadge status={o.status} />
                      </Td>
                      <Td align="right">
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
            </BandBody>
          )}
        </div>
      )}

      {/* ── 03 // where to go next ────────────────────────────────────── */}
      <div>
        <SectionBand index="03" title="Next steps" />
        <BandBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canCatalog && (
            <ShortcutCard
              href="/products"
              icon={<Package size={16} aria-hidden />}
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
              icon={<ListOrdered size={16} aria-hidden />}
              title="View orders"
              body="Full lifecycle, failed deliveries and the tracking timeline."
              foot={recent.data === undefined ? undefined : `${recent.data.total} in total`}
            />
          )}
          <ShortcutCard
            href="/inbound"
            icon={<Ship size={16} aria-hidden />}
            title="Inbound freight"
            body="Send stock to the warehouse and track what is on the water."
          />
          <ShortcutCard
            href="/tickets"
            icon={<LifeBuoy size={16} aria-hidden />}
            title="Support tickets"
            body="Damage claims, missing items and anything that needs a person."
          />
        </BandBody>
      </div>
    </div>
  );
}

/**
 * A figure that is MOVING — money out in the world rather than money in
 * the wallet.
 *
 * Built on the shared `Stat` rather than a second tile component: the
 * comps' tile is label + icon + figure + a hairline breakdown, which is
 * exactly what `Stat` grew `icon`, `unit` and `foot` for. A parallel
 * component here is how the two would come to disagree about padding.
 */
function MoneyTile({
  label,
  icon,
  tone = 'neutral',
  amount,
  count,
  countLabel,
  hint,
  loading,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly tone?: 'neutral' | 'warn';
  readonly amount: string | undefined;
  readonly count: number | undefined;
  readonly countLabel: string;
  readonly hint: string;
  readonly loading: boolean;
}): ReactElement {
  return (
    <Stat
      label={label}
      icon={icon}
      tone={tone}
      value={
        loading || amount === undefined ? (
          <Skeleton className="h-6 w-28" />
        ) : (
          <Money amount={amount} size="md" />
        )
      }
      hint={hint}
      {...(count === undefined ? {} : { foot: [{ label: countLabel, value: count }] })}
    />
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
      className="border-border bg-surface hover:border-accent block rounded-[var(--radius-3)] border p-3 transition-colors"
    >
      <span className="bg-accent-tint text-accent grid h-8 w-8 place-items-center rounded-[var(--radius-2)]">
        {icon}
      </span>
      <div className="text-text-strong mt-2.5 text-sm font-semibold">{title}</div>
      <p className="text-text-muted mt-1 text-xs leading-snug">{body}</p>
      <div className="border-border mt-2.5 flex items-center justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-text-faint font-mono">{foot ?? ''}</span>
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
        <div className="flex items-start justify-between gap-2">
          <div className="text-text-muted text-xs font-medium tracking-wide uppercase">
            {canonical.currency} balance
          </div>
          <span className="bg-surface-hover text-text-muted grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-2)]">
            <Wallet size={13} aria-hidden />
          </span>
        </div>
        <div className="text-text-bright mt-1.5">
          <Money
            amount={canonical.balance}
            currency={canonical.currency === 'BDT' ? 'BDT' : 'INR'}
            convert={false}
            size="lg"
          />
        </div>
        <div className="text-text-muted mt-1 text-xs">{caption}</div>
        {restated !== undefined && (
          <div className="text-text-faint border-border mt-2.5 flex flex-wrap items-center gap-x-1.5 border-t pt-2 text-xs">
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
