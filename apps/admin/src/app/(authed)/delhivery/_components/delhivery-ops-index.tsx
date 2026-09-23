'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Lock, Unlock } from 'lucide-react';
import { Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { useDelhiveryStatus, useRefillWaybillPool } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, AfSection, Meter, Notice } from '@/app/(authed)/system/_components/af-parts';
import { AccountSetupPanel } from './account-setup-panel';
import { TrackingLookupPanel } from './tracking-lookup-panel';
import { WalletImportPanel } from './wallet-import-panel';
import { TrackingPollPanel } from './tracking-poll-panel';
import './delhivery.css';

/**
 * The Delhivery operations console.
 *
 * Three things that fail silently until they are expensive, on one
 * screen: how many AWBs are left, whether physical writes are permitted,
 * and how much rate budget remains before the WAF blocks our egress IP.
 */
export function DelhiveryOpsIndex(): ReactElement {
  const toast = useToast();
  const status = useDelhiveryStatus();
  const refill = useRefillWaybillPool();
  // A refill spends the account's real AWB allocation (and one of five
  // bulk requests per five minutes), so it asks first.
  const [confirmRefill, setConfirmRefill] = useState(false);
  const [refillError, setRefillError] = useState<string | null>(null);

  const pool = status.data?.waybillPool;
  const usable = pool?.usableNow ?? 0;
  const poolTone = usable === 0 ? 'debit' : usable < 50 ? 'pending' : 'credit';

  async function doRefill(): Promise<void> {
    setRefillError(null);
    try {
      const result = await refill.mutateAsync();
      toast.success(
        result.fetched === 0
          ? `Pool is already above its watermark (${result.poolAfter} held).`
          : `Fetched ${result.fetched}. Pool now ${result.poolAfter}.`,
      );
    } catch (err) {
      const verdict = serverVerdict(err);
      toast.error(verdict);
      setRefillError(verdict);
      throw err;
    }
  }

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Delhivery' }]}
        Link={Link}
        title="Delhivery"
        subtitle="Waybill pool depth, the live-write guard, and remaining rate budget. Refreshes every 30 seconds."
        action={
          <Button
            variant="secondary"
            size="md"
            loading={refill.isPending}
            onClick={() => {
              setRefillError(null);
              setConfirmRefill(true);
            }}
          >
            Refill waybill pool
          </Button>
        }
      />

      <TrackingPollPanel />
      <TrackingLookupPanel />
      <WalletImportPanel />

      {status.isError ? (
        <ErrorState
          message={status.error?.message ?? 'Could not read Delhivery status.'}
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
          {/* ── mode + guard ── */}
          <AfSection
            title="Connection"
            note="Stub mode means no network call ever leaves this process. The write guard is a second, independent gate on operations with a physical or billable effect."
          >
            <div className="af-grid-2">
              <AfCard>
                <div>
                  <StatusChip
                    kind={status.data?.liveMode === true ? 'in-transit' : 'draft'}
                    label={status.data?.liveMode === true ? 'Live API' : 'Stub mode'}
                  />
                </div>
                <p className="af-small">
                  {status.data?.liveMode === true
                    ? 'Calls go to the real Delhivery API. There is no sandbox on this account, so every request counts against production.'
                    : 'No base URL configured, so the adapter answers from deterministic stubs. Safe to exercise any flow.'}
                </p>
              </AfCard>

              <AfCard tone={status.data?.liveWritesEnabled === true ? 'critical' : undefined}>
                <p className="af-title dl-guard">
                  {status.data?.liveWritesEnabled === true ? (
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
                  {status.data?.liveWritesEnabled === true
                    ? 'Manifesting, pickups, cancels and NDR actions will reach the real account. Turn this off again once the intended operation is done.'
                    : 'Manifesting, pickups, cancels and NDR actions are refused with DELHIVERY_LIVE_WRITES_DISABLED. This is the default and the safe state.'}
                </p>
                <Link href="/settings" className="af-link af-small af-inline-link">
                  Change in system settings →
                </Link>
              </AfCard>
            </div>
          </AfSection>

          {/* ── waybill pool ── */}
          <AfSection
            title="Waybill pool"
            note="AWBs are fetched in bulk ahead of time because Delhivery allows only five bulk requests per five minutes. An empty pool stops manifests."
          >
            <div className="af-kpis">
              <KpiCard
                label="Usable now"
                figure={<Num value={usable} />}
                tone={poolTone}
                hint="Past their settle delay"
              />
              <KpiCard
                label="Available"
                figure={<Num value={pool?.available ?? 0} />}
                hint="Includes not-yet-settled"
              />
              <KpiCard label="Assigned" figure={<Num value={pool?.assigned ?? 0} />} />
              <KpiCard label="Used" figure={<Num value={pool?.used ?? 0} />} />
              <KpiCard label="Void" figure={<Num value={pool?.void ?? 0} />} />
            </div>

            {usable === 0 && (
              <Notice tone="bad" role="alert">
                <p>
                  No usable waybills. Manifest closure will fail until the pool is refilled. In live
                  mode the refill itself needs the write guard on.
                </p>
              </Notice>
            )}
          </AfSection>

          {/* ── rate budget ── */}
          <AfSection
            title="Rate budget"
            note="Budgeted to 80% of Delhivery's documented limits, per five-minute window, shared across every API instance. Exhausting one returns a WAF 403 that blocks our whole egress IP."
          >
            <Table>
              <THead>
                <Tr>
                  <Th>Endpoint</Th>
                  <Th align="right">Remaining</Th>
                  <Th align="right">Budget</Th>
                  <Th>Headroom</Th>
                </Tr>
              </THead>
              <TBody>
                {status.data?.rateBudgets.map((b) => {
                  const pct = b.budget <= 0 ? 0 : Math.round((b.remaining / b.budget) * 100);
                  return (
                    <Tr key={b.endpoint}>
                      <Td>
                        <span className="af-stack af-stack--tight">
                          <span>{b.endpoint.replaceAll('_', ' ')}</span>
                          {b.endpoint === 'waybill_bulk' && (
                            <span className="af-faint">five per five minutes — the tight one</span>
                          )}
                        </span>
                      </Td>
                      <Td align="right">
                        <Num value={b.remaining} />
                      </Td>
                      <Td align="right">
                        <span className="af-small">
                          <Num value={b.budget} />
                        </span>
                      </Td>
                      <Td>
                        <span className="dl-headroom">
                          <Meter
                            value={pct / 100}
                            tone={pct < 20 ? 'bad' : pct < 50 ? 'warn' : 'good'}
                          />
                          <span className="af-small sk-figure">{pct}%</span>
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </AfSection>
        </>
      )}

      {/* The two prerequisites for a real parcel. Above is what the
          account currently holds; this is what has to be true before any
          of it is spent. */}
      <AccountSetupPanel />

      <ConfirmDialog
        open={confirmRefill}
        onOpenChange={setConfirmRefill}
        title="Refill the waybill pool?"
        entity="Delhivery waybill pool"
        consequence="This asks Delhivery for a bulk batch of real AWBs from the account's allocation and uses one of the five bulk requests allowed per five minutes."
        confirmLabel="Refill waybill pool"
        error={refillError}
        onConfirm={doRefill}
      />
    </div>
  );
}
