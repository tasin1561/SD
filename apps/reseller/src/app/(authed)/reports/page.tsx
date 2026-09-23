'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Clock,
  Gauge,
  HandCoins,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { storeWalletDirectionLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { buttonClassName } from '@skydrop/ui/app/button';
import { Accordion, AccordionItem } from '@skydrop/ui/app/accordion';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { istDateLabel, istDayRange, lastDays, monthLabel } from '@/lib/ist-day';
import {
  useStorePnl,
  useStorePnlMonth,
  useStorePnlMonths,
  useStorePosition,
  type StoreCarryView,
  type StorePnlLine,
  type StorePnlReport,
} from '@/lib/report-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RmCallout, RmSection } from '../wallet/_components/rm-parts';

/** The month select's value for "pick your own dates". */
const CUSTOM = 'custom';

/** An order number names an order the store can open (search pre-fills /orders). */
function orderLink(ref: string): string | null {
  return /^SD-/.test(ref) ? `/orders?search=${encodeURIComponent(ref)}` : null;
}

/**
 * The store's profit and loss by month (RS-8), or over any dates. A month
 * is FROZEN once it closes and never changes; anything that moves later is
 * carried into the month open at the time and shown there, with its
 * reason. A custom range is computed live and is never frozen. Money comes
 * from the store's own wallet ledger and expense book — never recomputed
 * here.
 */
export default function StoreReportsPage(): ReactElement {
  const months = useStorePnlMonths();
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? months.data?.[0]?.month ?? null;
  const custom = month === CUSTOM;
  const view = useStorePnlMonth(custom ? null : month);
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const range = useStorePnl(window, custom);

  return (
    <div className="rm-page">
      <PageHeader
        title="Reports"
        subtitle="Your profit and loss by month, and where your wallet stands. A closed month never changes; later changes are carried into the month then open."
        action={
          <Link href="/reports/analysis" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__label">Analysis</span>
            <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
              <ArrowRight size={15} />
            </span>
          </Link>
        }
      />

      <PositionTiles />

      {months.isPending ? (
        <SkeletonRows rows={6} cols={4} label="Loading your months" />
      ) : months.isError ? (
        <ErrorState message={serverVerdict(months.error)} retry={() => void months.refetch()} />
      ) : (
        <>
          <RmSection>
            <SectionHeading title="Period" />
            <div className="rm-filters rm-filters--wide">
              <Select
                id="pnl-month"
                label="Month"
                value={month ?? ''}
                onChange={(e) => setPicked(e.target.value)}
              >
                {months.data.map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthLabel(m.month)} — {m.status === 'closed' ? 'closed' : 'open'}
                  </option>
                ))}
                <option value={CUSTOM}>Custom range</option>
              </Select>
              {custom ? (
                <>
                  <DateField
                    id="pnl-from"
                    label="From"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <DateField
                    id="pnl-to"
                    label="To"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </>
              ) : null}
            </div>
            {custom ? (
              <p className="rm-muted rm-faint">
                Indian days, the last day included. A custom range is worked out now from your
                ledger — it is not a frozen month, so it moves if something changes later.
              </p>
            ) : null}
          </RmSection>

          {custom ? (
            range.isPending ? (
              <SkeletonRows rows={6} cols={4} label="Working out the range" />
            ) : range.isError ? (
              <ErrorState message={serverVerdict(range.error)} retry={() => void range.refetch()} />
            ) : (
              <>
                <div className="rm-kpis rm-kpis--3">
                  <KpiCard
                    label="Revenue"
                    icon={<TrendingUp size={14} />}
                    figure={<Money amount={range.data.revenueInr} size="lg" />}
                  />
                  <KpiCard
                    label="Costs"
                    icon={<TrendingDown size={14} />}
                    figure={<Money amount={range.data.costInr} size="lg" />}
                  />
                  <KpiCard
                    label="Net"
                    icon={<Scale size={14} />}
                    tone={range.data.netInr.startsWith('-') ? 'debit' : 'credit'}
                    figure={<Money amount={range.data.netInr} size="lg" />}
                  />
                </div>
                <ReportBody report={range.data} />
              </>
            )
          ) : month === null ? (
            <EmptyState
              icon={<CalendarClock size={22} />}
              title="No months yet"
              description="Your profit and loss starts with your first order or expense."
            />
          ) : view.isPending ? (
            <SkeletonRows rows={6} cols={4} label="Loading the month" />
          ) : view.isError ? (
            <ErrorState message={serverVerdict(view.error)} retry={() => void view.refetch()} />
          ) : (
            <>
              <div className="rm-kpis rm-kpis--3">
                <KpiCard
                  label="Revenue"
                  icon={<TrendingUp size={14} />}
                  figure={<Money amount={view.data.report.revenueInr} size="lg" />}
                />
                <KpiCard
                  label="Costs"
                  icon={<TrendingDown size={14} />}
                  figure={<Money amount={view.data.report.costInr} size="lg" />}
                />
                <KpiCard
                  label={view.data.status === 'closed' ? 'Net (as reported)' : 'Net so far'}
                  icon={<Scale size={14} />}
                  tone={view.data.asReportedNetInr.startsWith('-') ? 'debit' : 'credit'}
                  figure={<Money amount={view.data.asReportedNetInr} size="lg" />}
                  hint={
                    view.data.carriedInNetInr === '0.00' ? (
                      view.data.status === 'closed' ? (
                        `Closed ${view.data.closedAt === null ? '' : istDateLabel(view.data.closedAt)}`
                      ) : (
                        'This month is still open'
                      )
                    ) : (
                      <>
                        Includes <Money amount={view.data.carriedInNetInr} /> carried in from
                        earlier months
                      </>
                    )
                  }
                />
              </div>
              <ReportBody report={view.data.report} />
              <CarryTable
                title="Carried into this month"
                subtitle="Changes to earlier, closed months, found while this month was open."
                rows={view.data.carriedIn}
              />
              <CarryTable
                title="Carried out of this month"
                subtitle="Changes to this month found after it closed — counted in the month named."
                rows={view.data.carriedOut}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Where the wallet stands now — independent of the period chosen below. */
function PositionTiles(): ReactElement {
  const position = useStorePosition();
  if (position.isPending) {
    return (
      <div
        className="rm-kpis"
        role="status"
        aria-busy="true"
        aria-label="Loading where your wallet stands"
      >
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
      </div>
    );
  }
  if (position.isError) {
    return (
      <ErrorState message={serverVerdict(position.error)} retry={() => void position.refetch()} />
    );
  }
  const p = position.data;
  return (
    <div className="rm-kpis">
      <KpiCard
        label="Wallet balance"
        icon={<Wallet size={14} />}
        figure={<Money amount={p.balanceInr} size="lg" />}
      />
      <KpiCard
        label="You are owed"
        icon={<ArrowDownLeft size={14} />}
        tone="credit"
        figure={<Money amount={p.owedToStoreInr} size="lg" />}
      />
      <KpiCard
        label="You owe your seller"
        icon={<ArrowUpRight size={14} />}
        tone={p.owedByStoreInr === '0.00' ? 'neutral' : 'pending'}
        figure={<Money amount={p.owedByStoreInr} size="lg" />}
      />
      {p.withdrawableInr !== null ? (
        <KpiCard
          label="You can withdraw"
          icon={<HandCoins size={14} />}
          figure={<Money amount={p.withdrawableInr} size="lg" />}
          hint="Your balance, less withdrawals already asked for."
        />
      ) : null}
      <KpiCard
        label="Withdrawals waiting"
        icon={<Clock size={14} />}
        figure={<Money amount={p.pendingWithdrawals.amountInr} size="lg" />}
        hint={`${p.pendingWithdrawals.count} request${p.pendingWithdrawals.count === 1 ? '' : 's'}`}
      />
      <KpiCard
        label="Top-ups waiting"
        icon={<Landmark size={14} />}
        figure={<Money amount={p.pendingTopups.amountInr} size="lg" />}
        hint={`${p.pendingTopups.count} claim${p.pendingTopups.count === 1 ? '' : 's'} not yet seen by Skydrop`}
      />
      <KpiCard
        label="May go below zero by"
        icon={<Gauge size={14} />}
        figure={<Money amount={p.negativeLimit.effectiveInr} size="lg" />}
        hint="Set by your seller."
      />
    </div>
  );
}

/** The lines, expenses by category and cash movements of one report. */
function ReportBody({ report }: { report: StorePnlReport }): ReactElement {
  const me = useStoreIdentity();
  const sellerName = me?.seller.companyName ?? 'Your seller';
  return (
    <>
      <RmSection>
        <SectionHeading
          title="Profit and loss"
          note="Open a line to see every entry behind it. The entries add up to the line."
        />
        <Accordion type="multiple">
          {report.lines.map((l) => (
            <PnlLine key={l.key} line={l} />
          ))}
        </Accordion>
      </RmSection>

      {report.expensesByCategory.length > 0 ? (
        <RmSection>
          <SectionHeading title="Expenses by category" note="From your own expense book." />
          <Table caption="Expenses by category">
            <THead>
              <Tr>
                <Th>Category</Th>
                <Th align="right">Spent</Th>
              </Tr>
            </THead>
            <TBody>
              {report.expensesByCategory.map((c) => (
                <Tr key={c.category}>
                  <Td>{c.label}</Td>
                  <Td align="right">
                    <Money amount={c.amountInr} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </RmSection>
      ) : null}

      <RmSection>
        <SectionHeading
          title="Money in and out"
          note="Top-ups and withdrawals move cash; they are not profit or loss."
        />
        <p className="rm-cash">
          <span className="rm-cash__fact">
            <ArrowDownLeft size={14} aria-hidden />
            In: <Money amount={report.cash.inInr} direction="credit" />
          </span>
          <span className="rm-cash__fact">
            <ArrowUpRight size={14} aria-hidden />
            Out: <Money amount={report.cash.outInr} direction="debit" />
          </span>
        </p>
        {report.cash.byDirection.length > 0 ? (
          <Table caption="Money in and out">
            <THead>
              <Tr>
                <Th>What</Th>
                <Th align="right">Times</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </THead>
            <TBody>
              {report.cash.byDirection.map((d) => (
                <Tr key={d.direction}>
                  <Td>{storeWalletDirectionLabel(d.direction, sellerName)}</Td>
                  <Td align="right" className="sk-figure">
                    {d.count}
                  </Td>
                  <Td align="right">
                    <Money amount={d.amountInr} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </RmSection>

      {report.warnings.map((w) => (
        <RmCallout key={w} tone="warn" icon={<TriangleAlert size={16} />}>
          <p>{w}</p>
        </RmCallout>
      ))}
    </>
  );
}

function PnlLine({ line }: { line: StorePnlLine }): ReactElement {
  const revenue = line.side === 'revenue';
  return (
    <AccordionItem
      value={line.key}
      icon={revenue ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      title={
        <>
          {line.label} <span className="rm-count">({line.count})</span>
        </>
      }
      meta={<Money amount={line.amountInr} direction={revenue ? 'credit' : 'debit'} />}
    >
      <div className="rm-stack">
        <p className="rm-muted rm-faint">{line.note}</p>
        {line.rows.length === 0 ? (
          <p className="rm-muted">Nothing in this period.</p>
        ) : (
          <Table caption={line.label}>
            <THead>
              <Tr>
                <Th>Date</Th>
                <Th>Order / item</Th>
                <Th>What</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </THead>
            <TBody>
              {line.rows.map((r) => {
                const href = orderLink(r.ref);
                return (
                  <Tr key={r.id}>
                    <Td className="rm-when sk-figure">{istDateLabel(r.at)}</Td>
                    <Td>
                      {href === null ? (
                        r.ref
                      ) : (
                        <Link href={href} className="rm-ref sk-ident">
                          {r.ref}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      {r.subRef}
                      {r.context !== undefined && (
                        <span className="rm-faint rm-block">
                          Sold for <Money amount={r.context.retailInr} /> · transfer{' '}
                          <Money amount={r.context.transferInr} />
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={r.amountInr} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </AccordionItem>
  );
}

function CarryTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: readonly StoreCarryView[];
}): ReactElement {
  return (
    <RmSection>
      <SectionHeading title={title} note={subtitle} />
      {rows.length === 0 ? (
        <EmptyState bare title="Nothing carried" description="No change has been found." />
      ) : (
        <Table caption={title}>
          <THead>
            <Tr>
              <Th>Month</Th>
              <Th>Line</Th>
              <Th>Why</Th>
              <Th align="right">Effect on net</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td>
                  {monthLabel(c.originMonth)} → {monthLabel(c.landedMonth)}
                </Td>
                <Td>{c.lineLabel}</Td>
                <Td>{c.reason}</Td>
                <Td align="right">
                  <Money amount={c.netEffectInr} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </RmSection>
  );
}
