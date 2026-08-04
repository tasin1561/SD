'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Ident,
  Money,
  Num,
  PageHeader,
  Section,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useReconciliation, useSettlementsList } from '@/lib/ops-hooks';
import { RecordSettlementModal } from './record-settlement-modal';
import { usePermission } from '@/lib/use-permission';

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
  const [overdueAfterDays, setOverdueAfterDays] = useState(10);

  const recon = useReconciliation(overdueAfterDays);
  const list = useSettlementsList({ limit: 50 });

  const overdue = Number(recon.data?.overdueInr ?? 0);
  const shortPaid = recon.data?.shortPaidOrders ?? [];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Courier settlements"
        subtitle="Every rupee the courier pays us, matched to the orders it covers. What is not matched is float we are carrying on the sellers' behalf."
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setRecording(true)}>
              Record payout
            </Button>
          ) : null
        }
      />

      {/* ── the alarm ── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Outstanding float"
          value={
            recon.isLoading ? (
              '—'
            ) : (
              <Money amount={recon.data?.outstandingFloatInr ?? 0} decimals={false} />
            )
          }
          tone="neutral"
          hint="Delivered COD no payout covers yet"
        />
        <Stat
          label={`Overdue past ${overdueAfterDays}d`}
          value={recon.isLoading ? '—' : <Money amount={overdue} decimals={false} />}
          tone={overdue > 0 ? 'bad' : 'good'}
          hint={`${recon.data?.overdueOrders.length ?? 0} order${
            (recon.data?.overdueOrders.length ?? 0) === 1 ? '' : 's'
          } past the settlement window`}
        />
        <Stat
          label="Short-paid orders"
          value={recon.isLoading ? '—' : shortPaid.length}
          tone={shortPaid.length > 0 ? 'warn' : 'neutral'}
          hint="A payout touched these but under-paid"
        />
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-text-muted text-xs" htmlFor="overdue-days">
          Treat unsettled as overdue after
        </label>
        <select
          id="overdue-days"
          value={overdueAfterDays}
          onChange={(e) => setOverdueAfterDays(Number(e.target.value))}
          className="border-border bg-surface text-text-body rounded-[5px] border px-2 py-1 text-xs"
        >
          {[5, 7, 10, 14, 21, 30].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
        <span className="text-text-faint text-xs">
          Delhivery states 5–10 days; 10 is the top of that window.
        </span>
      </div>

      {recon.isError && (
        <ErrorNote
          className="mb-4"
          message={recon.error?.message ?? 'Could not load the reconciliation.'}
          retry={() => void recon.refetch()}
        />
      )}

      {/* ── overdue orders ── */}
      <Section
        title="Overdue"
        subtitle="Delivered, COD collected by the courier, no payout has covered it inside the window."
      >
        {recon.isLoading ? (
          <Card>
            <SkeletonRows rows={4} cols={5} />
          </Card>
        ) : (recon.data?.overdueOrders.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing overdue"
            description="Every delivered COD order is either settled or still inside the expected window."
          />
        ) : (
          <UnsettledTable rows={recon.data?.overdueOrders ?? []} />
        )}
      </Section>

      {/* ── short-paid ── */}
      {shortPaid.length > 0 && (
        <Section
          title="Short-paid"
          subtitle="A payout allocated less than the order was expected to yield. Each of these is a conversation with the courier."
        >
          <UnsettledTable rows={shortPaid} />
        </Section>
      )}

      {/* ── the payout log ── */}
      <Section
        title="Recorded payouts"
        subtitle="Each bank credit, and the orders it was allocated against."
      >
        {list.isError ? (
          <ErrorNote
            message={list.error?.message ?? 'Could not load payouts.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <Card>
            <SkeletonRows rows={4} cols={5} />
          </Card>
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
          <Table>
            <THead>
              <Tr>
                <Th>Reference</Th>
                <Th>Received</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Allocated</Th>
                <Th align="right">Unallocated</Th>
                <Th align="right">Orders</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data?.map((s) => {
                const unallocated = Number(s.unallocatedInr);
                return (
                  <Tr key={s.id}>
                    <Td>
                      <Ident value={s.reference} />
                      {s.note !== null && s.note !== '' && (
                        <div className="text-text-faint mt-0.5 text-xs">{s.note}</div>
                      )}
                    </Td>
                    <Td className="text-text-muted whitespace-nowrap">
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
                        <span className="text-text-faint">—</span>
                      ) : (
                        <span
                          className="text-[var(--color-critical)]"
                          title="This part of the payout is not explained by any order"
                        >
                          <Money amount={s.unallocatedInr} />
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Num value={s.lines.length} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>

      <RecordSettlementModal open={recording} onOpenChange={setRecording} />
    </div>
  );
}

function UnsettledTable({
  rows,
}: {
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
  return (
    <Table>
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
          <Tr key={r.orderId}>
            <Td>
              <Link href={`/orders/${r.orderId}`} className="text-accent hover:underline">
                <Ident value={r.orderNumber} />
              </Link>
            </Td>
            <Td className="text-text-muted whitespace-nowrap">
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
  );
}
