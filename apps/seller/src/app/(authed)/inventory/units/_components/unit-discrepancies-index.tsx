'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowLeft, ScanLine, Scale, Trash2, TriangleAlert } from 'lucide-react';
import {
  BandBody,
  Crumbs,
  EmptyState,
  ErrorNote,
  Ident,
  MetaChip,
  Num,
  PageHeader,
  SectionBand,
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
import { UnitTracePanel } from './unit-trace-panel';

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
 *
 * ── RETIRED UNITS ARE NOT "NEEDS ATTENTION" ─────────────────────────
 * The headline figure counts three lists, not four. A written-off unit
 * is a decision somebody already took and recorded; keeping it visible
 * is what stops a loss quietly vanishing from stock, but counting it as
 * an outstanding problem would mean the number never falls to zero and
 * therefore stops meaning anything.
 */
export function UnitDiscrepanciesIndex(): ReactElement {
  const report = useUnitDiscrepancies();
  const data = report.data;

  const stuck = data?.stuckUnits.length ?? 0;
  const unresolved = data?.unresolvedDispatched.length ?? 0;
  const mismatches = data?.countMismatches.length ?? 0;
  const retired = data?.retiredUnits.length ?? 0;
  const totalIssues = stuck + unresolved + mismatches;

  return (
    <div>
      <Link
        href="/inventory"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={13} />
        Inventory
      </Link>

      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Stock' },
              { label: 'Inventory', href: '/inventory' },
              { label: 'Unit discrepancies' },
            ]}
            Link={Link}
          />
        }
        title="Unit discrepancies"
        subtitle="For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count."
        meta={
          data === undefined ? undefined : (
            <>
              <MetaChip tone={totalIssues > 0 ? 'warn' : 'good'} dot>
                {totalIssues === 0 ? 'Everything reconciles' : `${totalIssues} to look at`}
              </MetaChip>
              <MetaChip>Strict-mode SKUs only</MetaChip>
              <MetaChip>Read {new Date(data.generatedAt).toLocaleString('en-IN')}</MetaChip>
            </>
          )
        }
      />

      {report.isError ? (
        <ErrorNote
          message={report.error?.message ?? 'Could not load the report.'}
          retry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Needs attention"
              icon={<TriangleAlert size={13} aria-hidden />}
              value={totalIssues}
              unit={totalIssues === 0 ? undefined : 'units'}
              tone={totalIssues > 0 ? 'warn' : 'good'}
              hint={totalIssues === 0 ? 'Everything reconciles.' : undefined}
              {...(totalIssues > 0
                ? {
                    foot: [
                      { label: 'Stuck mid-lifecycle', value: stuck },
                      { label: 'Unresolved dispatches', value: unresolved },
                      { label: 'Count mismatches', value: mismatches },
                    ],
                  }
                : {})}
            />
            <Stat
              label="Stuck mid-lifecycle"
              icon={<ScanLine size={13} aria-hidden />}
              value={stuck}
              unit={stuck === 0 ? undefined : 'units'}
              tone={stuck > 0 ? 'warn' : 'neutral'}
              hint={`Picked or packed for over ${data?.thresholds.stuckSlaHours ?? 0}h.`}
            />
            <Stat
              label="Unresolved dispatches"
              icon={<Trash2 size={13} aria-hidden />}
              value={unresolved}
              unit={unresolved === 0 ? undefined : 'units'}
              tone={unresolved > 0 ? 'bad' : 'neutral'}
              hint={`Out for over ${data?.thresholds.dispatchedUnresolvedDays ?? 0} days, never delivered or returned.`}
            />
            <Stat
              label="Count mismatches"
              icon={<Scale size={13} aria-hidden />}
              value={mismatches}
              unit={mismatches === 0 ? undefined : 'SKUs'}
              tone={mismatches > 0 ? 'bad' : 'neutral'}
              hint="Serials disagree with the stock figure."
            />
          </div>

          <div className="mb-4">
            <SectionBand
              index="01"
              title="Stuck mid-lifecycle"
              note="Usually a skipped scan on the floor rather than a lost item."
            />
            <BandBody flush={stuck > 0}>
              <UnitTable
                rows={data?.stuckUnits ?? []}
                emptyTitle="Nothing stuck"
                emptyDescription="Every serialized unit that started a pick has been scanned through to the next stage."
              />
            </BandBody>
          </div>

          <div className="mb-4">
            <SectionBand
              index="02"
              title="Unresolved dispatches"
              note="Each of these is a parcel to chase with the courier."
            />
            <BandBody flush={unresolved > 0}>
              <UnitTable
                rows={data?.unresolvedDispatched ?? []}
                emptyTitle="Nothing unaccounted for"
                emptyDescription="Every dispatched unit has either been delivered or come back."
              />
            </BandBody>
          </div>

          <div className="mb-4">
            <SectionBand
              index="03"
              title="Count mismatches"
              note="Reported, never auto-corrected — that would erase the evidence."
            />
            <BandBody flush={mismatches > 0}>
              {mismatches === 0 ? (
                <EmptyState
                  title="Serials and stock agree"
                  description="For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand."
                  bare
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
            </BandBody>
          </div>

          <div className="mb-4">
            <SectionBand
              index="04"
              title="Retired units"
              note="Kept visible so a loss stays countable rather than just disappearing."
            />
            <BandBody flush={retired > 0}>
              <UnitTable
                rows={data?.retiredUnits ?? []}
                emptyTitle="No units written off or lost"
                emptyDescription="Nothing has been retired from the serial ledger."
              />
            </BandBody>
          </div>
        </>
      )}

      {/* The other question: not "what looks wrong" but "what is
          this one item". */}
      <UnitTracePanel />
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
    return <EmptyState title={emptyTitle} description={emptyDescription} bare />;
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
            <Td className="text-text-muted font-mono text-xs whitespace-nowrap">
              {u.lastScanAt === null ? (
                <StatusBadge kind="failed" label="Never scanned" />
              ) : (
                new Date(u.lastScanAt).toLocaleString('en-IN')
              )}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
