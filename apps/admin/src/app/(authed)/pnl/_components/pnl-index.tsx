'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, LineChart } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Accordion, AccordionItem } from '@skydrop/ui/app/accordion';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { DateField } from '@skydrop/ui/app/date-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { usePnl, usePnlLineItems, type PnlBasisPartView } from '@/lib/ops-hooks';
import { istDateLabel, istDay, istDayRange } from '@/lib/ist-day';
import { LinkButton, MoCard, Notice } from '../../treasury/_components/money-parts';
import './pnl.css';

/**
 * Where the money is actually made.
 *
 * Four sources kept apart rather than netted into one number, because
 * they have different fixes: a delivery lane losing money is repriced, a
 * forwarder bill that has grown is renegotiated, an FX spread going the
 * wrong way is a treasury decision. A single "profit" figure tells you
 * the business is down without telling you which of those to go and
 * look at.
 *
 * Every line states how much of its COST side is measured. A margin
 * computed over the third of parcels we happen to have priced is not
 * the business's margin, and showing it without that caveat is how a
 * loss-making lane stays invisible for a quarter.
 */
export function PnlIndex(): ReactElement {
  const [from, setFrom] = useState(() => istDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => istDay(new Date()));
  // One line open at a time. Four expanded at once is a wall of numbers
  // that reads worse than the summary it was meant to explain.
  const [expanded, setExpanded] = useState<string | null>(null);

  // IST days, the closing day included: `to` is the NEXT IST midnight and
  // the API counts [from, to) (see ist-day.ts). The SAME range feeds the
  // line totals and their drilldown, so the rows under a total are always
  // the rows that made it.
  const params = useMemo(() => istDayRange(from, to), [from, to]);
  const pnl = usePnl(params);

  return (
    <div className="mo-page">
      <PageHeader
        title="Profit & loss"
        subtitle="What each part of the business earns, against what it costs — and how much of that we can actually see."
        action={
          // The same figures frozen month by month — for a month that must
          // not move after it has been reported (PNL-CF-1).
          <LinkButton href="/pnl/carry-forward" variant="ghost" size="sm">
            Carry-forward P&amp;L
          </LinkButton>
        }
      />

      <MoCard>
        <div className="pl-dates">
          <DateField label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <DateField label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </MoCard>

      {pnl.isLoading ? (
        <div className="mo-stack">
          <div className="mo-kpis">
            <Skeleton height={112} rounded="md" />
            <Skeleton height={112} rounded="md" />
            <Skeleton height={112} rounded="md" />
          </div>
          <SkeletonRows rows={5} cols={6} label="Loading the report" />
        </div>
      ) : pnl.isError || pnl.data === undefined ? (
        <ErrorState
          message={pnl.error?.message ?? 'Could not build the report.'}
          retry={() => void pnl.refetch()}
        />
      ) : (
        <>
          <div className="mo-kpis">
            <KpiCard
              label="Gross margin"
              tone={Number(pnl.data.grossMarginInr) >= 0 ? 'credit' : 'debit'}
              figure={<Money amount={pnl.data.grossMarginInr} currency="INR" convert={false} />}
              hint="The four sources, before what it costs to exist"
            />
            <KpiCard
              label="Operating expenses"
              figure={
                <Money amount={pnl.data.operatingExpensesInr} currency="INR" convert={false} />
              }
              hint="Rent, salaries, software — everything booked as an expense"
            />
            <KpiCard
              label="Net"
              tone={Number(pnl.data.netInr) >= 0 ? 'credit' : 'debit'}
              figure={<Money amount={pnl.data.netInr} currency="INR" convert={false} />}
              hint={pnl.data.complete ? 'Fully measured' : 'Partly estimated — see coverage'}
            />
          </div>

          {pnl.data.unattributedLegCosts !== null && (
            // Different from the coverage warning above: that one says a
            // cost is MISSING. This says a cost is recorded but filed where
            // the leg it belongs to cannot see it, so that leg reads better
            // than it is.
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <p>
                <strong>
                  <Money
                    amount={pnl.data.unattributedLegCosts.amountInr}
                    currency="INR"
                    convert={false}
                  />
                </strong>{' '}
                of leg costs across {pnl.data.unattributedLegCosts.count}{' '}
                {pnl.data.unattributedLegCosts.count === 1 ? 'entry' : 'entries'} sit in operating
                expenses with nothing to attribute them to. {pnl.data.unattributedLegCosts.note}
              </p>
            </Notice>
          )}

          {(pnl.data.warnings ?? []).length > 0 && (
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <ul className="mo-list">
                {(pnl.data.warnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}

          {!pnl.data.complete && (
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <p>
                Some cost is not recorded yet, so the margins below read higher than they are. What
                is missing is named on each line — nothing here is guessed to fill the gap.
              </p>
            </Notice>
          )}

          <section className="mo-section">
            <SectionHeading
              title="By source"
              note="Open a line to see what it is made of and every record behind it."
            />
            <Accordion value={expanded} onValueChange={setExpanded}>
              {pnl.data.lines.map((l) => {
                const full = l.coverage.priced === l.coverage.total;
                const open = expanded === l.key;
                return (
                  <AccordionItem
                    key={l.key}
                    value={l.key}
                    icon={<LineChart size={16} />}
                    title={
                      <span className="pl-line">
                        <span>
                          <span className="pl-line__label">{l.label}</span>
                          {l.coverage.note !== null && (
                            <span className="pl-line__note">{l.coverage.note}</span>
                          )}
                        </span>
                        <span className="pl-figs">
                          <Fig label="Revenue">
                            <Money amount={l.revenueInr} currency="INR" convert={false} />
                          </Fig>
                          <Fig label="Cost">
                            <Money amount={l.costInr} currency="INR" convert={false} />
                          </Fig>
                          <Fig label="Margin">
                            <Money amount={l.marginInr} currency="INR" convert={false} />
                          </Fig>
                          <Fig label="%">
                            <span className="sk-figure">
                              {l.marginPercent === null ? '—' : `${l.marginPercent}%`}
                            </span>
                          </Fig>
                        </span>
                      </span>
                    }
                    meta={
                      <span
                        className="pl-cover sk-figure"
                        data-full={full ? '1' : '0'}
                        title="Measured: records whose cost is recorded"
                      >
                        {full ? (
                          <CheckCircle2 size={13} aria-hidden />
                        ) : (
                          <AlertTriangle size={13} aria-hidden />
                        )}
                        {l.coverage.priced}/{l.coverage.total}
                      </span>
                    }
                  >
                    {/* The arithmetic, so the figure above can be re-run by
                        hand. A total nobody can split is a total nobody can
                        check. Mounted only while open, so the rows behind a
                        line are fetched when it is opened, as before. */}
                    {open && (
                      <div className="pl-drill">
                        <div className="pl-basis">
                          <BasisColumn
                            heading="Revenue is made of"
                            parts={l.basis.revenue}
                            totalInr={l.revenueInr}
                          />
                          <BasisColumn
                            heading="Cost is made of"
                            parts={l.basis.cost}
                            totalInr={l.costInr}
                            emptyText="Nothing — this line has no cost side."
                          />
                        </div>
                        <LineItems lineKey={l.key} from={params.from} to={params.to} />
                      </div>
                    )}
                  </AccordionItem>
                );
              })}
            </Accordion>
          </section>
        </>
      )}
    </div>
  );
}

/** One labelled figure in a line's header. The value is the caller's own node. */
function Fig({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <span className="pl-fig">
      <span className="pl-fig__label">{label}</span>
      <span className="pl-fig__value">{children}</span>
    </span>
  );
}

/**
 * What one side of a line is made of.
 *
 * Each part names the TABLE AND COLUMN it came from, not just a figure.
 * "₹4,005 revenue" cannot be checked against anything; "the sum of
 * inbound_freight_charges.total_inr over 2 bills" can be re-run and
 * compared. The two cost columns on a shipment — forward and RTO — are
 * exactly the pair somebody would otherwise sum wrongly, which is why
 * the filter is spelled out too.
 */
function BasisColumn({
  heading,
  parts,
  totalInr,
  emptyText,
}: {
  readonly heading: string;
  readonly parts: readonly PnlBasisPartView[];
  readonly totalInr: string;
  readonly emptyText?: string;
}): ReactElement {
  return (
    <div>
      <p className="pl-basis__head">{heading}</p>
      {parts.length === 0 ? (
        <p className="mo-faint">{emptyText ?? 'Nothing in this window.'}</p>
      ) : (
        <ul className="pl-basis__list">
          {parts.map((p) => (
            <li key={p.source} className="pl-basis__item">
              <div>
                <div className="mo-body">{p.label}</div>
                <span className="pl-basis__src sk-ident">{p.source}</span>
              </div>
              <div className="pl-basis__amt">
                <Money amount={p.amountInr} currency="INR" convert={false} />
                <div className="mo-faint sk-figure">
                  {p.count} {p.count === 1 ? 'row' : 'rows'}
                </div>
              </div>
            </li>
          ))}
          {/* Restated so the parts can be seen to add up. If they do not,
              that is the bug this whole panel exists to expose. */}
          {parts.length > 1 && (
            <li className="pl-basis__item pl-basis__total">
              <span>Total</span>
              <Money amount={totalInr} currency="INR" convert={false} />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Every record behind one line, listed.
 *
 * The terms above make the figure re-runnable as a query; this makes it
 * checkable against what a person is actually holding. Finding the
 * parcel that looks wrong means seeing the parcels.
 *
 * A missing cost shows as "not recorded", never as ₹0.00 — the two mean
 * opposite things, and only one of them leaves somebody with work to do.
 */
function LineItems({
  lineKey,
  from,
  to,
}: {
  readonly lineKey: string;
  readonly from: string;
  readonly to: string;
}): ReactElement {
  const q = usePnlLineItems(lineKey, from, to);

  if (q.isLoading) return <SkeletonRows rows={3} cols={4} label="Loading rows…" />;
  if (q.isError || q.data === undefined) {
    return (
      <p className="pl-state" data-tone="bad" role="alert">
        Could not load the rows behind this line.
      </p>
    );
  }
  if (q.data.items.length === 0) {
    return <p className="pl-state">Nothing in this window.</p>;
  }

  return (
    <div className="pl-rows">
      <p className="pl-rows__head">Every row ({q.data.items.length})</p>
      <Table maxHeight="20rem">
        <THead>
          <Tr>
            <Th>Reference</Th>
            <Th>Date</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Cost</Th>
          </Tr>
        </THead>
        <TBody>
          {q.data.items.map((it, i) => (
            <Tr key={`${it.ref}-${i}`}>
              <Td>
                <span className="sk-ident">{it.ref}</span>
                {it.subRef !== null && <div className="mo-faint">{it.subRef}</div>}
              </Td>
              <Td className="mo-nowrap">
                {/* The IST day, as the window is — not the browser's. */}
                {istDateLabel(it.at)}
              </Td>
              <Td align="right">
                {it.revenueInr === null ? (
                  <span className="mo-faint">—</span>
                ) : (
                  <Money amount={it.revenueInr} currency="INR" convert={false} />
                )}
              </Td>
              <Td align="right">
                {it.costInr === null ? (
                  // NOT a zero. "Nobody recorded it" and "it cost
                  // nothing" are opposite facts.
                  <span className="mo-warn">not recorded</span>
                ) : (
                  <Money amount={it.costInr} currency="INR" convert={false} />
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {q.data.truncated && (
        <p className="pl-state" data-tone="warn">
          Only the first {q.data.items.length} rows are shown, so these will not add up to the total
          above. Narrow the date range to see the rest.
        </p>
      )}
    </div>
  );
}
