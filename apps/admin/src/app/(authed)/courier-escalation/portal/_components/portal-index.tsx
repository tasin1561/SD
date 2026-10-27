'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { TextField } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useCourierPortalRuns,
  useCourierTaxonomy,
  useCourierChannel,
  useSetPortalMode,
  type PortalMode,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, AfSection, Notice } from '@/app/(authed)/system/_components/af-parts';
import { EscalationTabs } from '../../_components/escalation-tabs';
import '../../_components/escalation.css';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

/**
 * What the portal worker did — or, in SHADOW, would have done.
 *
 * ── SHADOW IS ONLY A DRY RUN IF SOMEBODY READS IT ────────────────────
 * The worker ships in SHADOW: it navigates, reads, decides, and writes
 * nothing. That is worth exactly as much as the record of it is legible,
 * and until this page existed the record went into a table with no
 * reader. This is where "it has been running for a week and here is what
 * it would have done" becomes a sentence somebody can check.
 *
 * ── THE TAXONOMY IS THE UNBLOCKER ────────────────────────────────────
 * Unattended action is refused outright while the category list is empty,
 * because a category ID we have never seen cannot be checked against the
 * Claims/Finance and Protect VAS locks. So this page shows the list and
 * marks what is locked — an empty table here is the reason the auto list
 * will not accept anything, stated in the place someone would look.
 *
 * READ-ONLY on purpose. Enabling the worker is a mode change, which lives
 * on the send-queue tab behind the emailed code.
 */
export function CourierPortalIndex(): ReactElement {
  const t = useT();
  const runs = useCourierPortalRuns();
  const taxonomy = useCourierTaxonomy();
  const channel = useCourierChannel();

  const rows = runs.data ?? [];
  const cats = taxonomy.data ?? [];
  const shadow = rows.filter((r) => r.mode === 'SHADOW').length;
  const failures = rows.filter((r) => r.outcome === 'FAILED' || r.outcome === 'CHALLENGED').length;

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: t('courierEscalationPortalPortalIndex.network') },
          { label: t('courierEscalationPortalPortalIndex.courierEscalation') },
        ]}
        Link={Link}
        title={t('courierEscalationPortalPortalIndex.portalWorker')}
        subtitle={t('courierEscalationPortalPortalIndex.theBrowserTierItRuns')}
      />
      <EscalationTabs />

      <PortalModeSwitch current={channel.data?.settings.portalMode ?? null} />

      <div className="af-kpis">
        <KpiCard
          label={t('courierEscalationPortalPortalIndex.portalMode')}
          figure={channel.data?.settings.portalMode ?? '—'}
          hint={t('courierEscalationPortalPortalIndex.shadowReadsAndDecidesBut')}
        />
        {runs.isLoading ? (
          <KpiCard
            label={t('courierEscalationPortalPortalIndex.shadowRunsRecorded')}
            figure="—"
            hint={t('courierEscalationPortalPortalIndex.loading')}
          />
        ) : (
          <KpiCard
            label={t('courierEscalationPortalPortalIndex.shadowRunsRecorded')}
            value={shadow}
            hint={t('courierEscalationPortalPortalIndex.eachOneIsADecision')}
          />
        )}
        {runs.isLoading ? (
          <KpiCard
            label={t('courierEscalationPortalPortalIndex.failedOrChallenged')}
            figure="—"
            hint={t('courierEscalationPortalPortalIndex.loading')}
          />
        ) : (
          <KpiCard
            label={t('courierEscalationPortalPortalIndex.failedOrChallenged')}
            value={failures}
            tone={failures > 0 ? 'debit' : 'neutral'}
            hint={t('courierEscalationPortalPortalIndex.aChallengeFreezesTheWorker')}
          />
        )}
      </div>

      <AfSection
        title={t('courierEscalationPortalPortalIndex.recentRuns')}
        note={t('courierEscalationPortalPortalIndex.newestFirstARunIs')}
      >
        {runs.isLoading ? (
          <AfCard flush>
            <SkeletonRows
              rows={4}
              cols={5}
              label={t('courierEscalationPortalPortalIndex.loadingRuns')}
            />
          </AfCard>
        ) : runs.isError ? (
          <ErrorState message={serverVerdict(runs.error)} retry={() => void runs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('courierEscalationPortalPortalIndex.theWorkerHasNotRun')}
            description={t('courierEscalationPortalPortalIndex.expectedItIsDeployedInert')}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('courierEscalationPortalPortalIndex.when')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.doing')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.mode')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.outcome')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.detail')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <span className="af-small af-nowrap">
                      {new Date(r.startedAt).toLocaleString('en-IN')}
                    </span>
                  </Td>
                  <Td>
                    <span className="af-nowrap">{humanise(r.kind)}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={r.mode === 'LIVE' ? 'in-transit' : 'draft'}
                      label={r.mode.toLowerCase()}
                    />
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={outcomeKind(r.outcome)}
                      label={humanise(r.outcome)}
                    />
                  </Td>
                  <Td>
                    {/* Verbatim, wrapped: a truncated failure detail is a
                        failure nobody can diagnose. */}
                    <pre className="af-pre ce-message" data-dense="1">
                      {r.detail ?? '—'}
                    </pre>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AfSection>

      <AfSection
        title={t('courierEscalationPortalPortalIndex.delhiverySCategories')}
        note={t('courierEscalationPortalPortalIndex.fetchedFromTheirPortalAnd')}
      >
        {taxonomy.isLoading ? (
          <AfCard flush>
            <SkeletonRows
              rows={3}
              cols={4}
              label={t('courierEscalationPortalPortalIndex.loadingCategories')}
            />
          </AfCard>
        ) : taxonomy.isError ? (
          <ErrorState
            message={serverVerdict(taxonomy.error)}
            retry={() => void taxonomy.refetch()}
          />
        ) : cats.length === 0 ? (
          <Notice tone="warn" title={t('courierEscalationPortalPortalIndex.notFetchedYet')}>
            <p>{t('courierEscalationPortalPortalIndex.thisIsWhyUnattendedAction')}</p>
          </Notice>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('courierEscalationPortalPortalIndex.theirId')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.category')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.unattended')}</Th>
                <Th>{t('courierEscalationPortalPortalIndex.lastSeen')}</Th>
              </Tr>
            </THead>
            <TBody>
              {cats.map((c) => (
                <Tr key={c.externalId}>
                  <Td>
                    <span className="sk-ident af-nowrap">{c.externalId}</span>
                  </Td>
                  <Td>{c.label}</Td>
                  <Td>
                    {c.isHumanOnly ? (
                      <span className="ce-lock-chip">
                        <Lock size={12} aria-hidden />{' '}
                        {t('courierEscalationPortalPortalIndex.humanOnly')}
                      </span>
                    ) : (
                      <span className="af-small">
                        {t('courierEscalationPortalPortalIndex.allowedIfListed')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="af-small af-nowrap">
                      {new Date(c.lastSeenAt).toLocaleDateString('en-IN')}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AfSection>
    </div>
  );
}

function outcomeKind(
  outcome: string,
): 'pending' | 'in-transit' | 'delivered' | 'failed' | 'draft' | 'cancelled' {
  switch (outcome) {
    case 'CONFIRMED':
    case 'ALREADY_PRESENT':
      return 'delivered';
    case 'SENT_UNVERIFIED':
      return 'pending';
    case 'FAILED':
    case 'CHALLENGED':
      return 'failed';
    case 'SKIPPED':
      return 'cancelled';
    default:
      return 'draft';
  }
}

function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}

/**
 * The switch that lets the browser actually click — and, more
 * importantly, the one that stops it.
 *
 * Going LIVE asks for a typed reason and a confirmation, because it is
 * the moment software starts typing into a courier's support desk in our
 * name. Coming BACK is one click with a reason pre-filled: the whole
 * point of an off switch is that it is faster to reach than the thing it
 * stops. Both are audited HIGH; the server is the boundary either way
 * (FE-2), and its verdict is shown verbatim.
 */
function PortalModeSwitch({ current }: { readonly current: string | null }): ReactElement {
  const t = useT();

  const setMode = useSetPortalMode();
  const toast = useToast();
  const canManage = usePermission('courier.accounts.manage');
  const [reason, setReason] = useState('');
  // Going LIVE is the moment software starts typing into a courier's
  // support desk in our name, so it asks first. Stopping stays one click.
  const [confirmLive, setConfirmLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const live = current === 'LIVE';
  const off = current === 'OFF';

  if (!canManage || current === null) return <></>;

  const change = async (portalMode: PortalMode, why: string): Promise<void> => {
    await setMode.mutateAsync({ portalMode, reason: why });
    toast.success(
      portalMode === 'LIVE'
        ? t('courierEscalationPortalPortalIndex.portalIsLive')
        : portalMode === 'OFF'
          ? t('courierEscalationPortalPortalIndex.portalAutomationIsOffNothing')
          : t('courierEscalationPortalPortalIndex.portalIsBackInShadow'),
    );
    setReason('');
  };

  const go = (portalMode: PortalMode, why: string): void => {
    void (async () => {
      try {
        await change(portalMode, why);
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  async function goLive(): Promise<void> {
    setLiveError(null);
    try {
      await change('LIVE', reason.trim());
    } catch (err) {
      // FE-2: verbatim, in the dialog, which stays open to retry.
      setLiveError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <AfCard tone={live ? 'critical' : undefined}>
      <div className="af-card__head">
        <div className="af-grow af-stack af-stack--tight">
          <p className="af-title">
            {t('courierEscalationPortalPortalIndex.browserChannel', {
              value: live
                ? t('courierEscalationPortalPortalIndex.liveItClicks')
                : off
                  ? t('courierEscalationPortalPortalIndex.offNothingRunsAtAll')
                  : t('courierEscalationPortalPortalIndex.shadowItWithholdsEveryClick'),
            })}
          </p>
          <p className="af-small">
            {live
              ? t('courierEscalationPortalPortalIndex.softwareIsRaisingTicketsOn')
              : off
                ? // The distinction people get wrong: SHADOW still signs in
                  // and reads, and can still fail at 3am about work nobody
                  // is waiting for. OFF is the one that means stop.
                  t('courierEscalationPortalPortalIndex.noBrowserIsOpenedAnd')
                : t('courierEscalationPortalPortalIndex.everythingUpToTheClick')}
          </p>
        </div>
        {live ? (
          <div className="af-row">
            <Button
              variant="destructive"
              size="sm"
              disabled={setMode.isPending}
              onClick={() =>
                go('SHADOW', t('courierEscalationPortalPortalIndex.stoppingTheBrowserChannelFrom'))
              }
            >
              {t('courierEscalationPortalPortalIndex.stopBackToShadow')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={setMode.isPending}
              onClick={() =>
                go('OFF', t('courierEscalationPortalPortalIndex.standingThePortalAutomationDown'))
              }
            >
              {t('courierEscalationPortalPortalIndex.turnItOff')}
            </Button>
          </div>
        ) : (
          <div className="af-row af-row--bottom">
            <div className="ce-reason">
              <TextField
                label={t('courierEscalationPortalPortalIndex.reason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('courierEscalationPortalPortalIndex.why10Chars')}
                aria-label={t('courierEscalationPortalPortalIndex.reasonForGoingLive')}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={reason.trim().length < 10 || setMode.isPending}
              onClick={() => {
                setLiveError(null);
                setConfirmLive(true);
              }}
            >
              {t('courierEscalationPortalPortalIndex.goLive')}
            </Button>
            {off ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={reason.trim().length < 10 || setMode.isPending}
                onClick={() => go('SHADOW', reason.trim())}
              >
                {t('courierEscalationPortalPortalIndex.backToShadow')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={setMode.isPending}
                onClick={() =>
                  go('OFF', t('courierEscalationPortalPortalIndex.standingThePortalAutomationDown'))
                }
              >
                {t('courierEscalationPortalPortalIndex.turnItOff')}
              </Button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title={t('courierEscalationPortalPortalIndex.letTheBrowserChannelClick')}
        entity={t('courierEscalationPortalPortalIndex.courierPortalWorker')}
        consequence={t('courierEscalationPortalPortalIndex.fromTheNextRunSoftware')}
        confirmLabel={t('courierEscalationPortalPortalIndex.goLive')}
        destructive
        error={liveError}
        onConfirm={goLive}
      >
        <Notice tone="info">
          <p>{t('courierEscalationPortalPortalIndex.reasonRecorded', { value: reason.trim() })}</p>
        </Notice>
      </ConfirmDialog>
    </AfCard>
  );
}
