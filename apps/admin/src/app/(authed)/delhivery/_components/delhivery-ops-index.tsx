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
import { useT } from '@/i18n/client';

/**
 * The Delhivery operations console.
 *
 * Three things that fail silently until they are expensive, on one
 * screen: how many AWBs are left, whether physical writes are permitted,
 * and how much rate budget remains before the WAF blocks our egress IP.
 */
export function DelhiveryOpsIndex(): ReactElement {
  const t = useT();
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
          ? t('delhiveryDelhiveryOpsIndex.poolIsAlreadyAboveIts', { poolAfter: result.poolAfter })
          : t('delhiveryDelhiveryOpsIndex.fetchedPoolNow', {
              fetched: result.fetched,
              poolAfter: result.poolAfter,
            }),
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
        breadcrumbs={[
          { label: t('delhiveryDelhiveryOpsIndex.network') },
          { label: t('delhiveryDelhiveryOpsIndex.delhivery') },
        ]}
        Link={Link}
        title={t('delhiveryDelhiveryOpsIndex.delhivery')}
        subtitle={t('delhiveryDelhiveryOpsIndex.waybillPoolDepthTheLive')}
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
            {t('delhiveryDelhiveryOpsIndex.refillWaybillPool')}
          </Button>
        }
      />

      <TrackingPollPanel />
      <TrackingLookupPanel />
      <WalletImportPanel />

      {status.isError ? (
        <ErrorState
          message={
            status.error?.message ?? t('delhiveryDelhiveryOpsIndex.couldNotReadDelhiveryStatus')
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
          {/* ── mode + guard ── */}
          <AfSection
            title={t('delhiveryDelhiveryOpsIndex.connection')}
            note={t('delhiveryDelhiveryOpsIndex.stubModeMeansNoNetwork')}
          >
            <div className="af-grid-2">
              <AfCard>
                <div>
                  <StatusChip
                    kind={status.data?.liveMode === true ? 'in-transit' : 'draft'}
                    label={
                      status.data?.liveMode === true
                        ? t('delhiveryDelhiveryOpsIndex.liveApi')
                        : t('delhiveryDelhiveryOpsIndex.stubMode')
                    }
                  />
                </div>
                <p className="af-small">
                  {status.data?.liveMode === true
                    ? t('delhiveryDelhiveryOpsIndex.callsGoToTheReal')
                    : t('delhiveryDelhiveryOpsIndex.noBaseUrlConfiguredSo')}
                </p>
              </AfCard>

              <AfCard tone={status.data?.liveWritesEnabled === true ? 'critical' : undefined}>
                <p className="af-title dl-guard">
                  {status.data?.liveWritesEnabled === true ? (
                    <>
                      <Unlock size={14} aria-hidden className="af-bad" />
                      <span className="af-bad">
                        {t('delhiveryDelhiveryOpsIndex.liveWritesEnabled')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Lock size={14} aria-hidden />
                      <span>{t('delhiveryDelhiveryOpsIndex.liveWritesBlocked')}</span>
                    </>
                  )}
                </p>
                <p className="af-small">
                  {status.data?.liveWritesEnabled === true
                    ? t('delhiveryDelhiveryOpsIndex.manifestingPickupsCancelsAndNdr')
                    : t('delhiveryDelhiveryOpsIndex.manifestingPickupsCancelsAndNdr2')}
                </p>
                <Link href="/settings" className="af-link af-small af-inline-link">
                  {t('delhiveryDelhiveryOpsIndex.changeInSystemSettings')}
                </Link>
              </AfCard>
            </div>
          </AfSection>

          {/* ── waybill pool ── */}
          <AfSection
            title={t('delhiveryDelhiveryOpsIndex.waybillPool')}
            note={t('delhiveryDelhiveryOpsIndex.awbsAreFetchedInBulk')}
          >
            <div className="af-kpis">
              <KpiCard
                label={t('delhiveryDelhiveryOpsIndex.usableNow')}
                figure={<Num value={usable} />}
                tone={poolTone}
                hint={t('delhiveryDelhiveryOpsIndex.pastTheirSettleDelay')}
              />
              <KpiCard
                label={t('delhiveryDelhiveryOpsIndex.available')}
                figure={<Num value={pool?.available ?? 0} />}
                hint={t('delhiveryDelhiveryOpsIndex.includesNotYetSettled')}
              />
              <KpiCard
                label={t('delhiveryDelhiveryOpsIndex.assigned')}
                figure={<Num value={pool?.assigned ?? 0} />}
              />
              <KpiCard
                label={t('delhiveryDelhiveryOpsIndex.used')}
                figure={<Num value={pool?.used ?? 0} />}
              />
              <KpiCard
                label={t('delhiveryDelhiveryOpsIndex.void')}
                figure={<Num value={pool?.void ?? 0} />}
              />
            </div>

            {usable === 0 && (
              <Notice tone="bad" role="alert">
                <p>{t('delhiveryDelhiveryOpsIndex.noUsableWaybillsManifestClosure')}</p>
              </Notice>
            )}
          </AfSection>

          {/* ── rate budget ── */}
          <AfSection
            title={t('delhiveryDelhiveryOpsIndex.rateBudget')}
            note={t('delhiveryDelhiveryOpsIndex.budgetedTo80OfDelhivery')}
          >
            <Table>
              <THead>
                <Tr>
                  <Th>{t('delhiveryDelhiveryOpsIndex.endpoint')}</Th>
                  <Th align="right">{t('delhiveryDelhiveryOpsIndex.remaining')}</Th>
                  <Th align="right">{t('delhiveryDelhiveryOpsIndex.budget')}</Th>
                  <Th>{t('delhiveryDelhiveryOpsIndex.headroom')}</Th>
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
                            <span className="af-faint">
                              {t('delhiveryDelhiveryOpsIndex.fivePerFiveMinutesThe')}
                            </span>
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
        title={t('delhiveryDelhiveryOpsIndex.refillTheWaybillPool')}
        entity={t('delhiveryDelhiveryOpsIndex.delhiveryWaybillPool')}
        consequence={t('delhiveryDelhiveryOpsIndex.thisAsksDelhiveryForA')}
        confirmLabel={t('delhiveryDelhiveryOpsIndex.refillWaybillPool')}
        error={refillError}
        onConfirm={doRefill}
      />
    </div>
  );
}
