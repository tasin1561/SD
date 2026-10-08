'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { ArrowLeft, Coins, PackageCheck, ShoppingBag, Users } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { buttonClassName } from '@skydrop/ui/app/button';
import {
  SortableTh,
  Table,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type SortDirection,
} from '@skydrop/ui/app/data-table';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { istDayRange, lastDays } from '@/lib/ist-day';
import { serverVerdict } from '@/lib/server-verdict';
import { useAssociateAnalysis, type AssociateAnalysisRow } from '@/lib/associate-hooks';
import {
  AsSection,
  AssociateCoverage,
  AssociatePauseSwitch,
  AssociatePerson,
  pct,
} from '../_components/associate-parts';
import '../_components/associates.css';

/** What each sortable column reads. Null is "we do not know", and sorts LAST. */
const SORTS: Record<string, (r: AssociateAnalysisRow) => number | string | null> = {
  name: (r) => r.fullName.toLowerCase(),
  placed: (r) => r.ordersPlaced,
  confirmed: (r) => r.confirmed,
  delivered: (r) => r.delivered,
  cancelled: (r) => r.cancelled,
  ndr: (r) => r.ndr,
  rto: (r) => r.rto,
  retail: (r) => Number(r.retailSoldInr),
  margin: (r) => Number(r.storeMarginInr),
  confirmationRate: (r) => r.confirmationRate,
  deliveryRate: (r) => r.deliveryRate,
  returnRate: (r) => r.returnRate,
  // Why a number is low is often the useful column, not the number.
  blocked: (r) => r.unpricedProducts + r.outOfRangePrices,
};

/**
 * ASSOC-1 — which associate is performing how much, and what to do
 * about it.
 *
 * NUMBERS AND MONEY both: how many orders each placed and how they
 * ended, beside the retail they sold and what it left this store. And
 * RS-9's rule on every rate and on the margin — divided only by what is
 * KNOWN, with the denominator printed under the figure, because a
 * delivery rate computed over parcels still moving reads as a fact and
 * is not one, and a margin that silently skipped the lines with no cost
 * behind them reads as better than it is (TRE-6: a missing cost is
 * UNCOVERED, never zero).
 *
 * The switch that stops somebody placing orders is on each ROW. The
 * whole point of this screen is "decide what to do about this person",
 * and sending somebody to another page to act on what they have just
 * read is how a feature goes unused.
 */
export default function AssociateAnalysisPage(): ReactElement {
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const analysis = useAssociateAnalysis(window);
  // Null means "as the server ranked them" — best-selling first, which
  // is the order the screen exists to be read in. A click sorts.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<SortDirection>('desc');

  const rows: readonly AssociateAnalysisRow[] = useMemo(() => {
    const all = analysis.data?.rows ?? [];
    if (sortKey === null) return all;
    const read = SORTS[sortKey];
    if (read === undefined) return all;
    const sign = direction === 'asc' ? 1 : -1;
    return [...all].sort((a, b) => {
      const x = read(a);
      const y = read(b);
      // An unknown figure sorts LAST whichever way the column points:
      // somebody we know nothing about must never read as the best or
      // the worst performer.
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === 'string' || typeof y === 'string') {
        return sign * String(x).localeCompare(String(y));
      }
      return sign * (x - y);
    });
  }, [analysis.data, sortKey, direction]);

  function sortBy(key: string): void {
    if (key === sortKey) setDirection(direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      // A name reads A→Z; a figure reads biggest first, which is the
      // question somebody opens this screen with.
      setDirection(key === 'name' ? 'asc' : 'desc');
    }
  }

  const totals = rows.reduce(
    (t, r) => ({
      placed: t.placed + r.ordersPlaced,
      delivered: t.delivered + r.delivered,
      retail: t.retail + Number(r.retailSoldInr),
      margin: t.margin + Number(r.storeMarginInr),
      lines: t.lines + r.marginCoverage.lines,
      priced: t.priced + r.marginCoverage.linesWithTransferPrice,
    }),
    { placed: 0, delivered: 0, retail: 0, margin: 0, lines: 0, priced: 0 },
  );
  const uncovered = totals.lines - totals.priced;

  const header = (
    <PageHeader
      title="How your associates are doing"
      subtitle="Orders each of them placed in this window, how those orders ended, what they sold and what it left you."
      action={
        <Link href="/associates" className={buttonClassName('secondary', 'md')}>
          <span className="sk-btn__fx" aria-hidden />
          <span className="sk-btn__icon" aria-hidden>
            <ArrowLeft size={15} />
          </span>
          <span className="sk-btn__label">All associates</span>
        </Link>
      }
    />
  );

  return (
    <div className="as-page">
      {header}
      <div className="as-filters">
        <DateField id="from" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <DateField id="to" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {analysis.isPending && <SkeletonRows rows={5} cols={6} label="Loading the analysis" />}
      {analysis.isError && (
        <ErrorState message={serverVerdict(analysis.error)} retry={() => void analysis.refetch()} />
      )}

      {analysis.data !== undefined && (
        <>
          <AsSection>
            <SectionHeading
              title="Everybody together"
              note={
                // The orders nobody on the roster placed are STATED, not
                // dropped: without them these figures quietly fall short
                // of the store's own order list and nothing says why.
                analysis.data.ordersNotByAnAssociate === 0
                  ? 'Every order of yours in this window was placed by an associate.'
                  : `Plus ${analysis.data.ordersNotByAnAssociate} order${analysis.data.ordersNotByAnAssociate === 1 ? '' : 's'} nobody on this list placed — your own, a CSV upload, or an API key. They are not on any row below.`
              }
            />
            <div className="as-kpis">
              <KpiCard
                label="Orders placed"
                icon={<ShoppingBag size={14} />}
                value={totals.placed}
                format={(n) => `${n}`}
              />
              <KpiCard
                label="Delivered"
                icon={<PackageCheck size={14} />}
                value={totals.delivered}
                format={(n) => `${n}`}
              />
              <KpiCard
                label="Retail sold"
                icon={<Coins size={14} />}
                figure={<Money amount={totals.retail} />}
              />
              <KpiCard
                label="Your margin"
                icon={<Coins size={14} />}
                figure={<Money amount={totals.margin} />}
                hint={
                  uncovered === 0
                    ? 'Retail − what you pay your seller, on every delivered line, before your share of Skydrop’s fees'
                    : `Retail − what you pay your seller, before your share of Skydrop’s fees. ${uncovered} of ${totals.lines} delivered lines have no cost recorded and are LEFT OUT, so the real figure is higher.`
                }
              />
            </div>
          </AsSection>

          <AsSection>
            <SectionHeading
              title="Associate by associate"
              note="Best-selling first until you sort. A rate counts only the orders whose outcome is known; the figure under it says how many that was."
            />
            {rows.length === 0 ? (
              <EmptyState
                icon={<Users size={22} />}
                title="No orders from any associate in this window"
                description="Widen the dates, or invite somebody and set their prices."
                action={
                  <Link href="/associates" className={buttonClassName('secondary', 'md')}>
                    <span className="sk-btn__fx" aria-hidden />
                    <span className="sk-btn__label">Go to associates</span>
                  </Link>
                }
              />
            ) : (
              <Table caption="Each associate’s orders and money">
                <THead>
                  <Tr>
                    <SortableTh
                      label="Person"
                      columnKey="name"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <Th>Can place orders</Th>
                    <SortableTh
                      label="Priced for"
                      columnKey="blocked"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Placed"
                      columnKey="placed"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Confirmed"
                      columnKey="confirmed"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Delivered"
                      columnKey="delivered"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Called off"
                      columnKey="cancelled"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Failed delivery"
                      columnKey="ndr"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Came back"
                      columnKey="rto"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Retail sold"
                      columnKey="retail"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Your margin"
                      columnKey="margin"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Confirmation"
                      columnKey="confirmationRate"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Delivery"
                      columnKey="deliveryRate"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                    <SortableTh
                      label="Returns"
                      columnKey="returnRate"
                      align="right"
                      activeKey={sortKey}
                      direction={direction}
                      onSort={sortBy}
                    />
                  </Tr>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <Tr key={r.storeUserId}>
                      <Td>
                        <AssociatePerson fullName={r.fullName} email={r.email} />
                      </Td>
                      <Td>
                        <AssociatePauseSwitch associate={r} />
                      </Td>
                      <Td>
                        {/* Beside the performance, because an unpriced
                            product or a price the seller's range has
                            moved out from under is usually WHY a number
                            below is low — and it is fixable from the
                            link on the roster. */}
                        <AssociateCoverage
                          priced={r.pricedProducts}
                          missing={r.unpricedProducts}
                          sellable={analysis.data.sellableProducts}
                          outOfRange={r.outOfRangePrices}
                        />
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.ordersPlaced}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.confirmed}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.delivered}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.cancelled}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.ndr}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {r.rto}
                      </Td>
                      <Td align="right">
                        <Money amount={r.retailSoldInr} />
                      </Td>
                      <Td align="right">
                        <Money amount={r.storeMarginInr} />
                        <span className="as-coverage">
                          {r.marginCoverage.lines === 0
                            ? 'nothing delivered yet'
                            : r.marginCoverage.linesWithTransferPrice === r.marginCoverage.lines
                              ? `all ${r.marginCoverage.lines} lines priced`
                              : `${r.marginCoverage.lines - r.marginCoverage.linesWithTransferPrice} of ${r.marginCoverage.lines} lines left out`}
                        </span>
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(r.confirmationRate)}
                        <span className="as-coverage">
                          {r.decidedCount === 0
                            ? 'none decided yet'
                            : `of ${r.decidedCount} decided`}
                        </span>
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(r.deliveryRate)}
                        <span className="as-coverage">
                          {r.outcomeKnownCount === 0
                            ? 'none finished yet'
                            : `of ${r.outcomeKnownCount} finished`}
                        </span>
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(r.returnRate)}
                        <span className="as-coverage">
                          {r.outcomeKnownCount === 0
                            ? 'none finished yet'
                            : `of ${r.outcomeKnownCount} finished`}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </AsSection>
        </>
      )}
    </div>
  );
}
