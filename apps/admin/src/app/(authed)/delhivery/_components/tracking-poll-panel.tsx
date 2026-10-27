'use client';

import type { ReactElement } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import './delhivery.css';
import { useRunTrackingPoll, useTrackingPollHealth } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * The human layer over the tracking poller.
 *
 * Delhivery pushes no webhooks, so this cron is the only thing moving an
 * order through IN_TRANSIT, OUT_FOR_DELIVERY and DELIVERED. It is also
 * the only part of the system that can stop while everything else keeps
 * working — no failed request, nothing in the logs, and the first
 * symptom is a seller asking why a parcel has not moved.
 *
 * So: the number is on a screen, and the fix is a button next to it.
 * Recovery previously meant an SSH session and a hand-written script, at
 * exactly the moment somebody is under pressure.
 */
export function TrackingPollPanel(): ReactElement | null {
  const t = useT();
  const toast = useToast();
  // This page is gated on managing waybills, which is a different job
  // from running tracking — so the panel checks its own permission
  // rather than inheriting the page's. The query is gated too, not just
  // the markup: a request nobody may make should never be sent, rather
  // than sent and its 403 hidden.
  const mayRun = usePermission('orders.tracking.run_poll');
  const health = useTrackingPollHealth(mayRun);
  const run = useRunTrackingPoll();

  if (!mayRun) return null;

  const minutes = health.data?.minutesSinceLastRun ?? null;
  const stale = health.data?.stale === true;

  async function runNow(): Promise<void> {
    try {
      const r = await run.mutateAsync();
      toast.success(
        r.stubMode
          ? t('delhiveryTrackingPollPanel.cycleRanInStubMode')
          : t('delhiveryTrackingPollPanel.checkedParcelsAppliedNewScans', {
              shipmentsExamined: r.shipmentsExamined,
              scansApplied: r.scansApplied,
              transitions: r.transitions,
            }),
      );
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  return (
    <AfSection
      title={t('delhiveryTrackingPollPanel.tracking')}
      note={t('delhiveryTrackingPollPanel.delhiverySendsUsNoWebhooks')}
    >
      {health.isError ? (
        <ErrorState
          message={
            health.error?.message ?? t('delhiveryTrackingPollPanel.couldNotReadTrackingHealth')
          }
          retry={() => void health.refetch()}
        />
      ) : health.isLoading ? (
        <Skeleton height="6rem" rounded="md" />
      ) : (
        <AfCard tone={stale ? 'critical' : undefined}>
          <div className="af-card__head">
            <div className="af-grow af-stack af-stack--tight">
              <div className="af-row">
                {stale ? (
                  <AlertTriangle size={16} aria-hidden className="af-bad" />
                ) : (
                  <Activity size={16} aria-hidden className="af-good" />
                )}
                <StatusChip
                  kind={stale ? 'failed' : 'delivered'}
                  label={
                    stale
                      ? t('delhiveryTrackingPollPanel.notRunning')
                      : t('delhiveryTrackingPollPanel.running')
                  }
                />
              </div>
              <p className="af-muted">
                {minutes === null
                  ? t('delhiveryTrackingPollPanel.noCycleHasEverCompleted')
                  : `Last cycle ${minutes === 0 ? 'less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`} ago. Scheduled ${health.data?.cronPattern ?? ''}.`}
              </p>
              {stale ? (
                <p className="af-muted">
                  {t('delhiveryTrackingPollPanel.ordersWillNotReachDelivered')}
                </p>
              ) : null}
            </div>
            <AsyncButton
              variant="secondary"
              size="md"
              labels={{
                idle: t('delhiveryTrackingPollPanel.runACycleNow'),
                busy: t('delhiveryTrackingPollPanel.running2'),
                done: t('delhiveryTrackingPollPanel.cycleRan'),
                error: t('delhiveryTrackingPollPanel.didNotRun'),
              }}
              disabled={run.isPending}
              onAction={runNow}
            />
          </div>
        </AfCard>
      )}
    </AfSection>
  );
}
