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
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
  const t = useT();

  const status = useShiprocketStatus();
  const connectivity = useShiprocketConnectivity();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const d = status.data;
  const stubbedButLive = d?.liveMode === false && d?.intakeEnabled === true;

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: t('shiprocketShiprocketOpsIndex.network') },
          { label: t('shiprocketShiprocketOpsIndex.shiprocket') },
        ]}
        Link={Link}
        title={t('shiprocketShiprocketOpsIndex.shiprocket')}
        subtitle={t('shiprocketShiprocketOpsIndex.whetherThisCourierIsAnswering')}
      />

      {status.isError ? (
        <ErrorState
          message={
            status.error?.message ?? t('shiprocketShiprocketOpsIndex.couldNotReadShiprocketStatus')
          }
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
                {richMessage(t('shiprocketShiprocketOpsIndex.shiprocketIsTakingNewParcels'), {
                  code: (
                    <code className="af-code sr-inline-code">courier.shiprocket_api_base_url</code>
                  ),
                })}
              </p>
            </Notice>
          )}

          {/* ── mode + the two switches ── */}
          <AfSection
            title={t('shiprocketShiprocketOpsIndex.connection')}
            note={t('shiprocketShiprocketOpsIndex.stubModeMeansNoNetwork')}
          >
            <div className="af-grid-3">
              <AfCard>
                <div>
                  <StatusChip
                    kind={d?.liveMode === true ? 'in-transit' : 'draft'}
                    label={
                      d?.liveMode === true
                        ? t('shiprocketShiprocketOpsIndex.liveApi')
                        : t('shiprocketShiprocketOpsIndex.stubMode')
                    }
                  />
                </div>
                <p className="af-small">
                  {d?.liveMode === true
                    ? t('shiprocketShiprocketOpsIndex.callsGoToTheReal')
                    : t('shiprocketShiprocketOpsIndex.noBaseUrlConfiguredSo')}
                </p>
              </AfCard>

              <AfCard tone={d?.liveWritesEnabled === true ? 'critical' : undefined}>
                <p className="af-title sr-guard">
                  {d?.liveWritesEnabled === true ? (
                    <>
                      <Unlock size={14} aria-hidden className="af-bad" />
                      <span className="af-bad">
                        {t('shiprocketShiprocketOpsIndex.liveWritesEnabled')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Lock size={14} aria-hidden />
                      <span>{t('shiprocketShiprocketOpsIndex.liveWritesBlocked')}</span>
                    </>
                  )}
                </p>
                <p className="af-small">
                  {d?.liveWritesEnabled === true
                    ? t('shiprocketShiprocketOpsIndex.bookingsReturnsPickupsCancelsAnd')
                    : t('shiprocketShiprocketOpsIndex.bookingsReturnsPickupsCancelsAnd2')}
                </p>
                <Link href="/settings" className="af-link af-small af-inline-link">
                  {t('shiprocketShiprocketOpsIndex.changeInSystemSettings')}
                </Link>
              </AfCard>

              <AfCard>
                <div>
                  <StatusChip
                    kind={d?.intakeEnabled === true ? 'confirmed' : 'cancelled'}
                    label={
                      d?.intakeEnabled === true
                        ? t('shiprocketShiprocketOpsIndex.takingNewParcels')
                        : t('shiprocketShiprocketOpsIndex.noNewParcels')
                    }
                  />
                </div>
                <p className="af-small">
                  {d?.intakeEnabled === true
                    ? t('shiprocketShiprocketOpsIndex.newParcelsCanBeBooked')
                    : t('shiprocketShiprocketOpsIndex.noNewParcelsInFlight')}
                </p>
                <Link href="/courier-accounts" className="af-link af-small af-inline-link">
                  {t('shiprocketShiprocketOpsIndex.changeOnCourierAccounts')}
                </Link>
              </AfCard>
            </div>
          </AfSection>

          {/* ── accounts ── */}
          <AfSection
            title={t('shiprocketShiprocketOpsIndex.accounts')}
            note={t('shiprocketShiprocketOpsIndex.thePickupLocationNameIs')}
          >
            <Table>
              <THead>
                <Tr>
                  <Th>{t('shiprocketShiprocketOpsIndex.account')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.pickupLocation')}</Th>
                  <Th align="right">{t('shiprocketShiprocketOpsIndex.wallet')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.read')}</Th>
                </Tr>
              </THead>
              <TBody>
                {d?.accounts.length === 0 ? (
                  <TableEmpty colSpan={4}>
                    {t('shiprocketShiprocketOpsIndex.noShiprocketAccountIsConfigured')}
                  </TableEmpty>
                ) : (
                  d?.accounts.map((a) => (
                    <Tr key={a.courierAccountId}>
                      <Td>
                        <span>{a.label}</span>
                        {!a.isActive && <span className="af-faint"> (inactive)</span>}
                      </Td>
                      <Td>
                        {a.pickupLocationName === null ? (
                          <span className="af-small af-bad">
                            {t('shiprocketShiprocketOpsIndex.notSetBookingsRefuse')}
                          </span>
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
                  <span className="af-mini__label">
                    {t('shiprocketShiprocketOpsIndex.lastWalletSync')}
                  </span>
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
                  <span className="af-mini__label">
                    {t('shiprocketShiprocketOpsIndex.lastInvoiceCheck')}
                  </span>
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
                  {t('shiprocketShiprocketOpsIndex.everyRunInDetail')}
                </Link>
              </AfCard>
              <AfCard>
                <div className="af-mini">
                  <span className="af-mini__label">
                    {t('shiprocketShiprocketOpsIndex.returnAddress')}
                  </span>
                  <span className="af-body">
                    {d?.returnAddressConfigured === true ? (
                      t('shiprocketShiprocketOpsIndex.set')
                    ) : (
                      <span className="af-bad">{t('shiprocketShiprocketOpsIndex.notSet')}</span>
                    )}
                  </span>
                </div>
                <p className="af-small">
                  {t('shiprocketShiprocketOpsIndex.theirReturnBookingSpellsOut')}
                </p>
              </AfCard>
            </div>
          </AfSection>

          {/* ── connectivity ── */}
          <AfSection
            title={t('shiprocketShiprocketOpsIndex.reachability')}
            note={t('shiprocketShiprocketOpsIndex.oneServiceabilityLookupOnA')}
          >
            <AfCard>
              <div className="sr-lane">
                <TextField
                  id="sr-from"
                  label={t('shiprocketShiprocketOpsIndex.fromPincode')}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  inputMode="numeric"
                />
                <TextField
                  id="sr-to"
                  label={t('shiprocketShiprocketOpsIndex.toPincode')}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  inputMode="numeric"
                />
                <AsyncButton
                  variant="secondary"
                  size="md"
                  labels={{
                    idle: t('shiprocketShiprocketOpsIndex.check'),
                    busy: t('shiprocketShiprocketOpsIndex.checking'),
                    done: t('shiprocketShiprocketOpsIndex.checked'),
                    error: t('shiprocketShiprocketOpsIndex.failed'),
                  }}
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
                        ? t('shiprocketShiprocketOpsIndex.reachedTheLiveApi')
                        : t('shiprocketShiprocketOpsIndex.answeredWithoutReachingThemStub')}{' '}
                      <Num value={connectivity.data.optionCount ?? 0} />{' '}
                      {t('shiprocketShiprocketOpsIndex.carrierQuoted', {
                        value: connectivity.data.optionCount === 1 ? '' : t('common.pluralS'),
                      })}
                      {connectivity.data.cheapestInr === null ? (
                        '.'
                      ) : (
                        <>
                          {t('shiprocketShiprocketOpsIndex.cheapest')}{' '}
                          <Money amount={connectivity.data.cheapestInr} />.
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
            title={t('shiprocketShiprocketOpsIndex.recentParcels')}
            note={t('shiprocketShiprocketOpsIndex.theTwentyMostRecentShiprocket')}
          >
            <Table>
              <THead>
                <Tr>
                  <Th>{t('shiprocketShiprocketOpsIndex.parcel')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.waybill')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.carrier')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.status')}</Th>
                  <Th>{t('shiprocketShiprocketOpsIndex.booked')}</Th>
                </Tr>
              </THead>
              <TBody>
                {d?.recentBookings.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    {t('shiprocketShiprocketOpsIndex.noShiprocketParcelsYet')}
                  </TableEmpty>
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
