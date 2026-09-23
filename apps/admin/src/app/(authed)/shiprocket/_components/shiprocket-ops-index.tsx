'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Lock, Unlock } from 'lucide-react';
import { Money, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TableEmpty, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useShiprocketConnectivity, useShiprocketStatus } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, AfSection, Notice } from '@/app/(authed)/system/_components/af-parts';
import './shiprocket.css';

function when(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The Shiprocket operations console.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────
 * `/delhivery` has been a full console for months and this courier had
 * none, while production carries BOTH live. Failover reaches Shiprocket
 * without anybody choosing it per parcel (CUR-14), so the courier that
 * can quietly take our volume was the one nobody could look at.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────
 * No waybill pool and no rate budget: Shiprocket issues the AWB at
 * assign, and publishes no per-endpoint limits. Gauges for either would
 * look informative and report nothing. The wallet DETAIL lives on
 * /cost-sync, which already owns it — a second copy of the same figures
 * is a second thing to keep in step.
 */
export function ShiprocketOpsIndex(): ReactElement {
  const status = useShiprocketStatus();
  const connectivity = useShiprocketConnectivity();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const d = status.data;
  const stubbedButLive = d?.liveMode === false && d?.intakeEnabled === true;

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Shiprocket' }]}
        Link={Link}
        title="Shiprocket"
        subtitle="Whether this courier is answering from its live API or from a stub, whether writes are armed, and what it has booked. Refreshes every 30 seconds."
      />

      {status.isError ? (
        <ErrorState
          message={status.error?.message ?? 'Could not read Shiprocket status.'}
          retry={() => void status.refetch()}
        />
      ) : status.isLoading ? (
        <div className="af-grid-3">
          <Skeleton height="6rem" rounded="md" />
          <Skeleton height="6rem" rounded="md" />
          <Skeleton height="6rem" rounded="md" />
        </div>
      ) : (
        <>
          {/*
            THE STUBBED-BESIDE-LIVE WARNING (CUR-15).

            This is the one state that costs money silently: a parcel the
            other courier refuses fails over here, a stub returns a
            fabricated waybill, and the parcel is dispatched with stock
            already gone and no van ever coming. The failover guard
            refuses it, but an operator has to be able to SEE it — and
            "intake on, answering from a stub" is exactly the shape.
          */}
          {stubbedButLive === true && (
            <Notice tone="bad" role="alert">
              <p>
                Shiprocket is taking new parcels but answering from a STUB. A booking here would
                come back with a waybill nobody issued. Either set
                <code className="af-code sr-inline-code">courier.shiprocket_api_base_url</code>, or
                switch the courier off for new parcels on /courier-accounts.
              </p>
            </Notice>
          )}

          {/* ── mode + the two switches ── */}
          <AfSection
            title="Connection"
            note="Stub mode means no network call ever leaves this process. The write guard and the intake switch are two further, independent gates."
          >
            <div className="af-grid-3">
              <AfCard>
                <div>
                  <StatusChip
                    kind={d?.liveMode === true ? 'in-transit' : 'draft'}
                    label={d?.liveMode === true ? 'Live API' : 'Stub mode'}
                  />
                </div>
                <p className="af-small">
                  {d?.liveMode === true
                    ? 'Calls go to the real Shiprocket API. There is no sandbox, so every request counts against production.'
                    : 'No base URL configured, so the adapter answers from deterministic stubs — including a FABRICATED waybill on a booking. Safe alone; dangerous beside a live courier.'}
                </p>
              </AfCard>

              <AfCard tone={d?.liveWritesEnabled === true ? 'critical' : undefined}>
                <p className="af-title sr-guard">
                  {d?.liveWritesEnabled === true ? (
                    <>
                      <Unlock size={14} aria-hidden className="af-bad" />
                      <span className="af-bad">Live writes enabled</span>
                    </>
                  ) : (
                    <>
                      <Lock size={14} aria-hidden />
                      <span>Live writes blocked</span>
                    </>
                  )}
                </p>
                <p className="af-small">
                  {d?.liveWritesEnabled === true
                    ? 'Bookings, returns, pickups, cancels and NDR actions reach the real account.'
                    : 'Bookings, returns, pickups, cancels and NDR actions are refused. This is the safe state.'}
                </p>
                <Link href="/settings" className="af-link af-small af-inline-link">
                  Change in system settings →
                </Link>
              </AfCard>

              <AfCard>
                <div>
                  <StatusChip
                    kind={d?.intakeEnabled === true ? 'confirmed' : 'cancelled'}
                    label={d?.intakeEnabled === true ? 'Taking new parcels' : 'No new parcels'}
                  />
                </div>
                <p className="af-small">
                  {d?.intakeEnabled === true
                    ? 'New parcels can be booked here, including by failover from another courier.'
                    : 'No NEW parcels — in-flight ones are still tracked, cancelled and costed (CUR-16).'}
                </p>
                <Link href="/courier-accounts" className="af-link af-small af-inline-link">
                  Change on courier accounts →
                </Link>
              </AfCard>
            </div>
          </AfSection>

          {/* ── accounts ── */}
          <AfSection
            title="Accounts"
            note="The pickup location name is matched byte for byte on every booking; without one, bookings are refused. The balance is what the nightly wallet sync last read."
          >
            <Table>
              <THead>
                <Tr>
                  <Th>Account</Th>
                  <Th>Pickup location</Th>
                  <Th align="right">Wallet</Th>
                  <Th>Read</Th>
                </Tr>
              </THead>
              <TBody>
                {d?.accounts.length === 0 ? (
                  <TableEmpty colSpan={4}>No Shiprocket account is configured.</TableEmpty>
                ) : (
                  d?.accounts.map((a) => (
                    <Tr key={a.courierAccountId}>
                      <Td>
                        <span>{a.label}</span>
                        {!a.isActive && <span className="af-faint"> (inactive)</span>}
                      </Td>
                      <Td>
                        {a.pickupLocationName === null ? (
                          <span className="af-small af-bad">not set — bookings refuse</span>
                        ) : (
                          <span className="sk-ident af-small">{a.pickupLocationName}</span>
                        )}
                      </Td>
                      <Td align="right">
                        {a.walletBalanceInr === null ? (
                          <span className="af-faint">—</span>
                        ) : (
                          <Money amount={a.walletBalanceInr} />
                        )}
                      </Td>
                      <Td>
                        <span className="af-faint sk-figure">{when(a.walletBalanceAt)}</span>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>

            <div className="af-grid-3">
              <AfCard>
                <div className="af-mini">
                  <span className="af-mini__label">Last wallet sync</span>
                  <span className="af-body">
                    <span className="sk-figure">{when(d?.lastWalletSync?.at ?? null)}</span>
                    {d?.lastWalletSync !== null && d?.lastWalletSync !== undefined && (
                      <span className={d.lastWalletSync.ok ? 'af-faint' : 'af-small af-bad'}>
                        {' '}
                        {d.lastWalletSync.ok ? 'ok' : 'FAILED'}
                      </span>
                    )}
                  </span>
                </div>
              </AfCard>
              <AfCard>
                <div className="af-mini">
                  <span className="af-mini__label">Last invoice check</span>
                  <span className="af-body">
                    <span className="sk-figure">{when(d?.lastInvoiceCheck?.at ?? null)}</span>
                    {d?.lastInvoiceCheck !== null && d?.lastInvoiceCheck !== undefined && (
                      <span className={d.lastInvoiceCheck.ok ? 'af-faint' : 'af-small af-bad'}>
                        {' '}
                        {d.lastInvoiceCheck.ok ? 'ok' : 'FAILED'}
                      </span>
                    )}
                  </span>
                </div>
                <Link href="/cost-sync" className="af-link af-small af-inline-link">
                  Every run, in detail →
                </Link>
              </AfCard>
              <AfCard>
                <div className="af-mini">
                  <span className="af-mini__label">Return address</span>
                  <span className="af-body">
                    {d?.returnAddressConfigured === true ? (
                      'Set'
                    ) : (
                      <span className="af-bad">Not set</span>
                    )}
                  </span>
                </div>
                <p className="af-small">
                  Their return booking spells out BOTH ends, so a customer collection needs the
                  address it comes back to. Without it, returns are refused by name.
                </p>
              </AfCard>
            </div>
          </AfSection>

          {/* ── connectivity ── */}
          <AfSection
            title="Reachability"
            note="One serviceability lookup on a lane. It creates nothing, and it is the only way to prove the stored credential still works without booking a parcel."
          >
            <AfCard>
              <div className="sr-lane">
                <TextField
                  id="sr-from"
                  label="From pincode"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  inputMode="numeric"
                />
                <TextField
                  id="sr-to"
                  label="To pincode"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  inputMode="numeric"
                />
                <AsyncButton
                  variant="secondary"
                  size="md"
                  labels={{ idle: 'Check', busy: 'Checking…', done: 'Checked', error: 'Failed' }}
                  disabled={connectivity.isPending || from.trim() === '' || to.trim() === ''}
                  onAction={() => connectivity.mutateAsync({ from, to })}
                />
              </div>

              {connectivity.isError && (
                <p className="af-error">{serverVerdict(connectivity.error)}</p>
              )}
              {connectivity.data !== undefined && (
                <div
                  className="af-inner"
                  data-tone={connectivity.data.error !== null ? 'bad' : undefined}
                >
                  {connectivity.data.error !== null ? (
                    <p className="af-small af-bad">{connectivity.data.error}</p>
                  ) : (
                    <p className="af-small">
                      {connectivity.data.reachedLiveApi
                        ? 'Reached the live API.'
                        : 'Answered WITHOUT reaching them (stub mode) — this proves nothing about the credential.'}{' '}
                      <Num value={connectivity.data.optionCount ?? 0} /> carrier
                      {connectivity.data.optionCount === 1 ? '' : 's'} quoted
                      {connectivity.data.cheapestInr === null ? (
                        '.'
                      ) : (
                        <>
                          , cheapest <Money amount={connectivity.data.cheapestInr} />.
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </AfCard>
          </AfSection>

          {/* ── bookings ── */}
          <AfSection
            title="Recent parcels"
            note="The twenty most recent Shiprocket shipments. A row with no waybill never got one — the AWB-less sweep chases those."
          >
            <Table>
              <THead>
                <Tr>
                  <Th>Parcel</Th>
                  <Th>Waybill</Th>
                  <Th>Carrier</Th>
                  <Th>Status</Th>
                  <Th>Booked</Th>
                </Tr>
              </THead>
              <TBody>
                {d?.recentBookings.length === 0 ? (
                  <TableEmpty colSpan={5}>No Shiprocket parcels yet.</TableEmpty>
                ) : (
                  d?.recentBookings.map((b) => (
                    <Tr key={b.shipmentId}>
                      <Td>
                        <span className="sk-ident af-small">{b.shipmentNumber}</span>
                      </Td>
                      <Td>
                        {b.awbNumber === null ? (
                          <span className="af-small af-bad">none</span>
                        ) : (
                          <span className="sk-ident af-small">{b.awbNumber}</span>
                        )}
                      </Td>
                      {/* WHICH carrier their ranking gave us. Blank on a
                          parcel booked before we recorded it — their
                          reply is not stored, so it cannot be filled in. */}
                      <Td>
                        <span className="af-small">{b.carrierName ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="af-small">{b.status}</span>
                      </Td>
                      <Td>
                        <span className="af-faint sk-figure">{when(b.bookedAt)}</span>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </AfSection>
        </>
      )}
    </div>
  );
}
