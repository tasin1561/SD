'use client';

import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import {
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { usePnl, usePnlLineItems, type PnlBasisPartView } from '@/lib/ops-hooks';
import { istDay, istDayRange } from '@/lib/ist-day';

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

  // IST days, inclusive of the closing day (see ist-day.ts). The SAME
  // range feeds the line totals and their drilldown, so the rows under a
  // total are always the rows that made it.
  const params = useMemo(() => istDayRange(from, to), [from, to]);
  const pnl = usePnl(params);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profit & loss"
        subtitle="What each part of the business earns, against what it costs — and how much of that we can actually see."
      />

      <Card>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
            <FormField label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
          </div>
        </CardBody>
      </Card>

      {pnl.isLoading ? (
        <LoadingState />
      ) : pnl.isError || pnl.data === undefined ? (
        <ErrorState
          message={pnl.error?.message ?? 'Could not build the report.'}
          retry={() => void pnl.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="Gross margin"
              tone={Number(pnl.data.grossMarginInr) >= 0 ? 'good' : 'bad'}
              value={<Money amount={pnl.data.grossMarginInr} currency="INR" convert={false} />}
              hint="The four sources, before what it costs to exist"
            />
            <Stat
              label="Operating expenses"
              value={
                <Money amount={pnl.data.operatingExpensesInr} currency="INR" convert={false} />
              }
              hint="Rent, salaries, software — everything booked as an expense"
            />
            <Stat
              label="Net"
              tone={Number(pnl.data.netInr) >= 0 ? 'good' : 'bad'}
              value={<Money amount={pnl.data.netInr} currency="INR" convert={false} />}
              hint={pnl.data.complete ? 'Fully measured' : 'Partly estimated — see coverage'}
            />
          </div>

          {pnl.data.unattributedLegCosts !== null && (
            <Card>
              <CardBody>
                {/* Different from the coverage warning above: that one
                    says a cost is MISSING. This says a cost is recorded
                    but filed where the leg it belongs to cannot see it,
                    so that leg reads better than it is. */}
                <div className="flex gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <p>
                    <strong>
                      <Money
                        amount={pnl.data.unattributedLegCosts.amountInr}
                        currency="INR"
                        convert={false}
                      />
                    </strong>{' '}
                    of leg costs across {pnl.data.unattributedLegCosts.count}{' '}
                    {pnl.data.unattributedLegCosts.count === 1 ? 'entry' : 'entries'} sit in
                    operating expenses with nothing to attribute them to.{' '}
                    {pnl.data.unattributedLegCosts.note}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          {(pnl.data.warnings ?? []).length > 0 && (
            <Card>
              <CardBody>
                <div className="flex gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <ul className="space-y-1">
                    {(pnl.data.warnings ?? []).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </CardBody>
            </Card>
          )}

          {!pnl.data.complete && (
            <Card>
              <CardBody>
                <div className="flex gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <p>
                    Some cost is not recorded yet, so the margins below read higher than they are.
                    What is missing is named on each line — nothing here is guessed to fill the gap.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          <Section title="By source">
            <Table>
              <THead>
                <Tr>
                  <Th>Source</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">%</Th>
                  <Th>Measured</Th>
                </Tr>
              </THead>
              <TBody>
                {pnl.data.lines.map((l) => {
                  const full = l.coverage.priced === l.coverage.total;
                  const open = expanded === l.key;
                  return (
                    <Fragment key={l.key}>
                      <Tr>
                        <Td>
                          <button
                            type="button"
                            className="hover:text-text-bright flex items-center gap-1.5 text-left font-medium"
                            onClick={() => setExpanded(open ? null : l.key)}
                            aria-expanded={open}
                          >
                            <ChevronRight
                              className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                              aria-hidden
                            />
                            {l.label}
                          </button>
                          {l.coverage.note !== null && (
                            <div className="text-xs text-muted mt-0.5">{l.coverage.note}</div>
                          )}
                        </Td>
                        <Td align="right">
                          <Money amount={l.revenueInr} currency="INR" convert={false} />
                        </Td>
                        <Td align="right">
                          <Money amount={l.costInr} currency="INR" convert={false} />
                        </Td>
                        <Td align="right">
                          <Money amount={l.marginInr} currency="INR" convert={false} />
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {l.marginPercent === null ? '—' : `${l.marginPercent}%`}
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1 text-xs tabular-nums">
                            {full ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
                            )}
                            {l.coverage.priced}/{l.coverage.total}
                          </span>
                        </Td>
                      </Tr>
                      {open && (
                        <Tr>
                          {/* The arithmetic, so the figure above can be
                            re-run by hand. A total nobody can split is
                            a total nobody can check. */}
                          <Td colSpan={6} className="bg-surface-raised">
                            <div className="grid gap-4 py-1 sm:grid-cols-2">
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
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </Section>
        </>
      )}
    </div>
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
      <div className="text-text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
        {heading}
      </div>
      {parts.length === 0 ? (
        <p className="text-text-faint text-xs">{emptyText ?? 'Nothing in this window.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {parts.map((p) => (
            <li key={p.source} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="text-text-body">{p.label}</div>
                <div className="text-text-faint font-mono break-all">{p.source}</div>
              </div>
              <div className="shrink-0 text-right">
                <Money amount={p.amountInr} currency="INR" convert={false} />
                <div className="text-text-faint tabular-nums">
                  {p.count} {p.count === 1 ? 'row' : 'rows'}
                </div>
              </div>
            </li>
          ))}
          {/* Restated so the parts can be seen to add up. If they do not,
              that is the bug this whole panel exists to expose. */}
          {parts.length > 1 && (
            <li className="border-border flex items-center justify-between gap-3 border-t pt-1.5 text-xs font-medium">
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

  if (q.isLoading) return <p className="text-text-muted py-2 text-xs">Loading rows…</p>;
  if (q.isError || q.data === undefined) {
    return <p className="text-danger py-2 text-xs">Could not load the rows behind this line.</p>;
  }
  if (q.data.items.length === 0) {
    return <p className="text-text-faint py-2 text-xs">Nothing in this window.</p>;
  }

  return (
    <div className="border-border mt-3 border-t pt-3">
      <div className="text-text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
        Every row ({q.data.items.length})
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-text-faint sticky top-0 bg-[var(--color-surface-raised)] text-left">
            <tr>
              <th className="py-1 pr-2 font-medium">Reference</th>
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 text-right font-medium">Revenue</th>
              <th className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((it, i) => (
              <tr key={`${it.ref}-${i}`} className="border-border/60 border-t">
                <td className="py-1 pr-2">
                  <span className="font-mono">{it.ref}</span>
                  {it.subRef !== null && <div className="text-text-faint">{it.subRef}</div>}
                </td>
                <td className="text-text-muted py-1 pr-2 whitespace-nowrap">
                  {new Date(it.at).toLocaleDateString('en-IN')}
                </td>
                <td className="py-1 pr-2 text-right">
                  {it.revenueInr === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Money amount={it.revenueInr} currency="INR" convert={false} />
                  )}
                </td>
                <td className="py-1 text-right">
                  {it.costInr === null ? (
                    // NOT a zero. "Nobody recorded it" and "it cost
                    // nothing" are opposite facts.
                    <span className="text-warning">not recorded</span>
                  ) : (
                    <Money amount={it.costInr} currency="INR" convert={false} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data.truncated && (
        <p className="text-warning mt-2 text-xs">
          Only the first {q.data.items.length} rows are shown, so these will not add up to the total
          above. Narrow the date range to see the rest.
        </p>
      )}
    </div>
  );
}
