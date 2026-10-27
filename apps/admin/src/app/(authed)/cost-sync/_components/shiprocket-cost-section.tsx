'use client';

import { useState, type ReactElement } from 'react';
import { CheckCircle2, PauseCircle, RefreshCw } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { Table, TableEmpty, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useRunShiprocketCost,
  useRunShiprocketInvoiceCheck,
  useRunShiprocketPortalProbe,
  useRunShiprocketWalletSync,
  useShiprocketCostPanel,
  type ShiprocketCostRunView,
  type ShiprocketEgressView,
  type ShiprocketInvoiceAccountView,
  type ShiprocketInvoiceRowView,
  type ShiprocketInvoiceRunView,
  type ShiprocketWalletAccountView,
  type ShiprocketWalletRunView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import './cost-sync.css';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage } from '@/i18n/client';

/** The legacy Stat tones, mapped onto the KPI card's. */
const STAT_TONE: Record<'good' | 'warn' | 'bad' | 'neutral', KpiTone> = {
  good: 'credit',
  warn: 'pending',
  bad: 'debit',
  neutral: 'neutral',
};

type RunKind = 'bills' | 'wallet' | 'probe' | 'invoices';

/** What each browser-driven run is, restated in its confirm. */
const BROWSER_RUNS = (
  t: Translate<MessageKey>,
): Record<
  Exclude<RunKind, 'bills'>,
  { title: string; entity: string; label: string; done: string }
> => ({
  wallet: {
    title: t('costSyncShiprocketCostSection.runTheShiprocketWalletSync'),
    entity: t('costSyncShiprocketCostSection.entityWallet'),
    label: t('costSyncShiprocketCostSection.runWalletSyncNow'),
    done: t('costSyncShiprocketCostSection.queuedItSignsInAnd'),
  },
  invoices: {
    title: t('costSyncShiprocketCostSection.checkShiprocketInvoicesNow'),
    entity: t('costSyncShiprocketCostSection.entityInvoices'),
    label: t('costSyncShiprocketCostSection.checkInvoicesNow'),
    done: t('costSyncShiprocketCostSection.queuedItSignsInAnd2'),
  },
  probe: {
    title: t('costSyncShiprocketCostSection.checkShiprocketWebsiteAccessNow'),
    entity: t('costSyncShiprocketCostSection.entityProbe'),
    label: t('costSyncShiprocketCostSection.checkWebsiteAccess'),
    done: t('costSyncShiprocketCostSection.queuedItSignsInThrough'),
  },
});

/**
 * The route the panel browser takes and the address it presents, in one
 * sentence — because the two only mean something together. A reading
 * from a VPN the browser does not go through vouches for nothing, and
 * that is exactly the mistake this line exists to make visible.
 */
function egressLine(
  tr: Translate<MessageKey>,
  t: Translate<MessageKey>,
  e: ShiprocketEgressView,
): string {
  const route =
    e.proxy === null
      ? t('costSyncShiprocketCostSection.noRouteIsSetSo')
      : t('costSyncShiprocketCostSection.goesOutThrough', { proxy: e.proxy });
  if (!e.checked) return t('costSyncShiprocketCostSection.whereItComesOutIs', { route });
  if (e.status === 'DOWN')
    return tr('costSyncShiprocketCostSection.runsAreRefused', {
      route,
      value: e.summary ?? tr('costSyncShiprocketCostSection.theCheckFailed'),
    });
  const where = e.summary ?? 'somewhere';
  return e.countryMismatch
    ? t('costSyncShiprocketCostSection.runsAreRefusedItComes', {
        route,
        where,
        value: e.expectedCountry ?? '—',
      })
    : t('costSyncShiprocketCostSection.comesOutAt', { route, where });
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function billCheckLabel(t: Translate<MessageKey>, run: ShiprocketCostRunView): string {
  if (!run.ok) return t('costSyncShiprocketCostSection.failed');
  if (run.skipped === 'DISABLED') return t('costSyncShiprocketCostSection.switchedOffCap');
  if (run.skipped === 'STUB_MODE')
    return t('costSyncShiprocketCostSection.skippedShiprocketIsInStub');
  if (run.skipped === 'NO_ACCOUNTS')
    return t('costSyncShiprocketCostSection.noShiprocketAccountWithA');
  if (run.accounts.some((a) => a.error !== null))
    return t('costSyncShiprocketCostSection.partlyFailed');
  return t('costSyncShiprocketCostSection.worked');
}

function walletLabel(t: Translate<MessageKey>, run: ShiprocketWalletRunView): string {
  if (run.skipped === 'DISABLED') return t('costSyncShiprocketCostSection.switchedOffCap');
  if (run.skipped === 'NO_ACCOUNTS') return t('costSyncShiprocketCostSection.noShiprocketAccount');
  if (!run.ok) return t('costSyncShiprocketCostSection.failed');
  if (run.accounts.some((a) => a.outcome !== 'READ'))
    return t('costSyncShiprocketCostSection.partlyFailed');
  return run.wrote
    ? t('costSyncShiprocketCostSection.worked')
    : t('costSyncShiprocketCostSection.workedNotRecording');
}

function invoiceRunLabel(t: Translate<MessageKey>, run: ShiprocketInvoiceRunView): string {
  if (run.skipped === 'DISABLED') return t('costSyncShiprocketCostSection.switchedOffCap');
  if (run.skipped === 'NO_ACCOUNTS') return t('costSyncShiprocketCostSection.noShiprocketAccount');
  if (!run.ok) return t('costSyncShiprocketCostSection.failed');
  if (run.accounts.some((a) => a.outcome !== 'CHECKED'))
    return t('costSyncShiprocketCostSection.partlyFailed');
  const differing = run.accounts.reduce(
    (n, a) => n + (a.result?.rows.filter((r) => r.status === 'DIFFERS').length ?? 0),
    0,
  );
  return differing === 0
    ? t('costSyncShiprocketCostSection.everyInvoiceMatchesTheWallet')
    : t('costSyncShiprocketCostSection.invoiceSDisagree', { differing });
}

/** One invoice's verdict, in words. */
function InvoiceResult({ r }: { readonly r: ShiprocketInvoiceRowView }): ReactElement {
  const t = useT();
  if (r.status === 'MATCHES') {
    return <span className="af-good">{t('costSyncShiprocketCostSection.matchesTheWallet')}</span>;
  }
  if (r.status === 'NOT_ITEMIZED') {
    return (
      <span className="af-small">{t('costSyncShiprocketCostSection.noItemizedFileToCheck')}</span>
    );
  }
  if (r.status === 'UNREADABLE') {
    return (
      <span className="af-bad">
        {t('costSyncShiprocketCostSection.couldNotBeRead')}
        {r.problem !== null && ` — ${r.problem}`}
      </span>
    );
  }
  const parts: string[] = [];
  if (r.totalsAgree === false)
    parts.push(t('costSyncShiprocketCostSection.fileAddsUpTo', { amount: r.itemizedInr ?? '?' }));
  if (r.differenceCount > 0) {
    parts.push(
      t('costSyncShiprocketCostSection.ordersBilledDifferently', {
        count: r.differenceCount,
        net: r.differenceInr,
      }),
    );
  }
  if (r.unknownServices.length > 0)
    parts.push(
      t('costSyncShiprocketCostSection.unknownService', { services: r.unknownServices.join(', ') }),
    );
  return <span className="af-bad">{parts.join(' · ')}</span>;
}

/** One account's invoices: a line each, then what no invoice has billed. */
function InvoiceAccountBlock({ a }: { readonly a: ShiprocketInvoiceAccountView }): ReactElement {
  const t = useT();

  const res = a.result;
  const rows =
    res === null ? [] : [...res.rows].sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate));
  return (
    <div className="cs-account">
      <div className="af-small">
        <span className="af-strong">{a.label}</span> ·{' '}
        {a.outcome === 'CHECKED'
          ? t('costSyncShiprocketCostSection.invoiceSRead', { invoicesRead: a.invoicesRead })
          : (OUTCOME_WORDS(t)[a.outcome] ?? a.outcome)}
        {a.detail !== null && <span> — {a.detail}</span>}
      </div>
      {res !== null && (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>{t('costSyncShiprocketCostSection.invoice')}</Th>
                <Th>{t('costSyncShiprocketCostSection.type')}</Th>
                <Th>{t('costSyncShiprocketCostSection.date')}</Th>
                <Th>{t('costSyncShiprocketCostSection.amount')}</Th>
                <Th>{t('costSyncShiprocketCostSection.againstTheWallet')}</Th>
                <Th>{t('costSyncShiprocketCostSection.disputeBy')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={6}>
                  {t('costSyncShiprocketCostSection.noInvoicesInTheWindow')}
                </TableEmpty>
              ) : (
                rows.map((r) => (
                  <Tr key={r.invoiceId}>
                    <Td>
                      <span className="sk-ident">{r.invoiceId}</span>
                    </Td>
                    <Td>{r.serviceType}</Td>
                    <Td>{r.invoiceDate}</Td>
                    <Td>
                      <Money amount={r.totalInr} />
                    </Td>
                    <Td>
                      <InvoiceResult r={r} />
                      {r.beforeRecords > 0 && (
                        <span className="af-small cs-block">
                          {t('costSyncShiprocketCostSection.lineSOlderThanOur', {
                            beforeRecords: r.beforeRecords,
                          })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {r.status === 'DIFFERS' && r.disputeOpen ? (
                        <span className="af-bad af-strong">{r.disputeBy}</span>
                      ) : (
                        <span className="af-small">{r.disputeBy}</span>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
          <p className="af-small">
            {t('costSyncShiprocketCostSection.vasChargedButNeverInvoiced')}{' '}
            {res.vasUninvoiced.count === 0 ? (
              'none'
            ) : (
              <>
                {res.vasUninvoiced.count}, <Money amount={res.vasUninvoiced.inr} />{' '}
                {t('costSyncShiprocketCostSection.namedOnSystemIssues')}
              </>
            )}{' '}
            {richMessage(t('costSyncShiprocketCostSection.freightNotInvoicedYetOrder'), {
              value: res.freightUninvoiced.orders.toLocaleString('en-IN'),
              money: <Money amount={res.freightUninvoiced.inr} />,
            })}
            {res.freightUninvoiced.staleCount > 0 &&
              t('costSyncShiprocketCostSection.chargedOver60DaysAgo', {
                staleCount: res.freightUninvoiced.staleCount,
              })}
          </p>
        </>
      )}
    </div>
  );
}

const OUTCOME_WORDS = (t: Translate<MessageKey>): Readonly<Record<string, string>> => ({
  CHECKED: 'checked',
  READ: 'read',
  REFUSED: t('costSyncShiprocketCostSection.refusedTheirBalancesDidNot'),
  SKIPPED: t('costSyncShiprocketCostSection.skippedASignInChallenge'),
  CHALLENGE: t('costSyncShiprocketCostSection.stoppedAtASignIn'),
  NO_LOGIN: t('costSyncShiprocketCostSection.noWebsiteLoginStored'),
  FAILED: 'failed',
});

/** One account's night, in the words somebody checking it would use. */
function WalletAccountLine({ a }: { readonly a: ShiprocketWalletAccountView }): ReactElement {
  const t = useT();

  const i = a.import;
  const written = i === null ? 0 : i.forwardWritten + i.rtoWritten;
  return (
    <li className="af-stack af-stack--tight af-small">
      <div>
        <span className="af-strong">{a.label}</span> · {OUTCOME_WORDS(t)[a.outcome] ?? a.outcome}
        {a.detail !== null && <span> — {a.detail}</span>}
      </div>
      {a.outcome === 'READ' && i !== null && (
        <div>
          {t('costSyncShiprocketCostSection.movementsReadBalancesAddUp', {
            value: a.passbookRows.toLocaleString('en-IN'),
            value2: i.txnsNew.toLocaleString('en-IN'),
            value3: i.txnsAlreadyHeld.toLocaleString('en-IN'),
            value4: i.dryRun
              ? t('costSyncShiprocketCostSection.wouldWrite')
              : t('costSyncShiprocketCostSection.wrote'),
            written,
          })}
          {i.revised > 0 && t('costSyncShiprocketCostSection.revised', { revised: i.revised })}{' '}
          {t('costSyncShiprocketCostSection.accountAdjustmentSNet', {
            adjustments: i.adjustments,
          })}{' '}
          <Money amount={i.adjustmentsNetInr} />
          {i.txnsMissing > 0 &&
            t('costSyncShiprocketCostSection.vanishedFromTheirPassbook', {
              txnsMissing: i.txnsMissing,
            })}
          {i.txnsMutated > 0 &&
            t('costSyncShiprocketCostSection.changed', { txnsMutated: i.txnsMutated })}
          {i.incompleteHistory > 0 &&
            t('costSyncShiprocketCostSection.parcelSNetBelowZero', {
              incompleteHistory: i.incompleteHistory,
            })}
        </div>
      )}
      {a.recharges !== null && (
        <div>
          {t('costSyncShiprocketCostSection.rechargesOfMatchedToOur', {
            matched: a.recharges.matched,
            seen: a.recharges.seen,
          })}
          {a.recharges.unrecorded > 0 &&
            t('costSyncShiprocketCostSection.notInOurBooks', {
              unrecorded: a.recharges.unrecorded,
            })}
          {a.recharges.amountMismatched > 0 &&
            t('costSyncShiprocketCostSection.withADifferentAmount', {
              amountMismatched: a.recharges.amountMismatched,
            })}
        </div>
      )}
      {a.ledger !== null && (
        <div>
          {t('costSyncShiprocketCostSection.ledgerOfCreditsFoundIn', {
            value: a.ledger.checked - a.ledger.uncovered.length,
            checked: a.ledger.checked,
            value2:
              a.ledger.uncovered.length > 0
                ? t('costSyncShiprocketCostSection.theRestAreNamedOn')
                : '',
            documents: a.ledger.documents,
          })}
        </div>
      )}
    </li>
  );
}

/**
 * Shiprocket's costs, beside Delhivery's.
 *
 * The WALLET SYNC is the one that records: their passbook read nightly off
 * app.shiprocket.in, every movement stored once, each parcel's cost netted
 * from them exactly as Delhivery's are. The API run beneath it only
 * CHECKS — it reads each order's final bill and names any that disagrees
 * with what the wallet charged. Two writers would take turns.
 */
export function ShiprocketCostSection(): ReactElement {
  const tr = useT();
  const t = useT();

  const panel = useShiprocketCostPanel();
  const run = useRunShiprocketCost();
  const wallet = useRunShiprocketWalletSync();
  const probe = useRunShiprocketPortalProbe();
  const invoices = useRunShiprocketInvoiceCheck();
  const canRun = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [busy, setBusy] = useState<RunKind | null>(null);
  // Wallet sync, invoice check and the website probe each sign in to the
  // courier's own website with our stored login, so each asks first. The
  // final-bill check reads their API and stays one click.
  const [confirming, setConfirming] = useState<Exclude<RunKind, 'bills'> | null>(null);

  const queue = async (which: RunKind, done: string): Promise<void> => {
    setBusy(which);
    try {
      if (which === 'bills') await run.mutateAsync();
      else if (which === 'wallet') await wallet.mutateAsync();
      else if (which === 'invoices') await invoices.mutateAsync();
      else await probe.mutateAsync();
      toast.success(done);
    } catch (err) {
      toast.error(serverVerdict(err));
      // Rejects so a rolling-label button shows the refusal.
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const d = panel.data;
  const lastWallet = d?.walletSyncs[0] ?? null;
  const lastInvoices = d?.invoiceChecks[0] ?? null;
  const lastBills = d?.last ?? null;
  const disagree = lastBills?.accounts.reduce((n, a) => n + a.ledgerDisagrees, 0) ?? 0;
  const recorded =
    d?.parcels.filter((p) => p.recordedForwardInr !== null || p.recordedRtoInr !== null).length ??
    0;

  const runButton = (which: Exclude<RunKind, 'bills'>): ReactElement => (
    <Button
      variant="secondary"
      size="sm"
      icon={<RefreshCw size={14} />}
      loading={busy === which}
      disabled={busy !== null}
      onClick={() => setConfirming(which)}
    >
      {BROWSER_RUNS(t)[which].label}
    </Button>
  );

  return (
    <section className="af-section">
      <SectionHeading title={t('costSyncShiprocketCostSection.shiprocket')} />
      {panel.isLoading ? (
        <AfCard flush>
          <SkeletonRows
            rows={4}
            cols={4}
            label={t('costSyncShiprocketCostSection.loadingShiprocketCosts')}
          />
        </AfCard>
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={
            panel.error?.message ?? t('costSyncShiprocketCostSection.couldNotLoadShiprocketCosts')
          }
          retry={() => void panel.refetch()}
        />
      ) : (
        <>
          <AfCard>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <p className="af-title cs-with-icon">
                  {lastWallet !== null && lastWallet.ok && d.writesEnabled ? (
                    <CheckCircle2 size={15} aria-hidden className="af-good" />
                  ) : (
                    <PauseCircle size={15} aria-hidden className="af-bad" />
                  )}
                  {t('costSyncShiprocketCostSection.walletSync', {
                    value:
                      lastWallet === null
                        ? t('costSyncShiprocketCostSection.hasNotRunYet')
                        : walletLabel(t, lastWallet),
                  })}
                </p>
                <p className="af-small">
                  {t('costSyncShiprocketCostSection.everyNightAt0350', {
                    value: !d.writesEnabled
                      ? t('costSyncShiprocketCostSection.notRecordingItReadsAnd')
                      : '',
                  })}
                </p>
              </div>
              {canRun && runButton('wallet')}
            </div>
            {lastWallet !== null && (
              <ul className="af-list af-stack">
                {lastWallet.accounts.map((a) => (
                  <WalletAccountLine key={a.courierAccountId} a={a} />
                ))}
                <li className="af-small">
                  {lastWallet.trigger === 'MANUAL'
                    ? t('costSyncShiprocketCostSection.runByHand')
                    : t('costSyncShiprocketCostSection.nightlyRun')}{' '}
                  · {fmtWhen(lastWallet.at)}
                  {lastWallet.windowDays !== null &&
                    t('costSyncShiprocketCostSection.lastDays', {
                      windowDays: lastWallet.windowDays,
                    })}
                </li>
              </ul>
            )}
          </AfCard>

          <AfCard>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <p className="af-title cs-with-icon">
                  {lastInvoices !== null &&
                  lastInvoices.ok &&
                  invoiceRunLabel(t, lastInvoices) === 'every invoice matches the wallet' ? (
                    <CheckCircle2 size={15} aria-hidden className="af-good" />
                  ) : (
                    <PauseCircle size={15} aria-hidden className="af-bad" />
                  )}
                  {t('costSyncShiprocketCostSection.invoiceCheck', {
                    value:
                      lastInvoices === null
                        ? t('costSyncShiprocketCostSection.hasNotRunYet')
                        : invoiceRunLabel(t, lastInvoices),
                  })}
                </p>
                <p className="af-small">{t('costSyncShiprocketCostSection.everyNightAt0430')}</p>
              </div>
              {canRun && runButton('invoices')}
            </div>
            {lastInvoices !== null && (
              <>
                {lastInvoices.accounts.map((a) => (
                  <InvoiceAccountBlock key={a.courierAccountId} a={a} />
                ))}
                <p className="af-small">
                  {lastInvoices.trigger === 'MANUAL'
                    ? t('costSyncShiprocketCostSection.runByHand')
                    : t('costSyncShiprocketCostSection.nightlyRun')}{' '}
                  · {fmtWhen(lastInvoices.at)}
                  {lastInvoices.windowDays !== null &&
                    t('costSyncShiprocketCostSection.invoicesFromTheLastDays', {
                      windowDays: lastInvoices.windowDays,
                    })}
                </p>
              </>
            )}
          </AfCard>

          <div className="af-kpis">
            <KpiCard
              label={t('costSyncShiprocketCostSection.walletBalance')}
              figure={
                d.balances[0] === undefined ? '—' : <Money amount={d.balances[0].balanceInr} />
              }
              hint={
                d.balances[0] === undefined
                  ? t('costSyncShiprocketCostSection.notReadYet')
                  : t('costSyncShiprocketCostSection.asRead', {
                      value: fmtWhen(d.balances[0].capturedAt),
                    })
              }
            />
            <KpiCard
              label={t('costSyncShiprocketCostSection.parcelsWithARecordedCost')}
              figure={`${recorded} / ${d.parcels.length}`}
              tone={
                STAT_TONE[d.parcels.length === 0 || recorded === d.parcels.length ? 'good' : 'warn']
              }
              hint={t('costSyncShiprocketCostSection.nettedFromTheirPassbookA')}
            />
            {lastBills === null ? (
              <KpiCard
                label={t('costSyncShiprocketCostSection.finalBillsThatDisagree')}
                figure="—"
                tone={STAT_TONE.neutral}
                hint={t('costSyncShiprocketCostSection.theirFinalBilledAmountAgainst')}
              />
            ) : (
              <KpiCard
                label={t('costSyncShiprocketCostSection.finalBillsThatDisagree')}
                value={disagree}
                tone={STAT_TONE[disagree === 0 ? 'good' : 'bad']}
                hint={t('costSyncShiprocketCostSection.theirFinalBilledAmountAgainst')}
              />
            )}
            <KpiCard
              label={t('costSyncShiprocketCostSection.lastBillCheck')}
              figure={
                lastBills === null
                  ? t('costSyncShiprocketCostSection.never')
                  : billCheckLabel(t, lastBills)
              }
              tone={STAT_TONE[lastBills === null || !lastBills.ok ? 'bad' : 'good']}
              hint={
                lastBills === null
                  ? t('costSyncShiprocketCostSection.itHasNotRunYet')
                  : fmtWhen(lastBills.at)
              }
            />
          </div>

          <AfCard>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <p className="af-title cs-with-icon">
                  {d.enabled && !d.stubMode ? (
                    <CheckCircle2 size={15} aria-hidden className="af-good" />
                  ) : (
                    <PauseCircle size={15} aria-hidden className="af-bad" />
                  )}
                  {t('costSyncShiprocketCostSection.finalBillCheck', {
                    value: d.stubMode
                      ? t('costSyncShiprocketCostSection.notRunningShiprocketIsIn')
                      : !d.enabled
                        ? t('costSyncShiprocketCostSection.switchedOff')
                        : t('costSyncShiprocketCostSection.on'),
                  })}
                </p>
                <p className="af-small">
                  {t('costSyncShiprocketCostSection.readsEachOrderSCharges', {
                    schedule: d.schedule,
                  })}
                </p>
              </div>
              {canRun && (
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  labels={{
                    idle: t('costSyncShiprocketCostSection.checkBillsNow'),
                    busy: t('costSyncShiprocketCostSection.queuing'),
                    done: t('costSyncShiprocketCostSection.queued'),
                  }}
                  disabled={busy !== null}
                  onAction={() =>
                    queue('bills', t('costSyncShiprocketCostSection.queuedItReadsEveryShiprocket'))
                  }
                />
              )}
            </div>
          </AfCard>

          <AfCard>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <h3 className="af-title">
                  {t('costSyncShiprocketCostSection.shiprocketWebsiteAccess')}
                </h3>
                <p className="af-small">{t('costSyncShiprocketCostSection.signsInAndSavesWhat')}</p>
              </div>
              {canRun && runButton('probe')}
            </div>
            <p
              className={
                d.egress.status === 'DOWN' || d.egress.countryMismatch
                  ? 'af-small af-bad'
                  : 'af-small'
              }
            >
              {egressLine(tr, t, d.egress)}
            </p>
            {d.portalProbe === null ? (
              <p className="af-small">{t('costSyncShiprocketCostSection.neverChecked')}</p>
            ) : (
              <ul className="af-list af-small">
                {d.portalProbe.accounts.map((a) => (
                  <li key={a.courierAccountId}>
                    <span className="af-strong">{a.label}</span> · {a.outcome}
                    {a.pages.length > 0 &&
                      ` · ${a.pages
                        .map((p) => `${p.tab}${p.landedOnLogin ? ' (bounced to login)' : ''}`)
                        .join(', ')}`}
                    {a.detail !== null && <span> — {a.detail}</span>}
                  </li>
                ))}
                <li>
                  {t('costSyncShiprocketCostSection.checked', { value: fmtWhen(d.portalProbe.at) })}
                </li>
              </ul>
            )}
          </AfCard>

          <div className="af-section">
            <SectionHeading
              title={t('costSyncShiprocketCostSection.ourShiprocketParcels')}
              as="h3"
            />
            <Table>
              <THead>
                <Tr>
                  <Th>{t('costSyncShiprocketCostSection.order')}</Th>
                  <Th>AWB</Th>
                  <Th>{t('costSyncShiprocketCostSection.theirStatus')}</Th>
                  <Th>{t('costSyncShiprocketCostSection.chargedSoFarEstimate')}</Th>
                  <Th>{t('costSyncShiprocketCostSection.finalBill')}</Th>
                  <Th>{t('costSyncShiprocketCostSection.recordedCostWallet')}</Th>
                  <Th>{t('costSyncShiprocketCostSection.lastRead')}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.parcels.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    <div className="af-stack af-stack--tight cs-empty">
                      <span className="af-strong">
                        {t('costSyncShiprocketCostSection.noShiprocketParcelsReadYet')}
                      </span>
                      <span className="af-small">
                        {t('costSyncShiprocketCostSection.parcelsAppearHereAfterThe')}
                      </span>
                    </div>
                  </TableEmpty>
                ) : (
                  d.parcels.map((p) => {
                    const fwd = p.recordedForwardInr === null ? null : Number(p.recordedForwardInr);
                    const rto = p.recordedRtoInr === null ? null : Number(p.recordedRtoInr);
                    const cost = fwd === null && rto === null ? null : (fwd ?? 0) + (rto ?? 0);
                    const differs =
                      cost !== null &&
                      p.billedInr !== null &&
                      Math.abs(cost - Number(p.billedInr)) > 0.004;
                    return (
                      <Tr key={p.shipmentId}>
                        <Td>
                          <span className="sk-ident">{p.orderNumber ?? '—'}</span>
                        </Td>
                        <Td>
                          <span className="sk-ident">{p.awbNumber ?? '—'}</span>
                        </Td>
                        <Td>{p.theirStatus}</Td>
                        <Td>
                          {p.provisionalInr === null ? '—' : <Money amount={p.provisionalInr} />}
                        </Td>
                        <Td>
                          {p.billedInr === null ? (
                            <span className="af-small">
                              {t('costSyncShiprocketCostSection.notBilledYet')}
                            </span>
                          ) : (
                            <Money amount={p.billedInr} />
                          )}
                        </Td>
                        <Td>
                          {cost === null ? (
                            <span className="af-small">uncovered</span>
                          ) : (
                            <span className="af-stack af-stack--tight">
                              <Money amount={cost.toFixed(2)} />
                              {differs && (
                                <span className="af-small af-bad">
                                  {t('costSyncShiprocketCostSection.differsFromTheirBill')}
                                </span>
                              )}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <span className="af-stack af-stack--tight">
                            <span className="af-small af-nowrap">{fmtWhen(p.readAt)}</span>
                            {p.readings > 1 && (
                              <span className="af-small">
                                {t('costSyncShiprocketCostSection.readingsItMoved', {
                                  readings: p.readings,
                                })}
                              </span>
                            )}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </TBody>
            </Table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title={
          confirming === null
            ? t('costSyncShiprocketCostSection.runNow')
            : BROWSER_RUNS(t)[confirming].title
        }
        entity={
          confirming === null
            ? t('costSyncShiprocketCostSection.shiprocket')
            : BROWSER_RUNS(t)[confirming].entity
        }
        consequence={t('costSyncShiprocketCostSection.thePortalWorkerSignsIn')}
        confirmLabel={t('costSyncShiprocketCostSection.runItNow')}
        onConfirm={() => {
          if (confirming === null) return;
          const which = confirming;
          // Queued in the background: the dialog closes at once and the
          // button beside the card shows it busy, exactly as before.
          void queue(which, BROWSER_RUNS(t)[which].done).catch(() => undefined);
        }}
      />
    </section>
  );
}
