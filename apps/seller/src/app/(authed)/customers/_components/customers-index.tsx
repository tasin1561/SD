'use client';

import Link from 'next/link';
import { Fragment, useState, type ReactElement } from 'react';
import { PackageCheck, RotateCcw, ShieldAlert, Users } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorNote,
  Input,
  MetaChip,
  Num,
  PageHeader,
  SectionBand,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useCustomers, type CustomerView } from '@/lib/account-hooks';
import { AddressHistory } from './address-history';
import { CustomerDetailPanel } from './customer-detail-panel';
import { serverVerdict } from '@/lib/server-verdict';

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

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Customers' }]}
            Link={Link}
          />
        }
        title="Customers"
        subtitle="Everyone you have shipped to, and how those orders ended."
        meta={
          list.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {total} {total === 1 ? 'customer' : 'customers'}
              </MetaChip>
              {flagged.length > 0 && (
                <MetaChip tone="warn">{flagged.length} flagged on this page</MetaChip>
              )}
              <MetaChip dot>Scoped to you</MetaChip>
            </>
          )
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Customers"
          icon={<Users size={13} aria-hidden />}
          value={list.data === undefined ? <span className="text-text-faint">—</span> : total}
          unit={list.data === undefined ? undefined : 'people'}
          tone="neutral"
          hint="Every phone number you have ever shipped to."
        />
        <Stat
          label="Orders on this page"
          icon={<PackageCheck size={13} aria-hidden />}
          value={loaded ? orderTotal : <span className="text-text-faint">—</span>}
          unit={loaded ? 'orders' : undefined}
          tone="neutral"
          {...(loaded
            ? {
                foot: [
                  { label: 'Delivered', value: deliveredTotal },
                  { label: 'Customers shown', value: items.length },
                ],
              }
            : {})}
        />
        <Stat
          label="Came back on this page"
          icon={<RotateCcw size={13} aria-hidden />}
          value={loaded ? rtoTotal : <span className="text-text-faint">—</span>}
          unit={loaded ? 'orders' : undefined}
          tone={rtoTotal > 0 ? 'warn' : 'neutral'}
          {...(answered
            ? {
                hint:
                  rtoTotal > 0
                    ? 'You pay the courier both ways on each of these.'
                    : 'Nothing from these customers has been returned.',
              }
            : {})}
          {...(loaded && refusedTotal > 0
            ? { foot: [{ label: 'Refused at the door', value: refusedTotal }] }
            : {})}
        />
        <Stat
          label="Flagged on this page"
          icon={<ShieldAlert size={13} aria-hidden />}
          value={loaded ? flagged.length : <span className="text-text-faint">—</span>}
          unit={loaded ? 'people' : undefined}
          tone={flagged.length > 0 ? 'bad' : 'neutral'}
          {...(answered
            ? {
                hint:
                  flagged.length > 0
                    ? 'Rated medium risk or worse. Worth a call before you ship again.'
                    : 'Nobody on this page has been rated a risk.',
              }
            : {})}
        />
      </div>

      <SectionBand
        index="01"
        title="Customer register"
        note={
          list.data === undefined
            ? undefined
            : `${total} ${total === 1 ? 'customer' : 'customers'}${searching ? ' matching' : ''}`
        }
        action={
          <>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Phone or name…"
              className="w-full sm:w-64"
              aria-label="Search customers"
            />
            {searching && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                className="text-text-faint hover:text-text-body px-1 text-xs transition-colors"
              >
                Reset
              </button>
            )}
          </>
        }
      />

      <BandBody flush>
        {list.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={6} />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title={searching ? 'Nobody matches that' : 'No customers yet'}
              description={
                searching
                  ? 'Try the full phone number including the country code.'
                  : 'A customer record appears the first time you place an order for a phone number.'
              }
              action={
                searching ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setSearch('');
                      setPage(1);
                    }}
                  >
                    Clear search
                  </Button>
                ) : undefined
              }
              bare
            />
          </div>
        ) : (
          <Table>
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
                  <Tr>
                    <Td>
                      <span className="text-text-bright font-mono text-xs">{c.phoneE164}</span>
                    </Td>
                    <Td>{c.name ?? <span className="text-text-faint">—</span>}</Td>
                    <Td align="right">
                      <Num value={c.totalOrdersCount} />
                    </Td>
                    <Td align="right">
                      <Num value={c.successfulOrdersCount} />
                    </Td>
                    <Td align="right">
                      {c.rtoCount === 0 ? (
                        <span className="text-text-faint">0</span>
                      ) : (
                        <span className="text-[var(--status-rto-fg)]">{c.rtoCount}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {c.refusedCount === 0 ? (
                        <span className="text-text-faint">0</span>
                      ) : (
                        <span className="text-[var(--color-critical)]">{c.refusedCount}</span>
                      )}
                    </Td>
                    <Td>
                      {isRated(c.riskLevel) ? (
                        <StatusBadge
                          kind={riskKind(c.riskLevel)}
                          label={c.riskLevel.toLowerCase()}
                        />
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </Td>
                    <Td className="text-text-muted font-mono text-xs">
                      {c.lastOrderAt === null
                        ? '—'
                        : new Date(c.lastOrderAt).toLocaleDateString('en-IN')}
                    </Td>
                    <Td align="right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded === c.id}
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      >
                        {expanded === c.id ? 'Hide' : 'Open'}
                      </Button>
                    </Td>
                  </Tr>
                  {expanded === c.id && (
                    <Tr>
                      <Td colSpan={9}>
                        <CustomerDetailPanel
                          customerId={c.id}
                          onDeleted={() => setExpanded(null)}
                        />
                        <AddressHistory customerId={c.id} />
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
            </TBody>
            <tfoot>
              <tr>
                <td colSpan={9} className="p-0">
                  <TablePaginator
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={total}
                    onPageChange={setPage}
                  />
                </td>
              </tr>
            </tfoot>
          </Table>
        )}
      </BandBody>
    </div>
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
