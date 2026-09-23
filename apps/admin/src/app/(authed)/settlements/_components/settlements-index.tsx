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
        title="Courier settlements"
        subtitle="Every rupee the courier pays us, matched to the orders it covers. What is not matched is float we are carrying on the sellers' behalf."
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setRecording(true)}
            >
              Record payout
            </Button>
          ) : null
        }
      />

      {/* ── the alarm ── */}
      <div className="mk-kpis">
        <KpiCard
          label="Outstanding float"
          figure={
            recon.isLoading ? (
              '—'
            ) : (
              <Money amount={recon.data?.outstandingFloatInr ?? 0} decimals={false} />
            )
          }
          tone="neutral"
          hint="Delivered COD no payout covers yet"
        />
        <KpiCard
          label={`Overdue past ${overdueAfterDays}d`}
          figure={recon.isLoading ? '—' : <Money amount={overdue} decimals={false} />}
          tone={overdue > 0 ? 'debit' : 'credit'}
          hint={`${recon.data?.overdueOrders.length ?? 0} order${
            (recon.data?.overdueOrders.length ?? 0) === 1 ? '' : 's'
          } past the settlement window`}
        />
        <KpiCard
          label="Short-paid orders"
          figure={recon.isLoading ? '—' : shortPaid.length}
          tone={shortPaid.length > 0 ? 'pending' : 'neutral'}
          hint="A payout touched these but under-paid"
        />
      </div>

      <div className="mk-filters">
        <Select
          id="overdue-days"
          label="Treat unsettled as overdue after"
          hint="Delhivery states 5–10 days; 10 is the top of that window."
          value={overdueAfterDays}
          onChange={(e) => setOverdueAfterDays(Number(e.target.value))}
        >
          {[5, 7, 10, 14, 21, 30].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </Select>
      </div>

      {recon.isError && (
        <ErrorState
          message={recon.error?.message ?? 'Could not load the reconciliation.'}
          retry={() => void recon.refetch()}
        />
      )}

      {/* ── overdue orders ── */}
      <MkSection>
        <SectionHeading
          title="Overdue"
          note="Delivered, COD collected by the courier, no payout has covered it inside the window."
        />
        {recon.isLoading ? (
          <SkeletonRows rows={4} cols={6} label="Loading overdue orders…" />
        ) : (recon.data?.overdueOrders.length ?? 0) === 0 ? (
          <EmptyState
            tone="positive"
            title="Nothing overdue"
            description="Every delivered COD order is either settled or still inside the expected window."
          />
        ) : (
          <UnsettledTable caption="Overdue orders" rows={recon.data?.overdueOrders ?? []} />
        )}
      </MkSection>

      {/* ── short-paid ── */}
      {shortPaid.length > 0 && (
        <MkSection>
          <SectionHeading
            title="Short-paid"
            note="A payout allocated less than the order was expected to yield. Each of these is a conversation with the courier."
          />
          <UnsettledTable caption="Short-paid orders" rows={shortPaid} />
        </MkSection>
      )}

      {/* ── the payout log ── */}
      <MkSection>
        <SectionHeading
          title="Recorded payouts"
          note="Each bank credit, and the orders it was allocated against."
        />
        {list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Could not load payouts.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={4} cols={7} label="Loading payouts…" />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No payouts recorded"
            description="Enter the courier's payout with its UTR reference and the orders it covers. The reference is what makes recording the same credit twice a refusal instead of a double-count."
            action={
              canWrite ? (
                <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
                  Record payout
                </Button>
              ) : null
            }
          />
        ) : (
          <MkCard flush>
            <Table caption="Recorded payouts">
              <THead>
                <Tr>
                  <Th>Reference</Th>
                  <Th>Received</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Allocated</Th>
                  <Th align="right">Unallocated</Th>
                  <Th align="right">Orders</Th>
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
                            title="This part of the payout is not explained by any order"
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
                            Allocate more
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
  const router = useRouter();
  return (
    <MkCard flush>
      <Table caption={caption}>
        <THead>
          <Tr>
            <Th>Order</Th>
            <Th>Delivered</Th>
            <Th align="right">Age</Th>
            <Th align="right">Expected</Th>
            <Th align="right">Settled</Th>
            <Th align="right">Shortfall</Th>
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
