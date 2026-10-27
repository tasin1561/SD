'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Num } from '@skydrop/ui/components';
import { Headset, PhoneCall, UserCheck } from 'lucide-react';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { TextField } from '@skydrop/ui/app/text-field';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { Facts, OoCard } from '../../../orders/_components/order-ops-parts';
import '../../_components/call-center.css';
import {
  useAgentMetrics,
  useAgents,
  useUpdateAgentSettings,
  type AgentListRow,
} from '@/lib/callcenter-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Call agents — who is on, what they are holding, how they are doing.
 *
 * The availability toggle is the one that matters day to day: an agent
 * marked available keeps being handed work, so someone who has gone
 * home without flipping it silently absorbs calls that then sit
 * untouched until they expire. Making it a one-click change from a
 * supervisor's list is the point of this screen.
 *
 * Capacity is shown as "holding N of M" rather than as a bare number,
 * because the number only means something against the cap.
 */
export function AgentsIndex(): ReactElement {
  const t = useT();
  const list = useAgents();
  const update = useUpdateAgentSettings();
  /*
    THE ID, NOT THE ROW. Holding the row itself made the detail panel a
    SNAPSHOT of the moment it was opened, so a successful capacity save
    left it still showing the old figure with its Save button enabled —
    pressing again re-sent the same number. Looking the agent up in the
    list means the panel reads whatever the server last said.
  */
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);

  const items = list.data ?? [];
  const openAgent = items.find((a) => a.agentId === openAgentId) ?? null;
  const availableCount = items.filter((a) => a.settings.isAvailable).length;
  const holding = items.reduce((n, a) => n + a.activeAssigned, 0);

  return (
    <div className="oo-page">
      <PageHeader
        title={t('callCenterAgentsAgentsIndex.callAgents')}
        subtitle={t('callCenterAgentsAgentsIndex.whoIsTakingCallsWhat')}
      />

      <div className="oo-kpis">
        <KpiCard
          label={t('callCenterAgentsAgentsIndex.agents')}
          icon={<Headset size={14} />}
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: items.length })}
        />
        <KpiCard
          label={t('callCenterAgentsAgentsIndex.markedAvailable')}
          icon={<UserCheck size={14} />}
          tone={items.length > 0 && availableCount === 0 ? 'debit' : 'neutral'}
          hint={
            items.length > 0 && availableCount === 0
              ? t('callCenterAgentsAgentsIndex.nobodyIsAvailableNothingWill')
              : undefined
          }
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: availableCount })}
        />
        <KpiCard
          label={t('callCenterAgentsAgentsIndex.callsHeldRightNow')}
          icon={<PhoneCall size={14} />}
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: holding })}
        />
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={6} label={t('callCenterAgentsAgentsIndex.loadingAgents')} />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('callCenterAgentsAgentsIndex.noCallAgents')}
          description={t('callCenterAgentsAgentsIndex.staffWithTheCallAgent')}
        />
      ) : (
        <OoCard flush>
          <Table caption={t('callCenterAgentsAgentsIndex.callAgents')}>
            <THead>
              <Tr>
                <Th>{t('callCenterAgentsAgentsIndex.agent')}</Th>
                <Th>{t('callCenterAgentsAgentsIndex.hours')}</Th>
                <Th>{t('callCenterAgentsAgentsIndex.languages')}</Th>
                <Th align="right">{t('callCenterAgentsAgentsIndex.holding')}</Th>
                <Th>{t('callCenterAgentsAgentsIndex.available')}</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {items.map((a) => (
                <Tr key={a.agentId}>
                  <Td className="oo-wrap">{a.email}</Td>
                  <Td>
                    <span className="oo-muted sk-figure">
                      {a.settings.workingHoursStart}–{a.settings.workingHoursEnd}{' '}
                      {a.settings.timezone}
                    </span>
                  </Td>
                  <Td>
                    {a.settings.languages.length === 0 ? (
                      <span className="oo-faint">—</span>
                    ) : (
                      a.settings.languages.join(', ')
                    )}
                  </Td>
                  <Td align="right">
                    <span
                      className={
                        a.activeAssigned >= a.settings.maxActiveCalls
                          ? 'sk-figure oo-warn'
                          : 'sk-figure'
                      }
                    >
                      {t('callCenterAgentsAgentsIndex.of', {
                        activeAssigned: a.activeAssigned,
                        maxActiveCalls: a.settings.maxActiveCalls,
                      })}
                    </span>
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={a.settings.isAvailable ? 'delivered' : 'cancelled'}
                      label={a.settings.isAvailable ? 'available' : 'off'}
                    />
                  </Td>
                  <Td align="right">
                    <span className="cc-row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({
                            agentId: a.agentId,
                            body: { isAvailable: !a.settings.isAvailable },
                          })
                        }
                      >
                        {a.settings.isAvailable
                          ? t('callCenterAgentsAgentsIndex.markOff')
                          : t('callCenterAgentsAgentsIndex.markAvailable')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setOpenAgentId(a.agentId)}>
                        {t('callCenterAgentsAgentsIndex.details')}
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </OoCard>
      )}

      {update.error !== null && (
        <p className="oo-error" role="alert">
          {serverVerdict(update.error)}
        </p>
      )}

      <AgentDetail agent={openAgent} onClose={() => setOpenAgentId(null)} />
    </div>
  );
}

function AgentDetail({
  agent,
  onClose,
}: {
  agent: AgentListRow | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const metrics = useAgentMetrics(agent?.agentId ?? null);
  const update = useUpdateAgentSettings();
  const [maxActiveCalls, setMaxActiveCalls] = useState('');

  /*
    The field OWNS its value, seeded when the panel opens on an agent.

    It used to render `maxActiveCalls === '' ? String(cap) : …`, using
    the empty string as a sentinel for "not edited" — which meant the
    field could not be EMPTIED: clearing it put the current cap straight
    back, and the next keystroke landed beside that rather than
    replacing it. Clearing "1" and typing "3" saved thirteen, with the
    button enabled and nothing to say so. Found by filming this screen.

    Keyed on the agent id rather than on the row, so a background
    refetch of the list cannot overwrite what somebody is typing.
  */
  const openOn = agent?.agentId ?? null;
  useEffect(() => {
    setMaxActiveCalls(agent === null ? '' : String(agent.settings.maxActiveCalls));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOn]);

  function close(): void {
    setMaxActiveCalls('');
    update.reset();
    onClose();
  }

  const outcomes = Object.entries(metrics.data?.byOutcome ?? {}).sort((a, b) => b[1] - a[1]);
  const attempts = metrics.data?.totalAttempts ?? 0;
  const confirmed = metrics.data?.confirmedCount ?? 0;
  const holds = metrics.data?.holds;

  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={agent?.email ?? t('callCenterAgentsAgentsIndex.agent')}
      description={t('callCenterAgentsAgentsIndex.attemptHistoryAndCapacity')}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {t('callCenterAgentsAgentsIndex.close')}
          </Button>
          {agent !== null && (
            <AsyncButton
              size="md"
              state={update.isPending ? 'busy' : 'idle'}
              labels={{
                idle: t('callCenterAgentsAgentsIndex.saveCapacity'),
                busy: t('callCenterAgentsAgentsIndex.saving'),
              }}
              disabled={
                maxActiveCalls === '' ||
                Number(maxActiveCalls) === agent.settings.maxActiveCalls ||
                Number(maxActiveCalls) < 1 ||
                update.isPending
              }
              onClick={() =>
                update.mutate({
                  agentId: agent.agentId,
                  body: { maxActiveCalls: Number(maxActiveCalls) },
                })
              }
            />
          )}
        </DialogFooter>
      }
    >
      {agent !== null && (
        <div className="oo-stack">
          <Facts
            items={[
              {
                label: t('callCenterAgentsAgentsIndex.workingHours'),
                value: `${agent.settings.workingHoursStart}–${agent.settings.workingHoursEnd} ${agent.settings.timezone}`,
              },
              {
                label: t('callCenterAgentsAgentsIndex.workingDays'),
                value:
                  agent.settings.workingDays.length === 0
                    ? '—'
                    : agent.settings.workingDays.map((d) => DAY_NAMES(t)[d] ?? d).join(', '),
              },
              {
                label: t('callCenterAgentsAgentsIndex.canTakeHighRisk'),
                value: agent.settings.canHandleHighRisk
                  ? t('callCenterAgentsAgentsIndex.yes')
                  : t('callCenterAgentsAgentsIndex.no'),
              },
              {
                label: t('callCenterAgentsAgentsIndex.canTakeHighValue'),
                value: agent.settings.canHandleHighValue
                  ? t('callCenterAgentsAgentsIndex.yes')
                  : t('callCenterAgentsAgentsIndex.no'),
              },
            ]}
          />

          {holds !== undefined && (holds.holdsCompleted > 0 || holds.holdsDropped > 0) && (
            <section className="oo-section">
              <SectionHeading
                as="h3"
                title={t('callCenterAgentsAgentsIndex.timeHoldingCalls')}
                // An attempt count says how much work an agent DID. This
                // says what became of the work they TOOK — a dropped hold
                // logs no attempt, so it is invisible above by
                // construction.
                note={
                  holds.holdsDropped === 0
                    ? t('callCenterAgentsAgentsIndex.everyCallThisAgentPicked')
                    : t('callCenterAgentsAgentsIndex.ofCallsPickedUpEnded', {
                        holdsDropped: holds.holdsDropped,
                        value: holds.holdsCompleted + holds.holdsDropped,
                      })
                }
              />
              <Facts
                items={[
                  {
                    label: t('callCenterAgentsAgentsIndex.callsWorked'),
                    value: <Num value={holds.holdsCompleted} />,
                  },
                  {
                    label: t('callCenterAgentsAgentsIndex.pickedUpThenDropped'),
                    value: <Num value={holds.holdsDropped} />,
                  },
                  {
                    label: t('callCenterAgentsAgentsIndex.averageTimeToLogAn'),
                    value:
                      holds.avgSecondsToOutcome === null
                        ? '—'
                        : formatDuration(holds.avgSecondsToOutcome),
                  },
                  {
                    label: t('callCenterAgentsAgentsIndex.longestHoldThatWentNowhere'),
                    value:
                      holds.longestDroppedSeconds === null
                        ? '—'
                        : formatDuration(holds.longestDroppedSeconds),
                  },
                  ...Object.entries(holds.dropsByReason).map(([reason, n]) => ({
                    label: DROP_REASON_LABELS(t)[reason] ?? reason,
                    value: <Num value={n} />,
                  })),
                ]}
              />
            </section>
          )}

          <section className="oo-section">
            <SectionHeading
              as="h3"
              title={t('callCenterAgentsAgentsIndex.attempts')}
              note={
                attempts === 0
                  ? t('callCenterAgentsAgentsIndex.noAttemptsLoggedYet')
                  : t('callCenterAgentsAgentsIndex.ofAttemptsEndedInA', { confirmed, attempts })
              }
            />
            {metrics.isLoading ? (
              <SkeletonRows
                rows={3}
                cols={3}
                label={t('callCenterAgentsAgentsIndex.loadingAttempts')}
              />
            ) : outcomes.length === 0 ? (
              <EmptyState
                bare
                title={t('callCenterAgentsAgentsIndex.nothingLogged')}
                description={t('callCenterAgentsAgentsIndex.noCallsRecordedForThis')}
              />
            ) : (
              <Table caption={t('callCenterAgentsAgentsIndex.attemptsByOutcome')}>
                <THead>
                  <Tr>
                    <Th>{t('callCenterAgentsAgentsIndex.outcome')}</Th>
                    <Th align="right">{t('callCenterAgentsAgentsIndex.count')}</Th>
                    <Th align="right">{t('callCenterAgentsAgentsIndex.share')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {outcomes.map(([outcome, count]) => (
                    <Tr key={outcome}>
                      <Td>{outcome.replace(/_/g, ' ').toLowerCase()}</Td>
                      <Td align="right">
                        <Num value={count} />
                      </Td>
                      <Td align="right" className="sk-figure">
                        {attempts === 0 ? '—' : `${Math.round((count / attempts) * 100)}%`}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section className="oo-section">
            <SectionHeading
              as="h3"
              title={t('callCenterAgentsAgentsIndex.capacity')}
              note={t('callCenterAgentsAgentsIndex.howManyCallsThisAgent')}
            />
            <TextField
              id="ag-max"
              label={t('callCenterAgentsAgentsIndex.maximumConcurrentCalls')}
              type="number"
              min={1}
              value={maxActiveCalls}
              onChange={(e) => setMaxActiveCalls(e.target.value)}
            />
          </section>

          {update.error !== null && (
            <p className="oo-error" role="alert">
              {serverVerdict(update.error)}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

const DAY_NAMES = (t: Translate<MessageKey>): Record<number, string> => ({
  0: t('callCenterAgentsAgentsIndex.sun'),
  1: t('callCenterAgentsAgentsIndex.mon'),
  2: t('callCenterAgentsAgentsIndex.tue'),
  3: t('callCenterAgentsAgentsIndex.wed'),
  4: t('callCenterAgentsAgentsIndex.thu'),
  5: t('callCenterAgentsAgentsIndex.fri'),
  6: t('callCenterAgentsAgentsIndex.sat'),
});

/** Why a hold ended with nothing to show for it, in words an operator
 *  can act on rather than an enum. */
const DROP_REASON_LABELS = (t: Translate<MessageKey>): Record<string, string> => ({
  RELEASED: t('callCenterAgentsAgentsIndex.handedBackWithoutCalling'),
  EXPIRED: t('callCenterAgentsAgentsIndex.heldPastTheTimeout'),
  AGENT_ABSENT: t('callCenterAgentsAgentsIndex.agentWasNotAtThe'),
  REASSIGNED: t('callCenterAgentsAgentsIndex.movedToSomeoneElse'),
});

/** Seconds → the coarsest unit that still says something. A hold is
 *  minutes long; rendering 450 helps nobody. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
