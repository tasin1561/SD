'use client';

import Link from 'next/link';
import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, PackageCheck, RotateCcw, ShieldAlert, Users } from 'lucide-react';
import { Num } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useCustomers, type CustomerView } from '@/lib/account-hooks';
import { AddressHistory } from './address-history';
import { CustomerDetailPanel } from './customer-detail-panel';
import { serverVerdict } from '@/lib/server-verdict';
import './customers.css';

const PAGE_SIZE = 25;

/**
 * Your customers.
 *
 * One row per phone number you have shipped to, with the counts that
 * actually matter in a COD market: how many orders they placed, how
 * many arrived, how many came back. RTO is the expensive one — a
 * customer who refuses parcels costs you the courier leg twice and
 * nobody is billed for it.
 *
 * The list is scoped to you by the server. A phone number that also
 * buys from another seller on Skydrop is a separate record with a
 * separate history; we do not merge them, deliberately.
 *
 * ── WHAT THE TILES MAY AND MAY NOT CLAIM ────────────────────────────
 * `total` is the server's count of every customer you have. Everything
 * else on this screen is summed from the TWENTY-FIVE rows currently
 * loaded — there is no customers-summary endpoint, and the list
 * endpoint returns one page. So the first tile says "all of them" and
 * the other three say "on this page", in the tile itself rather than in
 * a footnote. A derived figure presented as a total is the one mistake
 * on this page that would actually change a decision: a seller reading
 * "3 returned" as their whole return history would conclude their
 * customers are fine.
 *
 * The RISK column is the server's own `riskLevel`, never recomputed
 * here from the counts beside it — two ways to decide whether somebody
 * is risky is how the badge and the number come to disagree.
 */
export function CustomersIndex(): ReactElement {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Expanded inline rather than in a modal: you are comparing this
  // customer's addresses against their totals in the row above.
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useCustomers({
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const loaded = items.length > 0;
  /**
   * ANSWERED, not "has rows".
   *
   * A hint is a claim about the figure above it — "Nothing from these
   * customers has been returned" — and every derived count is 0 until
   * the request lands, so a plain ternary asserts that while the figure
   * itself is still an em dash. The two must agree: no answer, no
   * sentence.
   */
  const answered = list.data !== undefined;
  const rtoTotal = items.reduce((n, c) => n + c.rtoCount, 0);
  const refusedTotal = items.reduce((n, c) => n + c.refusedCount, 0);
  const orderTotal = items.reduce((n, c) => n + c.totalOrdersCount, 0);
  const deliveredTotal = items.reduce((n, c) => n + c.successfulOrdersCount, 0);
  const flagged = items.filter((c) => isFlagged(c.riskLevel));
  const searching = search.trim() !== '';

  const clearSearch = (): void => {
    setSearch('');
    setPage(1);
  };

  return (
    <div className="cst-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Customers' }]}
        Link={Link}
        title="Customers"
        subtitle="Everyone you have shipped to, and how those orders ended."
        meta={
          list.data === undefined ? undefined : (
            <span className="cst-meta">
              <Fact tone="accent">
                {total} {total === 1 ? 'customer' : 'customers'}
              </Fact>
              {flagged.length > 0 && <Fact tone="warn">{flagged.length} flagged on this page</Fact>}
              <Fact dot>Scoped to you</Fact>
            </span>
          )
        }
      />

      <div className="cst-kpis">
        {/* Counts roll once on mount and land on exactly the string they
            always showed (`String`, no digit grouping). */}
        {list.data === undefined ? (
          <KpiCard
            label="Customers"
            icon={<Users size={14} />}
            figure={<span className="cst-faint">—</span>}
            tone="neutral"
            hint="Every phone number you have ever shipped to."
          />
        ) : (
          <KpiCard
            label="Customers"
            icon={<Users size={14} />}
            value={total}
            format={String}
            unit="people"
            tone="neutral"
            hint="Every phone number you have ever shipped to."
          />
        )}
        {loaded ? (
          <KpiCard
            label="Orders on this page"
            icon={<PackageCheck size={14} />}
            value={orderTotal}
            format={String}
            unit="orders"
            tone="neutral"
            foot={[
              { label: 'Delivered', value: deliveredTotal },
              { label: 'Customers shown', value: items.length },
            ]}
          />
        ) : (
          <KpiCard
            label="Orders on this page"
            icon={<PackageCheck size={14} />}
            figure={<span className="cst-faint">—</span>}
            tone="neutral"
          />
        )}
        {loaded ? (
          <KpiCard
            label="Came back on this page"
            icon={<RotateCcw size={14} />}
            value={rtoTotal}
            format={String}
            unit="orders"
            tone={rtoTotal > 0 ? 'pending' : 'neutral'}
            hint={answered ? rtoHint(rtoTotal) : undefined}
            foot={
              refusedTotal > 0 ? [{ label: 'Refused at the door', value: refusedTotal }] : undefined
            }
          />
        ) : (
          <KpiCard
            label="Came back on this page"
            icon={<RotateCcw size={14} />}
            figure={<span className="cst-faint">—</span>}
            tone={rtoTotal > 0 ? 'pending' : 'neutral'}
            hint={answered ? rtoHint(rtoTotal) : undefined}
          />
        )}
        {loaded ? (
          <KpiCard
            label="Flagged on this page"
            icon={<ShieldAlert size={14} />}
            value={flagged.length}
            format={String}
            unit="people"
            tone={flagged.length > 0 ? 'debit' : 'neutral'}
            hint={answered ? flaggedHint(flagged.length) : undefined}
          />
        ) : (
          <KpiCard
            label="Flagged on this page"
            icon={<ShieldAlert size={14} />}
            figure={<span className="cst-faint">—</span>}
            tone={flagged.length > 0 ? 'debit' : 'neutral'}
            hint={answered ? flaggedHint(flagged.length) : undefined}
          />
        )}
      </div>

      <section className="cst-section">
        <SectionHeading
          title="Customer register"
          note={
            list.data === undefined
              ? undefined
              : `${total} ${total === 1 ? 'customer' : 'customers'}${searching ? ' matching' : ''}`
          }
        />
        <TableToolbar
          search={{
            value: search,
            onChange: (next) => {
              setSearch(next);
              setPage(1);
            },
            label: 'Search customers',
            placeholder: 'Phone or name…',
          }}
        >
          {searching && (
            <Button variant="ghost" size="sm" className="cst-reset" onClick={clearSearch}>
              Reset
            </Button>
          )}
        </TableToolbar>

        {list.isLoading ? (
          <SkeletonRows rows={6} label="Loading your customers…" />
        ) : list.isError ? (
          <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={searching ? 'Nobody matches that' : 'No customers yet'}
            description={
              searching
                ? 'Try the full phone number including the country code.'
                : 'A customer record appears the first time you place an order for a phone number.'
            }
            action={
              searching ? (
                <Button variant="secondary" size="md" onClick={clearSearch}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table caption="Customer register">
              <THead>
                <Tr>
                  <Th>Phone</Th>
                  <Th>Name</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Delivered</Th>
                  <Th align="right">RTO</Th>
                  <Th align="right">Refused</Th>
                  <Th>Risk</Th>
                  <Th>Last order</Th>
                  <Th align="right" aria-label="Open" />
                </Tr>
              </THead>
              <TBody>
                {items.map((c) => (
                  <Fragment key={c.id}>
                    <Tr selected={expanded === c.id}>
                      <Td>
                        <span className="cst-phone sk-ident">{c.phoneE164}</span>
                      </Td>
                      <Td>{c.name ?? <span className="cst-faint">—</span>}</Td>
                      <Td align="right">
                        <Num value={c.totalOrdersCount} />
                      </Td>
                      <Td align="right">
                        <Num value={c.successfulOrdersCount} />
                      </Td>
                      <Td align="right">
                        {c.rtoCount === 0 ? (
                          <span className="cst-faint sk-figure">0</span>
                        ) : (
                          <span className="cst-rto sk-figure">{c.rtoCount}</span>
                        )}
                      </Td>
                      <Td align="right">
                        {c.refusedCount === 0 ? (
                          <span className="cst-faint sk-figure">0</span>
                        ) : (
                          <span className="cst-bad sk-figure">{c.refusedCount}</span>
                        )}
                      </Td>
                      <Td>
                        {isRated(c.riskLevel) ? (
                          <StatusChip
                            kind={riskKind(c.riskLevel)}
                            label={c.riskLevel.toLowerCase()}
                            size="sm"
                          />
                        ) : (
                          <span className="cst-faint">—</span>
                        )}
                      </Td>
                      <Td>
                        <span className="cst-date sk-figure">
                          {c.lastOrderAt === null
                            ? '—'
                            : new Date(c.lastOrderAt).toLocaleDateString('en-IN')}
                        </span>
                      </Td>
                      <Td align="right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="cst-toggle"
                          aria-expanded={expanded === c.id}
                          iconRight={<ChevronDown size={14} className="cst-toggle__chev" />}
                          onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        >
                          {expanded === c.id ? 'Hide' : 'Open'}
                        </Button>
                      </Td>
                    </Tr>
                    {expanded === c.id && (
                      <Tr className="cst-expanded">
                        <Td colSpan={9}>
                          <div className="cst-well">
                            <CustomerDetailPanel
                              customerId={c.id}
                              onDeleted={() => setExpanded(null)}
                            />
                            <AddressHistory customerId={c.id} />
                          </div>
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
              label="Customer pages"
            />
          </>
        )}
      </section>
    </div>
  );
}

function rtoHint(rtoTotal: number): string {
  return rtoTotal > 0
    ? 'You pay the courier both ways on each of these.'
    : 'Nothing from these customers has been returned.';
}

function flaggedHint(flaggedCount: number): string {
  return flaggedCount > 0
    ? 'Rated medium risk or worse. Worth a call before you ship again.'
    : 'Nobody on this page has been rated a risk.';
}

/** A standing fact under the page title — never an action. */
function Fact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: 'accent' | 'warn' | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="cst-fact" data-tone={tone}>
      {dot && <span className="cst-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * HAS ANYBODY JUDGED THIS CUSTOMER?
 *
 * `CustomerRiskLevel` is NONE | LOW | MEDIUM | HIGH | BLOCKED, and
 * **NONE is the default** — it means unassessed, not safe and not
 * risky. Treating it as a rating is not cosmetic: on this account every
 * one of eleven customers is NONE, so counting "not LOW" as flagged put
 * "11 FLAGGED ON THIS PAGE" in the header and a red badge on every row,
 * telling a seller their entire customer book is risky when nobody has
 * looked at any of it.
 *
 * So NONE and null are the same thing here — no rating — and both read
 * as an em dash, exactly as an absent figure does everywhere else on
 * this screen.
 */
function isRated(level: CustomerView['riskLevel']): level is string {
  if (level === null) return false;
  const v = level.toUpperCase();
  return v !== 'NONE' && v !== '';
}

/**
 * A RATING, as a badge kind. Only ever called on a rated customer.
 *
 * The parameter is `string` because that is what the endpoint sends, so
 * an unrecognised value has to land somewhere. It lands on `pending`,
 * NOT on `failed`: a word we do not recognise is not evidence of risk,
 * and painting it red is how an unassessed customer came to look
 * blocked. Only the two levels that MEAN trouble are red.
 */
function riskKind(level: string): 'delivered' | 'pending' | 'failed' {
  switch (level.toUpperCase()) {
    case 'LOW':
      return 'delivered';
    case 'HIGH':
    case 'BLOCKED':
      return 'failed';
    case 'MEDIUM':
    default:
      return 'pending';
  }
}

/** Rated, and rated as trouble — what the "flagged" tile counts. */
function isFlagged(level: CustomerView['riskLevel']): boolean {
  return isRated(level) && level.toUpperCase() !== 'LOW';
}
