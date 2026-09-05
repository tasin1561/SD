'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useOrderStatusSummary, usePendingRows, useOrdersList } from '@/lib/api-hooks';
import { canSeePath } from '@/lib/page-access';
import { Plus, Search } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  Input,
  Money,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  OrderStatusBadge,
} from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';

/**
 * Seller order list — URL-driven filter state so a deep-linked filter
 * is shareable + browser back/forward navigates the same set. The
 * list itself is fetched via TanStack Query; the URL is canonical,
 * the query string is the fetch params.
 *
 * ── THE 2026-09-05 REDESIGN ──────────────────────────────────────────
 * Built from two reference comps, one light and one dark. What was
 * taken from them: a stat strip that answers "how is my day going"
 * before the table does, filter CHIPS carrying counts instead of a
 * dropdown that hides them, and rows that give the recipient two lines
 * so a name and a destination are not competing for one.
 *
 * What was deliberately NOT taken, because the comps are drawings and
 * a drawing can show a control with nothing behind it:
 *
 *   - A "Hub: Dhaka (DAC-01)" destination line. We do not have hubs on
 *     an order, and `recipientCity` is BLANK on every order placed
 *     since the form stopped asking (ORD-5). The PIN is the one part of
 *     a destination that is always there, so that is what rows show.
 *   - A date-range filter and a "More Filters (2)" button. The list
 *     endpoint takes status and search; a filter control that cannot
 *     filter is worse than an absent one.
 *   - A selection checkbox column. There is no bulk action for a
 *     seller to apply to a selection, so it would be a column of
 *     checkboxes that do nothing.
 *   - An "Export Manifest" action. A manifest is OUR record of what
 *     went on a van (CUR-4); it is not the seller's to export.
 *
 * Every colour comes from the shared tokens (FE-6), so both themes are
 * one implementation rather than two.
 */

const STATUSES = Object.values(OrderStatus);
const PAGE_SIZES = [15, 20, 50, 100] as const;

/**
 * When it was placed, as presets rather than two date pickers.
 *
 * The question a seller actually has is "since when", and a pair of
 * pickers asks for two answers to get one. `days: null` is everything.
 */
const RANGES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly days: number | null;
}> = [
  { key: '', label: 'Any time', days: null },
  { key: '1', label: 'Today', days: 1 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  // `days: null` like "Any time", but the presence of `from`/`to` in
  // the URL is what makes it a filter. Kept last: it is the answer for
  // "that week in August", which is a rarer question than "recently".
  { key: 'custom', label: 'Custom range…', days: null },
];
const DEFAULT_PAGE_SIZE = 20;

/**
 * The chips, in lifecycle order.
 *
 * Ordered by where an order IS rather than by how many are there:
 * a chip that moves position as counts change is a chip people stop
 * being able to find. Anything a seller has that is not on this list
 * still reaches them through the "All statuses" select below.
 */
const CHIP_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.DELIVERED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.CANCELLED,
];

/** Statuses each tile counts. Named once, read by tile and by nobody else. */
const PROCESSING: readonly OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
];
const MOVING: readonly OrderStatus[] = [
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
];
const RETURNING: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

interface QueryParams {
  readonly status: OrderStatus | '';
  readonly search: string;
  readonly range: string;
  /** `YYYY-MM-DD`, both optional — one end alone is a valid range. */
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as OrderStatus | null;
  const size = Number(sp.get('pageSize'));
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    search: sp.get('search') ?? '',
    range: RANGES.some((r) => r.key === (sp.get('range') ?? '')) ? (sp.get('range') ?? '') : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? (sp.get('from') ?? '') : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? (sp.get('to') ?? '') : '',
    page: Math.max(1, Number(sp.get('page')) || 1),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

export function OrdersIndex(): ReactElement {
  const identity = useSellerIdentity();
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  const [searchInput, setSearchInput] = useState(params.search);
  const pendingCount = usePendingRows().data?.length ?? 0;
  const summary = useOrderStatusSummary();

  const counts = useMemo(() => {
    const m = new Map<string, { count: number; cod: number }>();
    for (const r of summary.data?.byStatus ?? []) {
      m.set(r.status, { count: r.count, cod: Number(r.codInr) });
    }
    return m;
  }, [summary.data]);

  const countOf = useCallback(
    (statuses: readonly OrderStatus[]): number =>
      statuses.reduce((t, s) => t + (counts.get(s)?.count ?? 0), 0),
    [counts],
  );
  const codOf = useCallback(
    (statuses: readonly OrderStatus[]): number =>
      statuses.reduce((t, s) => t + (counts.get(s)?.cod ?? 0), 0),
    [counts],
  );

  const updateUrl = useCallback(
    (next: Partial<QueryParams>) => {
      const merged: QueryParams = { ...params, ...next };
      const nextSp = new URLSearchParams();
      if (merged.status) nextSp.set('status', merged.status);
      if (merged.search) nextSp.set('search', merged.search);
      if (merged.range) nextSp.set('range', merged.range);
      if (merged.range === 'custom' && merged.from) nextSp.set('from', merged.from);
      if (merged.range === 'custom' && merged.to) nextSp.set('to', merged.to);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      if (merged.pageSize !== DEFAULT_PAGE_SIZE) nextSp.set('pageSize', String(merged.pageSize));
      const qs = nextSp.toString();
      router.replace(qs ? `/orders?${qs}` : '/orders');
    },
    [params, router],
  );

  // The range resolved to an instant at render time rather than stored
  // as one: a URL carrying "last 7 days" still means the last 7 days
  // tomorrow, where a stored timestamp would quietly mean last week.
  const days = RANGES.find((r) => r.key === params.range)?.days ?? null;
  const custom = params.range === 'custom';
  const placedFrom = custom
    ? params.from === ''
      ? undefined
      : new Date(`${params.from}T00:00:00`).toISOString()
    : days === null
      ? undefined
      : new Date(Date.now() - days * 86_400_000).toISOString();
  // The END DAY IS INCLUSIVE. A person picking "to: 31 August" means
  // the whole of the 31st; sending midnight would silently drop that
  // day's orders and look like data loss rather than an off-by-one.
  const placedTo =
    custom && params.to !== '' ? new Date(`${params.to}T23:59:59.999`).toISOString() : undefined;

  const list = useOrdersList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(placedFrom === undefined ? {} : { placedFrom }),
    ...(placedTo === undefined ? {} : { placedTo }),
    page: params.page,
    pageSize: params.pageSize,
  });

  const filtered = params.status !== '' || params.search !== '' || params.range !== '';

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Everything you have sent us, and where each one has got to."
        action={
          <div className="flex items-center gap-2">
            {/* Only when there IS something waiting. A permanent nav
                item for an empty queue is noise; a queue nobody knows
                about is worse than both. */}
            {pendingCount > 0 && canSeePath(identity, '/orders/pending') && (
              <Link href="/orders/pending">
                <Button variant="ghost" size="md">
                  <span className="text-[var(--status-pending-fg)]">{pendingCount} pending</span>
                </Button>
              </Link>
            )}
            {canSeePath(identity, '/orders/import') && (
              <Link href="/orders/import">
                <Button variant="ghost" size="md">
                  CSV import
                </Button>
              </Link>
            )}
            {canSeePath(identity, '/orders/new') && (
              <Link href="/orders/new">
                <Button variant="primary" size="md">
                  <Plus size={14} /> New order
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* ── How the day is going, before the table says anything ──── */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OrderStat
          label="Total orders"
          value={summary.data?.total}
          tone="neutral"
          foot={
            summary.data === undefined ? null : (
              <>
                COD placed <Money amount={summary.data.totalCodInr} />
              </>
            )
          }
        />
        <OrderStat
          label="Being processed"
          value={summary.data === undefined ? undefined : countOf(PROCESSING)}
          tone={countOf(PROCESSING) > 0 ? 'warn' : 'neutral'}
          foot={
            summary.data === undefined ? null : (
              <>{counts.get(OrderStatus.PENDING_CONFIRMATION)?.count ?? 0} awaiting the call</>
            )
          }
        />
        <OrderStat
          label="On the road"
          value={summary.data === undefined ? undefined : countOf(MOVING)}
          tone="neutral"
          foot={
            summary.data === undefined ? null : (
              <>
                <Money amount={String(codOf(MOVING))} /> still to collect
              </>
            )
          }
        />
        <OrderStat
          label="Delivered"
          value={summary.data === undefined ? undefined : counts.get(OrderStatus.DELIVERED)?.count}
          tone="good"
          foot={
            summary.data === undefined ? null : (
              <>
                {countOf(RETURNING)} coming back ·{' '}
                <Money amount={String(counts.get(OrderStatus.DELIVERED)?.cod ?? 0)} /> collected
              </>
            )
          }
        />
      </div>

      {/* ── Search. No date range and no "more filters": the endpoint
             takes status and search, and a control that cannot filter
             is worse than an absent one. ─────────────────────────── */}
      <Card className="mb-3">
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateUrl({ search: searchInput.trim(), page: 1 });
            }}
            // BOUNDED, not `flex-1`. The form stretching to the row's
            // full width put the Search button hard against the date
            // filter with a chasm between it and the box it belongs to.
            // A control and its verb belong together; the leftover space
            // goes to the filters after them.
            className="flex w-full min-w-0 items-center gap-2 sm:w-[520px]"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                aria-hidden
                className="text-text-faint pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              />
              <Input
                aria-label="Search orders"
                placeholder="Order number, ref, AWB, recipient name or phone…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button type="submit" variant="secondary" size="md">
              Search
            </Button>
          </form>

          <Select
            aria-label="Placed when"
            value={params.range}
            onChange={(e) => updateUrl({ range: e.target.value, from: '', to: '', page: 1 })}
            className="w-[150px]"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>

          {custom && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="Placed from"
                value={params.from}
                max={params.to === '' ? undefined : params.to}
                onChange={(e) => updateUrl({ from: e.target.value, page: 1 })}
                className="w-[150px]"
              />
              <span className="text-text-faint text-xs">to</span>
              <Input
                type="date"
                aria-label="Placed to"
                value={params.to}
                min={params.from === '' ? undefined : params.from}
                onChange={(e) => updateUrl({ to: e.target.value, page: 1 })}
                className="w-[150px]"
              />
            </div>
          )}

          <Select
            aria-label="Filter by status"
            value={params.status}
            onChange={(e) =>
              updateUrl({ status: (e.target.value as OrderStatus | '') || '', page: 1 })
            }
            className="w-[210px]"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>

          {filtered && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setSearchInput('');
                updateUrl({ status: '', search: '', range: '', from: '', to: '', page: 1 });
              }}
            >
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      {/* ── Chips. The counts live HERE rather than only in a dropdown,
             because "how many are stuck at the call" is the question
             this page is opened to answer. ───────────────────────── */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip
          label="All"
          count={summary.data?.total}
          active={params.status === ''}
          onClick={() => updateUrl({ status: '', page: 1 })}
        />
        {CHIP_STATUSES.map((s) => {
          const n = counts.get(s)?.count ?? 0;
          // A status this seller has never had is not a filter worth
          // offering; one they have had stays even at zero, so a
          // filter cannot vanish out from under somebody mid-task.
          if (n === 0 && params.status !== s) return null;
          return (
            <Chip
              key={s}
              label={statusLabel(s)}
              count={n}
              kind={orderStatusKind(s)}
              active={params.status === s}
              onClick={() => updateUrl({ status: s, page: 1 })}
            />
          );
        })}
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading orders…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load orders.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No orders match that' : 'No orders yet'}
          description={
            filtered
              ? 'Try clearing the filters — the counts on the chips above show what you do have.'
              : 'Orders appear here as you create them or your CSVs import.'
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Order</Th>
              <Th>Recipient</Th>
              <Th>Phone</Th>
              <Th>Status</Th>
              <Th align="right">COD</Th>
              <Th>Placed</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((o) => (
              <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                <Td>
                  <Link
                    href={`/orders/${o.id}`}
                    className="text-accent font-mono text-xs hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                  {o.sellerOrderRef !== null && o.sellerOrderRef !== '' && (
                    <div className="text-text-faint mt-0.5 font-mono text-xs">
                      ref {o.sellerOrderRef}
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="text-text-body">{o.recipientName}</div>
                  {/* City is blank on everything placed since the form
                      stopped asking (ORD-5), so the PIN carries the
                      destination and the city joins it when present. */}
                  <div className="text-text-faint mt-0.5 text-xs">
                    {[o.recipientCity, o.recipientPostalCode].filter((v) => v !== '').join(' · ') ||
                      '—'}
                  </div>
                </Td>
                <Td className="text-text-muted font-mono text-xs">{o.recipientPhoneE164 || '—'}</Td>
                <Td>
                  <OrderStatusBadge status={o.status} />
                </Td>
                <Td align="right">
                  {o.codAmountInr === null ? (
                    <span className="text-text-faint text-xs">Prepaid</span>
                  ) : (
                    <Money amount={o.codAmountInr} />
                  )}
                </Td>
                <Td className="text-text-muted font-mono text-xs">
                  {new Date(o.placedAt).toISOString().slice(0, 16).replace('T', ' ')}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
                <div className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
                  <label className="text-text-faint flex items-center gap-2 text-xs">
                    Rows
                    <Select
                      aria-label="Rows per page"
                      value={params.pageSize}
                      onChange={(e) => updateUrl({ pageSize: Number(e.target.value), page: 1 })}
                      className="w-[76px]"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <TablePaginator
                    page={params.page}
                    pageSize={params.pageSize}
                    total={list.data.total}
                    onPageChange={(next) => updateUrl({ page: next })}
                  />
                </div>
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}

/**
 * One tile.
 *
 * `tone` is what carries colour in the light theme (tokens.css tints a
 * `data-tone` tile and its figure); in dark it is a border. The value
 * is deliberately absent rather than 0 while loading — a tile that
 * reads "0 delivered" and then changes to 8 has told you something
 * false in between.
 */
function OrderStat({
  label,
  value,
  foot,
  tone,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly foot: ReactElement | null;
  readonly tone: 'neutral' | 'warn' | 'bad' | 'good';
}): ReactElement {
  return (
    <div data-tone={tone} className="border-border bg-surface-raised rounded-lg border px-4 py-3">
      <div className="text-text-muted text-xs font-medium uppercase tracking-wide">{label}</div>
      {/* `data-stat-value` is the hook tokens.css uses to put the
          figure in the deeper hue of its tone — without it a tinted
          tile has a pale ground and a plain number sitting on it. */}
      <div data-stat-value className="mt-1 text-2xl font-semibold tabular-nums">
        {value === undefined ? <span className="text-text-faint">—</span> : value}
      </div>
      <div className="text-text-faint mt-0.5 text-xs">{foot ?? ' '}</div>
    </div>
  );
}

/** A filter chip carrying its own count. */
function Chip({
  label,
  count,
  active,
  kind,
  onClick,
}: {
  readonly label: string;
  readonly count: number | undefined;
  readonly active: boolean;
  readonly kind?: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'bg-accent-fill text-accent-fg rounded-full px-3 py-1 text-xs font-medium'
          : 'border-border text-text-muted hover:text-text-body hover:border-border-strong rounded-full border px-3 py-1 text-xs transition-colors'
      }
    >
      {kind !== undefined && !active && (
        <span
          aria-hidden
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ background: `var(--status-${kind}-fg)` }}
        />
      )}
      {label}
      {count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{count}</span>}
    </button>
  );
}
