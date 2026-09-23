'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { useToast } from '@skydrop/ui/app/toast';
import { isWalletCredit, walletDirectionLabel } from '@skydrop/ui/status';
import { WalletEntryDirection } from '@skydrop/db';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { Tabs } from '@skydrop/ui/app/tabs';
import {
  Table,
  TableEmpty,
  TableToolbar,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ParachuteProgress } from '@skydrop/ui/app/parachute-progress';
import {
  useReconcileSellerWallets,
  useSellerWalletOverview,
  type SellerWalletRow,
} from '@/lib/seller-wallet-hooks';
import { usePermission } from '@/lib/use-permission';
import { useFxRatesList } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { MkCard } from './money-parts';

type Filter = 'all' | 'credit' | 'debt' | 'payout';

/** Every direction the label helpers can actually answer for. */
const KNOWN_DIRECTIONS = new Set<string>(Object.values(WalletEntryDirection));

/**
 * The taka figure beside the rupee one.
 *
 * ── WHY THIS IS NOT `<Money convert />` ──────────────────────────────
 * The admin app mounts no `MoneyDisplayProvider`, on purpose: it is an
 * operational console reading a canonical ledger, and turning its
 * figures over into taka would put an operator and a seller on
 * different numbers during the same phone call. So `convert` there is a
 * no-op and renders rupees a second time — which is exactly what this
 * page did.
 *
 * Showing BOTH is a different thing from converting: the rupee figure
 * stays primary and present, and the taka one is an aid beside it. The
 * rate is the posted one, and when there is no rate this renders
 * NOTHING — a missing second figure is honest, a wrong one is not.
 */
function Bdt({
  amountInr,
  rate,
}: {
  readonly amountInr: string;
  readonly rate: number | null;
}): ReactElement | null {
  if (rate === null || !Number.isFinite(Number(amountInr))) return null;
  return (
    <span className="mk-faint">
      ≈ <Money amount={(Number(amountInr) * rate).toFixed(2)} currency="BDT" convert={false} />
    </span>
  );
}

/**
 * Every seller's wallet in one place.
 *
 * ── THE TWO DIRECTIONS STAY APART ────────────────────────────────────
 * A seller ₹50,000 in credit and another ₹50,000 in debt is not a
 * business with nothing outstanding: one is money we must be able to
 * pay on demand, the other is money we may never see. A single net
 * figure would be true of nobody, so the four tiles across the top are
 * four different questions and are never summed into one.
 *
 * ── AND WHAT IS DELIBERATELY NOT HERE ────────────────────────────────
 * Nothing on this page is invented to fill a layout. Every figure comes
 * from a ledger, and where we have no answer — a wallet nothing has
 * ever touched — it says so rather than showing a plausible zero.
 */
export function SellerWalletsIndex(): ReactElement {
  const overview = useSellerWalletOverview();
  const toast = useToast();
  const mayReconcile = usePermission('money.wallets.reconcile');
  const reconcile = useReconcileSellerWallets();
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);
  // Read unconditionally — `a && usePermission(b)` short-circuits,
  // which skips a hook call and changes the hook ORDER between renders.
  const canReadFx = usePermission('fx.view');
  const fx = useFxRatesList(canReadFx);
  const inrToBdt = ((): number | null => {
    const direct = (fx.data ?? []).find((r) => r.fromCurrency === 'INR' && r.toCurrency === 'BDT');
    if (direct !== undefined) return Number(direct.rate);
    const inverse = (fx.data ?? []).find((r) => r.fromCurrency === 'BDT' && r.toCurrency === 'INR');
    return inverse === undefined || Number(inverse.rate) === 0 ? null : 1 / Number(inverse.rate);
  })();

  const rows = useMemo(() => overview.data?.rows ?? [], [overview.data]);
  const counts = useMemo(
    () => ({
      all: rows.length,
      credit: rows.filter((r) => Number(r.balanceInr) > 0).length,
      debt: rows.filter((r) => Number(r.balanceInr) < 0).length,
      payout: rows.filter((r) => Number(r.pendingWithdrawalInr) > 0).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === 'credit') return Number(r.balanceInr) > 0;
        if (filter === 'debt') return Number(r.balanceInr) < 0;
        if (filter === 'payout') return Number(r.pendingWithdrawalInr) > 0;
        return true;
      })
      .filter(
        (r) =>
          q === '' ||
          r.companyName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.sellerId.toLowerCase().includes(q),
      );
  }, [rows, filter, term]);

  async function runReconcile(): Promise<void> {
    try {
      const r = await reconcile.mutateAsync();
      if (r.drifted.length > 0) {
        // The serious outcome, and it must not read like a success. A
        // ledger disagreeing with itself is reported, never quietly
        // corrected — correcting it would erase the evidence.
        toast.error(
          `${r.drifted.length} wallet(s) do NOT add up: ${r.drifted
            .map((d) => `${d.companyName} (running ${d.running} vs entries ${d.summed})`)
            .join('; ')}. Nothing was changed — this needs investigating.`,
        );
        return;
      }
      toast.success(
        r.repaired === 0
          ? `Checked ${r.checked} wallet(s). Every one agrees with its ledger; nothing needed repair.`
          : `Checked ${r.checked} wallet(s), repaired ${r.repaired} cached balance(s).`,
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <div className="mk-page">
      <PageHeader
        title="Seller wallets"
        meta={
          <span className="mk-count sk-figure">
            {counts.all} {counts.all === 1 ? 'account' : 'accounts'}
          </span>
        }
        subtitle="What we owe sellers, what they owe us, and every ledger behind those two numbers."
        action={
          mayReconcile ? (
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw size={15} />}
              loading={reconcile.isPending}
              disabled={reconcile.isPending}
              onClick={() => setConfirmingReconcile(true)}
              title="Re-check every wallet against its own ledger. Balances update as money moves, so this is a verification rather than a refresh."
            >
              {reconcile.isPending ? 'Checking…' : 'Re-check ledgers'}
            </Button>
          ) : undefined
        }
      />

      {reconcile.isPending && (
        <ParachuteProgress
          label="Re-checking every seller wallet against its ledger"
          detail="Nothing is changed unless a cached balance drifted from its own entries."
        />
      )}

      {overview.isLoading ? (
        <>
          <div className="mk-kpis">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={148} rounded="md" />
            ))}
          </div>
          <SkeletonRows rows={6} cols={7} label="Loading seller wallets…" />
        </>
      ) : overview.isError || overview.data === undefined ? (
        <ErrorState
          message={overview.error?.message ?? 'Failed to load.'}
          retry={() => void overview.refetch()}
        />
      ) : (
        <>
          <div className="mk-kpis">
            <MoneyTile
              label="We owe sellers"
              caption="Payable on demand"
              amountInr={overview.data.totals.owedToSellersInr}
              icon={<ArrowUpRight size={16} />}
              footLeft={`${overview.data.totals.sellersInCredit} in credit`}
              footRight="OK"
              tone="ok"
              inrToBdt={inrToBdt}
            />
            <MoneyTile
              label="Sellers owe us"
              caption="Negative balances and return charges"
              amountInr={overview.data.totals.owedBySellersInr}
              icon={<AlertTriangle size={16} />}
              footLeft={`${overview.data.totals.sellersInDebt} account${
                overview.data.totals.sellersInDebt === 1 ? '' : 's'
              } in debt`}
              footRight={Number(overview.data.totals.owedBySellersInr) > 0 ? 'Review' : '—'}
              // Loud only when there is something to be loud about. A
              // permanently red tile is one nobody reads.
              tone={Number(overview.data.totals.owedBySellersInr) > 0 ? 'bad' : 'ok'}
              inrToBdt={inrToBdt}
            />
            <MoneyTile
              label="Withdrawals held"
              caption="Asked for, already inside the balance above"
              amountInr={overview.data.totals.pendingWithdrawalInr}
              icon={<ClipboardCheck size={16} />}
              footLeft={`${counts.payout} awaiting payout`}
              footRight={counts.payout > 0 ? 'Pending' : '—'}
              tone={counts.payout > 0 ? 'warn' : 'ok'}
              inrToBdt={inrToBdt}
            />
            <MoneyTile
              label="Top-ups in review"
              caption="Claimed, not yet matched to a statement — in no balance"
              amountInr={overview.data.totals.pendingTopupInr}
              icon={<CheckCircle2 size={16} />}
              footLeft={
                Number(overview.data.totals.pendingTopupInr) > 0
                  ? 'Waiting on verification'
                  : 'All statements reconciled'
              }
              footRight={Number(overview.data.totals.pendingTopupInr) > 0 ? 'Queued' : 'Clear'}
              tone="ok"
              inrToBdt={inrToBdt}
            />
          </div>

          <MkCard flush>
            <div className="mk-card__head">
              <Tabs
                label="Which wallets"
                size="sm"
                value={filter}
                onChange={(id) => setFilter(id as Filter)}
                items={[
                  { id: 'all', label: 'All wallets', count: counts.all },
                  { id: 'credit', label: 'In credit', count: counts.credit },
                  { id: 'debt', label: 'In debt', count: counts.debt },
                  { id: 'payout', label: 'Pending payout', count: counts.payout },
                ]}
              />
            </div>
            <TableToolbar
              search={{
                value: term,
                onChange: setTerm,
                label: 'Filter wallets',
                placeholder: 'Filter by company, email or id…',
              }}
            />
            <Table caption="Seller wallets">
              <THead>
                <Tr>
                  <Th>Seller</Th>
                  <Th align="right">Available balance</Th>
                  <Th align="right">Requested out</Th>
                  <Th align="right">Awaiting review</Th>
                  <Th>Last movement</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    {rows.length === 0
                      ? 'No sellers yet. Every approved seller appears here, whether or not money has moved.'
                      : 'No wallet matches that.'}
                  </TableEmpty>
                ) : (
                  shown.map((r) => <WalletRow key={r.sellerId} row={r} inrToBdt={inrToBdt} />)
                )}
              </TBody>
            </Table>
            <div className="mk-card__foot">
              <span>
                Showing {shown.length} of {rows.length} registered seller wallet
                {rows.length === 1 ? '' : 's'}
              </span>
              <span className="mk-balances">
                <span className="mk-small">Net position</span>
                <Money amount={overview.data.totals.netInr} currency="INR" convert={false} />
                {/* The arithmetic, spelled out. A net figure with no
                    working is the one number on this page that could be
                    read as "nothing is outstanding". */}
                <span className="mk-faint">
                  (owed to sellers {overview.data.totals.owedToSellersInr} − owed by them{' '}
                  {overview.data.totals.owedBySellersInr})
                </span>
              </span>
            </div>
          </MkCard>
        </>
      )}

      <ConfirmDialog
        open={confirmingReconcile}
        onOpenChange={setConfirmingReconcile}
        title="Re-check every seller ledger?"
        entity={`Every seller wallet · ${counts.all} ${counts.all === 1 ? 'account' : 'accounts'}`}
        consequence="Each wallet's cached balance is checked against its own ledger entries. A cached balance that drifted is repaired; a ledger that disagrees with itself is reported and never changed."
        confirmLabel="Re-check ledgers"
        onConfirm={runReconcile}
      />
    </div>
  );
}

const TILE_TONE: Record<'ok' | 'warn' | 'bad', KpiTone> = {
  ok: 'neutral',
  warn: 'pending',
  bad: 'debit',
};

/**
 * One headline figure, with what it stands on underneath it.
 *
 * The caption and the footer are the point: a rupee total on its own
 * invites the wrong reading, and "payable on demand" versus "in no
 * balance" is the difference between money we must hold and money that
 * is not ours yet.
 */
function MoneyTile({
  label,
  caption,
  amountInr,
  icon,
  footLeft,
  footRight,
  tone,
  inrToBdt,
}: {
  readonly label: string;
  readonly caption: string;
  readonly amountInr: string;
  readonly icon: ReactElement;
  readonly footLeft: string;
  readonly footRight: string;
  readonly tone: 'ok' | 'warn' | 'bad';
  readonly inrToBdt: number | null;
}): ReactElement {
  return (
    <KpiCard
      label={label}
      hint={caption}
      icon={icon}
      // The tone is carried by the glow and the footer word. Tinting all
      // four at once makes them shout together and none of them read.
      tone={TILE_TONE[tone]}
      figure={<Money amount={amountInr} currency="INR" convert={false} />}
      // The taka equivalent, because half the people reading this think
      // in it. Absent entirely when no rate is posted — a missing second
      // figure is honest, a wrong one is not.
      secondary={<Bdt amountInr={amountInr} rate={inrToBdt} />}
      foot={[{ label: footLeft, value: footRight }]}
    />
  );
}

/** The initials chip — enough to tell two rows apart at a glance. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

function WalletRow({
  row,
  inrToBdt,
}: {
  readonly row: SellerWalletRow;
  readonly inrToBdt: number | null;
}): ReactElement {
  const balance = Number(row.balanceInr);
  const inDebt = balance < 0;
  /*
    Checked, not cast.

    `walletDirectionLabel` and `isWalletCredit` are exhaustive switches
    that THROW on an unrecognised value — right at compile time, fatal
    at runtime, because a render that throws takes the whole page with
    it. That is exactly what happened when the API sent the database
    value (`order_charges`) instead of the enum name.

    The API is fixed; this makes the page survive it happening again,
    because "one row has no label" is a far better failure than "seller
    wallets does not load".
  */
  const direction = KNOWN_DIRECTIONS.has(row.lastMovementDirection ?? '')
    ? (row.lastMovementDirection as WalletEntryDirection)
    : null;

  return (
    <Tr>
      <Td>
        <div className="mk-seller">
          <span className="mk-initials" data-debt={inDebt ? '1' : undefined} aria-hidden>
            {initials(row.companyName)}
          </span>
          <div className="mk-cell">
            <Link href={`/seller-wallets/${row.sellerId}`} className="mk-name mk-seller__name">
              {row.companyName}
              {inDebt ? (
                <AlertTriangle size={14} className="mk-seller__mark" data-tone="bad" aria-hidden />
              ) : row.status === 'APPROVED' ? (
                <BadgeCheck size={14} className="mk-seller__mark" data-tone="good" aria-hidden />
              ) : null}
            </Link>
            <span className="mk-small mk-wrap">{row.email}</span>
            <span className="mk-faint sk-ident mk-wrap">{row.sellerId}</span>
          </div>
        </div>
      </Td>
      <Td align="right">
        <div className="mk-cell mk-cell--end">
          <Money
            amount={row.balanceInr}
            currency="INR"
            convert={false}
            direction={inDebt ? 'debit' : balance > 0 ? 'credit' : 'neutral'}
          />
          <Bdt amountInr={row.balanceInr} rate={inrToBdt} />
        </div>
      </Td>
      <Td align="right">
        {Number(row.pendingWithdrawalInr) > 0 ? (
          <Money amount={row.pendingWithdrawalInr} currency="INR" convert={false} />
        ) : (
          <span className="mk-faint">—</span>
        )}
      </Td>
      <Td align="right">
        {Number(row.pendingTopupInr) > 0 ? (
          <Money amount={row.pendingTopupInr} currency="INR" convert={false} />
        ) : (
          <span className="mk-faint">—</span>
        )}
      </Td>
      <Td>
        {row.lastMovementAt === null ? (
          // Not a date and not a dash: a wallet nothing has ever touched
          // is a real state, and saying so beats an empty cell that
          // reads as missing data.
          <span className="mk-faint">Nothing has moved yet</span>
        ) : (
          <div className="mk-cell">
            <span className="mk-when">
              {new Date(row.lastMovementAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            {direction !== null && (
              <span
                className="mk-text mk-small"
                data-tone={isWalletCredit(direction) ? 'good' : 'critical'}
              >
                {walletDirectionLabel(direction)}
              </span>
            )}
          </div>
        )}
      </Td>
      <Td>
        <StatusChip
          kind={inDebt ? 'failed' : balance > 0 ? 'delivered' : 'draft'}
          label={inDebt ? 'In debit' : balance > 0 ? 'In credit' : 'Settled'}
          size="sm"
        />
      </Td>
      <Td align="right">
        <Link href={`/seller-wallets/${row.sellerId}`} className={buttonClassName('ghost', 'sm')}>
          <span className="sk-btn__label">Ledger →</span>
        </Link>
      </Td>
    </Tr>
  );
}
