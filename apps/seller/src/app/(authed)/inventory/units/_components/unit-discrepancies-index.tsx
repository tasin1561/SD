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
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';

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
  const t = useT();
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
        {t('inventoryUnits.inventory')}
      </BackLink>

      <PageHeader
        breadcrumbs={[
          { label: t('inventoryUnits.clientConsole') },
          { label: t('inventoryUnits.stock') },
          { label: t('inventoryUnits.inventory'), href: '/inventory' },
          { label: t('inventoryUnits.unitDiscrepancies') },
        ]}
        Link={Link}
        title={t('inventoryUnits.unitDiscrepancies')}
        subtitle={t('inventoryUnits.forSkusTrackedPer')}
        meta={
          data === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone={totalIssues > 0 ? 'warn' : 'good'} dot>
                {totalIssues === 0
                  ? t('inventoryUnits.everythingReconciles')
                  : t('inventoryUnits.toLookAt', { totalIssues })}
              </MetaFact>
              <MetaFact>
                <GlossaryTerm
                  title={t('inventoryUnits.strictMode')}
                  icon={<ShieldCheck size={16} />}
                  description={t('inventoryUnits.aSkuOnStrict')}
                >
                  {t('inventoryUnits.strictModeSkusOnly')}
                </GlossaryTerm>
              </MetaFact>
              <MetaFact>
                {richMessage(t('inventoryUnits.read'), {
                  generatedAt: new Date(data.generatedAt).toLocaleString('en-IN'),
                })}
              </MetaFact>
            </MetaFacts>
          )
        }
      />

      {report.isError ? (
        <ErrorState
          message={report.error?.message ?? t('inventoryUnits.couldNotLoadThe')}
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
              label={t('inventoryUnits.needsAttention')}
              icon={<TriangleAlert size={14} />}
              value={totalIssues}
              format={rawCount}
              {...(totalIssues === 0 ? {} : { unit: 'units' })}
              tone={totalIssues > 0 ? 'pending' : 'credit'}
              hint={totalIssues === 0 ? t('inventoryUnits.everythingReconciles2') : undefined}
              {...(totalIssues > 0
                ? {
                    foot: [
                      { label: t('inventoryUnits.stuckMidLifecycle'), value: stuck },
                      { label: t('inventoryUnits.unresolvedDispatches'), value: unresolved },
                      { label: t('inventoryUnits.countMismatches'), value: mismatches },
                    ],
                  }
                : {})}
            />
            <KpiCard
              label={t('inventoryUnits.stuckMidLifecycle')}
              icon={<ScanLine size={14} />}
              value={stuck}
              format={rawCount}
              {...(stuck === 0 ? {} : { unit: 'units' })}
              tone={stuck > 0 ? 'pending' : 'neutral'}
              hint={t('inventoryUnits.pickedOrPackedFor', {
                stuckSlaHours: data?.thresholds.stuckSlaHours ?? 0,
              })}
            />
            <KpiCard
              label={t('inventoryUnits.unresolvedDispatches')}
              icon={<Trash2 size={14} />}
              value={unresolved}
              format={rawCount}
              {...(unresolved === 0 ? {} : { unit: 'units' })}
              tone={unresolved > 0 ? 'debit' : 'neutral'}
              hint={t('inventoryUnits.outForOverDays', {
                dispatchedUnresolvedDays: data?.thresholds.dispatchedUnresolvedDays ?? 0,
              })}
            />
            <KpiCard
              label={t('inventoryUnits.countMismatches')}
              icon={<Scale size={14} />}
              value={mismatches}
              format={rawCount}
              {...(mismatches === 0 ? {} : { unit: t('inventoryUnits.skus') })}
              tone={mismatches > 0 ? 'debit' : 'neutral'}
              hint={t('inventoryUnits.serialsDisagreeWithThe')}
            />
          </KpiGrid>

          <AreaSection
            title={t('inventoryUnits.stuckMidLifecycle')}
            note={t('inventoryUnits.usuallyASkippedScan')}
          >
            <Panel flush>
              <UnitTable
                rows={data?.stuckUnits ?? []}
                emptyTitle={t('inventoryUnits.nothingStuck')}
                emptyDescription={t('inventoryUnits.everySerializedUnitThat')}
              />
            </Panel>
          </AreaSection>

          <AreaSection
            title={t('inventoryUnits.unresolvedDispatches')}
            note={t('inventoryUnits.eachOfTheseIs')}
          >
            <Panel flush>
              <UnitTable
                rows={data?.unresolvedDispatched ?? []}
                emptyTitle={t('inventoryUnits.nothingUnaccountedFor')}
                emptyDescription={t('inventoryUnits.everyDispatchedUnitHas')}
              />
            </Panel>
          </AreaSection>

          <AreaSection
            title={t('inventoryUnits.countMismatches')}
            note={t('inventoryUnits.reportedNeverAutoCorrected')}
          >
            <Panel flush>
              {mismatches === 0 ? (
                <PanelPad>
                  <EmptyState
                    tone="positive"
                    title={t('inventoryUnits.serialsAndStockAgree')}
                    description={t('inventoryUnits.forEveryStrictMode')}
                    bare
                  />
                </PanelPad>
              ) : (
                <Table caption={t('inventoryUnits.countMismatches')}>
                  <THead>
                    <Tr>
                      <Th>{t('inventoryUnits.sku')}</Th>
                      <Th>{t('inventoryUnits.warehouse')}</Th>
                      <Th align="right">{t('inventoryUnits.serialsInStock')}</Th>
                      <Th align="right">{t('inventoryUnits.recordedOnHand')}</Th>
                      <Th align="right">{t('inventoryUnits.difference')}</Th>
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
            title={t('inventoryUnits.retiredUnits')}
            note={t('inventoryUnits.keptVisibleSoA')}
          >
            <Panel flush>
              <UnitTable
                rows={data?.retiredUnits ?? []}
                emptyTitle={t('inventoryUnits.noUnitsWrittenOff')}
                emptyDescription={t('inventoryUnits.nothingHasBeenRetired')}
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
  const t = useT();
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
          <Th>{t('inventoryUnits.serial')}</Th>
          <Th>{t('inventoryUnits.sku')}</Th>
          <Th>{t('inventoryUnits.status')}</Th>
          <Th align="right">{t('inventoryUnits.timeInStatus')}</Th>
          <Th>{t('inventoryUnits.lastScan')}</Th>
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
                <StatusChip kind="failed" label={t('inventoryUnits.neverScanned')} size="sm" />
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
