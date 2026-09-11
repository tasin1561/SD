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
  useShiprocketCostPanel,
  type ShiprocketCostRunView,
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

function runLabel(run: ShiprocketCostRunView): string {
  if (!run.ok) return 'Failed';
  if (run.skipped === 'DISABLED') return 'Switched off';
  if (run.skipped === 'STUB_MODE') return 'Skipped — Shiprocket is in stub mode';
  if (run.skipped === 'NO_ACCOUNTS') return 'No Shiprocket account with a login';
  if (run.accounts.some((a) => a.error !== null)) return 'Partly failed';
  return run.wrote ? 'Worked' : 'Worked (not recording)';
}

/**
 * Shiprocket's costs, beside Delhivery's.
 *
 * Two figures per parcel, kept apart on purpose. "Charged so far" is
 * rebuilt from Shiprocket's breakdown and is an estimate — it missed
 * their final figure on one sampled parcel in twenty-two. "Final" is
 * Shiprocket's own billed amount and is the only one ever recorded as a
 * parcel's cost, so it is the only one the P&L sees.
 *
 * The wallet's unexplained movement is shown, never booked: the account
 * also carries parcels booked on Shiprocket's website, plus recharges and
 * credits, and without their ledger none of that can be attributed.
 */
export function ShiprocketCostSection(): ReactElement {
  const panel = useShiprocketCostPanel();
  const run = useRunShiprocketCost();
  const probe = useRunShiprocketPortalProbe();
  const [probing, setProbing] = useState(false);
  const goProbe = (): void => {
    setProbing(true);
    void (async () => {
      try {
        await probe.mutateAsync();
        toast.success(
          'Queued. It signs in through Bangalore and reads three pages — refresh in two minutes.',
        );
      } catch (err) {
        toast.error(serverVerdict(err));
      } finally {
        setProbing(false);
      }
    })();
  };
  const canRun = usePermission('courier.accounts.manage');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = (): void => {
    setBusy(true);
    void (async () => {
      try {
        await run.mutateAsync();
        toast.success('Queued. It reads every Shiprocket parcel — refresh in a minute.');
      } catch (err) {
        toast.error(serverVerdict(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  const d = panel.data;
  const acct = d?.last?.accounts[0];
  const finals = d?.parcels.filter((p) => p.billedInr !== null).length ?? 0;

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
                    {d.enabled && !d.stubMode ? (
                      <CheckCircle2 size={15} className="text-status-delivered" />
                    ) : (
                      <PauseCircle size={15} className="text-status-failed" />
                    )}
                    {d.stubMode
                      ? 'Not running — Shiprocket is in stub mode (no API address set)'
                      : !d.enabled
                        ? 'Switched off — no Shiprocket costs are being read'
                        : d.writesEnabled
                          ? 'On — reading charges and recording final costs'
                          : 'On, but not recording — it reads and reports, and writes nothing'}
                  </p>
                  <p className="text-text-muted mt-0.5 text-xs">
                    {d.schedule} · read from Shiprocket&rsquo;s API, one order at a time
                  </p>
                </div>
                {canRun && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={go}>
                    <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />
                    {busy ? 'Running…' : 'Run it now'}
                  </Button>
                )}
              </div>
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
              label="Unexplained movement"
              value={
                acct?.unexplainedInr === null || acct === undefined ? (
                  '—'
                ) : (
                  <Money amount={acct.unexplainedInr} />
                )
              }
              hint="The change in balance our own parcels do not explain: parcels booked on Shiprocket's website, recharges, credits and disputes. Reported, never booked as an expense."
            />
            <Stat
              label="Parcels with a final cost"
              value={`${finals} / ${d.parcels.length}`}
              tone={d.parcels.length === 0 || finals === d.parcels.length ? 'good' : 'warn'}
              hint="Shiprocket fills in its final billed amount weeks after delivery. Until then the parcel's cost is uncovered, not zero."
            />
            <Stat
              label="Last run"
              value={d.last === null ? 'Never' : runLabel(d.last)}
              tone={d.last === null || !d.last.ok ? 'bad' : 'good'}
              hint={d.last === null ? 'It has not run yet.' : fmtWhen(d.last.at)}
            />
          </div>

          <Card className="mb-4">
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">Shiprocket website</h3>
                  <p className="text-text-muted mt-0.5 text-xs">
                    Their passbook, ledger and recharges have no API, so these are read from
                    app.shiprocket.in through the Bangalore tunnel. A sign-in challenge stops it
                    until someone resolves the issue — it never retries on its own.
                  </p>
                </div>
                {canRun && (
                  <Button variant="secondary" size="sm" disabled={probing} onClick={goProbe}>
                    <RefreshCw size={14} className={probing ? 'animate-spin' : undefined} />
                    {probing ? 'Queuing…' : 'Check website access'}
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
                    <Th>Final (billed)</Th>
                    <Th>Recorded cost</Th>
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
                      const recorded =
                        fwd === null && rto === null ? null : (fwd ?? 0) + (rto ?? 0);
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
                            {recorded === null ? (
                              <span className="text-text-muted text-xs">uncovered</span>
                            ) : (
                              <Money amount={recorded.toFixed(2)} />
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
