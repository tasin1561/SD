'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
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
import { usePnl } from '@/lib/ops-hooks';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => isoDay(new Date()));

  const params = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00.000Z`).toISOString(),
      // Inclusive of the closing day — a window ending "today" that
      // stopped at midnight would silently omit today's trading.
      to: new Date(`${to}T23:59:59.999Z`).toISOString(),
    }),
    [from, to],
  );
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
                  return (
                    <Tr key={l.key}>
                      <Td>
                        <div className="font-medium">{l.label}</div>
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
