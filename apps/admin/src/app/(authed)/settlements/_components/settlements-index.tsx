'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Ident, Money, Num } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { Select } from '@skydrop/ui/app/select';
import { useReconciliation, useSettlementsList, type SettlementView } from '@/lib/ops-hooks';
import { RecordSettlementModal } from './record-settlement-modal';
import { AllocateSettlementModal } from './allocate-settlement-modal';
import { usePermission } from '@/lib/use-permission';
import { useRouter } from 'next/navigation';
import { MkCard, MkSection } from '../../seller-wallets/_components/money-parts';
import { useT } from '@/i18n/client';

/**
 * Courier settlements + float reconciliation (R2c).
 *
 * The reconciliation panel comes FIRST and the payout log second,
 * because the question this screen exists to answer is "how much has
 * the courier collected that they have not paid us yet" — the log is
 * the evidence, the float is the alarm.
 *
 * Sellers are credited from our own balance before the courier settles,
 * so an unexplained float is not a reporting curiosity: it is money
 * that has left and not come back.
 */
export function SettlementsIndex(): ReactElement {
  const t = useT();
  const canWrite = usePermission('money.settlements.record');
  const [recording, setRecording] = useState(false);
  const [allocating, setAllocating] = useState<SettlementView | null>(null);
  const [overdueAfterDays, setOverdueAfterDays] = useState(10);

  const recon = useReconciliation(overdueAfterDays);
  const list = useSettlementsList({ limit: 50 });

  const overdue = Number(recon.data?.overdueInr ?? 0);
  const shortPaid = recon.data?.shortPaidOrders ?? [];

  return (
    <div className="mk-page">
      <PageHeader
        title={t('settlementsSettlementsIndex.courierSettlements')}
        subtitle={t('settlementsSettlementsIndex.everyRupeeTheCourierPays')}
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setRecording(true)}
            >
              {t('settlementsSettlementsIndex.recordPayout')}
            </Button>
          ) : null
        }
      />

      {/* ── the alarm ── */}
      <div className="mk-kpis">
        <KpiCard
          label={t('settlementsSettlementsIndex.outstandingFloat')}
          figure={
            recon.isLoading ? (
              '—'
            ) : (
              <Money amount={recon.data?.outstandingFloatInr ?? 0} decimals={false} />
            )
          }
          tone="neutral"
          hint={t('settlementsSettlementsIndex.deliveredCodNoPayoutCovers')}
        />
        <KpiCard
          label={t('settlementsSettlementsIndex.overduePastD', { overdueAfterDays })}
          figure={recon.isLoading ? '—' : <Money amount={overdue} decimals={false} />}
          tone={overdue > 0 ? 'debit' : 'credit'}
          hint={t('settlementsSettlementsIndex.orderPastTheSettlementWindow', {
            value: recon.data?.overdueOrders.length ?? 0,
            value2: (recon.data?.overdueOrders.length ?? 0) === 1 ? '' : t('common.pluralS'),
          })}
        />
        <KpiCard
          label={t('settlementsSettlementsIndex.shortPaidOrders')}
          figure={recon.isLoading ? '—' : shortPaid.length}
          tone={shortPaid.length > 0 ? 'pending' : 'neutral'}
          hint={t('settlementsSettlementsIndex.aPayoutTouchedTheseBut')}
        />
      </div>

      <div className="mk-filters">
        <Select
          id="overdue-days"
          label={t('settlementsSettlementsIndex.treatUnsettledAsOverdueAfter')}
          hint={t('settlementsSettlementsIndex.delhiveryStates510Days')}
          value={overdueAfterDays}
          onChange={(e) => setOverdueAfterDays(Number(e.target.value))}
        >
          {[5, 7, 10, 14, 21, 30].map((d) => (
            <option key={d} value={d}>
              {t('settlementsSettlementsIndex.days', { d })}
            </option>
          ))}
        </Select>
      </div>

      {recon.isError && (
        <ErrorState
          message={
            recon.error?.message ?? t('settlementsSettlementsIndex.couldNotLoadTheReconciliation')
          }
          retry={() => void recon.refetch()}
        />
      )}

      {/* ── overdue orders ── */}
      <MkSection>
        <SectionHeading
          title={t('settlementsSettlementsIndex.overdue')}
          note={t('settlementsSettlementsIndex.deliveredCodCollectedByThe')}
        />
        {recon.isLoading ? (
          <SkeletonRows
            rows={4}
            cols={6}
            label={t('settlementsSettlementsIndex.loadingOverdueOrders')}
          />
        ) : (recon.data?.overdueOrders.length ?? 0) === 0 ? (
          <EmptyState
            tone="positive"
            title={t('settlementsSettlementsIndex.nothingOverdue')}
            description={t('settlementsSettlementsIndex.everyDeliveredCodOrderIs')}
          />
        ) : (
          <UnsettledTable
            caption={t('settlementsSettlementsIndex.overdueOrders')}
            rows={recon.data?.overdueOrders ?? []}
          />
        )}
      </MkSection>

      {/* ── short-paid ── */}
      {shortPaid.length > 0 && (
        <MkSection>
          <SectionHeading
            title={t('settlementsSettlementsIndex.shortPaid')}
            note={t('settlementsSettlementsIndex.aPayoutAllocatedLessThan')}
          />
          <UnsettledTable
            caption={t('settlementsSettlementsIndex.shortPaidOrders')}
            rows={shortPaid}
          />
        </MkSection>
      )}

      {/* ── the payout log ── */}
      <MkSection>
        <SectionHeading
          title={t('settlementsSettlementsIndex.recordedPayouts')}
          note={t('settlementsSettlementsIndex.eachBankCreditAndThe')}
        />
        {list.isError ? (
          <ErrorState
            message={list.error?.message ?? t('settlementsSettlementsIndex.couldNotLoadPayouts')}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={7} label={t('settlementsSettlementsIndex.loadingPayouts')} />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState
            title={t('settlementsSettlementsIndex.noPayoutsRecorded')}
            description={t('settlementsSettlementsIndex.enterTheCourierSPayout')}
            action={
              canWrite ? (
                <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
                  {t('settlementsSettlementsIndex.recordPayout')}
                </Button>
              ) : null
            }
          />
        ) : (
          <MkCard flush>
            <Table caption={t('settlementsSettlementsIndex.recordedPayouts')}>
              <THead>
                <Tr>
                  <Th>{t('settlementsSettlementsIndex.reference')}</Th>
                  <Th>{t('settlementsSettlementsIndex.received')}</Th>
                  <Th align="right">{t('settlementsSettlementsIndex.amount')}</Th>
                  <Th align="right">{t('settlementsSettlementsIndex.allocated')}</Th>
                  <Th align="right">{t('settlementsSettlementsIndex.unallocated')}</Th>
                  <Th align="right">{t('settlementsSettlementsIndex.orders')}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {list.data?.map((s) => {
                  const unallocated = Number(s.unallocatedInr);
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <div className="mk-cell">
                          <Ident value={s.reference} />
                          {s.note !== null && s.note !== '' && (
                            <span className="mk-faint">{s.note}</span>
                          )}
                        </div>
                      </Td>
                      <Td className="mk-when sk-figure">
                        {new Date(s.receivedAt).toLocaleDateString()}
                      </Td>
                      <Td align="right">
                        <Money amount={s.amountInr} />
                      </Td>
                      <Td align="right">
                        <Money amount={s.allocatedInr} />
                      </Td>
                      <Td align="right">
                        {unallocated === 0 ? (
                          <span className="mk-faint">—</span>
                        ) : (
                          <span
                            className="mk-text"
                            data-tone="critical"
                            title={t('settlementsSettlementsIndex.thisPartOfThePayout')}
                          >
                            <Money amount={s.unallocatedInr} />
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <Num value={s.lines.length} />
                      </Td>
                      <Td align="right">
                        {/* Only where there is money left to explain. An
                            always-on action would invite allocating a
                            fully-explained payout, which the server
                            refuses anyway. */}
                        {unallocated !== 0 && canWrite && (
                          <Button variant="ghost" size="sm" onClick={() => setAllocating(s)}>
                            {t('settlementsSettlementsIndex.allocateMore')}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </MkCard>
        )}
      </MkSection>

      <RecordSettlementModal open={recording} onOpenChange={setRecording} />
      {allocating !== null && (
        <AllocateSettlementModal
          settlementId={allocating.id}
          reference={allocating.reference}
          unallocatedInr={allocating.unallocatedInr}
          open
          onOpenChange={(next) => {
            if (!next) setAllocating(null);
          }}
        />
      )}
    </div>
  );
}

function UnsettledTable({
  rows,
  caption,
}: {
  readonly caption: string;
  readonly rows: ReadonlyArray<{
    orderId: string;
    orderNumber: string;
    deliveredAt: string | null;
    ageDays: number;
    expectedInr: string;
    settledInr: string;
    shortfallInr: string;
  }>;
}): ReactElement {
  const t = useT();
  const router = useRouter();
  return (
    <MkCard flush>
      <Table caption={caption}>
        <THead>
          <Tr>
            <Th>{t('settlementsSettlementsIndex.order')}</Th>
            <Th>{t('settlementsSettlementsIndex.delivered')}</Th>
            <Th align="right">{t('settlementsSettlementsIndex.age')}</Th>
            <Th align="right">{t('settlementsSettlementsIndex.expected')}</Th>
            <Th align="right">{t('settlementsSettlementsIndex.settled')}</Th>
            <Th align="right">{t('settlementsSettlementsIndex.shortfall')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.orderId} onActivate={() => router.push(`/orders/${r.orderId}`)}>
              <Td>
                <Link href={`/orders/${r.orderId}`} className="mk-inline-link">
                  <Ident value={r.orderNumber} />
                </Link>
              </Td>
              <Td className="mk-when sk-figure">
                {r.deliveredAt === null ? '—' : new Date(r.deliveredAt).toLocaleDateString()}
              </Td>
              <Td align="right">
                <Num value={r.ageDays} suffix="d" />
              </Td>
              <Td align="right">
                <Money amount={r.expectedInr} />
              </Td>
              <Td align="right">
                <Money amount={r.settledInr} />
              </Td>
              <Td align="right">
                <Money amount={r.shortfallInr} direction="debit" />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </MkCard>
  );
}
