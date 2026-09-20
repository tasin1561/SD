'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { Package, PercentCircle, TrendingUp, Undo2 } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  BandBody,
  Button,
  Crumbs,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  Money,
  Num,
  PageHeader,
  ResellerStoreStatusBadge,
  SectionBand,
  Stat,
  StripFact,
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
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   A TREND LINE / SPARKLINE per store   the endpoint answers ONE window
 *       at a time, not a series. Drawing a curve would mean either
 *       inventing points or firing a request per bucket per store.
 *   A STORE'S OWN P&L                    deliberately out of reach: a
 *       store's expenses are its books, not the seller's (RS-8).
 *   MARGIN WITH NO COVERAGE FIGURE       margin needs a unit cost, and
 *       the cost is not known for every line. Every margin figure here
 *       carries how many lines it could price — a bare rupee number
 *       would read as complete when it is not (TRE-6's rule).
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

  const stores = useMemo(() => cards.data?.stores ?? [], [cards.data]);
  const placed = stores.reduce((sum, s) => sum + s.scorecard.placed, 0);
  const units = stores.reduce((sum, s) => sum + s.scorecard.unitsDelivered, 0);
  const margin = stores.reduce((sum, s) => sum + Number(s.scorecard.marginInr), 0);
  const marginLines = stores.reduce((sum, s) => sum + s.scorecard.marginCoverage.lines, 0);
  const marginPriced = stores.reduce((sum, s) => sum + s.scorecard.marginCoverage.linesWithCost, 0);
  const autoPaused = stores.filter((s) => s.autoPause !== null && s.autoPause.enabled).length;
  const loaded = cards.data !== undefined;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Reports' }]}
            Link={Link}
          />
        }
        title="Reseller store reports"
        subtitle="How each of your reseller stores is doing, what it earned you, and when one pauses itself for too many returns."
        meta={
          !loaded ? undefined : (
            <>
              <MetaChip tone="accent">
                {stores.length} {stores.length === 1 ? 'store' : 'stores'}
              </MetaChip>
              <MetaChip>
                {istDateLabel(window.from)} – {istDateLabel(window.to)}
              </MetaChip>
              {autoPaused > 0 && <MetaChip tone="warn">{autoPaused} auto-pause on</MetaChip>}
            </>
          )
        }
        action={
          <Link
            href="/reseller-stores/stock-forecast"
            className="text-accent text-sm hover:underline"
          >
            Stock forecast →
          </Link>
        }
      />

      {/* ── The window, across every store ──────────────────────────
             Four tiles summed from the scorecards below. The margin
             tile carries its COVERAGE in the footer rather than
             standing alone: a cost is not recorded for every line, and
             a bare figure would read as the whole picture. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Orders placed"
          icon={<Package size={13} aria-hidden />}
          value={loaded ? <Num value={placed} /> : <span className="text-text-faint">—</span>}
          unit={loaded ? (placed === 1 ? 'order' : 'orders') : undefined}
          tone="neutral"
          hint="By your reseller stores, in this window."
        />
        <Stat
          label="Units delivered"
          icon={<TrendingUp size={13} aria-hidden />}
          value={loaded ? <Num value={units} /> : <span className="text-text-faint">—</span>}
          unit={loaded ? 'units' : undefined}
          tone="neutral"
          hint="Reached a customer and stayed there."
        />
        <Stat
          label="Margin on what shipped"
          icon={<PercentCircle size={13} aria-hidden />}
          value={
            loaded ? (
              <Money amount={margin} decimals={false} />
            ) : (
              <span className="text-text-faint">—</span>
            )
          }
          tone="neutral"
          {...(loaded && marginLines > 0
            ? {
                foot: [
                  {
                    label: 'Lines we could price',
                    value: `${marginPriced} / ${marginLines}`,
                  },
                ],
              }
            : {})}
          hint="Transfer price less your unit cost, where the cost is recorded."
        />
        <Stat
          label="Auto-pause armed"
          icon={<Undo2 size={13} aria-hidden />}
          value={loaded ? autoPaused : <span className="text-text-faint">—</span>}
          unit={loaded ? `of ${stores.length}` : undefined}
          tone={loaded && autoPaused > 0 ? 'warn' : 'neutral'}
          hint="Stores that stop themselves when too many parcels come back."
        />
      </div>

      <SectionBand
        index="01"
        title="The window"
        note="Days are counted in IST, the same as everything else on your account."
      />
      <BandBody className="mb-4">
        <div className="flex flex-wrap gap-3">
          <FormField label="From" htmlFor="from">
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="to">
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
      </BandBody>

      {cards.isPending && <LoadingState label="Loading the scorecards" rows={5} />}
      {cards.isError && (
        <ErrorState message={serverVerdict(cards.error)} retry={() => void cards.refetch()} />
      )}
      {cards.data !== undefined &&
        (stores.length === 0 ? (
          <EmptyState
            title="No reseller stores yet"
            description="Open one for a business that will resell your stock, and its numbers appear here."
            action={
              <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
                Open a reseller store
              </Link>
            }
          />
        ) : (
          <>
            <SectionBand
              index="02"
              title="Scorecards"
              note="Rates leave out orders whose outcome is not known yet."
            />
            <BandBody flush className="mb-4">
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
                          className="text-text-bright font-medium hover:underline"
                        >
                          {s.name}
                        </Link>
                        {s.status !== null ? (
                          <div className="mt-0.5">
                            <ResellerStoreStatusBadge status={s.status} />
                          </div>
                        ) : null}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {s.scorecard.placed}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {pct(s.scorecard.confirmationRatePct)}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {pct(s.scorecard.cancelRatePct)}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {pct(s.scorecard.deliveryRatePct)}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {pct(s.scorecard.returnRatePct)}
                      </Td>
                      <Td align="right" className="font-mono text-xs">
                        {s.scorecard.unitsDelivered}
                      </Td>
                      <Td align="right">
                        <Money amount={s.scorecard.marginInr} />
                        {/* The coverage travels WITH the figure: a margin
                            priced from half the lines is not the same
                            claim as one priced from all of them. */}
                        <span className="text-text-faint mt-0.5 block text-xs">
                          cost known {s.scorecard.marginCoverage.linesWithCost}/
                          {s.scorecard.marginCoverage.lines}
                        </span>
                      </Td>
                      <Td align="right">
                        <Money amount={s.balanceInr} />
                      </Td>
                      <Td>
                        <span className="text-text-muted block text-xs">
                          {s.autoPause !== null && s.autoPause.enabled
                            ? `> ${s.autoPause.returnRatePercent}% over ${s.autoPause.windowDays}d`
                            : 'Off'}
                        </span>
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
            </BandBody>

            <SectionBand
              index="03"
              title="Stores ranked by what they made you"
              note="Wallet credits less charges, less the cost of the goods delivered where a cost is recorded."
            />
            <BandBody flush className="mb-4">
              <Table>
                <THead>
                  <Tr>
                    <Th className="w-10">#</Th>
                    <Th>Store</Th>
                    <Th align="right">Profit</Th>
                    <Th align="right">Cost known</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cards.data.ranking.map((r) => (
                    <Tr key={r.storeId}>
                      <Td className="text-text-faint font-mono text-xs">{r.rank}</Td>
                      <Td>
                        <Link
                          href={`/reseller-stores/${r.storeId}`}
                          className="text-text-bright font-medium hover:underline"
                        >
                          {r.name}
                        </Link>
                      </Td>
                      <Td align="right">
                        <Money amount={r.profitInr} />
                      </Td>
                      <Td align="right" className="text-text-muted font-mono text-xs">
                        {r.costCoverage.linesWithCost}/{r.costCoverage.lines} lines
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </BandBody>
          </>
        ))}

      <SectionBand
        index={stores.length === 0 ? '02' : '04'}
        title="Transfer revenue by store"
        note="Every wallet entry in the window naming one of that store's orders."
      />
      <BandBody flush>
        {revenue.isPending && (
          <div className="p-3">
            <LoadingState label="Loading transfer revenue" rows={3} />
          </div>
        )}
        {revenue.isError && (
          <div className="p-3">
            <ErrorState
              message={serverVerdict(revenue.error)}
              retry={() => void revenue.refetch()}
            />
          </div>
        )}
        {revenue.data !== undefined &&
          (revenue.data.stores.length === 0 ? (
            <EmptyState
              bare
              title="Nothing on your wallet from a store in this window"
              description="Credits and charges appear here once a store's orders reach the point they are paid."
            />
          ) : (
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
                          className="text-text-bright font-medium hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-text-faint mt-0.5 block text-xs">
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
                        <span className="text-text-faint mt-0.5 block text-xs">
                          {d?.orders ?? 0} orders
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ))}
      </BandBody>

      {loaded && stores.length > 0 && (
        <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
          <StripFact label="Orders placed" value={<Num value={placed} />} />
          <StripFact label="Units delivered" value={<Num value={units} />} />
          <StripFact
            label="Margin"
            value={<Money amount={margin} decimals={false} />}
            tone={margin > 0 ? 'good' : 'neutral'}
          />
          <StripFact label="Cost known" value={`${marginPriced} / ${marginLines} lines`} />
        </div>
      )}

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
