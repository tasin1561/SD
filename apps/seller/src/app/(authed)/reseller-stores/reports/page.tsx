'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  ResellerStoreStatusBadge,
  Section,
  Switch,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { istDateLabel, istDayRange, lastDays } from '@/lib/ist-day';
import { can } from '@/lib/page-access';
import {
  useResellerScorecards,
  useResellerTransferRevenue,
  useSetAutoPause,
  type StoreScoreRow,
} from '@/lib/reseller-report-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const pct = (v: string | null): string => (v === null ? '—' : `${v}%`);

/**
 * Your reseller stores, measured (RS-8 / RS-9): each store's scorecard and
 * balance, the stores ranked by the profit they made you, and the transfer
 * revenue each brought onto your wallet. Never a store's own expenses or
 * P&L — those are the store's books.
 */
export default function ResellerReportsPage(): ReactElement {
  const identity = useSellerIdentity();
  const mayManage = can(identity, 'stores.manage');
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const cards = useResellerScorecards(window);
  const revenue = useResellerTransferRevenue(window);
  const [editing, setEditing] = useState<StoreScoreRow | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reseller store reports"
        subtitle="How each of your reseller stores is doing, what it earned you, and when one pauses itself for too many returns."
        action={
          <Link href="/reseller-stores/stock-forecast" className="text-sm underline">
            Stock forecast
          </Link>
        }
      />
      <div className="flex flex-wrap gap-3">
        <FormField label="From" htmlFor="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="To" htmlFor="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>

      {cards.isPending && <LoadingState label="Loading the scorecards" rows={5} />}
      {cards.isError && (
        <ErrorState message={serverVerdict(cards.error)} retry={() => void cards.refetch()} />
      )}
      {cards.data !== undefined &&
        (cards.data.stores.length === 0 ? (
          <EmptyState
            title="No reseller stores yet"
            action={<Link href="/reseller-stores">Open a reseller store</Link>}
          />
        ) : (
          <div className="space-y-6">
            <Section
              title="Scorecards"
              subtitle="Orders the store placed in the window. Rates leave out orders whose outcome is not known yet. Margin is transfer price − your unit cost, where the cost is known."
            >
              <Table>
                <THead>
                  <Tr>
                    <Th>Store</Th>
                    <Th align="right">Placed</Th>
                    <Th align="right">Confirmed</Th>
                    <Th align="right">Cancelled</Th>
                    <Th align="right">Delivered</Th>
                    <Th align="right">Returned</Th>
                    <Th align="right">Units</Th>
                    <Th align="right">Margin</Th>
                    <Th align="right">Balance</Th>
                    <Th>Auto-pause</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cards.data.stores.map((s) => (
                    <Tr key={s.storeId}>
                      <Td>
                        <Link
                          href={`/reseller-stores/${s.storeId}`}
                          className="text-accent hover:underline"
                        >
                          {s.name}
                        </Link>
                        {s.status !== null ? (
                          <div className="mt-0.5">
                            <ResellerStoreStatusBadge status={s.status} />
                          </div>
                        ) : null}
                      </Td>
                      <Td align="right">{s.scorecard.placed}</Td>
                      <Td align="right">{pct(s.scorecard.confirmationRatePct)}</Td>
                      <Td align="right">{pct(s.scorecard.cancelRatePct)}</Td>
                      <Td align="right">{pct(s.scorecard.deliveryRatePct)}</Td>
                      <Td align="right">{pct(s.scorecard.returnRatePct)}</Td>
                      <Td align="right">{s.scorecard.unitsDelivered}</Td>
                      <Td align="right">
                        <Money amount={s.scorecard.marginInr} />
                        <span className="text-text-muted block text-xs">
                          cost known {s.scorecard.marginCoverage.linesWithCost}/
                          {s.scorecard.marginCoverage.lines}
                        </span>
                      </Td>
                      <Td align="right">
                        <Money amount={s.balanceInr} />
                      </Td>
                      <Td>
                        {s.autoPause !== null && s.autoPause.enabled
                          ? `> ${s.autoPause.returnRatePercent}% over ${s.autoPause.windowDays}d`
                          : 'Off'}
                        {mayManage && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                            Change
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Section>

            <Section
              title="Stores ranked by what they made you"
              subtitle="What this window's orders put on your wallet (credits − charges), less the cost of the goods delivered where you recorded a cost."
            >
              <Table>
                <THead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Store</Th>
                    <Th align="right">Profit</Th>
                    <Th align="right">Cost known</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cards.data.ranking.map((r) => (
                    <Tr key={r.storeId}>
                      <Td>{r.rank}</Td>
                      <Td>
                        <Link
                          href={`/reseller-stores/${r.storeId}`}
                          className="text-accent hover:underline"
                        >
                          {r.name}
                        </Link>
                      </Td>
                      <Td align="right">
                        <Money amount={r.profitInr} />
                      </Td>
                      <Td align="right">
                        {r.costCoverage.linesWithCost}/{r.costCoverage.lines} lines
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Section>
          </div>
        ))}

      <Section
        title="Transfer revenue by store"
        subtitle="Every entry on your wallet in the window that names one of the store's orders — credits add, charges subtract. Beside it, the transfer value of orders delivered in the window."
      >
        {revenue.isPending && <LoadingState label="Loading transfer revenue" rows={3} />}
        {revenue.isError && (
          <ErrorState message={serverVerdict(revenue.error)} retry={() => void revenue.refetch()} />
        )}
        {revenue.data !== undefined && (
          <Table>
            <THead>
              <Tr>
                <Th>Store</Th>
                <Th align="right">Credited</Th>
                <Th align="right">Charged</Th>
                <Th align="right">Net</Th>
                <Th align="right">Delivered (transfer value)</Th>
              </Tr>
            </THead>
            <TBody>
              {revenue.data.stores.map((s) => {
                const d = revenue.data.deliveredTransfer.find((x) => x.storeId === s.storeId);
                return (
                  <Tr key={s.storeId}>
                    <Td>
                      <Link
                        href={`/reseller-stores/${s.storeId}`}
                        className="text-accent hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="text-text-muted block text-xs">
                        {s.rows.length} entries
                        {s.rows[0] === undefined
                          ? ''
                          : `, latest ${istDateLabel(s.rows[s.rows.length - 1]?.at ?? s.rows[0].at)}`}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money amount={s.creditsInr} direction="credit" />
                    </Td>
                    <Td align="right">
                      <Money amount={s.debitsInr} direction="debit" />
                    </Td>
                    <Td align="right">
                      <Money amount={s.netInr} />
                    </Td>
                    <Td align="right">
                      <Money amount={d?.transferInr ?? '0.00'} />
                      <span className="text-text-muted block text-xs">{d?.orders ?? 0} orders</span>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>

      {editing !== null && <AutoPauseModal store={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AutoPauseModal({
  store,
  onClose,
}: {
  store: StoreScoreRow;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const save = useSetAutoPause();
  const rule = store.autoPause;
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [rate, setRate] = useState(rule?.returnRatePercent ?? '30');
  const [min, setMin] = useState(String(rule?.minDecidedOrders ?? 10));
  const [days, setDays] = useState(String(rule?.windowDays ?? 30));
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Auto-pause “${store.name}”`}
      description="Pause this store automatically — no new orders — when more of its parcels come back than you allow. Orders already placed carry on; you resume it yourself. After you resume, only parcels that come back afterwards count."
    >
      <div className="mb-3">
        <Switch checked={enabled} onChange={setEnabled} label="Pause automatically" />
      </div>
      <FormField label="Return rate above (%)" htmlFor="rate">
        <Input
          id="rate"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </FormField>
      <FormField label="Once at least this many parcels have an outcome" htmlFor="min">
        <Input id="min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
      </FormField>
      <FormField label="Over the last N days" htmlFor="days">
        <Input
          id="days"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </FormField>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                storeId: store.storeId,
                enabled,
                returnRatePercent: rate,
                minDecidedOrders: Number(min),
                windowDays: Number(days),
              },
              {
                onSuccess: () => {
                  toast.success('Saved.');
                  onClose();
                },
                onError: (err) => toast.error(serverVerdict(err)),
              },
            )
          }
        >
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
