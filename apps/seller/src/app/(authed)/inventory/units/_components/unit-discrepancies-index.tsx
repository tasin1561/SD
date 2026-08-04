'use client';

import type { ReactElement } from 'react';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  Num,
  PageHeader,
  Section,
  Skeleton,
  Stat,
  StatusBadge,
  StockUnitStatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useUnitDiscrepancies, type StuckUnitRow } from '@/lib/ops-hooks';

/**
 * Serialized-unit discrepancies (strict-mode SKUs only).
 *
 * Four different failures, deliberately kept apart rather than merged
 * into one "problems" count, because each needs a different response:
 * a stuck unit means a scan was skipped on the floor; an unresolved
 * dispatch means a parcel neither arrived nor came back; a retired unit
 * is a loss to chase; a count mismatch means the unit ledger and the
 * stock figure disagree.
 *
 * The mismatch list is surfaced, never auto-corrected — quietly
 * reconciling the two would destroy the only evidence of what went
 * wrong.
 */
export function UnitDiscrepanciesIndex(): ReactElement {
  const report = useUnitDiscrepancies();
  const data = report.data;

  const totalIssues =
    (data?.stuckUnits.length ?? 0) +
    (data?.unresolvedDispatched.length ?? 0) +
    (data?.countMismatches.length ?? 0);

  return (
    <div>
      <PageHeader
        title="Unit discrepancies"
        subtitle="For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count."
      />

      {report.isError ? (
        <ErrorNote
          message={report.error?.message ?? 'Could not load the report.'}
          retry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Needs attention"
              value={totalIssues}
              tone={totalIssues > 0 ? 'warn' : 'good'}
              hint={totalIssues === 0 ? 'Everything reconciles' : 'Across the three lists below'}
            />
            <Stat
              label="Stuck mid-lifecycle"
              value={data?.stuckUnits.length ?? 0}
              tone={(data?.stuckUnits.length ?? 0) > 0 ? 'warn' : 'neutral'}
              hint={`Picked or packed for over ${data?.thresholds.stuckSlaHours ?? 0}h`}
            />
            <Stat
              label="Unresolved dispatches"
              value={data?.unresolvedDispatched.length ?? 0}
              tone={(data?.unresolvedDispatched.length ?? 0) > 0 ? 'bad' : 'neutral'}
              hint={`Out for over ${data?.thresholds.dispatchedUnresolvedDays ?? 0} days, never delivered or returned`}
            />
            <Stat
              label="Count mismatches"
              value={data?.countMismatches.length ?? 0}
              tone={(data?.countMismatches.length ?? 0) > 0 ? 'bad' : 'neutral'}
              hint="Serials disagree with the stock figure"
            />
          </div>

          <Section
            title="Stuck mid-lifecycle"
            subtitle="A unit was picked or packed and then never scanned again. Usually a skipped scan on the floor rather than a lost item."
          >
            <UnitTable
              rows={data?.stuckUnits ?? []}
              emptyTitle="Nothing stuck"
              emptyDescription="Every serialized unit that started a pick has been scanned through to the next stage."
            />
          </Section>

          <Section
            title="Unresolved dispatches"
            subtitle="Dispatched long ago, with no delivery confirmed and no return received. Each of these is a parcel to chase with the courier."
          >
            <UnitTable
              rows={data?.unresolvedDispatched ?? []}
              emptyTitle="Nothing unaccounted for"
              emptyDescription="Every dispatched unit has either been delivered or come back."
            />
          </Section>

          <Section
            title="Count mismatches"
            subtitle="The serial ledger and the stock figure disagree. This is reported, never auto-corrected — silently reconciling the two would erase the evidence of how it happened."
          >
            {(data?.countMismatches.length ?? 0) === 0 ? (
              <EmptyState
                title="Serials and stock agree"
                description="For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand."
              />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>Warehouse</Th>
                    <Th align="right">Serials in stock</Th>
                    <Th align="right">Recorded on hand</Th>
                    <Th align="right">Difference</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data?.countMismatches.map((m) => (
                    <Tr key={`${m.variantId}-${m.warehouseId}`}>
                      <Td>
                        <Ident value={m.skuCode ?? `${m.variantId.slice(0, 8)}…`} />
                      </Td>
                      <Td className="text-text-muted text-xs">
                        <Ident value={`${m.warehouseId.slice(0, 8)}…`} />
                      </Td>
                      <Td align="right">
                        <Num value={m.unitsInStock} />
                      </Td>
                      <Td align="right">
                        <Num value={m.qtyOnHand} />
                      </Td>
                      <Td align="right">
                        <span
                          className={
                            m.delta === 0 ? 'text-text-faint' : 'text-[var(--color-critical)]'
                          }
                        >
                          <Num value={m.delta > 0 ? `+${m.delta}` : m.delta} />
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>

          <Section
            title="Retired units"
            subtitle="Written off or recorded as lost. Kept visible so a loss stays countable rather than just disappearing from stock."
          >
            <UnitTable
              rows={data?.retiredUnits ?? []}
              emptyTitle="No units written off or lost"
              emptyDescription="Nothing has been retired from the serial ledger."
            />
          </Section>

          <Card>
            <CardBody>
              <p className="text-text-faint text-xs leading-relaxed">
                Report generated{' '}
                {data === undefined ? '—' : new Date(data.generatedAt).toLocaleString()}. Only SKUs
                you have set to strict per-unit tracking appear here.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function UnitTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  readonly rows: readonly StuckUnitRow[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}): ReactElement {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Serial</Th>
          <Th>SKU</Th>
          <Th>Status</Th>
          <Th align="right">Time in status</Th>
          <Th>Last scan</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((u) => (
          <Tr key={u.stockUnitId}>
            <Td>
              <Ident value={u.serialBarcode} />
            </Td>
            <Td className="text-text-muted text-xs">
              {u.skuCode ?? <Ident value={`${u.variantId.slice(0, 8)}…`} />}
            </Td>
            <Td>
              <StockUnitStatusBadge status={u.status} />
            </Td>
            <Td align="right">
              {u.hoursInStatus >= 48 ? (
                <span className="text-[var(--status-pending-fg)]">
                  <Num value={Math.round(u.hoursInStatus / 24)} suffix="d" />
                </span>
              ) : (
                <Num value={Math.round(u.hoursInStatus)} suffix="h" />
              )}
            </Td>
            <Td className="text-text-muted whitespace-nowrap text-xs">
              {u.lastScanAt === null ? (
                <StatusBadge kind="failed" label="Never scanned" />
              ) : (
                new Date(u.lastScanAt).toLocaleString()
              )}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
