'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Hourglass,
  LifeBuoy,
  ListOrdered,
  Package,
  PhoneOff,
  Ship,
  Truck,
  Wallet,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  useOrdersList,
  useProductsList,
  useMoneyInFlight,
  useSellerProfile,
  useWalletBalances,
} from '@/lib/api-hooks';
import { useMyNsaOrders } from '@/lib/ops-hooks';
import { Money } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ListRow, ListRows } from '@skydrop/ui/app/list-row';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  CreateOrderLink,
  DashSection,
  MetaFact,
  MoneyTile,
  OnboardingSteps,
  ShortcutCard,
} from './dashboard-parts';
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
 *
 * ── THE 2026-09-23 RESTYLE (the app primitives) ─────────────────────
 * The same data, gates and words on `@skydrop/ui/app/*`: KPI cards for
 * the balance and the money in flight (each figure is the SAME `<Money>`
 * node, handed to the card as `figure`, so no amount is re-formatted),
 * list rows with a severity stripe for what needs the seller, the data
 * table for recent orders, and shortcut cards for where to go next.
 * The numbered section bands and their "NN //" indexes are gone. The
 * presentational pieces live in `dashboard-parts.tsx`; the decisions
 * stay here.
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

  /*
    WHAT NEEDS A DECISION TODAY.

    A dashboard opened every morning should lead with the handful of
    things that stop unless somebody acts, not with totals — a total is
    the same tomorrow whether you read it or not. Both figures are read
    from endpoints `/needs-attention` already uses (nothing new is
    computed here, and that page stays the authority); the row is the
    signpost, and it is ABSENT on a clean morning rather than showing
    two zeroes, which is how a dashboard becomes furniture.

    Gated on `orders.view`, the same key `/needs-attention` is behind —
    so a viewer who may not read orders never fires either request.
  */
  const awaiting = useOrdersList(
    { status: OrderStatus.AWAITING_SELLER_DECISION, page: 1, pageSize: 1 },
    { enabled: canOrders },
  );
  const stuck = useMyNsaOrders({ enabled: canOrders });
  const awaitingCount = awaiting.data?.total ?? 0;
  const stuckCount = (stuck.data ?? []).length;
  // Only once BOTH have answered, and only when there is something to
  // say. A row that appears a second after the page paints, or that
  // claims "0 waiting" while the request is still out, is worse than
  // one that waits.
  const needsYou = awaiting.isSuccess && stuck.isSuccess && awaitingCount + stuckCount > 0;
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
    <div className="db-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Dashboard' }]}
        Link={Link}
        title={`Hello, ${companyName}`}
        subtitle="Your most recent orders, what you are owed, and where to go next."
        meta={
          <span className="db-meta">
            <MetaFact tone="good" dot>
              Account active
            </MetaFact>
            {canWallet && canonicalCurrency !== null && (
              <MetaFact tone="accent">{canonicalCurrency} wallet</MetaFact>
            )}
            {canOrders && recent.data !== undefined && (
              <MetaFact>
                {recent.data.total} {recent.data.total === 1 ? 'order' : 'orders'} placed
              </MetaFact>
            )}
          </span>
        }
        action={canOrders ? <CreateOrderLink /> : undefined}
      />

      {/* ── What needs you, before anything that is merely true ──── */}
      {canOrders && needsYou && (
        <ListRows label="Needs your attention">
          {awaitingCount > 0 && (
            <ListRow
              key="awaiting"
              href="/needs-attention"
              Link={Link}
              severity="high"
              icon={<PhoneOff size={16} />}
              title="Waiting on your decision"
              description={
                <>
                  We rang and nobody answered. Nothing happens to these until you say.
                  <span className="db-row-cta">Open the list · Needs attention →</span>
                </>
              }
              meta={
                <span className="db-count sk-figure">
                  {awaitingCount} {awaitingCount === 1 ? 'order' : 'orders'}
                </span>
              }
            />
          )}
          {stuckCount > 0 && (
            <ListRow
              key="stuck"
              href="/needs-attention"
              Link={Link}
              severity="critical"
              icon={<AlertTriangle size={16} />}
              title="Out for delivery, not arrived"
              description={
                // We chase these; the seller does not have to. Saying so
                // is what stops the row reading as a task list.
                <>
                  We are chasing the courier on these.
                  <span className="db-row-cta">See where each one is · Needs attention →</span>
                </>
              }
              meta={
                <span className="db-count sk-figure">
                  {stuckCount} {stuckCount === 1 ? 'parcel' : 'parcels'}
                </span>
              }
            />
          )}
        </ListRows>
      )}

      {canProfile && canCatalog && onboardingVisible(onboardingKnown, steps) && (
        <DashSection title="Finish setting up" note={`${completedSteps} of ${STEPS_TOTAL} done`}>
          <OnboardingSteps
            steps={steps}
            completed={completedSteps}
            firstIncomplete={firstIncomplete}
          />
        </DashSection>
      )}

      {/* ── Money ─────────────────────────────────────────────────────── */}
      {(canWallet || canOrders) && (
        <DashSection
          title="Treasury & liquidity"
          link={canWallet ? { href: '/wallet', label: 'Ledger and top-ups →' } : undefined}
        >
          <div className="db-kpis">
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
                  icon={<Truck size={14} />}
                  tone="info"
                  amount={inFlight.data?.inTransit.codInr}
                  count={inFlight.data?.inTransit.count}
                  countLabel="orders dispatched"
                  hint="Confirmed and dispatched, not yet delivered. Before our charges."
                  loading={inFlight.isLoading}
                />
                <MoneyTile
                  label="Clearing"
                  icon={<Hourglass size={14} />}
                  tone="pending"
                  amount={inFlight.data?.processing.codInr}
                  count={inFlight.data?.processing.count}
                  countLabel="delivered, unpaid"
                  hint="Delivered; waiting on the courier to remit the cash to us."
                  loading={inFlight.isLoading}
                />
              </>
            )}
          </div>
        </DashSection>
      )}

      {/* ── Recent orders ─────────────────────────────────────────────── */}
      {canOrders && (
        <DashSection title="Recent orders" link={{ href: '/orders', label: 'See all orders →' }}>
          {recent.isLoading ? (
            <SkeletonRows rows={5} cols={5} label="Loading your orders…" />
          ) : recent.isError ? (
            <ErrorState
              message={recent.error?.message ?? 'Could not load your orders.'}
              retry={() => void recent.refetch()}
            />
          ) : (recent.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="Your most recent orders appear here once you create one."
            />
          ) : (
            <Table caption="Recent orders">
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
                      <Link href={`/orders/${o.id}`} className="db-order-link sk-ident">
                        {o.orderNumber}
                      </Link>
                    </Td>
                    <Td>
                      <div className="db-recipient">{o.recipientName}</div>
                      <div className="db-recipient-place">
                        {o.recipientCity === ''
                          ? (o.recipientStateProvince ?? '—')
                          : o.recipientCity}
                      </div>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={orderStatusKind(o.status)}
                        label={statusLabel(o.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="db-prepaid">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} />
                      )}
                    </Td>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="db-link">
                        View →
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </DashSection>
      )}

      {/* ── Where to go next ──────────────────────────────────────────── */}
      <DashSection title="Next steps">
        <ul className="db-shortcuts">
          {canCatalog && (
            <ShortcutCard
              href="/products"
              icon={<Package size={18} />}
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
              icon={<ListOrdered size={18} />}
              title="View orders"
              body="Full lifecycle, failed deliveries and the tracking timeline."
              foot={recent.data === undefined ? undefined : `${recent.data.total} in total`}
            />
          )}
          {/* The page that answers "is anything of mine stuck". It had
              a nav row and no route in from here, so on a clean morning
              — when the rows above are correctly absent — nothing on
              the dashboard pointed at it at all. */}
          {canOrders && (
            <ShortcutCard
              href="/needs-attention"
              icon={<AlertTriangle size={18} />}
              title="Needs attention"
              body="Orders we could not confirm, and parcels that never arrived."
              foot={
                awaiting.isSuccess && stuck.isSuccess
                  ? awaitingCount + stuckCount === 0
                    ? 'Nothing right now'
                    : `${awaitingCount + stuckCount} to look at`
                  : undefined
              }
            />
          )}
          <ShortcutCard
            href="/inbound"
            icon={<Ship size={18} />}
            title="Inbound freight"
            body="Send stock to the warehouse and track what is on the water."
          />
          <ShortcutCard
            href="/tickets"
            icon={<LifeBuoy size={18} />}
            title="Support tickets"
            body="Damage claims, missing items and anything that needs a person."
          />
        </ul>
      </DashSection>
    </div>
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
  // Colour follows the same sign the caption states in words, so the
  // tone is never the only signal.
  const tone = value === 0 ? 'neutral' : value > 0 ? 'credit' : 'debit';

  // The restatement, when the API sent one. Its rate is what makes it
  // checkable rather than a second number to take on trust — and an
  // absent rate is stated as absent rather than quietly dropped, since
  // a figure whose rate nobody can see is the one to distrust.
  const restated = (query.data?.balances ?? []).find((b) => b.isConverted);

  /*
    The rupee figure leads, the caption is the hint, and the taka
    restatement is the hairline foot — the "what this figure is made of"
    slot. The figure is the same `<Money>` it always was, handed to the
    card as a ready node: KpiCard draws it and never re-formats it.
  */
  return (
    <KpiCard
      label={`${canonical.currency} balance`}
      icon={<Wallet size={14} />}
      tone={tone}
      figure={
        <Money
          amount={canonical.balance}
          currency={canonical.currency === 'BDT' ? 'BDT' : 'INR'}
          convert={false}
          size="lg"
        />
      }
      hint={caption}
      {...(restated === undefined
        ? {}
        : {
            foot: [
              {
                label: (
                  <span className="db-restated">
                    <span aria-hidden>≈</span>
                    <Money
                      amount={restated.balance}
                      currency={restated.currency === 'BDT' ? 'BDT' : 'INR'}
                      convert={false}
                    />
                    <span className="db-sr">the same balance in {restated.currency}</span>
                  </span>
                ),
                value:
                  restated.fxRate === null ? (
                    <span className="db-faint">rate not recorded</span>
                  ) : (
                    <span className="db-faint">₹1 = ৳{Number(restated.fxRate).toFixed(2)}</span>
                  ),
              },
            ],
          })}
    />
  );
}
