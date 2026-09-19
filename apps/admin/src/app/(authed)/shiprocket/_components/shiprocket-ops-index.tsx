'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  FormField,
  Input,
  Money,
  Num,
  PageHeader,
  Section,
  Skeleton,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
  TableEmpty,
} from '@skydrop/ui/components';
import { useShiprocketConnectivity, useShiprocketStatus } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
    <div>
      <PageHeader
        title="Shiprocket"
        subtitle="Whether this courier is answering from its live API or from a stub, whether writes are armed, and what it has booked. Refreshes every 30 seconds."
      />

      {status.isError ? (
        <ErrorNote
          message={status.error?.message ?? 'Could not read Shiprocket status.'}
          retry={() => void status.refetch()}
        />
      ) : status.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
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
            <div
              role="alert"
              className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] mb-4 flex items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2"
            >
              <AlertTriangle
                size={14}
                className="text-[var(--color-critical)] mt-0.5 shrink-0"
                aria-hidden
              />
              <p className="text-[var(--color-critical)] text-xs leading-relaxed">
                Shiprocket is taking new parcels but answering from a STUB. A booking here would
                come back with a waybill nobody issued. Either set
                <code className="mx-1">courier.shiprocket_api_base_url</code>, or switch the courier
                off for new parcels on /courier-accounts.
              </p>
            </div>
          )}

          {/* ── mode + the two switches ── */}
          <Section
            title="Connection"
            subtitle="Stub mode means no network call ever leaves this process. The write guard and the intake switch are two further, independent gates."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardBody>
                  <div className="mb-1.5 flex items-center gap-2">
                    <StatusBadge
                      kind={d?.liveMode === true ? 'in-transit' : 'draft'}
                      label={d?.liveMode === true ? 'Live API' : 'Stub mode'}
                    />
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">
                    {d?.liveMode === true
                      ? 'Calls go to the real Shiprocket API. There is no sandbox, so every request counts against production.'
                      : 'No base URL configured, so the adapter answers from deterministic stubs — including a FABRICATED waybill on a booking. Safe alone; dangerous beside a live courier.'}
                  </p>
                </CardBody>
              </Card>

              <Card tone={d?.liveWritesEnabled === true ? 'critical' : 'default'}>
                <CardBody>
                  <div className="mb-1.5 flex items-center gap-2">
                    {d?.liveWritesEnabled === true ? (
                      <>
                        <Unlock size={14} className="text-[var(--color-critical)]" aria-hidden />
                        <span className="text-[var(--color-critical)] text-sm font-medium">
                          Live writes ENABLED
                        </span>
                      </>
                    ) : (
                      <>
                        <Lock size={14} className="text-text-muted" aria-hidden />
                        <span className="text-text-body text-sm font-medium">
                          Live writes blocked
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">
                    {d?.liveWritesEnabled === true
                      ? 'Bookings, returns, pickups, cancels and NDR actions reach the real account.'
                      : 'Bookings, returns, pickups, cancels and NDR actions are refused. This is the safe state.'}
                  </p>
                  <Link
                    href="/settings"
                    className="text-accent mt-2 inline-block text-xs hover:underline"
                  >
                    Change in system settings →
                  </Link>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <div className="mb-1.5 flex items-center gap-2">
                    <StatusBadge
                      kind={d?.intakeEnabled === true ? 'confirmed' : 'cancelled'}
                      label={d?.intakeEnabled === true ? 'Taking new parcels' : 'No new parcels'}
                    />
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">
                    {d?.intakeEnabled === true
                      ? 'New parcels can be booked here, including by failover from another courier.'
                      : 'No NEW parcels — in-flight ones are still tracked, cancelled and costed (CUR-16).'}
                  </p>
                  <Link
                    href="/courier-accounts"
                    className="text-accent mt-2 inline-block text-xs hover:underline"
                  >
                    Change on courier accounts →
                  </Link>
                </CardBody>
              </Card>
            </div>
          </Section>

          {/* ── accounts ── */}
          <Section
            title="Accounts"
            subtitle="The pickup location name is matched byte for byte on every booking; without one, bookings are refused. The balance is what the nightly wallet sync last read."
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
                        <span className="text-text-body">{a.label}</span>
                        {!a.isActive && (
                          <span className="text-text-faint ml-2 text-xs">(inactive)</span>
                        )}
                      </Td>
                      <Td>
                        {a.pickupLocationName ?? (
                          <span className="text-[var(--color-critical)] text-xs">
                            not set — bookings refuse
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {a.walletBalanceInr === null ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <Money amount={a.walletBalanceInr} />
                        )}
                      </Td>
                      <Td className="text-text-faint text-xs">{when(a.walletBalanceAt)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Card>
                <CardBody>
                  <div className="text-text-faint text-xs">Last wallet sync</div>
                  <div className="text-text-body mt-1 text-sm">
                    {when(d?.lastWalletSync?.at ?? null)}
                    {d?.lastWalletSync !== null && d?.lastWalletSync !== undefined && (
                      <span
                        className={
                          d.lastWalletSync.ok
                            ? 'text-text-faint ml-2 text-xs'
                            : 'text-[var(--color-critical)] ml-2 text-xs'
                        }
                      >
                        {d.lastWalletSync.ok ? 'ok' : 'FAILED'}
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <div className="text-text-faint text-xs">Last invoice check</div>
                  <div className="text-text-body mt-1 text-sm">
                    {when(d?.lastInvoiceCheck?.at ?? null)}
                    {d?.lastInvoiceCheck !== null && d?.lastInvoiceCheck !== undefined && (
                      <span
                        className={
                          d.lastInvoiceCheck.ok
                            ? 'text-text-faint ml-2 text-xs'
                            : 'text-[var(--color-critical)] ml-2 text-xs'
                        }
                      >
                        {d.lastInvoiceCheck.ok ? 'ok' : 'FAILED'}
                      </span>
                    )}
                  </div>
                  <Link
                    href="/cost-sync"
                    className="text-accent mt-2 inline-block text-xs hover:underline"
                  >
                    Every run, in detail →
                  </Link>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <div className="text-text-faint text-xs">Return address</div>
                  <div className="text-text-body mt-1 text-sm">
                    {d?.returnAddressConfigured === true ? (
                      'Set'
                    ) : (
                      <span className="text-[var(--color-critical)]">Not set</span>
                    )}
                  </div>
                  <p className="text-text-muted mt-1 text-xs leading-relaxed">
                    Their return booking spells out BOTH ends, so a customer collection needs the
                    address it comes back to. Without it, returns are refused by name.
                  </p>
                </CardBody>
              </Card>
            </div>
          </Section>

          {/* ── connectivity ── */}
          <Section
            title="Reachability"
            subtitle="One serviceability lookup on a lane. It creates nothing, and it is the only way to prove the stored credential still works without booking a parcel."
          >
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="From pincode" htmlFor="sr-from">
                <Input
                  id="sr-from"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  inputMode="numeric"
                />
              </FormField>
              <FormField label="To pincode" htmlFor="sr-to">
                <Input
                  id="sr-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  inputMode="numeric"
                />
              </FormField>
              <Button
                variant="secondary"
                size="md"
                disabled={connectivity.isPending || from.trim() === '' || to.trim() === ''}
                onClick={() => void connectivity.mutateAsync({ from, to }).catch(() => undefined)}
              >
                {connectivity.isPending ? 'Checking…' : 'Check'}
              </Button>
            </div>

            {connectivity.isError && (
              <p className="text-[var(--color-critical)] mt-3 text-xs">
                {serverVerdict(connectivity.error)}
              </p>
            )}
            {connectivity.data !== undefined && (
              <Card className="mt-3">
                <CardBody>
                  {connectivity.data.error !== null ? (
                    <p className="text-[var(--color-critical)] text-xs leading-relaxed">
                      {connectivity.data.error}
                    </p>
                  ) : (
                    <p className="text-text-muted text-xs leading-relaxed">
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
                </CardBody>
              </Card>
            )}
          </Section>

          {/* ── bookings ── */}
          <Section
            title="Recent parcels"
            subtitle="The twenty most recent Shiprocket shipments. A row with no waybill never got one — the AWB-less sweep chases those."
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
                      <Td className="font-mono text-xs">{b.shipmentNumber}</Td>
                      <Td className="font-mono text-xs">
                        {b.awbNumber ?? (
                          <span className="text-[var(--color-critical)] font-sans">none</span>
                        )}
                      </Td>
                      {/* WHICH carrier their ranking gave us. Blank on a
                          parcel booked before we recorded it — their
                          reply is not stored, so it cannot be filled in. */}
                      <Td className="text-text-muted text-xs">{b.carrierName ?? '—'}</Td>
                      <Td className="text-text-muted text-xs">{b.status}</Td>
                      <Td className="text-text-faint text-xs">{when(b.bookedAt)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Section>
        </>
      )}
    </div>
  );
}
