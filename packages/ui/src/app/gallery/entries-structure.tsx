'use client';

import {
  Bell,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Inbox,
  LayoutDashboard,
  MapPin,
  Package,
  PackagePlus,
  Plus,
  Search,
  Settings,
  Truck,
  User,
  Wallet,
} from 'lucide-react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../button';
import { EmptyState, ErrorState } from '../empty-state';
import { FilterBar, FilterField } from '../filter-bar';
import { KpiCard, Odometer } from '../kpi-card';
import { ListRow, ListRows } from '../list-row';
import { PageHeader, SectionHeading } from '../page-header';
import { Pagination } from '../pagination';
import { HeaderIconButton, Shell, type LinkLike, type NavGroup } from '../shell';
import { SignInScreen } from '../sign-in';
import { Skeleton, SkeletonRows } from '../skeleton';
import { StatusChip, type StatusChipKind } from '../status-chip';
import { Stepper } from '../stepper';
import { Tabs } from '../tabs';
import { Timeline, type TimelineStep } from '../timeline';
import {
  RowActions,
  SelectAllTh,
  SelectTd,
  SortableTh,
  Table,
  TableEmpty,
  TableToolbar,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useRowSelection,
  type SortDirection,
} from '../data-table';
import type { GalleryEntry } from './types';

/* ── Fixtures ──────────────────────────────────────────────────────── */

/** A link that goes nowhere: the gallery must not navigate. */
const DemoLink: LinkLike = ({ href, className, children, onClick, ...rest }) => (
  <a
    href={href}
    className={className}
    aria-current={rest['aria-current']}
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
  >
    {children}
  </a>
);

const NAV: readonly NavGroup[] = [
  {
    items: [{ href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> }],
  },
  {
    heading: 'Operations',
    items: [
      {
        href: '/orders',
        label: 'Orders',
        icon: <Package size={15} />,
        badge: <StatusChip kind="pending" label="12" size="sm" />,
      },
      { href: '/orders/new', label: 'New order', icon: <PackagePlus size={15} /> },
      { href: '/inventory', label: 'Inventory', icon: <Boxes size={15} /> },
      { href: '/shipments', label: 'Shipments', icon: <Truck size={15} /> },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/wallet', label: 'Wallet', icon: <Wallet size={15} /> },
      { href: '/charges', label: 'Charges', icon: <CreditCard size={15} /> },
    ],
  },
  {
    heading: 'Account',
    items: [{ href: '/settings', label: 'Settings', icon: <Settings size={15} /> }],
  },
];

interface OrderRow {
  readonly id: string;
  readonly customer: string;
  readonly city: string;
  readonly kind: StatusChipKind;
  readonly status: string;
  readonly cod: number;
}

const CITIES = ['Delhi', 'Mumbai', 'Kolkata', 'Bengaluru', 'Pune', 'Jaipur'];
const STATES: ReadonlyArray<readonly [StatusChipKind, string]> = [
  ['pending', 'Pending confirmation'],
  ['confirmed', 'Confirmed'],
  ['in-transit', 'In transit'],
  ['delivered', 'Delivered'],
  ['rto', 'Returning'],
  ['cancelled', 'Cancelled'],
];
const ORDERS: readonly OrderRow[] = Array.from({ length: 12 }, (_, i) => {
  const state = STATES[i % STATES.length] ?? STATES[0] ?? ['neutral', '—'];
  return {
    id: `SD-2026-38-${String(1200 + i).padStart(6, '0')}`,
    customer:
      ['Aarav Sharma', 'Priya Nair', 'Rohan Das', 'Meera Iyer', 'Kabir Singh', 'Anaya Rao'][
        i % 6
      ] ?? 'Customer',
    city: CITIES[i % CITIES.length] ?? 'Delhi',
    kind: state[0],
    status: state[1],
    cod: 450 + i * 137,
  };
});

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/* ── Live demos ────────────────────────────────────────────────────── */

function ShellDemo(): ReactElement {
  const [path, setPath] = useState('/orders');
  const Link: LinkLike = (props) => (
    <DemoLink
      {...props}
      onClick={() => {
        setPath(props.href);
        props.onClick();
      }}
    />
  );
  return (
    <div
      style={{ height: 520, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 16 }}
    >
      <Shell
        contained
        subtitle="Seller"
        sectionLabel="Operations"
        navGroups={NAV}
        identityPrimary="Menev Store"
        identitySecondary="owner@menev.example"
        identityHref="/account"
        headerAlways={
          <HeaderIconButton label="Notifications" icon={<Bell size={16} />} count={3} />
        }
        headerActions={<HeaderIconButton label="Search" icon={<Search size={16} />} />}
        statusStrip="Rates: ৳1 = ₹0.81 · Fees charged in rupees"
        pathname={path}
        Link={Link}
        onSignOut={() => undefined}
      >
        <PageHeader
          title="Orders"
          subtitle="Every order across your stores."
          breadcrumbs={[{ label: 'Operations', href: '/orders' }, { label: 'Orders' }]}
          action={
            <Button icon={<Plus size={16} />} size="sm">
              New order
            </Button>
          }
        />
        <p style={{ color: 'var(--fg-muted)' }}>Current path: {path}</p>
      </Shell>
    </div>
  );
}

function StickyHeaderDemo(): ReactElement {
  return (
    <div
      style={{
        height: 260,
        overflow: 'auto',
        border: '1px solid var(--line)',
        borderRadius: 16,
        padding: 16,
      }}
    >
      <PageHeader
        sticky
        title="Order SD-2026-38-001204"
        subtitle="Scroll this frame — the title bar sticks and condenses."
        breadcrumbs={[{ label: 'Orders', href: '#' }, { label: 'SD-2026-38-001204' }]}
        meta={<StatusChip kind="in-transit" label="In transit" />}
        action={<Button size="sm">Cancel order</Button>}
      />
      {Array.from({ length: 12 }, (_, i) => (
        <p key={i} style={{ color: 'var(--fg-muted)' }}>
          Content line {i + 1}
        </p>
      ))}
    </div>
  );
}

function TableDemo({ empty = false }: { readonly empty?: boolean }): ReactElement {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('cod');
  const [dir, setDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = empty
      ? []
      : ORDERS.filter(
          (o) => q === '' || `${o.id} ${o.customer} ${o.city}`.toLowerCase().includes(q),
        );
    return [...filtered].sort((a, b) => {
      const d = sortKey === 'cod' ? a.cod - b.cod : a.customer.localeCompare(b.customer);
      return dir === 'asc' ? d : -d;
    });
  }, [query, sortKey, dir, empty]);
  const selection = useRowSelection(rows.map((r) => r.id));
  const onSort = (key: string): void => {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setDir('asc');
    }
  };
  return (
    <div>
      <TableToolbar
        search={{ value: query, onChange: setQuery, label: 'Search orders' }}
        selectedCount={selection.count}
        bulkActions={
          <Button size="sm" variant="secondary" onClick={selection.clear}>
            Clear selection
          </Button>
        }
        action={
          <Button size="sm" icon={<Plus size={15} />}>
            Add order
          </Button>
        }
      />
      <Table caption="Orders">
        <THead>
          <tr>
            <SelectAllTh selection={selection} />
            <Th>Order</Th>
            <SortableTh
              label="Customer"
              columnKey="customer"
              activeKey={sortKey}
              direction={dir}
              onSort={onSort}
            />
            <Th>City</Th>
            <Th>Status</Th>
            <SortableTh
              label="COD"
              columnKey="cod"
              activeKey={sortKey}
              direction={dir}
              onSort={onSort}
              align="right"
            />
            <Th align="right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={7}>
              <EmptyState
                bare
                title="No orders match"
                description="Clear the search to see every order."
                action={
                  <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            </TableEmpty>
          ) : (
            rows.map((o) => (
              <Tr key={o.id} onActivate={() => undefined} selected={selection.isSelected(o.id)}>
                <SelectTd selection={selection} id={o.id} label={`Select ${o.id}`} />
                <Td>
                  <a href="#" className="sk-ident" onClick={(e) => e.preventDefault()}>
                    {o.id}
                  </a>
                </Td>
                <Td>{o.customer}</Td>
                <Td>{o.city}</Td>
                <Td>
                  <StatusChip kind={o.kind} label={o.status} />
                </Td>
                <Td align="right" className="sk-figure">
                  {INR.format(o.cod)}
                </Td>
                <RowActions>
                  <Button size="sm" variant="ghost">
                    View
                  </Button>
                </RowActions>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
      <Pagination page={page} pageSize={20} total={empty ? 0 : 240} onPageChange={setPage} />
    </div>
  );
}

function PaginationDemo({ withSize }: { readonly withSize: boolean }): ReactElement {
  const [page, setPage] = useState(6);
  const [size, setSize] = useState(20);
  return (
    <Pagination
      page={page}
      pageSize={size}
      total={1240}
      onPageChange={setPage}
      onPageSizeChange={withSize ? setSize : undefined}
    />
  );
}

function FilterDemo({ staged }: { readonly staged: boolean }): ReactElement {
  const [status, setStatus] = useState('Delivered');
  const [city, setCity] = useState('Delhi');
  const [busy, setBusy] = useState(false);
  const chips = [
    ...(status !== ''
      ? [{ id: 'status', label: `Status: ${status}`, onRemove: () => setStatus('') }]
      : []),
    ...(city !== '' ? [{ id: 'city', label: `City: ${city}`, onRemove: () => setCity('') }] : []),
  ];
  const input = (value: string, set: (v: string) => void, label: string): ReactNode => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={label}
      style={{
        width: '100%',
        minHeight: 40,
        padding: '0 12px',
        borderRadius: 12,
        border: '1px solid var(--border-control)',
        background: 'var(--surface-input)',
        color: 'var(--fg-strong)',
        font: 'inherit',
      }}
    />
  );
  return (
    <FilterBar
      chips={chips}
      onReset={() => {
        setStatus('');
        setCity('');
      }}
      onApply={
        staged
          ? () => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 900);
            }
          : undefined
      }
      applying={busy}
    >
      <FilterField icon={<ClipboardCheck size={15} />}>
        {input(status, setStatus, 'Status')}
      </FilterField>
      <FilterField icon={<MapPin size={15} />}>{input(city, setCity, 'City')}</FilterField>
      <FilterField icon={<CalendarDays size={15} />}>
        {input('', () => undefined, 'Date')}
      </FilterField>
    </FilterBar>
  );
}

function TabsDemo({ routes }: { readonly routes: boolean }): ReactElement {
  const [tab, setTab] = useState('orders');
  const panel = (t: string): ReactNode => (
    <div style={{ padding: 16, border: '1px solid var(--line)', borderRadius: 12 }}>
      <SectionHeading title={t} note="Panels rise in when the tab changes." />
    </div>
  );
  return (
    <Tabs
      label="Order views"
      value={tab}
      onChange={setTab}
      items={[
        {
          id: 'orders',
          label: 'All orders',
          count: 240,
          icon: <Package size={14} />,
          ...(routes ? { href: '#orders' } : { panel: panel('All orders') }),
        },
        {
          id: 'waiting',
          label: 'Waiting',
          count: 12,
          icon: <Inbox size={14} />,
          ...(routes ? { href: '#waiting' } : { panel: panel('Waiting') }),
        },
        {
          id: 'moving',
          label: 'On the way',
          icon: <Truck size={14} />,
          ...(routes ? { href: '#moving' } : { panel: panel('On the way') }),
        },
        {
          id: 'returns',
          label: 'Returns',
          count: 3,
          ...(routes ? { href: '#returns' } : { panel: panel('Returns') }),
        },
      ]}
    />
  );
}

const DELIVERED: readonly TimelineStep[] = [
  {
    id: 'placed',
    label: 'Order placed',
    state: 'done',
    time: '8 Sep, 10:12',
    description: 'Confirmed by phone.',
  },
  {
    id: 'packed',
    label: 'Packed',
    state: 'done',
    time: '9 Sep, 14:40',
    location: 'Bengaluru warehouse',
  },
  { id: 'shipped', label: 'Handed to courier', state: 'done', time: '9 Sep, 18:05' },
  { id: 'out', label: 'Out for delivery', state: 'done', time: '11 Sep, 09:20', location: 'Delhi' },
  { id: 'done', label: 'Delivered', state: 'done', time: '11 Sep, 13:48' },
];
const MOVING: readonly TimelineStep[] = [
  { id: 'placed', label: 'Order placed', state: 'done', time: '12 Sep, 10:12' },
  { id: 'packed', label: 'Packed', state: 'done', time: '13 Sep, 14:40' },
  {
    id: 'shipped',
    label: 'In transit',
    state: 'current',
    time: '14 Sep, 06:10',
    location: 'Nagpur hub',
    description: 'Moving towards the destination city.',
  },
  { id: 'out', label: 'Out for delivery', state: 'todo' },
  { id: 'done', label: 'Delivered', state: 'todo' },
];
const RETURNING: readonly TimelineStep[] = [
  { id: 'placed', label: 'Order placed', state: 'done', time: '2 Sep, 10:12' },
  { id: 'shipped', label: 'In transit', state: 'done', time: '3 Sep, 18:05' },
  {
    id: 'failed',
    label: 'Delivery failed',
    state: 'done',
    tone: 'failed',
    time: '5 Sep, 12:30',
    description: 'Customer not reachable on the phone.',
  },
  {
    id: 'rto',
    label: 'Returning to us',
    state: 'current',
    tone: 'returning',
    time: '6 Sep, 09:00',
  },
  { id: 'back', label: 'Received back', state: 'todo' },
];

function WizardDemo(): ReactElement {
  const [step, setStep] = useState(1);
  const steps = [
    { id: 'w-account', label: 'Account', icon: <User size={16} /> },
    { id: 'w-details', label: 'Details', icon: <ClipboardCheck size={16} /> },
    { id: 'w-review', label: 'Review', icon: <Package size={16} /> },
  ];
  return (
    <Stepper mode="wizard" label="Create order" steps={steps} current={step} onStepChange={setStep}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 16,
          border: '1px solid var(--line)',
          borderRadius: 12,
        }}
      >
        <span style={{ flex: 1 }}>Step {step + 1} content</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Back
        </Button>
        <Button size="sm" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>
          Next
        </Button>
      </div>
    </Stepper>
  );
}

function SectionsDemo(): ReactElement {
  const ids = ['sec-customer', 'sec-address', 'sec-items', 'sec-payment'];
  const labels = ['Customer', 'Address', 'Items', 'Payment'];
  return (
    <div>
      <Stepper
        mode="sections"
        sticky
        label="Order form sections"
        scrollOffset={80}
        steps={ids.map((id, i) => ({ id, label: labels[i] ?? id }))}
      />
      <form
        style={{ display: 'grid', gap: 16, marginTop: 16 }}
        onSubmit={(e) => e.preventDefault()}
      >
        {ids.map((id, i) => (
          <section
            key={id}
            id={id}
            style={{
              minHeight: 260,
              padding: 16,
              border: '1px solid var(--line)',
              borderRadius: 12,
            }}
          >
            <SectionHeading title={labels[i] ?? id} note="Every field stays mounted — one form." />
          </section>
        ))}
      </form>
    </div>
  );
}

function KpiRefetchDemo(): ReactElement {
  const [n, setN] = useState(1284);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <KpiCard
        label="Orders this month"
        value={n}
        unit="orders"
        tone="info"
        icon={<Package size={16} />}
      />
      <Button size="sm" variant="secondary" onClick={() => setN(n + 17)}>
        Refetch (no re-roll)
      </Button>
    </div>
  );
}

function SignInDemo(): ReactElement {
  return (
    <div
      style={{ height: 620, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 16 }}
    >
      <div style={{ transform: 'scale(1)', height: '100%' }}>
        <SignInScreen
          portal="seller portal"
          note="Use the login from your invitation."
          footer={
            <>
              Forgot your password? <a href="#">Reset it</a>
            </>
          }
        >
          <form style={{ display: 'grid', gap: 12 }} onSubmit={(e) => e.preventDefault()}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Email</span>
              <input
                id="email-demo"
                type="email"
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border-control)',
                  background: 'var(--surface-input)',
                  color: 'var(--fg-strong)',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Password</span>
              <input
                id="password-demo"
                type="password"
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border-control)',
                  background: 'var(--surface-input)',
                  color: 'var(--fg-strong)',
                }}
              />
            </label>
            <Button type="submit" fullWidth>
              Sign in
            </Button>
          </form>
        </SignInScreen>
      </div>
    </div>
  );
}

const ALL_KINDS: ReadonlyArray<readonly [StatusChipKind, string]> = [
  ['draft', 'Draft'],
  ['pending', 'Pending'],
  ['confirmed', 'Confirmed'],
  ['in-transit', 'In transit'],
  ['delivered', 'Delivered'],
  ['rto', 'Returning'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
  ['held', 'On hold'],
  ['neutral', 'Unknown'],
];

/* ── Entries ───────────────────────────────────────────────────────── */

export const STRUCTURE_ENTRIES: readonly GalleryEntry[] = [
  {
    id: 'shell',
    wide: true,
    name: 'Shell',
    patterns: ['u23', 'u31', 'u20'],
    usedFor: 'The chrome of every signed-in page in seller, admin and reseller.',
    states: [
      {
        label:
          'Contained frame — hover rows (the accent bar follows), collapse a group, narrow the window below 1024px for the drawer',
        render: () => <ShellDemo />,
      },
      {
        label: 'Header icon buttons — hover fills and lifts; count badge',
        render: () => (
          <div style={{ display: 'flex', gap: 8 }}>
            <HeaderIconButton label="Notifications" icon={<Bell size={16} />} count={4} />
            <HeaderIconButton label="Search" icon={<Search size={16} />} />
            <HeaderIconButton label="Menu" icon={<Settings size={16} />} accent />
          </div>
        ),
      },
    ],
  },
  {
    id: 'page-header',
    name: 'Page header',
    patterns: ['u30'],
    usedFor: 'The top of every page: breadcrumb, title, facts, primary action.',
    states: [
      {
        label: 'Default',
        render: () => (
          <PageHeader
            title="Wallet"
            subtitle="Money we hold for you, and what moved it."
            breadcrumbs={[{ label: 'Money', href: '#' }, { label: 'Wallet' }]}
            meta={
              <>
                <StatusChip kind="confirmed" label="Settled daily" />
                <StatusChip kind="neutral" label="INR" />
              </>
            }
            action={<Button size="sm">Request payout</Button>}
          />
        ),
      },
      { label: 'Sticky — scroll the frame', render: () => <StickyHeaderDemo /> },
      {
        label: 'Section heading',
        render: () => (
          <SectionHeading
            title="Recent orders"
            note="The last five, newest first."
            action={
              <Button size="sm" variant="ghost">
                See all
              </Button>
            }
          />
        ),
      },
    ],
  },
  {
    id: 'kpi-card',
    name: 'KPI card',
    patterns: ['u31', 'odometer'],
    usedFor: 'Dashboard and money figures.',
    states: [
      {
        label: 'Credit / debit / pending / neutral',
        render: () => (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <KpiCard
              label="Wallet balance"
              figure={INR.format(48250.4)}
              tone="credit"
              icon={<Wallet size={16} />}
              trend={{ direction: 'up', label: '+12% vs last week', good: true }}
            />
            <KpiCard
              label="Charges this month"
              figure={INR.format(9120)}
              tone="debit"
              icon={<CreditCard size={16} />}
              trend={{ direction: 'up', label: '+4%', good: false }}
            />
            <KpiCard
              label="Awaiting confirmation"
              value={37}
              unit="orders"
              tone="pending"
              chip={<StatusChip kind="pending" label="Needs you" size="sm" />}
              secondary="6 at the call desk"
            />
            <KpiCard
              label="Parcels moving"
              value={1204}
              tone="neutral"
              foot={[
                { label: 'Delhivery', value: '1,012' },
                { label: 'Shiprocket', value: '192' },
              ]}
            />
          </div>
        ),
      },
      { label: 'Refetch does not re-roll', render: () => <KpiRefetchDemo /> },
      { label: 'Odometer alone', render: () => <Odometer value={1234567} /> },
    ],
  },
  {
    id: 'data-table',
    wide: true,
    name: 'Data table',
    patterns: ['u07'],
    usedFor: 'Every list page — orders, inventory, tickets, payouts.',
    states: [
      {
        label: '12 rows, sort, search, select (resize below 768px for cards)',
        render: () => <TableDemo />,
      },
      { label: 'Empty', render: () => <TableDemo empty /> },
    ],
  },
  {
    id: 'pagination',
    wide: true,
    name: 'Pagination',
    patterns: ['u16'],
    usedFor: 'Under every paged table.',
    states: [
      { label: 'With page size', render: () => <PaginationDemo withSize /> },
      {
        label: 'Legacy shape (page / pageSize / total)',
        render: () => <PaginationDemo withSize={false} />,
      },
    ],
  },
  {
    id: 'filter-bar',
    wide: true,
    name: 'Filter bar',
    patterns: ['u04'],
    usedFor: 'Above list pages with more than two filters.',
    states: [
      { label: 'Live filters (no Apply)', render: () => <FilterDemo staged={false} /> },
      {
        label: 'Staged filters (Apply, busy while "applying")',
        render: () => <FilterDemo staged />,
      },
    ],
  },
  {
    id: 'status-chip',
    name: 'Status chip',
    patterns: ['u07', 'u21'],
    usedFor: 'Every status on every screen — colour, icon and word.',
    states: [
      {
        label: 'All kinds',
        render: () => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_KINDS.map(([k, l]) => (
              <StatusChip key={k} kind={k} label={l} />
            ))}
          </div>
        ),
      },
      {
        label: 'Small, and pulse once (low stock)',
        render: () => (
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusChip kind="delivered" label="Delivered" size="sm" />
            <StatusChip kind="pending" label="Low stock" pulse />
          </div>
        ),
      },
    ],
  },
  {
    id: 'tabs',
    wide: true,
    name: 'Tabs',
    patterns: ['u09', 'liquid-bead'],
    usedFor: 'In-page views and route tabs.',
    states: [
      {
        label: 'In-page tabs — arrow keys move and select',
        render: () => <TabsDemo routes={false} />,
      },
      { label: 'Route tabs (links, aria-current)', render: () => <TabsDemo routes /> },
    ],
  },
  {
    id: 'timeline',
    name: 'Timeline',
    patterns: ['u17'],
    usedFor: 'Order journey in every console and the public tracking page.',
    states: [
      {
        label: 'Delivered',
        render: () => (
          <Timeline
            header={{
              title: 'Order',
              id: 'SD-2026-38-001204',
              status: <StatusChip kind="delivered" label="Delivered" />,
            }}
            steps={DELIVERED}
          />
        ),
      },
      {
        label: 'In transit — current step pulses',
        render: () => (
          <Timeline
            header={{
              icon: <Truck size={18} />,
              title: 'Parcel',
              id: '38061110487620',
              status: <StatusChip kind="in-transit" label="In transit" />,
              eta: 'ETA 16 Sep',
            }}
            steps={MOVING}
            progress={{ value: 55, label: 'On the way' }}
            expected={{ day: 'Tuesday, 16 Sep', time: 'by 7 pm' }}
          />
        ),
      },
      {
        label: 'Returning',
        render: () => (
          <Timeline
            header={{
              title: 'Order',
              id: 'SD-2026-36-000877',
              status: <StatusChip kind="rto" label="Returning" />,
            }}
            steps={RETURNING}
          />
        ),
      },
    ],
  },
  {
    id: 'stepper',
    wide: true,
    name: 'Stepper',
    patterns: ['u34'],
    usedFor: 'Wizards, and the progress header over the create-order form.',
    states: [
      { label: 'Wizard — click a completed step to go back', render: () => <WizardDemo /> },
      { label: 'Sections — scroll the page; click a step to jump', render: () => <SectionsDemo /> },
    ],
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    patterns: [],
    usedFor: 'Every loading state — never a spinner.',
    states: [
      {
        label: 'Blocks',
        render: () => (
          <div style={{ display: 'grid', gap: 8 }}>
            <Skeleton width="40%" height={20} />
            <Skeleton width="80%" />
            <Skeleton width={48} height={48} rounded="full" />
          </div>
        ),
      },
      { label: 'Rows', render: () => <SkeletonRows rows={4} cols={5} /> },
    ],
  },
  {
    id: 'empty-state',
    name: 'Empty state',
    patterns: ['u27'],
    usedFor: 'Empty lists, cleared queues, failed fetches.',
    states: [
      {
        label: 'Neutral',
        render: () => (
          <EmptyState
            title="No orders yet"
            description="Orders you create or import land here."
            action={
              <Button size="sm" icon={<Plus size={15} />}>
                New order
              </Button>
            }
          />
        ),
      },
      {
        label: 'Positive',
        render: () => (
          <EmptyState
            tone="positive"
            title="Nothing needs you"
            description="Every order is confirmed and moving."
          />
        ),
      },
      {
        label: 'Error, verbatim, with Retry',
        render: () => (
          <ErrorState
            message="[ORDER_NOT_FOUND] Order SD-2026-38-009999 does not exist."
            retry={() => undefined}
          />
        ),
      },
    ],
  },
  {
    id: 'list-row',
    wide: true,
    name: 'List row',
    patterns: ['u21'],
    usedFor: 'Queues, inboxes, attention lists.',
    states: [
      {
        label: 'Rows — hover lifts, the bar grows, the chevron appears',
        render: () => (
          <ListRows label="Needs attention">
            <ListRow
              href="#"
              icon={<Truck size={16} />}
              title="SD-2026-38-001204"
              tag="Delhivery"
              description="No scan for 2 days"
              status={<StatusChip kind="in-transit" label="In transit" />}
              age="2d"
              severity="high"
            />
            <ListRow
              onClick={() => undefined}
              icon={<Package size={16} />}
              title="SD-2026-38-001188"
              description="Customer asked to call back"
              status={<StatusChip kind="pending" label="Pending" />}
              age="4h"
              severity="medium"
            />
            <ListRow
              icon={<Wallet size={16} />}
              title="Payout requested"
              description="₹12,400 to HDFC ****1123"
              meta={INR.format(12400)}
            />
            <ListRow
              href="#"
              icon={<Inbox size={16} />}
              title="Selected row"
              selected
              description="Currently open"
            />
          </ListRows>
        ),
      },
    ],
  },
  {
    id: 'sign-in',
    wide: true,
    name: 'Sign-in screen',
    patterns: ['corridor-map'],
    usedFor: 'Every unauthenticated page in admin, seller and reseller.',
    states: [{ label: 'With a dummy form', render: () => <SignInDemo /> }],
  },
];
