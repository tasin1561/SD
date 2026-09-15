'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Select,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { storeWalletDirectionLabel } from '@skydrop/ui/status';
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
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Your profit and loss by month, and where your wallet stands. A closed month never changes; later changes are carried into the month then open."
        action={
          <Link href="/reports/analysis" className="text-sm underline">
            Analysis
          </Link>
        }
      />

      <PositionTiles />

      {months.isPending ? (
        <LoadingState label="Loading your months" rows={6} />
      ) : months.isError ? (
        <ErrorState message={serverVerdict(months.error)} retry={() => void months.refetch()} />
      ) : (
        <>
          <Section title="Period">
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Month" htmlFor="pnl-month">
                <Select
                  id="pnl-month"
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
              </FormField>
              {custom ? (
                <>
                  <FormField label="From" htmlFor="pnl-from">
                    <Input
                      id="pnl-from"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </FormField>
                  <FormField label="To" htmlFor="pnl-to">
                    <Input
                      id="pnl-to"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </FormField>
                </>
              ) : null}
            </div>
            {custom ? (
              <p className="text-text-muted mt-2 text-xs">
                Indian days, the last day included. A custom range is worked out now from your
                ledger — it is not a frozen month, so it moves if something changes later.
              </p>
            ) : null}
          </Section>

          {custom ? (
            range.isPending ? (
              <LoadingState label="Working out the range" rows={6} />
            ) : range.isError ? (
              <ErrorState message={serverVerdict(range.error)} retry={() => void range.refetch()} />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Revenue"
                    value={<Money amount={range.data.revenueInr} size="lg" />}
                  />
                  <Stat label="Costs" value={<Money amount={range.data.costInr} size="lg" />} />
                  <Stat
                    label="Net"
                    tone={range.data.netInr.startsWith('-') ? 'bad' : 'good'}
                    value={<Money amount={range.data.netInr} size="lg" />}
                  />
                </div>
                <ReportBody report={range.data} />
              </>
            )
          ) : month === null ? (
            <EmptyState
              title="No months yet"
              description="Your profit and loss starts with your first order or expense."
            />
          ) : view.isPending ? (
            <LoadingState label="Loading the month" rows={6} />
          ) : view.isError ? (
            <ErrorState message={serverVerdict(view.error)} retry={() => void view.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat
                  label="Revenue"
                  value={<Money amount={view.data.report.revenueInr} size="lg" />}
                />
                <Stat label="Costs" value={<Money amount={view.data.report.costInr} size="lg" />} />
                <Stat
                  label={view.data.status === 'closed' ? 'Net (as reported)' : 'Net so far'}
                  tone={view.data.asReportedNetInr.startsWith('-') ? 'bad' : 'good'}
                  value={<Money amount={view.data.asReportedNetInr} size="lg" />}
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
  if (position.isPending) return <LoadingState label="Loading where your wallet stands" rows={2} />;
  if (position.isError) {
    return (
      <ErrorState message={serverVerdict(position.error)} retry={() => void position.refetch()} />
    );
  }
  const p = position.data;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Wallet balance" value={<Money amount={p.balanceInr} size="lg" />} />
      <Stat
        label="You are owed"
        tone="good"
        value={<Money amount={p.owedToStoreInr} size="lg" />}
      />
      <Stat
        label="You owe your seller"
        tone={p.owedByStoreInr === '0.00' ? 'neutral' : 'warn'}
        value={<Money amount={p.owedByStoreInr} size="lg" />}
      />
      {p.withdrawableInr !== null ? (
        <Stat
          label="You can withdraw"
          value={<Money amount={p.withdrawableInr} size="lg" />}
          hint="Your balance, less withdrawals already asked for."
        />
      ) : null}
      <Stat
        label="Withdrawals waiting"
        value={<Money amount={p.pendingWithdrawals.amountInr} size="lg" />}
        hint={`${p.pendingWithdrawals.count} request${p.pendingWithdrawals.count === 1 ? '' : 's'}`}
      />
      <Stat
        label="Top-ups waiting"
        value={<Money amount={p.pendingTopups.amountInr} size="lg" />}
        hint={`${p.pendingTopups.count} claim${p.pendingTopups.count === 1 ? '' : 's'} not yet seen by Skydrop`}
      />
      <Stat
        label="May go below zero by"
        value={<Money amount={p.negativeLimit.effectiveInr} size="lg" />}
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
      <Section
        title="Profit and loss"
        subtitle="Open a line to see every entry behind it. The entries add up to the line."
      >
        {report.lines.map((l) => (
          <PnlLine key={l.key} line={l} />
        ))}
      </Section>

      {report.expensesByCategory.length > 0 ? (
        <Section title="Expenses by category" subtitle="From your own expense book.">
          <Table>
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
        </Section>
      ) : null}

      <Section
        title="Money in and out"
        subtitle="Top-ups and withdrawals move cash; they are not profit or loss."
      >
        <p className="text-sm">
          In: <Money amount={report.cash.inInr} direction="credit" /> · Out:{' '}
          <Money amount={report.cash.outInr} direction="debit" />
        </p>
        {report.cash.byDirection.length > 0 ? (
          <div className="mt-3">
            <Table>
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
                    <Td align="right">{d.count}</Td>
                    <Td align="right">
                      <Money amount={d.amountInr} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </Section>

      {report.warnings.map((w) => (
        <p key={w} className="text-warning text-sm">
          {w}
        </p>
      ))}
    </>
  );
}

function PnlLine({ line }: { line: StorePnlLine }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-2">
      <CardHeader
        title={
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span>
              {line.label} <span className="text-text-muted text-xs">({line.count})</span>
            </span>
            <Money
              amount={line.amountInr}
              direction={line.side === 'revenue' ? 'credit' : 'debit'}
            />
          </button>
        }
      />
      {open && (
        <CardBody>
          <p className="text-text-muted mb-2 text-xs">{line.note}</p>
          {line.rows.length === 0 ? (
            <p className="text-sm">Nothing in this period.</p>
          ) : (
            <Table>
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
                      <Td>{istDateLabel(r.at)}</Td>
                      <Td>
                        {href === null ? (
                          r.ref
                        ) : (
                          <Link
                            href={href}
                            className="text-accent font-mono text-xs hover:underline"
                          >
                            {r.ref}
                          </Link>
                        )}
                      </Td>
                      <Td>
                        {r.subRef}
                        {r.context !== undefined && (
                          <span className="text-text-muted block text-xs">
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
        </CardBody>
      )}
    </Card>
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
    <Section title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <EmptyState bare title="Nothing carried" description="No change has been found." />
      ) : (
        <Table>
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
    </Section>
  );
}
