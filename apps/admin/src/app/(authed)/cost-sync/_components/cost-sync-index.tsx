'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, PauseCircle, RefreshCw } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
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
import {
  useRunWalletSync,
  useWalletSyncPanel,
  type WalletSyncRun,
  type WalletSyncRunAccount,
  type WalletSyncWrite,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { ShiprocketCostSection } from './shiprocket-cost-section';

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

/** The last run, in full — the one somebody actually reads. */
function LastRun({ run }: { readonly run: WalletSyncRun }): ReactElement {
  return (
    <Card className="mb-4">
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusBadge kind={runTone(run)} label={runLabel(run)} />
          <span className="text-sm">{fmtWhen(run.at)}</span>
          {!run.wrote && run.skipped === null && (
            // Worth its own line: a dry run reads the real file and
            // records nothing, so "it worked" and "the costs moved" are
            // different statements.
            <span className="text-text-muted text-xs">
              Writes are off — it parsed the real file and changed nothing.
            </span>
          )}
        </div>

        {run.accounts.length === 0 ? (
          <p className="text-text-muted text-sm">
            {run.skipped === 'DISABLED'
              ? 'The sync is switched off, so it did nothing. No courier costs are being recorded.'
              : 'No courier accounts were eligible, so there was nothing to read.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {run.accounts.map((a) => (
              <AccountResult key={a.courierAccountId || a.label} account={a} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AccountResult({ account: a }: { readonly account: WalletSyncRunAccount }): ReactElement {
  if (a.error !== null) {
    return (
      <div className="border-status-failed/40 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={14} className="text-status-failed" />
          {a.label}
        </div>
        {/* The courier's own words, verbatim — a paraphrase loses the
            only part that says what to check. */}
        <p className="text-text-muted mt-1 text-xs">{a.error}</p>
      </div>
    );
  }

  const matched = (a.awbsInFile ?? 0) - (a.unknownAwbs ?? 0);
  return (
    <div className="border-border rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{a.label}</span>
        <span className="text-text-muted text-xs">
          {fmtDay(a.periodFrom)} → {fmtDay(a.periodTo)}
          {a.coveredDays !== null && ` · ${a.coveredDays} days`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
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
        <div className="border-border mt-2 border-t pt-2">
          <WrittenParcels writes={a.writes} truncated={a.writesTruncated} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {a.sumInr !== null && (
          <span className="text-text-muted">
            Export total <Money amount={a.sumInr} />
          </span>
        )}
        {a.totalsAgree === false && (
          // Their file disagreeing with itself is a real signal about
          // the export, not about us.
          <StatusBadge kind="failed" label="Their stated total does not match the rows" />
        )}
        {a.rangeApplied === false && (
          <StatusBadge kind="pending" label="Date filter was not applied" />
        )}
        {a.txnsMissing > 0 && (
          // Their ledger dropped transactions we held for dates this file
          // covers. Not a parse problem — a history change, and a system
          // issue says which ones.
          <StatusBadge kind="failed" label={`${a.txnsMissing} vanished from their ledger`} />
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div>
      <div className="text-text-muted">{label}</div>
      <div className="tabular-nums">{value}</div>
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
        <Td>{fmtWhen(run.at)}</Td>
        <Td>
          <StatusBadge kind={runTone(run)} label={runLabel(run)} />
        </Td>
        <Td className="tabular-nums">{run.windowDays === null ? '—' : `${run.windowDays}d`}</Td>
        <Td>
          {written === 0 ? (
            <span className="tabular-nums">0</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="hover:text-accent inline-flex items-center gap-1 tabular-nums"
            >
              <ChevronRight
                size={13}
                className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
                aria-hidden
              />
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
              <p className="text-text-muted py-1 text-xs">
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
    <div className="py-1">
      <div className="flex flex-col gap-1">
        {writes.map((w) => (
          <div
            key={`${w.leg}:${w.awbNumber}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs"
          >
            {/* The order number first — it is what somebody recognises.
                The AWB is what the courier charged against, so both are
                here and the AWB is the one that pastes into search. */}
            <span className="font-medium">{w.orderNumber ?? 'No order linked'}</span>
            <span className="text-text-muted tabular-nums">{w.awbNumber}</span>
            <span className="tabular-nums">
              <Money amount={w.amountInr} />
            </span>
            {w.leg === 'rto' && <StatusBadge kind="rto" label="return leg" />}
            {w.revised && (
              // A figure that MOVED is the normal case on a later export
              // and a different fact from a first reading — worth telling
              // apart when a margin changes under somebody. The previous
              // figure is shown because "revised" alone does not say by
              // how much, or in which direction.
              <StatusBadge
                kind="pending"
                label={w.previousInr === null ? 'revised' : `was ₹${w.previousInr}`}
              />
            )}
          </div>
        ))}
      </div>
      {truncated > 0 && (
        <p className="text-text-muted mt-1.5 text-xs">
          …and {truncated} more, not listed. The count above is exact.
        </p>
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

  const go = (): void => {
    setBusy(true);
    void (async () => {
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
    })();
  };

  const d = panel.data;
  const forwardGap = d === undefined ? 0 : d.cost.dispatched - d.cost.withForwardCost;

  return (
    <Section>
      <PageHeader
        title="Courier cost sync"
        subtitle="Every night we sign in to the courier’s portal, download their wallet export and record what each parcel actually cost us. Without it every margin figure is a guess — and the way this fails is silence, so this page exists to be looked at."
      />

      {panel.isLoading ? (
        <LoadingState label="Loading the sync…" />
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={panel.error?.message ?? 'Could not load the sync.'}
          retry={() => void panel.refetch()}
        />
      ) : (
        <>
          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-text-strong flex items-center gap-2 text-sm font-medium">
                    {d.enabled ? (
                      <CheckCircle2 size={15} className="text-status-delivered" />
                    ) : (
                      <PauseCircle size={15} className="text-status-failed" />
                    )}
                    {d.enabled
                      ? d.writesEnabled
                        ? 'On — reading and recording costs'
                        : 'On, but not recording — it reads the file and writes nothing'
                      : 'Switched off — no courier costs are being recorded at all'}
                  </p>
                  <p className="text-text-muted mt-0.5 text-xs">
                    {d.schedule} · asks for the last {d.windowDays} days each time
                  </p>
                </div>
                {canRun && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={go}>
                    <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />
                    {busy ? 'Running…' : 'Run it now'}
                  </Button>
                )}
              </div>
              {canRun && (
                <p className="text-text-muted mt-2 text-xs">
                  This queues the job for the portal worker, which is the process that owns the
                  browser — so the run starts in the background and takes a minute or two. Running
                  it twice is harmless: the second import sees the same figures and records them as
                  unchanged.
                </p>
              )}
            </CardBody>
          </Card>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Parcels with a real cost"
              value={`${d.cost.withForwardCost} / ${d.cost.dispatched}`}
              tone={forwardGap === 0 ? 'good' : forwardGap > d.cost.dispatched / 2 ? 'bad' : 'warn'}
              // TRE-6: a missing cost is UNCOVERED, never zero. Zero
              // would report the whole of that revenue as profit.
              hint="Dispatched parcels whose courier charge we have actually read. The rest are uncovered — their margin is unknown, not zero."
            />
            <Stat
              label="Returns with a real cost"
              value={`${d.cost.withRtoCost} / ${d.cost.returned}`}
              tone={
                d.cost.returned === 0 || d.cost.withRtoCost === d.cost.returned ? 'good' : 'warn'
              }
              hint="Returns are billed separately from the delivery leg, so they are counted separately."
            />
            <Stat
              label="Forward cost recorded"
              value={<Money amount={d.cost.forwardTotalInr} />}
              hint="The sum of what the courier actually charged us to deliver."
            />
            <Stat
              label="Return cost recorded"
              value={<Money amount={d.cost.rtoTotalInr} />}
              hint="The sum of what the courier actually charged us to bring parcels back."
            />
          </div>

          {d.last !== null && <LastRun run={d.last} />}

          <Card>
            <CardBody>
              <h2 className="mb-3 text-sm font-medium">Recent runs</h2>
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
                      <div className="flex flex-col items-center gap-1.5 py-2">
                        <div className="font-medium">No runs recorded</div>
                        <div className="text-text-muted text-xs">
                          Either it has never run, or it has never finished far enough to say so.
                        </div>
                      </div>
                    </TableEmpty>
                  ) : (
                    d.history.map((r) => <HistoryRow key={r.at} run={r} />)
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}

      {/* Its own data and its own loading state: Shiprocket is read
          from their API by a different job, and a Delhivery panel that
          fails to load must not hide it. */}
      <ShiprocketCostSection />
    </Section>
  );
}
