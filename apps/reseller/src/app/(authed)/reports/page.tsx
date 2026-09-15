'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
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
import { istDateLabel, monthLabel } from '@/lib/ist-day';
import {
  useStorePnlMonth,
  useStorePnlMonths,
  useStorePosition,
  type StoreCarryView,
  type StorePnlLine,
} from '@/lib/report-hooks';

/**
 * The store's profit and loss by month (RS-8). A month is FROZEN once it
 * closes and never changes; anything that moves later is carried into the
 * month open at the time and shown there, with its reason. Money comes from
 * the store's own wallet ledger and expense book — never recomputed here.
 */
export default function StoreReportsPage(): ReactElement {
  const months = useStorePnlMonths();
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? months.data?.[0]?.month ?? null;
  const view = useStorePnlMonth(month);
  const position = useStorePosition();

  const header = (
    <PageHeader
      title="Reports"
      subtitle="Your profit and loss by month, and where your wallet stands. A closed month never changes; later changes are carried into the month then open."
      action={
        <Link href="/reports/analysis" className="text-sm underline">
          Analysis
        </Link>
      }
    />
  );

  if (months.isPending) {
    return (
      <>
        {header}
        <LoadingState rows={6} />
      </>
    );
  }
  if (months.isError) {
    return (
      <>
        {header}
        <ErrorState message={months.error.message} retry={() => void months.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      {position.data !== undefined && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Wallet balance"
            value={<Money amount={position.data.balanceInr} size="lg" />}
          />
          <Stat
            label="You are owed"
            tone="good"
            value={<Money amount={position.data.owedToStoreInr} size="lg" />}
          />
          <Stat
            label="You owe your seller"
            tone={position.data.owedByStoreInr === '0.00' ? 'neutral' : 'warn'}
            value={<Money amount={position.data.owedByStoreInr} size="lg" />}
          />
          <Stat
            label="Withdrawals waiting"
            value={<Money amount={position.data.pendingWithdrawals.amountInr} size="lg" />}
            hint={`${position.data.pendingWithdrawals.count} request(s)`}
          />
        </div>
      )}

      <Section title="Month">
        <Select aria-label="Month" value={month ?? ''} onChange={(e) => setPicked(e.target.value)}>
          {(months.data ?? []).map((m) => (
            <option key={m.month} value={m.month}>
              {monthLabel(m.month)} — {m.status === 'closed' ? 'closed' : 'open'}
            </option>
          ))}
        </Select>
      </Section>

      {view.isPending && month !== null && <LoadingState rows={6} />}
      {view.isError && (
        <ErrorState message={view.error.message} retry={() => void view.refetch()} />
      )}
      {view.data !== undefined && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                view.data.carriedInNetInr === '0.00'
                  ? view.data.status === 'closed'
                    ? `Closed ${view.data.closedAt === null ? '' : istDateLabel(view.data.closedAt)}`
                    : 'This month is still open'
                  : `Includes ₹${view.data.carriedInNetInr} carried in from earlier months`
              }
            />
          </div>

          <Section
            title="Profit and loss"
            subtitle="Open a line to see every entry behind it. The entries add up to the line."
          >
            {view.data.report.lines.map((l) => (
              <PnlLine key={l.key} line={l} />
            ))}
          </Section>

          <Section
            title="Money in and out"
            subtitle="Top-ups and withdrawals move cash; they are not profit or loss."
          >
            <p className="text-sm">
              In: <Money amount={view.data.report.cash.inInr} direction="credit" /> · Out:{' '}
              <Money amount={view.data.report.cash.outInr} direction="debit" />
            </p>
          </Section>

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
          {view.data.report.warnings.map((w) => (
            <p key={w} className="text-sm text-warn">
              {w}
            </p>
          ))}
        </>
      )}
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
            <p className="text-sm">Nothing this month.</p>
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
                {line.rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{istDateLabel(r.at)}</Td>
                    <Td>{r.ref}</Td>
                    <Td>
                      {r.subRef}
                      {r.context !== undefined && (
                        <span className="text-text-muted block text-xs">
                          Sold for ₹{r.context.retailInr} · transfer ₹{r.context.transferInr}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={r.amountInr} />
                    </Td>
                  </Tr>
                ))}
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
