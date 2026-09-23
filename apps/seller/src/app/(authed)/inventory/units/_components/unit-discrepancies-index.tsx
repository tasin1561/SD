'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowLeft, ScanLine, Scale, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { Ident, Num } from '@skydrop/ui/components';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import {
  AreaPage,
  AreaSection,
  BackLink,
  KpiGrid,
  MetaFact,
  MetaFacts,
  Panel,
  PanelPad,
  StockUnitStatusBadge,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
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
  const totalIssues = stuck + unresolved + mismatches;

  return (
    <AreaPage>
      <BackLink href="/inventory">
        <ArrowLeft size={14} />
        Inventory
      </BackLink>

      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Stock' },
          { label: 'Inventory', href: '/inventory' },
          { label: 'Unit discrepancies' },
        ]}
        Link={Link}
        title="Unit discrepancies"
        subtitle="For SKUs tracked per unit by serial. Where a scan is missing, a parcel is unaccounted for, or the serials disagree with the stock count."
        meta={
          data === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone={totalIssues > 0 ? 'warn' : 'good'} dot>
                {totalIssues === 0 ? 'Everything reconciles' : `${totalIssues} to look at`}
              </MetaFact>
              <MetaFact>
                <GlossaryTerm
                  title="Strict mode"
                  icon={<ShieldCheck size={16} />}
                  description="A SKU on strict mode carries a serial on every physical unit, and the warehouse scans it at receiving, pick and pack. Only those SKUs appear on this page. We set it, not you."
                >
                  Strict-mode SKUs only
                </GlossaryTerm>
              </MetaFact>
              <MetaFact>Read {new Date(data.generatedAt).toLocaleString('en-IN')}</MetaFact>
            </MetaFacts>
          )
        }
      />

      {report.isError ? (
        <ErrorState
          message={report.error?.message ?? 'Could not load the report.'}
          retry={() => void report.refetch()}
        />
      ) : report.isLoading ? (
        <KpiGrid>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={96} rounded="md" />
          ))}
        </KpiGrid>
      ) : (
        <>
          <KpiGrid>
            <KpiCard
              label="Needs attention"
              icon={<TriangleAlert size={14} />}
              value={totalIssues}
              format={rawCount}
              {...(totalIssues === 0 ? {} : { unit: 'units' })}
              tone={totalIssues > 0 ? 'pending' : 'credit'}
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
            <KpiCard
              label="Stuck mid-lifecycle"
              icon={<ScanLine size={14} />}
              value={stuck}
              format={rawCount}
              {...(stuck === 0 ? {} : { unit: 'units' })}
              tone={stuck > 0 ? 'pending' : 'neutral'}
              hint={`Picked or packed for over ${data?.thresholds.stuckSlaHours ?? 0}h.`}
            />
            <KpiCard
              label="Unresolved dispatches"
              icon={<Trash2 size={14} />}
              value={unresolved}
              format={rawCount}
              {...(unresolved === 0 ? {} : { unit: 'units' })}
              tone={unresolved > 0 ? 'debit' : 'neutral'}
              hint={`Out for over ${data?.thresholds.dispatchedUnresolvedDays ?? 0} days, never delivered or returned.`}
            />
            <KpiCard
              label="Count mismatches"
              icon={<Scale size={14} />}
              value={mismatches}
              format={rawCount}
              {...(mismatches === 0 ? {} : { unit: 'SKUs' })}
              tone={mismatches > 0 ? 'debit' : 'neutral'}
              hint="Serials disagree with the stock figure."
            />
          </KpiGrid>

          <AreaSection
            title="Stuck mid-lifecycle"
            note="Usually a skipped scan on the floor rather than a lost item."
          >
            <Panel flush>
              <UnitTable
                rows={data?.stuckUnits ?? []}
                emptyTitle="Nothing stuck"
                emptyDescription="Every serialized unit that started a pick has been scanned through to the next stage."
              />
            </Panel>
          </AreaSection>

          <AreaSection
            title="Unresolved dispatches"
            note="Each of these is a parcel to chase with the courier."
          >
            <Panel flush>
              <UnitTable
                rows={data?.unresolvedDispatched ?? []}
                emptyTitle="Nothing unaccounted for"
                emptyDescription="Every dispatched unit has either been delivered or come back."
              />
            </Panel>
          </AreaSection>

          <AreaSection
            title="Count mismatches"
            note="Reported, never auto-corrected — that would erase the evidence."
          >
            <Panel flush>
              {mismatches === 0 ? (
                <PanelPad>
                  <EmptyState
                    tone="positive"
                    title="Serials and stock agree"
                    description="For every strict-mode SKU, the number of in-stock serials matches the recorded quantity on hand."
                    bare
                  />
                </PanelPad>
              ) : (
                <Table caption="Count mismatches">
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
                        <Td>
                          <span className="inv-muted">
                            <Ident value={`${m.warehouseId.slice(0, 8)}…`} />
                          </span>
                        </Td>
                        <Td align="right">
                          <Num value={m.unitsInStock} />
                        </Td>
                        <Td align="right">
                          <Num value={m.qtyOnHand} />
                        </Td>
                        <Td align="right">
                          <span className="inv-num" data-tone={m.delta === 0 ? 'faint' : 'bad'}>
                            <Num value={m.delta > 0 ? `+${m.delta}` : m.delta} />
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>
          </AreaSection>

          <AreaSection
            title="Retired units"
            note="Kept visible so a loss stays countable rather than just disappearing."
          >
            <Panel flush>
              <UnitTable
                rows={data?.retiredUnits ?? []}
                emptyTitle="No units written off or lost"
                emptyDescription="Nothing has been retired from the serial ledger."
              />
            </Panel>
          </AreaSection>
        </>
      )}

      {/* The other question: not "what looks wrong" but "what is
          this one item". */}
      <UnitTracePanel />
    </AreaPage>
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
    return (
      <PanelPad>
        <EmptyState tone="positive" title={emptyTitle} description={emptyDescription} bare />
      </PanelPad>
    );
  }
  return (
    <Table caption={emptyTitle}>
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
            <Td>
              <span className="inv-muted">
                {u.skuCode ?? <Ident value={`${u.variantId.slice(0, 8)}…`} />}
              </span>
            </Td>
            <Td>
              <StockUnitStatusBadge status={u.status} />
            </Td>
            <Td align="right">
              {u.hoursInStatus >= 48 ? (
                <span className="inv-num" data-tone="warn">
                  <Num value={Math.round(u.hoursInStatus / 24)} suffix="d" />
                </span>
              ) : (
                <Num value={Math.round(u.hoursInStatus)} suffix="h" />
              )}
            </Td>
            <Td>
              {u.lastScanAt === null ? (
                <StatusChip kind="failed" label="Never scanned" size="sm" />
              ) : (
                <span className="sk-figure inv-muted" style={{ whiteSpace: 'nowrap' }}>
                  {new Date(u.lastScanAt).toLocaleString('en-IN')}
                </span>
              )}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
