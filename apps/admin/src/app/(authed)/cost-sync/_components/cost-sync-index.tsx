'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, PauseCircle, RefreshCw } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TableEmpty, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useRunWalletSync,
  useWalletSyncPanel,
  type WalletSyncRun,
  type WalletSyncRunAccount,
  type WalletSyncWrite,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import { ShiprocketCostSection } from './shiprocket-cost-section';
import './cost-sync.css';

/**
 * Is the nightly courier-cost sync actually working?
 *
 * ── THE FAILURE THIS PAGE IS FOR ─────────────────────────────────────
 * A cost sync that stops is INVISIBLE. The figures simply stop moving,
 * and nobody notices until a margin looks wrong weeks later. The job
 * already raises an issue when it throws — what nothing could show was
 * the quieter version: it ran, it succeeded, and it matched almost
 * nothing; or it was switched off months ago and every margin since has
 * been uncovered.
 *
 * So the page leads with the two things that answer "is this working":
 * whether it is switched on at all, and what the last run actually did.
 *
 * ── UNMATCHED ROWS ARE NORMAL, AND SAYING SO MATTERS ─────────────────
 * The courier's wallet export covers every parcel on that account, most
 * of which are not ours. A big "unknown" count is expected and is shown
 * as context rather than as a warning — presenting it as an error would
 * train people to ignore the number, and it is the same number that
 * would tell them something real if the matched count ever dropped to
 * nothing.
 */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function fmtDay(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function runTone(run: WalletSyncRun): 'delivered' | 'pending' | 'failed' {
  if (!run.ok) return 'failed';
  if (run.skipped !== null) return 'pending';
  return run.accounts.some((a) => a.error !== null) ? 'pending' : 'delivered';
}

function runLabel(run: WalletSyncRun): string {
  if (!run.ok) return 'Failed';
  if (run.skipped === 'DISABLED') return 'Switched off';
  if (run.skipped === 'NO_ACCOUNTS') return 'No accounts';
  if (run.accounts.some((a) => a.error !== null)) return 'Partly failed';
  return run.wrote ? 'Worked' : 'Worked (dry run)';
}

/** The legacy Stat tones, mapped onto the KPI card's. */
const STAT_TONE: Record<'good' | 'warn' | 'bad' | 'neutral', KpiTone> = {
  good: 'credit',
  warn: 'pending',
  bad: 'debit',
  neutral: 'neutral',
};

/** The last run, in full — the one somebody actually reads. */
function LastRun({ run }: { readonly run: WalletSyncRun }): ReactElement {
  return (
    <AfCard>
      <div className="af-row">
        <StatusChip kind={runTone(run)} label={runLabel(run)} />
        <span className="af-body">{fmtWhen(run.at)}</span>
        {!run.wrote && run.skipped === null && (
          // Worth its own line: a dry run reads the real file and
          // records nothing, so "it worked" and "the costs moved" are
          // different statements.
          <span className="af-small">
            Writes are off — it parsed the real file and changed nothing.
          </span>
        )}
      </div>

      {run.accounts.length === 0 ? (
        <p className="af-muted">
          {run.skipped === 'DISABLED'
            ? 'The sync is switched off, so it did nothing. No courier costs are being recorded.'
            : 'No courier accounts were eligible, so there was nothing to read.'}
        </p>
      ) : (
        <div className="af-stack">
          {run.accounts.map((a) => (
            <AccountResult key={a.courierAccountId || a.label} account={a} />
          ))}
        </div>
      )}
    </AfCard>
  );
}

function AccountResult({ account: a }: { readonly account: WalletSyncRunAccount }): ReactElement {
  if (a.error !== null) {
    return (
      <div className="af-inner" data-tone="bad">
        <p className="af-title cs-with-icon">
          <AlertTriangle size={14} aria-hidden className="af-bad" />
          {a.label}
        </p>
        {/* The courier's own words, verbatim — a paraphrase loses the
            only part that says what to check. */}
        <p className="af-small">{a.error}</p>
      </div>
    );
  }

  const matched = (a.awbsInFile ?? 0) - (a.unknownAwbs ?? 0);
  return (
    <div className="af-inner">
      <div className="af-row af-row--between">
        <span className="af-title">{a.label}</span>
        <span className="af-small">
          {fmtDay(a.periodFrom)} → {fmtDay(a.periodTo)}
          {a.coveredDays !== null && ` · ${a.coveredDays} days`}
        </span>
      </div>
      <div className="cs-facts">
        <Fact label="Rows read" value={a.rowsRead === null ? '—' : String(a.rowsRead)} />
        <Fact
          label="Our parcels"
          value={a.awbsInFile === null ? '—' : `${matched} of ${a.awbsInFile}`}
        />
        <Fact
          label="Costs written"
          value={`${a.forwardWritten ?? 0} forward · ${a.rtoWritten ?? 0} RTO`}
        />
        <Fact label="Revised" value={String(a.revised ?? 0)} />
      </div>
      {a.writes.length > 0 && (
        // Shown here as well as in the history, because this is the card
        // somebody reads first — sending them to a table row to find out
        // what the run they are looking at actually did would be a
        // strange piece of hide-and-seek.
        <div className="af-divider">
          <WrittenParcels writes={a.writes} truncated={a.writesTruncated} />
        </div>
      )}
      <div className="af-row">
        {a.sumInr !== null && (
          <span className="af-small">
            Export total <Money amount={a.sumInr} />
          </span>
        )}
        {a.totalsAgree === false && (
          // Their file disagreeing with itself is a real signal about
          // the export, not about us.
          <StatusChip size="sm" kind="failed" label="Their stated total does not match the rows" />
        )}
        {a.rangeApplied === false && (
          <StatusChip size="sm" kind="pending" label="Date filter was not applied" />
        )}
        {a.txnsMissing > 0 && (
          // Their ledger dropped transactions we held for dates this file
          // covers. Not a parse problem — a history change, and a system
          // issue says which ones.
          <StatusChip
            size="sm"
            kind="failed"
            label={`${a.txnsMissing} vanished from their ledger`}
          />
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="af-mini">
      <span className="af-mini__label">{label}</span>
      <span className="af-mini__value sk-figure">{value}</span>
    </div>
  );
}

/**
 * One run, and — when it wrote anything — WHICH parcels.
 *
 * The count answers "did it work". It does not answer "what did it do
 * to my orders", which is the question somebody actually has when a row
 * says it wrote sixteen. So the count is a disclosure control rather
 * than a number to be taken on trust.
 *
 * Collapsed by default: on a normal day every run writes a handful and
 * nobody needs the list, and thirteen expanded runs would bury the
 * shape of the history — which is what this table is for.
 */
function HistoryRow({ run }: { readonly run: WalletSyncRun }): ReactElement {
  const [open, setOpen] = useState(false);
  const written = run.accounts.reduce(
    (n, a) => n + (a.forwardWritten ?? 0) + (a.rtoWritten ?? 0),
    0,
  );
  const total = run.accounts.find((a) => a.sumInr !== null)?.sumInr ?? null;
  const writes = run.accounts.flatMap((a) => a.writes);
  const truncated = run.accounts.reduce((n, a) => n + a.writesTruncated, 0);
  // A run from before the detail was recorded is NOT a run that wrote
  // nothing, and conflating them would make the older half of this
  // table quietly lie. Only the count is known there, and it says so.
  const detailUnavailable = written > 0 && writes.length === 0;

  return (
    <>
      <Tr>
        <Td>
          <span className="af-nowrap">{fmtWhen(run.at)}</span>
        </Td>
        <Td>
          <StatusChip size="sm" kind={runTone(run)} label={runLabel(run)} />
        </Td>
        <Td>
          <span className="sk-figure">{run.windowDays === null ? '—' : `${run.windowDays}d`}</span>
        </Td>
        <Td>
          {written === 0 ? (
            <span className="sk-figure">0</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="af-disclose sk-figure"
            >
              <ChevronRight size={13} className="af-disclose__chev" aria-hidden />
              {written}
            </button>
          )}
        </Td>
        <Td>{total === null ? '—' : <Money amount={total} />}</Td>
      </Tr>
      {open && (
        <Tr>
          <Td colSpan={5}>
            {detailUnavailable ? (
              <p className="af-small">
                This run predates us recording which parcels were written, so only the count is
                known. Runs from here on list them.
              </p>
            ) : (
              <WrittenParcels writes={writes} truncated={truncated} />
            )}
          </Td>
        </Tr>
      )}
    </>
  );
}

function WrittenParcels({
  writes,
  truncated,
}: {
  readonly writes: readonly WalletSyncWrite[];
  readonly truncated: number;
}): ReactElement {
  return (
    <div className="af-stack af-stack--tight">
      <ul className="af-list">
        {writes.map((w) => (
          <li key={`${w.leg}:${w.awbNumber}`} className="cs-write">
            {/* The order number first — it is what somebody recognises.
                The AWB is what the courier charged against, so both are
                here and the AWB is the one that pastes into search. */}
            <span className="af-strong sk-ident">{w.orderNumber ?? 'No order linked'}</span>
            <span className="af-small sk-ident">{w.awbNumber}</span>
            <span className="sk-figure">
              <Money amount={w.amountInr} />
            </span>
            {w.leg === 'rto' && <StatusChip size="sm" kind="rto" label="return leg" />}
            {w.revised && (
              // A figure that MOVED is the normal case on a later export
              // and a different fact from a first reading — worth telling
              // apart when a margin changes under somebody. The previous
              // figure is shown because "revised" alone does not say by
              // how much, or in which direction.
              <StatusChip
                size="sm"
                kind="pending"
                label={w.previousInr === null ? 'revised' : `was ₹${w.previousInr}`}
              />
            )}
          </li>
        ))}
      </ul>
      {truncated > 0 && (
        <p className="af-small">…and {truncated} more, not listed. The count above is exact.</p>
      )}
    </div>
  );
}

export function CostSyncIndex(): ReactElement {
  const panel = useWalletSyncPanel();
  const run = useRunWalletSync();
  const canRun = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // A run is a real browser session against a courier login, so the
  // button asks first. Confirm sends the same request as before.
  const [confirming, setConfirming] = useState(false);

  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      await run.mutateAsync();
      // QUEUED, not finished. The work happens in the portal worker
      // and takes a minute or two; saying "finished" here would be a
      // straightforward lie, and the person would refresh, see the
      // old run, and conclude the button was broken.
      toast.success('Queued. It runs in the portal worker — refresh in a minute or two.');
    } catch (err) {
      // FE-2: the server's verdict verbatim.
      toast.error(serverVerdict(err));
    } finally {
      setBusy(false);
    }
  };

  const d = panel.data;
  const forwardGap = d === undefined ? 0 : d.cost.dispatched - d.cost.withForwardCost;

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Courier cost sync' }]}
        Link={Link}
        title="Courier cost sync"
        subtitle="Every night we sign in to the courier’s portal, download their wallet export and record what each parcel actually cost us. Without it every margin figure is a guess — and the way this fails is silence, so this page exists to be looked at."
      />

      {panel.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={4} cols={4} label="Loading the sync…" />
        </AfCard>
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={panel.error?.message ?? 'Could not load the sync.'}
          retry={() => void panel.refetch()}
        />
      ) : (
        <>
          <AfCard tone={d.enabled ? undefined : 'critical'}>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <p className="af-title cs-with-icon">
                  {d.enabled ? (
                    <CheckCircle2 size={15} aria-hidden className="af-good" />
                  ) : (
                    <PauseCircle size={15} aria-hidden className="af-bad" />
                  )}
                  {d.enabled
                    ? d.writesEnabled
                      ? 'On — reading and recording costs'
                      : 'On, but not recording — it reads the file and writes nothing'
                    : 'Switched off — no courier costs are being recorded at all'}
                </p>
                <p className="af-small">
                  {d.schedule} · asks for the last {d.windowDays} days each time
                </p>
              </div>
              {canRun && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  loading={busy}
                  onClick={() => setConfirming(true)}
                >
                  Run it now
                </Button>
              )}
            </div>
            {canRun && (
              <p className="af-small">
                This queues the job for the portal worker, which is the process that owns the
                browser — so the run starts in the background and takes a minute or two. Running it
                twice is harmless: the second import sees the same figures and records them as
                unchanged.
              </p>
            )}
          </AfCard>

          <div className="af-kpis">
            <KpiCard
              label="Parcels with a real cost"
              figure={`${d.cost.withForwardCost} / ${d.cost.dispatched}`}
              tone={
                STAT_TONE[
                  forwardGap === 0 ? 'good' : forwardGap > d.cost.dispatched / 2 ? 'bad' : 'warn'
                ]
              }
              // TRE-6: a missing cost is UNCOVERED, never zero. Zero
              // would report the whole of that revenue as profit.
              hint="Dispatched parcels whose courier charge we have actually read. The rest are uncovered — their margin is unknown, not zero."
            />
            <KpiCard
              label="Returns with a real cost"
              figure={`${d.cost.withRtoCost} / ${d.cost.returned}`}
              tone={
                STAT_TONE[
                  d.cost.returned === 0 || d.cost.withRtoCost === d.cost.returned ? 'good' : 'warn'
                ]
              }
              hint="Returns are billed separately from the delivery leg, so they are counted separately."
            />
            <KpiCard
              label="Forward cost recorded"
              figure={<Money amount={d.cost.forwardTotalInr} />}
              hint="The sum of what the courier actually charged us to deliver."
            />
            <KpiCard
              label="Return cost recorded"
              figure={<Money amount={d.cost.rtoTotalInr} />}
              hint="The sum of what the courier actually charged us to bring parcels back."
            />
          </div>

          {d.last !== null && <LastRun run={d.last} />}

          <AfSection title="Recent runs">
            <Table>
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>Result</Th>
                  <Th>Window</Th>
                  <Th>Costs written</Th>
                  <Th>Export total</Th>
                </Tr>
              </THead>
              <TBody>
                {d.history.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    <div className="af-stack af-stack--tight cs-empty">
                      <span className="af-strong">No runs recorded</span>
                      <span className="af-small">
                        Either it has never run, or it has never finished far enough to say so.
                      </span>
                    </div>
                  </TableEmpty>
                ) : (
                  d.history.map((r) => <HistoryRow key={r.at} run={r} />)
                )}
              </TBody>
            </Table>
          </AfSection>
        </>
      )}

      {/* Its own data and its own loading state: Shiprocket is read
          from their API by a different job, and a Delhivery panel that
          fails to load must not hide it. */}
      <ShiprocketCostSection />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Run the Delhivery cost sync now?"
        entity="Delhivery wallet export"
        consequence="The portal worker signs in to the courier's own website with our stored login and reads their wallet export; it takes a minute or two."
        confirmLabel="Run it now"
        onConfirm={go}
      />
    </div>
  );
}
