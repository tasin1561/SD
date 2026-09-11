'use client';

import { useState, type ReactElement } from 'react';
import { CheckCircle2, PauseCircle, RefreshCw } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  Stat,
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
  useRunShiprocketCost,
  useRunShiprocketPortalProbe,
  useRunShiprocketWalletSync,
  useShiprocketCostPanel,
  type ShiprocketCostRunView,
  type ShiprocketWalletAccountView,
  type ShiprocketWalletRunView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

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

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
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
    <li className="space-y-0.5">
      <div>
        <span className="font-medium">{a.label}</span> · {OUTCOME_WORDS[a.outcome] ?? a.outcome}
        {a.detail !== null && <span className="text-text-muted"> — {a.detail}</span>}
      </div>
      {a.outcome === 'READ' && i !== null && (
        <div className="text-text-muted">
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
        <div className="text-text-muted">
          Recharges: {a.recharges.matched} of {a.recharges.seen} matched to our bank book
          {a.recharges.unrecorded > 0 && `, ${a.recharges.unrecorded} not in our books`}
          {a.recharges.amountMismatched > 0 &&
            `, ${a.recharges.amountMismatched} with a different amount`}
        </div>
      )}
      {a.ledger !== null && (
        <div className="text-text-muted">
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
  const canRun = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [busy, setBusy] = useState<'bills' | 'wallet' | 'probe' | null>(null);

  const queue = (which: 'bills' | 'wallet' | 'probe', done: string): void => {
    setBusy(which);
    void (async () => {
      try {
        if (which === 'bills') await run.mutateAsync();
        else if (which === 'wallet') await wallet.mutateAsync();
        else await probe.mutateAsync();
        toast.success(done);
      } catch (err) {
        toast.error(serverVerdict(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  const d = panel.data;
  const lastWallet = d?.walletSyncs[0] ?? null;
  const lastBills = d?.last ?? null;
  const disagree = lastBills?.accounts.reduce((n, a) => n + a.ledgerDisagrees, 0) ?? 0;
  const recorded =
    d?.parcels.filter((p) => p.recordedForwardInr !== null || p.recordedRtoInr !== null).length ??
    0;

  return (
    <div className="mt-8">
      <h2 className="text-text-strong mb-3 text-base font-semibold">Shiprocket</h2>
      {panel.isLoading ? (
        <LoadingState label="Loading Shiprocket costs…" />
      ) : panel.isError || d === undefined ? (
        <ErrorState
          message={panel.error?.message ?? 'Could not load Shiprocket costs.'}
          retry={() => void panel.refetch()}
        />
      ) : (
        <>
          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-text-strong flex items-center gap-2 text-sm font-medium">
                    {lastWallet !== null && lastWallet.ok && d.writesEnabled ? (
                      <CheckCircle2 size={15} className="text-status-delivered" />
                    ) : (
                      <PauseCircle size={15} className="text-status-failed" />
                    )}
                    Wallet sync —{' '}
                    {lastWallet === null ? 'has not run yet' : walletLabel(lastWallet)}
                  </p>
                  <p className="text-text-muted mt-0.5 text-xs">
                    Every night at 03:50 IST · their Passbook, Recharge History and Ledger, read
                    from app.shiprocket.in through Bangalore. Each movement is stored once and each
                    parcel&rsquo;s cost netted from them, the way Delhivery&rsquo;s are.
                    {!d.writesEnabled && ' Not recording: it reads and reports only.'}
                  </p>
                </div>
                {canRun && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      queue(
                        'wallet',
                        'Queued. It signs in and reads about 70 pages — refresh in five minutes.',
                      )
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={busy === 'wallet' ? 'animate-spin' : undefined}
                    />
                    {busy === 'wallet' ? 'Queuing…' : 'Run wallet sync now'}
                  </Button>
                )}
              </div>
              {lastWallet !== null && (
                <ul className="mt-3 space-y-2 text-xs">
                  {lastWallet.accounts.map((a) => (
                    <WalletAccountLine key={a.courierAccountId} a={a} />
                  ))}
                  <li className="text-text-muted">
                    {lastWallet.trigger === 'MANUAL' ? 'Run by hand' : 'Nightly run'} ·{' '}
                    {fmtWhen(lastWallet.at)}
                    {lastWallet.windowDays !== null && ` · last ${lastWallet.windowDays} days`}
                  </li>
                </ul>
              )}
            </CardBody>
          </Card>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Wallet balance"
              value={
                d.balances[0] === undefined ? '—' : <Money amount={d.balances[0].balanceInr} />
              }
              hint={
                d.balances[0] === undefined
                  ? 'Not read yet.'
                  : `As read ${fmtWhen(d.balances[0].capturedAt)}.`
              }
            />
            <Stat
              label="Parcels with a recorded cost"
              value={`${recorded} / ${d.parcels.length}`}
              tone={d.parcels.length === 0 || recorded === d.parcels.length ? 'good' : 'warn'}
              hint="Netted from their passbook. A parcel with no movement yet is uncovered, not free."
            />
            <Stat
              label="Final bills that disagree"
              value={lastBills === null ? '—' : String(disagree)}
              tone={lastBills === null ? 'neutral' : disagree === 0 ? 'good' : 'bad'}
              hint="Their final billed amount against what their wallet charged for the same parcel. The wallet figure is what the P&L uses."
            />
            <Stat
              label="Last bill check"
              value={lastBills === null ? 'Never' : billCheckLabel(lastBills)}
              tone={lastBills === null || !lastBills.ok ? 'bad' : 'good'}
              hint={lastBills === null ? 'It has not run yet.' : fmtWhen(lastBills.at)}
            />
          </div>

          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-text-strong flex items-center gap-2 text-sm font-medium">
                    {d.enabled && !d.stubMode ? (
                      <CheckCircle2 size={15} className="text-status-delivered" />
                    ) : (
                      <PauseCircle size={15} className="text-status-failed" />
                    )}
                    Final-bill check —{' '}
                    {d.stubMode
                      ? 'not running, Shiprocket is in stub mode'
                      : !d.enabled
                        ? 'switched off'
                        : 'on'}
                  </p>
                  <p className="text-text-muted mt-0.5 text-xs">
                    {d.schedule} · reads each order&rsquo;s charges from Shiprocket&rsquo;s API and
                    checks their final bill against the wallet. It records nothing as a cost.
                  </p>
                </div>
                {canRun && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      queue(
                        'bills',
                        'Queued. It reads every Shiprocket parcel — refresh in a minute.',
                      )
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={busy === 'bills' ? 'animate-spin' : undefined}
                    />
                    {busy === 'bills' ? 'Queuing…' : 'Check bills now'}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">Shiprocket website access</h3>
                  <p className="text-text-muted mt-0.5 text-xs">
                    Signs in and saves what the three wallet pages show, without storing anything. A
                    sign-in challenge stops every website run until someone resolves the issue — it
                    never retries on its own.
                  </p>
                </div>
                {canRun && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      queue(
                        'probe',
                        'Queued. It signs in through Bangalore and reads three pages — refresh in two minutes.',
                      )
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={busy === 'probe' ? 'animate-spin' : undefined}
                    />
                    {busy === 'probe' ? 'Queuing…' : 'Check website access'}
                  </Button>
                )}
              </div>
              {d.portalProbe === null ? (
                <p className="text-text-muted mt-3 text-xs">Never checked.</p>
              ) : (
                <ul className="mt-3 space-y-1 text-xs">
                  {d.portalProbe.accounts.map((a) => (
                    <li key={a.courierAccountId}>
                      <span className="font-medium">{a.label}</span> · {a.outcome}
                      {a.pages.length > 0 &&
                        ` · ${a.pages
                          .map((p) => `${p.tab}${p.landedOnLogin ? ' (bounced to login)' : ''}`)
                          .join(', ')}`}
                      {a.detail !== null && <span className="text-text-muted"> — {a.detail}</span>}
                    </li>
                  ))}
                  <li className="text-text-muted">Checked {fmtWhen(d.portalProbe.at)}</li>
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="mb-3 text-sm font-medium">Our Shiprocket parcels</h3>
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
                      <div className="flex flex-col items-center gap-1.5 py-2">
                        <div className="font-medium">No Shiprocket parcels read yet</div>
                        <div className="text-text-muted text-xs">
                          Parcels appear here after the first run that finds them.
                        </div>
                      </div>
                    </TableEmpty>
                  ) : (
                    d.parcels.map((p) => {
                      const fwd =
                        p.recordedForwardInr === null ? null : Number(p.recordedForwardInr);
                      const rto = p.recordedRtoInr === null ? null : Number(p.recordedRtoInr);
                      const cost = fwd === null && rto === null ? null : (fwd ?? 0) + (rto ?? 0);
                      const differs =
                        cost !== null &&
                        p.billedInr !== null &&
                        Math.abs(cost - Number(p.billedInr)) > 0.004;
                      return (
                        <Tr key={p.shipmentId}>
                          <Td>{p.orderNumber ?? '—'}</Td>
                          <Td>
                            <span className="font-mono text-xs">{p.awbNumber ?? '—'}</span>
                          </Td>
                          <Td>{p.theirStatus}</Td>
                          <Td>
                            {p.provisionalInr === null ? '—' : <Money amount={p.provisionalInr} />}
                          </Td>
                          <Td>
                            {p.billedInr === null ? (
                              <span className="text-text-muted text-xs">not billed yet</span>
                            ) : (
                              <Money amount={p.billedInr} />
                            )}
                          </Td>
                          <Td>
                            {cost === null ? (
                              <span className="text-text-muted text-xs">uncovered</span>
                            ) : (
                              <>
                                <Money amount={cost.toFixed(2)} />
                                {differs && (
                                  <span className="text-status-failed block text-xs">
                                    differs from their bill
                                  </span>
                                )}
                              </>
                            )}
                          </Td>
                          <Td>
                            <span className="text-xs">{fmtWhen(p.readAt)}</span>
                            {p.readings > 1 && (
                              <span className="text-text-muted block text-xs">
                                {p.readings} readings — it moved
                              </span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
