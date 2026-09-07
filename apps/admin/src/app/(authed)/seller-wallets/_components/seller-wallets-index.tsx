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
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  Input,
  LoadingState,
  Money,
  PageHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { isWalletCredit, walletDirectionLabel } from '@skydrop/ui/status';
import { WalletEntryDirection } from '@skydrop/db';
import {
  useReconcileSellerWallets,
  useSellerWalletOverview,
  type SellerWalletRow,
} from '@/lib/seller-wallet-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

type Filter = 'all' | 'credit' | 'debt' | 'payout';

/** Every direction the label helpers can actually answer for. */
const KNOWN_DIRECTIONS = new Set<string>(Object.values(WalletEntryDirection));

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
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Seller wallets
            <span className="border-border text-text-muted rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide uppercase">
              {counts.all} {counts.all === 1 ? 'account' : 'accounts'}
            </span>
          </span>
        }
        subtitle="What we owe sellers, what they owe us, and every ledger behind those two numbers."
        action={
          mayReconcile ? (
            <Button
              variant="secondary"
              size="md"
              disabled={reconcile.isPending}
              onClick={() => void runReconcile()}
              title="Re-check every wallet against its own ledger. Balances update as money moves, so this is a verification rather than a refresh."
            >
              <RefreshCw className="size-4" />
              {reconcile.isPending ? 'Checking…' : 'Re-check ledgers'}
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading ? (
        <LoadingState />
      ) : overview.isError || overview.data === undefined ? (
        <ErrorState
          message={overview.error?.message ?? 'Failed to load.'}
          retry={() => void overview.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MoneyTile
              label="We owe sellers"
              caption="Payable on demand"
              amountInr={overview.data.totals.owedToSellersInr}
              icon={<ArrowUpRight className="size-4" />}
              footLeft={`${overview.data.totals.sellersInCredit} in credit`}
              footRight="OK"
              tone="ok"
            />
            <MoneyTile
              label="Sellers owe us"
              caption="Negative balances and return charges"
              amountInr={overview.data.totals.owedBySellersInr}
              icon={<AlertTriangle className="size-4" />}
              footLeft={`${overview.data.totals.sellersInDebt} account${
                overview.data.totals.sellersInDebt === 1 ? '' : 's'
              } in debt`}
              footRight={Number(overview.data.totals.owedBySellersInr) > 0 ? 'REVIEW' : '—'}
              // Loud only when there is something to be loud about. A
              // permanently red tile is one nobody reads.
              tone={Number(overview.data.totals.owedBySellersInr) > 0 ? 'bad' : 'ok'}
            />
            <MoneyTile
              label="Withdrawals held"
              caption="Asked for, already inside the balance above"
              amountInr={overview.data.totals.pendingWithdrawalInr}
              icon={<ClipboardCheck className="size-4" />}
              footLeft={`${counts.payout} awaiting payout`}
              footRight={counts.payout > 0 ? 'PENDING' : '—'}
              tone={counts.payout > 0 ? 'warn' : 'ok'}
            />
            <MoneyTile
              label="Top-ups in review"
              caption="Claimed, not yet matched to a statement — in no balance"
              amountInr={overview.data.totals.pendingTopupInr}
              icon={<CheckCircle2 className="size-4" />}
              footLeft={
                Number(overview.data.totals.pendingTopupInr) > 0
                  ? 'Waiting on verification'
                  : 'All statements reconciled'
              }
              footRight={Number(overview.data.totals.pendingTopupInr) > 0 ? 'QUEUED' : 'CLEAR'}
              tone="ok"
            />
          </div>

          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1">
                <FilterTab
                  active={filter === 'all'}
                  n={counts.all}
                  onClick={() => setFilter('all')}
                >
                  All wallets
                </FilterTab>
                <FilterTab
                  active={filter === 'credit'}
                  n={counts.credit}
                  onClick={() => setFilter('credit')}
                >
                  In credit
                </FilterTab>
                <FilterTab
                  active={filter === 'debt'}
                  n={counts.debt}
                  onClick={() => setFilter('debt')}
                >
                  In debt
                </FilterTab>
                <FilterTab
                  active={filter === 'payout'}
                  n={counts.payout}
                  onClick={() => setFilter('payout')}
                >
                  Pending payout
                </FilterTab>
              </div>
              <Input
                className="w-full sm:w-72"
                placeholder="Filter by company, email or id…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                aria-label="Filter wallets"
              />
            </CardBody>
          </Card>

          <Table>
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
                shown.map((r) => <WalletRow key={r.sellerId} row={r} />)
              )}
            </TBody>
          </Table>

          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-text-muted">
                Showing {shown.length} of {rows.length} registered seller wallet
                {rows.length === 1 ? '' : 's'}
              </span>
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-text-muted text-xs tracking-wide uppercase">
                  Net position
                </span>
                <Money amount={overview.data.totals.netInr} currency="INR" convert={false} />
                {/* The arithmetic, spelled out. A net figure with no
                    working is the one number on this page that could be
                    read as "nothing is outstanding". */}
                <span className="text-text-faint text-xs">
                  (owed to sellers {overview.data.totals.owedToSellersInr} − owed by them{' '}
                  {overview.data.totals.owedBySellersInr})
                </span>
              </span>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function FilterTab({
  active,
  n,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly n: number;
  readonly onClick: () => void;
  readonly children: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-surface-raised text-text-bright'
          : 'text-text-muted hover:text-text hover:bg-surface-raised/60'
      }`}
    >
      {children}
      <span
        className={`rounded px-1 text-xs tabular-nums ${
          active ? 'bg-accent-fill text-accent-fg' : 'text-text-faint'
        }`}
      >
        {n}
      </span>
    </button>
  );
}

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
}: {
  readonly label: string;
  readonly caption: string;
  readonly amountInr: string;
  readonly icon: ReactElement;
  readonly footLeft: string;
  readonly footRight: string;
  readonly tone: 'ok' | 'warn' | 'bad';
}): ReactElement {
  const accent =
    tone === 'bad'
      ? 'var(--status-failed-fg)'
      : tone === 'warn'
        ? 'var(--status-pending-fg)'
        : 'var(--status-delivered-fg)';
  return (
    <Card
      // The border carries the tone. Tinting the whole tile makes four
      // of them shout at once and none of them read.
      style={{ borderColor: tone === 'ok' ? undefined : accent }}
    >
      <CardBody className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-text-muted text-xs font-medium tracking-wide uppercase">
              {label}
            </div>
            <div className="text-text-faint mt-0.5 text-xs">{caption}</div>
          </div>
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          <Money amount={amountInr} currency="INR" convert={false} />
        </div>
        {/* The BDT equivalent, because half the people reading this
            think in taka. Rendered through Money so it is grouped the
            Indian way or the Bangladeshi way, never a bare number. */}
        <div className="text-text-faint text-xs">
          ≈ <Money amount={amountInr} currency="INR" />
        </div>
        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-2 text-xs">
          <span className="text-text-muted">{footLeft}</span>
          <span style={{ color: accent }} className="font-medium tracking-wide">
            {footRight}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

/** The initials chip — enough to tell two rows apart at a glance. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

function WalletRow({ row }: { readonly row: SellerWalletRow }): ReactElement {
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
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-xs font-semibold"
            style={{
              background: inDebt ? 'var(--status-failed-bg)' : 'var(--color-surface-raised)',
              color: inDebt ? 'var(--status-failed-fg)' : 'var(--color-text-muted)',
            }}
            aria-hidden
          >
            {initials(row.companyName)}
          </span>
          <div className="min-w-0">
            <Link
              href={`/seller-wallets/${row.sellerId}`}
              className="text-text-bright inline-flex items-center gap-1.5 font-medium hover:underline"
            >
              {row.companyName}
              {inDebt ? (
                <AlertTriangle className="text-status-failed-fg size-3.5" aria-hidden />
              ) : row.status === 'APPROVED' ? (
                <BadgeCheck className="text-status-delivered-fg size-3.5" aria-hidden />
              ) : null}
            </Link>
            <div className="text-text-muted truncate text-xs">{row.email}</div>
            <div className="text-text-faint font-mono text-[11px] break-all">{row.sellerId}</div>
          </div>
        </div>
      </Td>
      <Td align="right">
        <Money
          amount={row.balanceInr}
          currency="INR"
          convert={false}
          direction={inDebt ? 'debit' : balance > 0 ? 'credit' : 'neutral'}
        />
        <div className="text-text-faint text-xs">
          ≈ <Money amount={row.balanceInr} currency="INR" />
        </div>
      </Td>
      <Td align="right" className="text-text-muted">
        {Number(row.pendingWithdrawalInr) > 0 ? (
          <Money amount={row.pendingWithdrawalInr} currency="INR" convert={false} />
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </Td>
      <Td align="right" className="text-text-muted">
        {Number(row.pendingTopupInr) > 0 ? (
          <Money amount={row.pendingTopupInr} currency="INR" convert={false} />
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </Td>
      <Td className="text-xs">
        {row.lastMovementAt === null ? (
          // Not a date and not a dash: a wallet nothing has ever touched
          // is a real state, and saying so beats an empty cell that
          // reads as missing data.
          <span className="text-text-faint">Nothing has moved yet</span>
        ) : (
          <>
            <div className="text-text-muted">
              {new Date(row.lastMovementAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
            {direction !== null && (
              <div
                style={{
                  color: isWalletCredit(direction)
                    ? 'var(--status-delivered-fg)'
                    : 'var(--status-failed-fg)',
                }}
              >
                {walletDirectionLabel(direction)}
              </div>
            )}
          </>
        )}
      </Td>
      <Td>
        <StatusBadge
          kind={inDebt ? 'failed' : balance > 0 ? 'delivered' : 'draft'}
          label={inDebt ? 'In debit' : balance > 0 ? 'In credit' : 'Settled'}
        />
      </Td>
      <Td align="right">
        <Link href={`/seller-wallets/${row.sellerId}`}>
          <Button variant="ghost" size="sm">
            Ledger →
          </Button>
        </Link>
      </Td>
    </Tr>
  );
}
