'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { Package, PercentCircle, Settings2, TrendingUp, Undo2 } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { Money, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Switch } from '@skydrop/ui/app/switch';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { resellerStoreStatusKind, resellerStoreStatusLabel } from '@skydrop/ui/status';
import { istDateLabel, istDayRange, lastDays } from '@/lib/ist-day';
import { can } from '@/lib/page-access';
import {
  useResellerScorecards,
  useResellerTransferRevenue,
  useSetAutoPause,
  type StoreScoreRow,
} from '@/lib/reseller-report-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RsFact, RsFacts, RsLink, RsSection, RsStrip, RsStripFact } from '../_components/rs-parts';

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
  const dash = <span className="rs-faint">—</span>;

  return (
    <div className="rs-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Reselling' }, { label: 'Reports' }]}
        Link={Link}
        title="Reseller store reports"
        subtitle="How each of your reseller stores is doing, what it earned you, and when one pauses itself for too many returns."
        meta={
          !loaded ? undefined : (
            <RsFacts>
              <RsFact tone="accent">
                {stores.length} {stores.length === 1 ? 'store' : 'stores'}
              </RsFact>
              <RsFact>
                {istDateLabel(window.from)} – {istDateLabel(window.to)}
              </RsFact>
              {autoPaused > 0 && <RsFact tone="warn">{autoPaused} auto-pause on</RsFact>}
            </RsFacts>
          )
        }
        action={<RsLink href="/reseller-stores/stock-forecast">Stock forecast</RsLink>}
      />

      {/* ── The window, across every store ──────────────────────────
             Four cards summed from the scorecards below. The margin card
             carries its COVERAGE in the footer rather than standing
             alone: a cost is not recorded for every line, and a bare
             figure would read as the whole picture. The counts keep
             their `<Num>` figures (a changing window must not re-roll a
             number that only rolls once); the margin keeps its `<Money>`. */}
      {cards.isPending ? (
        <div className="rs-kpis">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
          ))}
        </div>
      ) : (
        <div className="rs-kpis">
          <KpiCard
            label="Orders placed"
            icon={<Package size={14} />}
            figure={loaded ? <Num value={placed} /> : dash}
            unit={loaded ? (placed === 1 ? 'order' : 'orders') : undefined}
            tone="neutral"
            hint="By your reseller stores, in this window."
          />
          <KpiCard
            label="Units delivered"
            icon={<TrendingUp size={14} />}
            figure={loaded ? <Num value={units} /> : dash}
            unit={loaded ? 'units' : undefined}
            tone="neutral"
            hint="Reached a customer and stayed there."
          />
          <KpiCard
            label="Margin on what shipped"
            icon={<PercentCircle size={14} />}
            figure={loaded ? <Money amount={margin} decimals={false} /> : dash}
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
          <KpiCard
            label="Auto-pause armed"
            icon={<Undo2 size={14} />}
            figure={loaded ? <Num value={autoPaused} /> : dash}
            unit={loaded ? `of ${stores.length}` : undefined}
            tone={loaded && autoPaused > 0 ? 'pending' : 'neutral'}
            hint="Stores that stop themselves when too many parcels come back."
          />
        </div>
      )}

      <RsSection
        title="The window"
        note="Days are counted in IST, the same as everything else on your account."
      >
        <div className="rs-dates">
          <DateField
            id="from"
            label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <DateField id="to" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </RsSection>

      {cards.isPending && <SkeletonRows rows={5} cols={10} label="Loading the scorecards" />}
      {cards.isError && (
        <ErrorState message={serverVerdict(cards.error)} retry={() => void cards.refetch()} />
      )}
      {cards.data !== undefined &&
        (stores.length === 0 ? (
          <EmptyState
            title="No reseller stores yet"
            description="Open one for a business that will resell your stock, and its numbers appear here."
            action={<RsLink href="/reseller-stores">Open a reseller store</RsLink>}
          />
        ) : (
          <>
            <RsSection
              title="Scorecards"
              note="Rates leave out orders whose outcome is not known yet."
              flush
            >
              <Table caption="Scorecards">
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
                        <Link href={`/reseller-stores/${s.storeId}`} className="rs-name-link">
                          {s.name}
                        </Link>
                        {s.status !== null ? (
                          <div className="rs-block">
                            <StatusChip
                              kind={resellerStoreStatusKind(s.status)}
                              label={resellerStoreStatusLabel(s.status)}
                              size="sm"
                            />
                          </div>
                        ) : null}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {s.scorecard.placed}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(s.scorecard.confirmationRatePct)}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(s.scorecard.cancelRatePct)}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(s.scorecard.deliveryRatePct)}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(s.scorecard.returnRatePct)}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {s.scorecard.unitsDelivered}
                      </Td>
                      <Td align="right">
                        <Money amount={s.scorecard.marginInr} />
                        {/* The coverage travels WITH the figure: a margin
                            priced from half the lines is not the same
                            claim as one priced from all of them. */}
                        <span className="rs-faint rs-block">
                          cost known {s.scorecard.marginCoverage.linesWithCost}/
                          {s.scorecard.marginCoverage.lines}
                        </span>
                      </Td>
                      <Td align="right">
                        <Money amount={s.balanceInr} />
                      </Td>
                      <Td>
                        <span className="rs-small rs-block">
                          {s.autoPause !== null && s.autoPause.enabled
                            ? `> ${s.autoPause.returnRatePercent}% over ${s.autoPause.windowDays}d`
                            : 'Off'}
                        </span>
                        {mayManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Settings2 size={13} />}
                            onClick={() => setEditing(s)}
                          >
                            Change
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </RsSection>

            <RsSection
              title="Stores ranked by what they made you"
              note="Wallet credits less charges, less the cost of the goods delivered where a cost is recorded."
              flush
            >
              <Table caption="Stores ranked by what they made you">
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
                      <Td className="rs-faint sk-figure">{r.rank}</Td>
                      <Td>
                        <Link href={`/reseller-stores/${r.storeId}`} className="rs-name-link">
                          {r.name}
                        </Link>
                      </Td>
                      <Td align="right">
                        <Money amount={r.profitInr} />
                      </Td>
                      <Td align="right" className="rs-small sk-figure">
                        {r.costCoverage.linesWithCost}/{r.costCoverage.lines} lines
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </RsSection>
          </>
        ))}

      <RsSection
        title="Transfer revenue by store"
        note="Every wallet entry in the window naming one of that store's orders."
        flush
      >
        {revenue.isPending && <SkeletonRows rows={3} cols={5} label="Loading transfer revenue" />}
        {revenue.isError && (
          <div className="rs-card__pad">
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
            <Table caption="Transfer revenue by store">
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
                        <Link href={`/reseller-stores/${s.storeId}`} className="rs-name-link">
                          {s.name}
                        </Link>
                        <span className="rs-faint rs-block">
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
                        <span className="rs-faint rs-block">{d?.orders ?? 0} orders</span>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ))}
      </RsSection>

      {loaded && stores.length > 0 && (
        <RsStrip>
          <RsStripFact label="Orders placed" value={<Num value={placed} />} />
          <RsStripFact label="Units delivered" value={<Num value={units} />} />
          <RsStripFact
            label="Margin"
            value={<Money amount={margin} decimals={false} />}
            tone={margin > 0 ? 'good' : 'neutral'}
          />
          <RsStripFact label="Cost known" value={`${marginPriced} / ${marginLines} lines`} />
        </RsStrip>
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

  // The SAME request as before; the button is busy while it runs, and the
  // outcome is told by the same toasts. On success the dialog closes.
  async function doSave(): Promise<void> {
    try {
      await save.mutateAsync({
        storeId: store.storeId,
        enabled,
        returnRatePercent: rate,
        minDecidedOrders: Number(min),
        windowDays: Number(days),
      });
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
    toast.success('Saved.');
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Auto-pause “${store.name}”`}
      description="Pause this store automatically — no new orders — when more of its parcels come back than you allow. Orders already placed carry on; you resume it yourself. After you resume, only parcels that come back afterwards count."
      icon={<Undo2 size={18} />}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{ idle: 'Save', busy: 'Saving…', done: 'Saved' }}
            onAction={doSave}
          />
        </DialogFooter>
      }
    >
      <div className="rs-form">
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Pause automatically" />
        <TextField
          id="rate"
          label="Return rate above (%)"
          inputMode="decimal"
          inputClassName="sk-figure"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <TextField
          id="min"
          label="Once at least this many parcels have an outcome"
          inputMode="numeric"
          inputClassName="sk-figure"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <TextField
          id="days"
          label="Over the last N days"
          inputMode="numeric"
          inputClassName="sk-figure"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
