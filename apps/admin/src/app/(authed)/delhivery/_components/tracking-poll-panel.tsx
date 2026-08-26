'use client';

import type { ReactElement } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  Section,
  Skeleton,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { useRunTrackingPoll, useTrackingPollHealth } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
export function TrackingPollPanel(): ReactElement {
  const toast = useToast();
  const health = useTrackingPollHealth();
  const run = useRunTrackingPoll();

  const minutes = health.data?.minutesSinceLastRun ?? null;
  const stale = health.data?.stale === true;

  async function runNow(): Promise<void> {
    try {
      const r = await run.mutateAsync();
      toast.success(
        r.stubMode
          ? 'Cycle ran in STUB MODE — no call left this process. Tracking is not actually running; check the API base URL.'
          : `Checked ${r.shipmentsExamined} parcels, applied ${r.scansApplied} new scans, moved ${r.transitions} orders.`,
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Section
      title="Tracking"
      subtitle="Delhivery sends us no webhooks, so a scheduled poll is what moves every order to delivered. If this stops, nothing else fails — parcels simply stop updating."
    >
      {health.isError ? (
        <ErrorNote
          message={health.error?.message ?? 'Could not read tracking health.'}
          retry={() => void health.refetch()}
        />
      ) : health.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  {stale ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" aria-hidden />
                  ) : (
                    <Activity className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
                  )}
                  <StatusBadge
                    kind={stale ? 'failed' : 'delivered'}
                    label={stale ? 'Not running' : 'Running'}
                  />
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {minutes === null
                    ? 'No cycle has ever completed. Either the poller has not run since this was added, or it is not running at all.'
                    : `Last cycle ${minutes === 0 ? 'less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`} ago. Scheduled ${health.data?.cronPattern ?? ''}.`}
                </p>
                {stale ? (
                  <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
                    Orders will not reach delivered while this is stopped, which also means COD is
                    not being credited. Run a cycle below, then check the API process is up and that
                    the Delhivery base URL is still set.
                  </p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                size="md"
                disabled={run.isPending}
                onClick={() => void runNow()}
              >
                {run.isPending ? 'Running…' : 'Run a cycle now'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </Section>
  );
}
