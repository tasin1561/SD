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

/** The legacy Stat tones, mapped onto the KPI card's. */
const STAT_TONE: Record<'good' | 'warn' | 'bad' | 'neutral', KpiTone> = {
  good: 'credit',
  warn: 'pending',
  bad: 'debit',
  neutral: 'neutral',
};

type RunKind = 'bills' | 'wallet' | 'probe' | 'invoices';

/** What each browser-driven run is, restated in its confirm. */
const BROWSER_RUNS: Record<
  Exclude<RunKind, 'bills'>,
  { title: string; entity: string; label: string; done: string }
> = {
  wallet: {
    title: 'Run the Shiprocket wallet sync now?',
    entity: 'Shiprocket passbook, recharges and ledger',
    label: 'Run wallet sync now',
    done: 'Queued. It signs in and reads about 70 pages — refresh in five minutes.',
  },
  invoices: {
    title: 'Check Shiprocket invoices now?',
    entity: 'Shiprocket freight and VAS invoices',
    label: 'Check invoices now',
    done: 'Queued. It signs in and opens each invoice — refresh in three minutes.',
  },
  probe: {
    title: 'Check Shiprocket website access now?',
    entity: 'Shiprocket website login',
    label: 'Check website access',
    done: 'Queued. It signs in through Bangalore and reads three pages — refresh in two minutes.',
  },
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function billCheckLabel(run: ShiprocketCostRunView): string {
  if (!run.ok) return 'Failed';
  if (run.skipped === 'DISABLED') return 'Switched off';
  if (run.skipped === 'STUB_MODE') return 'Skipped — Shiprocket is in stub mode';
  if (run.skipped === 'NO_ACCOUNTS') return 'No Shiprocket account with a login';
  if (run.accounts.some((a) => a.error !== null)) return 'Partly failed';
  return 'Worked';
}

function walletLabel(run: ShiprocketWalletRunView): string {
  if (run.skipped === 'DISABLED') return 'Switched off';
  if (run.skipped === 'NO_ACCOUNTS') return 'No Shiprocket account';
  if (!run.ok) return 'Failed';
  if (run.accounts.some((a) => a.outcome !== 'READ')) return 'Partly failed';
  return run.wrote ? 'Worked' : 'Worked (not recording)';
}

function invoiceRunLabel(run: ShiprocketInvoiceRunView): string {
  if (run.skipped === 'DISABLED') return 'Switched off';
  if (run.skipped === 'NO_ACCOUNTS') return 'No Shiprocket account';
  if (!run.ok) return 'Failed';
  if (run.accounts.some((a) => a.outcome !== 'CHECKED')) return 'Partly failed';
  const differing = run.accounts.reduce(
    (n, a) => n + (a.result?.rows.filter((r) => r.status === 'DIFFERS').length ?? 0),
    0,
  );
  return differing === 0 ? 'every invoice matches the wallet' : `${differing} invoice(s) disagree`;
}

/** One invoice's verdict, in words. */
function InvoiceResult({ r }: { readonly r: ShiprocketInvoiceRowView }): ReactElement {
  if (r.status === 'MATCHES') {
    return <span className="af-good">Matches the wallet</span>;
  }
  if (r.status === 'NOT_ITEMIZED') {
    return <span className="af-small">No itemized file to check</span>;
  }
  if (r.status === 'UNREADABLE') {
    return (
      <span className="af-bad">Could not be read{r.problem !== null && ` — ${r.problem}`}</span>
    );
  }
  const parts: string[] = [];
  if (r.totalsAgree === false) parts.push(`its file adds up to ₹${r.itemizedInr ?? '?'}`);
  if (r.differenceCount > 0) {
    parts.push(`${r.differenceCount} order(s) billed differently (net ₹${r.differenceInr})`);
  }
  if (r.unknownServices.length > 0) parts.push(`unknown service: ${r.unknownServices.join(', ')}`);
  return <span className="af-bad">{parts.join(' · ')}</span>;
}

/** One account's invoices: a line each, then what no invoice has billed. */
function InvoiceAccountBlock({ a }: { readonly a: ShiprocketInvoiceAccountView }): ReactElement {
  const res = a.result;
  const rows =
    res === null ? [] : [...res.rows].sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate));
  return (
    <div className="cs-account">
      <div className="af-small">
        <span className="af-strong">{a.label}</span> ·{' '}
        {a.outcome === 'CHECKED'
          ? `${a.invoicesRead} invoice(s) read`
          : (OUTCOME_WORDS[a.outcome] ?? a.outcome)}
        {a.detail !== null && <span> — {a.detail}</span>}
      </div>
      {res !== null && (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>Invoice</Th>
                <Th>Type</Th>
                <Th>Date</Th>
                <Th>Amount</Th>
                <Th>Against the wallet</Th>
                <Th>Dispute by</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={6}>No invoices in the window.</TableEmpty>
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
                          {r.beforeRecords} line(s) older than our records, not compared
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
            VAS charged but never invoiced:{' '}
            {res.vasUninvoiced.count === 0 ? (
              'none'
            ) : (
              <>
                {res.vasUninvoiced.count}, <Money amount={res.vasUninvoiced.inr} /> — named on
                /system-issues
              </>
            )}{' '}
            · Freight not invoiced yet: {res.freightUninvoiced.orders.toLocaleString('en-IN')}{' '}
            order(s), <Money amount={res.freightUninvoiced.inr} /> — normal until a parcel&rsquo;s
            charges finalise
            {res.freightUninvoiced.staleCount > 0 &&
              `; ${res.freightUninvoiced.staleCount} charged over 60 days ago`}
          </p>
        </>
      )}
    </div>
  );
}

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  CHECKED: 'checked',
  READ: 'read',
  REFUSED: 'refused — their balances did not add up, nothing stored',
  SKIPPED: 'skipped — a sign-in challenge is open',
  CHALLENGE: 'stopped at a sign-in challenge',
  NO_LOGIN: 'no website login stored',
  FAILED: 'failed',
};

/** One account's night, in the words somebody checking it would use. */
function WalletAccountLine({ a }: { readonly a: ShiprocketWalletAccountView }): ReactElement {
  const i = a.import;
  const written = i === null ? 0 : i.forwardWritten + i.rtoWritten;
  return (
    <li className="af-stack af-stack--tight af-small">
      <div>
        <span className="af-strong">{a.label}</span> · {OUTCOME_WORDS[a.outcome] ?? a.outcome}
        {a.detail !== null && <span> — {a.detail}</span>}
      </div>
      {a.outcome === 'READ' && i !== null && (
        <div>
          {a.passbookRows.toLocaleString('en-IN')} movements read, balances add up ·{' '}
          {i.txnsNew.toLocaleString('en-IN')} new, {i.txnsAlreadyHeld.toLocaleString('en-IN')}{' '}
          already held · {i.dryRun ? 'would write' : 'wrote'} {written} parcel cost(s)
          {i.revised > 0 && ` (${i.revised} revised)`} · {i.adjustments} account adjustment(s), net{' '}
          <Money amount={i.adjustmentsNetInr} />
          {i.txnsMissing > 0 && ` · ${i.txnsMissing} vanished from their passbook`}
          {i.txnsMutated > 0 && ` · ${i.txnsMutated} changed`}
          {i.incompleteHistory > 0 && ` · ${i.incompleteHistory} parcel(s) net below zero`}
        </div>
      )}
      {a.recharges !== null && (
        <div>
          Recharges: {a.recharges.matched} of {a.recharges.seen} matched to our bank book
          {a.recharges.unrecorded > 0 && `, ${a.recharges.unrecorded} not in our books`}
          {a.recharges.amountMismatched > 0 &&
            `, ${a.recharges.amountMismatched} with a different amount`}
        </div>
      )}
      {a.ledger !== null && (
        <div>
          Ledger: {a.ledger.checked - a.ledger.uncovered.length} of {a.ledger.checked} credits found
          in the passbook
          {a.ledger.uncovered.length > 0 && ' — the rest are named on /system-issues'} ·{' '}
          {a.ledger.documents} invoice(s), already counted through the passbook
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
      {BROWSER_RUNS[which].label}
    </Button>
  );

  return (
    <section className="af-section">
      <SectionHeading title="Shiprocket" />
      {panel.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={4} cols={4} label="Loading Shiprocket costs…" />
        </AfCard>
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={panel.error?.message ?? 'Could not load Shiprocket costs.'}
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
                  Wallet sync — {lastWallet === null ? 'has not run yet' : walletLabel(lastWallet)}
                </p>
                <p className="af-small">
                  Every night at 03:50 IST · their Passbook, Recharge History and Ledger, read from
                  app.shiprocket.in through Bangalore. Each movement is stored once and each
                  parcel&rsquo;s cost netted from them, the way Delhivery&rsquo;s are.
                  {!d.writesEnabled && ' Not recording: it reads and reports only.'}
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
                  {lastWallet.trigger === 'MANUAL' ? 'Run by hand' : 'Nightly run'} ·{' '}
                  {fmtWhen(lastWallet.at)}
                  {lastWallet.windowDays !== null && ` · last ${lastWallet.windowDays} days`}
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
                  invoiceRunLabel(lastInvoices) === 'every invoice matches the wallet' ? (
                    <CheckCircle2 size={15} aria-hidden className="af-good" />
                  ) : (
                    <PauseCircle size={15} aria-hidden className="af-bad" />
                  )}
                  Invoice check —{' '}
                  {lastInvoices === null ? 'has not run yet' : invoiceRunLabel(lastInvoices)}
                </p>
                <p className="af-small">
                  Every night at 04:30 IST · each Freight and VAS invoice&rsquo;s itemized file,
                  compared line by line with what their wallet charged. Shiprocket settles a
                  discrepancy only if it is raised within 15 days of the invoice, so a disagreement
                  inside that window is raised as HIGH.
                </p>
              </div>
              {canRun && runButton('invoices')}
            </div>
            {lastInvoices !== null && (
              <>
                {lastInvoices.accounts.map((a) => (
                  <InvoiceAccountBlock key={a.courierAccountId} a={a} />
                ))}
                <p className="af-small">
                  {lastInvoices.trigger === 'MANUAL' ? 'Run by hand' : 'Nightly run'} ·{' '}
                  {fmtWhen(lastInvoices.at)}
                  {lastInvoices.windowDays !== null &&
                    ` · invoices from the last ${lastInvoices.windowDays} days`}
                </p>
              </>
            )}
          </AfCard>

          <div className="af-kpis">
            <KpiCard
              label="Wallet balance"
              figure={
                d.balances[0] === undefined ? '—' : <Money amount={d.balances[0].balanceInr} />
              }
              hint={
                d.balances[0] === undefined
                  ? 'Not read yet.'
                  : `As read ${fmtWhen(d.balances[0].capturedAt)}.`
              }
            />
            <KpiCard
              label="Parcels with a recorded cost"
              figure={`${recorded} / ${d.parcels.length}`}
              tone={
                STAT_TONE[d.parcels.length === 0 || recorded === d.parcels.length ? 'good' : 'warn']
              }
              hint="Netted from their passbook. A parcel with no movement yet is uncovered, not free."
            />
            {lastBills === null ? (
              <KpiCard
                label="Final bills that disagree"
                figure="—"
                tone={STAT_TONE.neutral}
                hint="Their final billed amount against what their wallet charged for the same parcel. The wallet figure is what the P&L uses."
              />
            ) : (
              <KpiCard
                label="Final bills that disagree"
                value={disagree}
                tone={STAT_TONE[disagree === 0 ? 'good' : 'bad']}
                hint="Their final billed amount against what their wallet charged for the same parcel. The wallet figure is what the P&L uses."
              />
            )}
            <KpiCard
              label="Last bill check"
              figure={lastBills === null ? 'Never' : billCheckLabel(lastBills)}
              tone={STAT_TONE[lastBills === null || !lastBills.ok ? 'bad' : 'good']}
              hint={lastBills === null ? 'It has not run yet.' : fmtWhen(lastBills.at)}
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
                  Final-bill check —{' '}
                  {d.stubMode
                    ? 'not running, Shiprocket is in stub mode'
                    : !d.enabled
                      ? 'switched off'
                      : 'on'}
                </p>
                <p className="af-small">
                  {d.schedule} · reads each order&rsquo;s charges from Shiprocket&rsquo;s API and
                  checks their final bill against the wallet. It records nothing as a cost.
                </p>
              </div>
              {canRun && (
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  labels={{ idle: 'Check bills now', busy: 'Queuing…', done: 'Queued' }}
                  disabled={busy !== null}
                  onAction={() =>
                    queue(
                      'bills',
                      'Queued. It reads every Shiprocket parcel — refresh in a minute.',
                    )
                  }
                />
              )}
            </div>
          </AfCard>

          <AfCard>
            <div className="af-card__head">
              <div className="af-grow af-stack af-stack--tight">
                <h3 className="af-title">Shiprocket website access</h3>
                <p className="af-small">
                  Signs in and saves what the three wallet pages show, without storing anything. A
                  sign-in challenge stops every website run until someone resolves the issue — it
                  never retries on its own.
                </p>
              </div>
              {canRun && runButton('probe')}
            </div>
            {d.portalProbe === null ? (
              <p className="af-small">Never checked.</p>
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
                <li>Checked {fmtWhen(d.portalProbe.at)}</li>
              </ul>
            )}
          </AfCard>

          <div className="af-section">
            <SectionHeading title="Our Shiprocket parcels" as="h3" />
            <Table>
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>AWB</Th>
                  <Th>Their status</Th>
                  <Th>Charged so far (estimate)</Th>
                  <Th>Final bill</Th>
                  <Th>Recorded cost (wallet)</Th>
                  <Th>Last read</Th>
                </Tr>
              </THead>
              <TBody>
                {d.parcels.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    <div className="af-stack af-stack--tight cs-empty">
                      <span className="af-strong">No Shiprocket parcels read yet</span>
                      <span className="af-small">
                        Parcels appear here after the first run that finds them.
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
                            <span className="af-small">not billed yet</span>
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
                                <span className="af-small af-bad">differs from their bill</span>
                              )}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <span className="af-stack af-stack--tight">
                            <span className="af-small af-nowrap">{fmtWhen(p.readAt)}</span>
                            {p.readings > 1 && (
                              <span className="af-small">{p.readings} readings — it moved</span>
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
        title={confirming === null ? 'Run now?' : BROWSER_RUNS[confirming].title}
        entity={confirming === null ? 'Shiprocket' : BROWSER_RUNS[confirming].entity}
        consequence="The portal worker signs in to Shiprocket's own website with our stored login and runs in the background; it is queued, not finished, when this closes."
        confirmLabel="Run it now"
        onConfirm={() => {
          if (confirming === null) return;
          const which = confirming;
          // Queued in the background: the dialog closes at once and the
          // button beside the card shows it busy, exactly as before.
          void queue(which, BROWSER_RUNS[which].done).catch(() => undefined);
        }}
      />
    </section>
  );
}
