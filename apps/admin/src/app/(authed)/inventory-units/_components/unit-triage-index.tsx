'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Ident, Num } from '@skydrop/ui/components';
import { Clock, TriangleAlert, Users } from 'lucide-react';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { statusLabel, stockUnitStatusKind } from '@skydrop/ui/status';
import { useSellerUnitReport, useUnitTriage, type StuckUnitRow } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AreaPage,
  AreaSection,
  Callout,
  InlineError,
  KpiGrid,
  Note,
  Stack,
  ToneText,
} from '../../inventory/_components/stock-kit';
import { UnitTracePanel } from './unit-trace-panel';
import './units.css';
import { useT, useLocale } from '@/i18n/client';

/**
 * Serialized-unit discrepancies, from the warehouse's side.
 *
 * The seller version of this screen answers "what is wrong with MY
 * stock". An operator has a different question — *whose* stock needs
 * looking at — so this leads with a cross-seller queue and drills in.
 *
 * The drill-down renders the same report the seller sees, computed by
 * the same code. That matters during a support call: the operator and
 * the seller are looking at one number, not two that might disagree.
 *
 * Read-only throughout. Where the unit ledger and the aggregate
 * disagree, the discrepancy is surfaced and never auto-corrected — a
 * silent reconcile would destroy the evidence of what happened on the
 * floor. Fixing one is a stock adjustment through the normal path, with
 * its reason code and its audit row.
 */
export function UnitTriageIndex(): ReactElement {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const triage = useUnitTriage();
  const data = triage.data;

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[
          { label: t('inventoryUnitsUnitTriageIndex.inventory') },
          { label: t('inventoryUnitsUnitTriageIndex.serialUnits') },
        ]}
        title={t('inventoryUnitsUnitTriageIndex.unitDiscrepancies')}
        subtitle={t('inventoryUnitsUnitTriageIndex.forSkusTrackedPerUnit')}
      />

      {triage.isError ? (
        <InlineError message={serverVerdict(triage.error)} retry={() => void triage.refetch()} />
      ) : triage.isLoading ? (
        <KpiGrid>
          <Skeleton height={96} rounded="md" />
          <Skeleton height={96} rounded="md" />
          <Skeleton height={96} rounded="md" />
        </KpiGrid>
      ) : (
        <>
          <KpiGrid>
            <KpiCard
              label={t('inventoryUnitsUnitTriageIndex.needsAttention')}
              icon={<TriangleAlert size={14} />}
              value={data?.totalNeedsAttention ?? 0}
              tone={(data?.totalNeedsAttention ?? 0) > 0 ? 'pending' : 'credit'}
              hint={t('inventoryUnitsUnitTriageIndex.acrossEveryClientHoldingSerialized')}
            />
            <KpiCard
              label={t('inventoryUnitsUnitTriageIndex.clientsAffected')}
              icon={<Users size={14} />}
              value={data?.sellers.filter((s) => s.needsAttention > 0).length ?? 0}
              hint={t('inventoryUnitsUnitTriageIndex.ofSwept', { value: data?.examined ?? 0 })}
            />
            <KpiCard
              label={t('inventoryUnitsUnitTriageIndex.reportGenerated')}
              icon={<Clock size={14} />}
              figure={data === undefined ? '—' : new Date(data.generatedAt).toLocaleTimeString()}
              hint={t('inventoryUnitsUnitTriageIndex.recomputedOnLoad')}
            />
          </KpiGrid>

          {data?.truncated === true && (
            <InlineError
              message={t('inventoryUnitsUnitTriageIndex.onlyTheFirstClientsWere', {
                examined: data.examined,
              })}
            />
          )}

          {(data?.sellers.length ?? 0) === 0 ? (
            <EmptyState
              tone="positive"
              title={t('inventoryUnitsUnitTriageIndex.noSerializedStockAnywhere')}
              description={t('inventoryUnitsUnitTriageIndex.nothingToReconcileNoClient')}
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('inventoryUnitsUnitTriageIndex.client')}</Th>
                  <Th align="right">{t('inventoryUnitsUnitTriageIndex.stuck')}</Th>
                  <Th align="right">{t('inventoryUnitsUnitTriageIndex.unresolvedDispatch')}</Th>
                  <Th align="right">{t('inventoryUnitsUnitTriageIndex.countMismatch')}</Th>
                  <Th align="right">{t('inventoryUnitsUnitTriageIndex.total')}</Th>
                  <Th>{t('inventoryUnitsUnitTriageIndex.theirThresholds')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data?.sellers.map((s) => (
                  <Tr
                    key={s.sellerId}
                    selected={selected === s.sellerId}
                    onActivate={() => setSelected(selected === s.sellerId ? null : s.sellerId)}
                  >
                    <Td>
                      <span className="unit-seller">
                        {s.companyName ?? t('inventoryUnitsUnitTriageIndex.unknownClient')}
                      </span>
                      <span className="stk-sub">
                        <Link
                          href={`/sellers/${s.sellerId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="stk-link"
                        >
                          <Ident value={`${s.sellerId.slice(0, 8)}…`} />
                        </Link>
                      </span>
                    </Td>
                    <Td align="right" className="sk-figure">
                      <Num value={s.stuckUnits} />
                    </Td>
                    <Td align="right" className="sk-figure">
                      {s.unresolvedDispatched > 0 ? (
                        <ToneText tone="bad">
                          <Num value={s.unresolvedDispatched} />
                        </ToneText>
                      ) : (
                        <Num value={0} />
                      )}
                    </Td>
                    <Td align="right" className="sk-figure">
                      {s.countMismatches > 0 ? (
                        <ToneText tone="bad">
                          <Num value={s.countMismatches} />
                        </ToneText>
                      ) : (
                        <Num value={0} />
                      )}
                    </Td>
                    <Td align="right" className="sk-figure">
                      {s.needsAttention === 0 ? (
                        <StatusChip size="sm" kind="delivered" label="clear" />
                      ) : (
                        <strong className="stk-num">
                          <Num value={s.needsAttention} />
                        </strong>
                      )}
                    </Td>
                    <Td className="stk-faint stk-nowrap">
                      {t('inventoryUnitsUnitTriageIndex.stuckHDispatchD', {
                        stuckSlaHours: s.thresholds.stuckSlaHours,
                        dispatchedUnresolvedDays: s.thresholds.dispatchedUnresolvedDays,
                      })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          {selected !== null && <SellerDetail sellerId={selected} />}

          <Callout tone="info">
            <p className="unit-note">
              Thresholds are per client and overridable, so &ldquo;stuck&rdquo; means past{' '}
              <em>that</em> client&apos;s SLA. Retired units — written off or lost — are
              deliberately excluded from the totals: they are settled facts rather than work, and
              counting them would mean the queue never reaches zero.
            </p>
          </Callout>
        </>
      )}
    </AreaPage>
  );
}

function SellerDetail({ sellerId }: { readonly sellerId: string }): ReactElement {
  const t = useT();
  const report = useSellerUnitReport(sellerId);
  const d = report.data;

  return (
    <AreaSection
      title={t('inventoryUnitsUnitTriageIndex.detail')}
      note={t('inventoryUnitsUnitTriageIndex.exactlyWhatThisClientSees')}
    >
      {report.isError ? (
        <InlineError message={serverVerdict(report.error)} retry={() => void report.refetch()} />
      ) : report.isLoading ? (
        <Skeleton height={96} rounded="md" />
      ) : (
        <Stack>
          <UnitTable
            title={t('inventoryUnitsUnitTriageIndex.stuckMidLifecycle')}
            rows={d?.stuckUnits ?? []}
            empty={t('inventoryUnitsUnitTriageIndex.everyUnitThatStartedA')}
          />
          <UnitTable
            title={t('inventoryUnitsUnitTriageIndex.unresolvedDispatches')}
            rows={d?.unresolvedDispatched ?? []}
            empty={t('inventoryUnitsUnitTriageIndex.everyDispatchedUnitHasBeen')}
          />
          {(d?.countMismatches.length ?? 0) > 0 && (
            <div>
              <h4 className="unit-group-title">
                {t('inventoryUnitsUnitTriageIndex.countMismatches')}
              </h4>
              <Table>
                <THead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>{t('inventoryUnitsUnitTriageIndex.warehouse')}</Th>
                    <Th align="right">{t('inventoryUnitsUnitTriageIndex.serials')}</Th>
                    <Th align="right">{t('inventoryUnitsUnitTriageIndex.onHand')}</Th>
                    <Th align="right">{t('inventoryUnitsUnitTriageIndex.difference')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {d?.countMismatches.map((m) => (
                    <Tr key={`${m.variantId}-${m.warehouseId}`}>
                      <Td>
                        <Ident value={m.skuCode ?? m.variantId.slice(0, 8)} />
                      </Td>
                      <Td className="stk-muted">
                        <Ident value={m.warehouseId.slice(0, 8)} />
                      </Td>
                      <Td align="right" className="sk-figure">
                        <Num value={m.unitsInStock} />
                      </Td>
                      <Td align="right" className="sk-figure">
                        <Num value={m.qtyOnHand} />
                      </Td>
                      <Td align="right" className="sk-figure">
                        <ToneText tone="bad">
                          <Num value={m.delta > 0 ? `+${m.delta}` : m.delta} />
                        </ToneText>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Stack>
      )}
    </AreaSection>
  );
}

function UnitTable({
  title,
  rows,
  empty,
}: {
  readonly title: string;
  readonly rows: readonly StuckUnitRow[];
  readonly empty: string;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  return (
    <div className="stk-stack stk-stack--tight">
      <h4 className="unit-group-title">{title}</h4>
      {rows.length === 0 ? (
        <Note tone="faint">{empty}</Note>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t('inventoryUnitsUnitTriageIndex.serial')}</Th>
              <Th>SKU</Th>
              <Th>{t('inventoryUnitsUnitTriageIndex.status')}</Th>
              <Th align="right">{t('inventoryUnitsUnitTriageIndex.inStatus')}</Th>
              <Th>{t('inventoryUnitsUnitTriageIndex.lastScan')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((u) => (
              <Tr key={u.stockUnitId}>
                <Td>
                  <Ident value={u.serialBarcode} />
                </Td>
                <Td className="stk-muted">
                  {u.skuCode ?? <Ident value={u.variantId.slice(0, 8)} />}
                </Td>
                <Td>
                  <StatusChip
                    size="sm"
                    kind={stockUnitStatusKind(u.status)}
                    label={statusLabel(u.status, locale)}
                  />
                </Td>
                <Td align="right" className="sk-figure">
                  {u.hoursInStatus >= 48 ? (
                    <ToneText tone="warn">
                      <Num value={Math.round(u.hoursInStatus / 24)} suffix="d" />
                    </ToneText>
                  ) : (
                    <Num value={Math.round(u.hoursInStatus)} suffix="h" />
                  )}
                </Td>
                <Td className="stk-muted stk-nowrap">
                  {u.lastScanAt === null ? (
                    <StatusChip
                      size="sm"
                      kind="failed"
                      label={t('inventoryUnitsUnitTriageIndex.neverScanned')}
                    />
                  ) : (
                    new Date(u.lastScanAt).toLocaleString()
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {/* The other question: not "which units look wrong" but "what is
          this one in my hand". */}
      <UnitTracePanel />
    </div>
  );
}
