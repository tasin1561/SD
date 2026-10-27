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
  type WalletSyncFailureArtifact,
  type WalletSyncRun,
  type WalletSyncRunAccount,
  type WalletSyncWrite,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import { ShiprocketCostSection } from './shiprocket-cost-section';
import './cost-sync.css';
import { useT } from '@/i18n/client';

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
  const t = useT();
  return (
    <AfCard>
      <div className="af-row">
        <StatusChip kind={runTone(run)} label={runLabel(run)} />
        <span className="af-body">{fmtWhen(run.at)}</span>
        {!run.wrote && run.skipped === null && (
          // Worth its own line: a dry run reads the real file and
          // records nothing, so "it worked" and "the costs moved" are
          // different statements.
          <span className="af-small">{t('costSyncCostSyncIndex.writesAreOffItParsed')}</span>
        )}
      </div>

      {run.accounts.length === 0 ? (
        <p className="af-muted">
          {run.skipped === 'DISABLED'
            ? t('costSyncCostSyncIndex.theSyncIsSwitchedOff')
            : t('costSyncCostSyncIndex.noCourierAccountsWereEligible')}
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

/**
 * What was on screen when it failed.
 *
 * ── WHY THIS IS HERE AT ALL ──────────────────────────────────────────
 * The message above says what we were WAITING for. On 5 October 2026
 * that was "Timeout 120000ms exceeded while waiting for event download"
 * — equally true of a slower export, of a button that has become a
 * format menu, and of a page that was still drawing, and those need
 * three different fixes. The portal worker now screenshots the page, and
 * a screenshot nobody can reach is a screenshot nobody looks at.
 *
 * The links are PRESIGNED per request and short-lived, so they open in a
 * new tab and are never stored or shared — re-open the page for fresh
 * ones. Absent on every run from before the capture existed, which is
 * why nothing renders rather than an empty slot promising a file.
 */
function FailureArtifact({
  artifact: a,
}: {
  readonly artifact: WalletSyncFailureArtifact | null;
}): ReactElement | null {
  const t = useT();
  if (a === null) return null;
  const hasLink = a.screenshotUrl !== null || a.pageTextUrl !== null;
  if (!hasLink && a.url === null && a.control === null && a.problem === null) return null;
  return (
    <div className="af-small cs-artifact">
      {a.url !== null && <div>{t('costSyncCostSyncIndex.page', { url: a.url })}</div>}
      {/* The half the timeout cannot say: what was actually on the
          control we waited for. */}
      {a.control !== null && (
        <div>{t('costSyncCostSyncIndex.control', { control: a.control })}</div>
      )}
      {hasLink && (
        <div>
          {a.screenshotUrl !== null && (
            <a href={a.screenshotUrl} target="_blank" rel="noreferrer">
              {t('costSyncCostSyncIndex.screenshot')}
            </a>
          )}
          {a.screenshotUrl !== null && a.pageTextUrl !== null && ' · '}
          {a.pageTextUrl !== null && (
            <a href={a.pageTextUrl} target="_blank" rel="noreferrer">
              {t('costSyncCostSyncIndex.pageText')}
            </a>
          )}
        </div>
      )}
      {/* "There should be a capture and there is not" is a different
          fact from "nothing was captured", so it is said rather than
          swallowed. */}
      {a.problem !== null && <div>{a.problem}</div>}
    </div>
  );
}

function AccountResult({ account: a }: { readonly account: WalletSyncRunAccount }): ReactElement {
  const t = useT();
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
        <FailureArtifact artifact={a.failureArtifact} />
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
          {a.coveredDays !== null &&
            t('costSyncCostSyncIndex.days', { coveredDays: a.coveredDays })}
        </span>
      </div>
      <div className="cs-facts">
        <Fact
          label={t('costSyncCostSyncIndex.rowsRead')}
          value={a.rowsRead === null ? '—' : String(a.rowsRead)}
        />
        <Fact
          label={t('costSyncCostSyncIndex.ourParcels')}
          value={a.awbsInFile === null ? '—' : `${matched} of ${a.awbsInFile}`}
        />
        <Fact
          label={t('costSyncCostSyncIndex.costsWritten')}
          value={`${a.forwardWritten ?? 0} forward · ${a.rtoWritten ?? 0} RTO`}
        />
        <Fact label={t('costSyncCostSyncIndex.revised')} value={String(a.revised ?? 0)} />
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
            {t('costSyncCostSyncIndex.exportTotal')} <Money amount={a.sumInr} />
          </span>
        )}
        {a.totalsAgree === false && (
          // Their file disagreeing with itself is a real signal about
          // the export, not about us.
          <StatusChip
            size="sm"
            kind="failed"
            label={t('costSyncCostSyncIndex.theirStatedTotalDoesNot')}
          />
        )}
        {a.rangeApplied === false && (
          <StatusChip
            size="sm"
            kind="pending"
            label={t('costSyncCostSyncIndex.dateFilterWasNotApplied')}
          />
        )}
        {a.txnsMissing > 0 && (
          // Their ledger dropped transactions we held for dates this file
          // covers. Not a parse problem — a history change, and a system
          // issue says which ones.
          <StatusChip
            size="sm"
            kind="failed"
            label={t('costSyncCostSyncIndex.vanishedFromTheirLedger', {
              txnsMissing: a.txnsMissing,
            })}
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
  const t = useT();
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
              <p className="af-small">{t('costSyncCostSyncIndex.thisRunPredatesUsRecording')}</p>
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
  const t = useT();
  return (
    <div className="af-stack af-stack--tight">
      <ul className="af-list">
        {writes.map((w) => (
          <li key={`${w.leg}:${w.awbNumber}`} className="cs-write">
            {/* The order number first — it is what somebody recognises.
                The AWB is what the courier charged against, so both are
                here and the AWB is the one that pastes into search. */}
            <span className="af-strong sk-ident">
              {w.orderNumber ?? t('costSyncCostSyncIndex.noOrderLinked')}
            </span>
            <span className="af-small sk-ident">{w.awbNumber}</span>
            <span className="sk-figure">
              <Money amount={w.amountInr} />
            </span>
            {w.leg === 'rto' && (
              <StatusChip size="sm" kind="rto" label={t('costSyncCostSyncIndex.returnLeg')} />
            )}
            {w.revised && (
              // A figure that MOVED is the normal case on a later export
              // and a different fact from a first reading — worth telling
              // apart when a margin changes under somebody. The previous
              // figure is shown because "revised" alone does not say by
              // how much, or in which direction.
              <StatusChip
                size="sm"
                kind="pending"
                label={
                  w.previousInr === null
                    ? 'revised'
                    : t('costSyncCostSyncIndex.was', { previousInr: w.previousInr })
                }
              />
            )}
          </li>
        ))}
      </ul>
      {truncated > 0 && (
        <p className="af-small">{t('costSyncCostSyncIndex.andMoreNotListedThe', { truncated })}</p>
      )}
    </div>
  );
}

export function CostSyncIndex(): ReactElement {
  const t = useT();
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
      toast.success(t('costSyncCostSyncIndex.queuedItRunsInThe'));
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
        breadcrumbs={[
          { label: t('costSyncCostSyncIndex.network') },
          { label: t('costSyncCostSyncIndex.courierCostSync') },
        ]}
        Link={Link}
        title={t('costSyncCostSyncIndex.courierCostSync')}
        subtitle={t('costSyncCostSyncIndex.everyNightWeSignIn')}
      />

      {panel.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={4} cols={4} label={t('costSyncCostSyncIndex.loadingTheSync')} />
        </AfCard>
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={panel.error?.message ?? t('costSyncCostSyncIndex.couldNotLoadTheSync')}
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
                      ? t('costSyncCostSyncIndex.onReadingAndRecordingCosts')
                      : t('costSyncCostSyncIndex.onButNotRecordingIt')
                    : t('costSyncCostSyncIndex.switchedOffNoCourierCosts')}
                </p>
                <p className="af-small">
                  {t('costSyncCostSyncIndex.asksForTheLastDays', {
                    schedule: d.schedule,
                    windowDays: d.windowDays,
                  })}
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
                  {t('costSyncCostSyncIndex.runItNow')}
                </Button>
              )}
            </div>
            {canRun && <p className="af-small">{t('costSyncCostSyncIndex.thisQueuesTheJobFor')}</p>}
          </AfCard>

          <div className="af-kpis">
            <KpiCard
              label={t('costSyncCostSyncIndex.parcelsWithARealCost')}
              figure={`${d.cost.withForwardCost} / ${d.cost.dispatched}`}
              tone={
                STAT_TONE[
                  forwardGap === 0 ? 'good' : forwardGap > d.cost.dispatched / 2 ? 'bad' : 'warn'
                ]
              }
              // TRE-6: a missing cost is UNCOVERED, never zero. Zero
              // would report the whole of that revenue as profit.
              hint={t('costSyncCostSyncIndex.dispatchedParcelsWhoseCourierCharge')}
            />
            <KpiCard
              label={t('costSyncCostSyncIndex.returnsWithARealCost')}
              figure={`${d.cost.withRtoCost} / ${d.cost.returned}`}
              tone={
                STAT_TONE[
                  d.cost.returned === 0 || d.cost.withRtoCost === d.cost.returned ? 'good' : 'warn'
                ]
              }
              hint={t('costSyncCostSyncIndex.returnsAreBilledSeparatelyFrom')}
            />
            <KpiCard
              label={t('costSyncCostSyncIndex.forwardCostRecorded')}
              figure={<Money amount={d.cost.forwardTotalInr} />}
              hint={t('costSyncCostSyncIndex.theSumOfWhatThe')}
            />
            <KpiCard
              label={t('costSyncCostSyncIndex.returnCostRecorded')}
              figure={<Money amount={d.cost.rtoTotalInr} />}
              hint={t('costSyncCostSyncIndex.theSumOfWhatThe2')}
            />
          </div>

          {d.last !== null && <LastRun run={d.last} />}

          <AfSection title={t('costSyncCostSyncIndex.recentRuns')}>
            <Table>
              <THead>
                <Tr>
                  <Th>{t('costSyncCostSyncIndex.when')}</Th>
                  <Th>{t('costSyncCostSyncIndex.result')}</Th>
                  <Th>{t('costSyncCostSyncIndex.window')}</Th>
                  <Th>{t('costSyncCostSyncIndex.costsWritten')}</Th>
                  <Th>{t('costSyncCostSyncIndex.exportTotal')}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.history.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    <div className="af-stack af-stack--tight cs-empty">
                      <span className="af-strong">{t('costSyncCostSyncIndex.noRunsRecorded')}</span>
                      <span className="af-small">
                        {t('costSyncCostSyncIndex.eitherItHasNeverRun')}
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
        title={t('costSyncCostSyncIndex.runTheDelhiveryCostSync')}
        entity={t('costSyncCostSyncIndex.delhiveryWalletExport')}
        consequence={t('costSyncCostSyncIndex.thePortalWorkerSignsIn')}
        confirmLabel={t('costSyncCostSyncIndex.runItNow')}
        onConfirm={go}
      />
    </div>
  );
}
