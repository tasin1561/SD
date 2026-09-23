'use client';

import { useState, type ReactElement } from 'react';
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
  const list = useAgents();
  const update = useUpdateAgentSettings();
  const [openAgent, setOpenAgent] = useState<AgentListRow | null>(null);

  const items = list.data ?? [];
  const availableCount = items.filter((a) => a.settings.isAvailable).length;
  const holding = items.reduce((n, a) => n + a.activeAssigned, 0);

  return (
    <div className="oo-page">
      <PageHeader
        title="Call agents"
        subtitle="Who is taking calls, what they are holding, and how their attempts are landing."
      />

      <div className="oo-kpis">
        <KpiCard
          label="Agents"
          icon={<Headset size={14} />}
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: items.length })}
        />
        <KpiCard
          label="Marked available"
          icon={<UserCheck size={14} />}
          tone={items.length > 0 && availableCount === 0 ? 'debit' : 'neutral'}
          hint={
            items.length > 0 && availableCount === 0
              ? 'Nobody is available — nothing will be assigned'
              : undefined
          }
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: availableCount })}
        />
        <KpiCard
          label="Calls held right now"
          icon={<PhoneCall size={14} />}
          {...(list.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: holding })}
        />
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={6} label="Loading agents…" />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No call agents"
          description="Staff with the call agent role appear here once they exist. Add them from Staff."
        />
      ) : (
        <OoCard flush>
          <Table caption="Call agents">
            <THead>
              <Tr>
                <Th>Agent</Th>
                <Th>Hours</Th>
                <Th>Languages</Th>
                <Th align="right">Holding</Th>
                <Th>Available</Th>
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
                      {a.activeAssigned} of {a.settings.maxActiveCalls}
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
                        {a.settings.isAvailable ? 'Mark off' : 'Mark available'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setOpenAgent(a)}>
                        Details
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

      <AgentDetail agent={openAgent} onClose={() => setOpenAgent(null)} />
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
  const metrics = useAgentMetrics(agent?.agentId ?? null);
  const update = useUpdateAgentSettings();
  const [maxActiveCalls, setMaxActiveCalls] = useState('');

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
      title={agent?.email ?? 'Agent'}
      description="Attempt history and capacity."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Close
          </Button>
          {agent !== null && (
            <AsyncButton
              size="md"
              state={update.isPending ? 'busy' : 'idle'}
              labels={{ idle: 'Save capacity', busy: 'Saving…' }}
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
                label: 'Working hours',
                value: `${agent.settings.workingHoursStart}–${agent.settings.workingHoursEnd} ${agent.settings.timezone}`,
              },
              {
                label: 'Working days',
                value:
                  agent.settings.workingDays.length === 0
                    ? '—'
                    : agent.settings.workingDays.map((d) => DAY_NAMES[d] ?? d).join(', '),
              },
              {
                label: 'Can take high risk',
                value: agent.settings.canHandleHighRisk ? 'Yes' : 'No',
              },
              {
                label: 'Can take high value',
                value: agent.settings.canHandleHighValue ? 'Yes' : 'No',
              },
            ]}
          />

          {holds !== undefined && (holds.holdsCompleted > 0 || holds.holdsDropped > 0) && (
            <section className="oo-section">
              <SectionHeading
                as="h3"
                title="Time holding calls"
                // An attempt count says how much work an agent DID. This
                // says what became of the work they TOOK — a dropped hold
                // logs no attempt, so it is invisible above by
                // construction.
                note={
                  holds.holdsDropped === 0
                    ? 'Every call this agent picked up ended in a logged outcome.'
                    : `${holds.holdsDropped} of ${holds.holdsCompleted + holds.holdsDropped} calls picked up ended without a call being logged.`
                }
              />
              <Facts
                items={[
                  { label: 'Calls worked', value: <Num value={holds.holdsCompleted} /> },
                  { label: 'Picked up then dropped', value: <Num value={holds.holdsDropped} /> },
                  {
                    label: 'Average time to log an outcome',
                    value:
                      holds.avgSecondsToOutcome === null
                        ? '—'
                        : formatDuration(holds.avgSecondsToOutcome),
                  },
                  {
                    label: 'Longest hold that went nowhere',
                    value:
                      holds.longestDroppedSeconds === null
                        ? '—'
                        : formatDuration(holds.longestDroppedSeconds),
                  },
                  ...Object.entries(holds.dropsByReason).map(([reason, n]) => ({
                    label: DROP_REASON_LABELS[reason] ?? reason,
                    value: <Num value={n} />,
                  })),
                ]}
              />
            </section>
          )}

          <section className="oo-section">
            <SectionHeading
              as="h3"
              title="Attempts"
              note={
                attempts === 0
                  ? 'No attempts logged yet.'
                  : `${confirmed} of ${attempts} attempts ended in a confirmed order.`
              }
            />
            {metrics.isLoading ? (
              <SkeletonRows rows={3} cols={3} label="Loading attempts…" />
            ) : outcomes.length === 0 ? (
              <EmptyState
                bare
                title="Nothing logged"
                description="No calls recorded for this agent."
              />
            ) : (
              <Table caption="Attempts by outcome">
                <THead>
                  <Tr>
                    <Th>Outcome</Th>
                    <Th align="right">Count</Th>
                    <Th align="right">Share</Th>
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
              title="Capacity"
              note="How many calls this agent can hold at once. Lower it if they are drowning; raise it only if they are idle."
            />
            <TextField
              id="ag-max"
              label="Maximum concurrent calls"
              type="number"
              min={1}
              value={maxActiveCalls === '' ? String(agent.settings.maxActiveCalls) : maxActiveCalls}
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

const DAY_NAMES: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/** Why a hold ended with nothing to show for it, in words an operator
 *  can act on rather than an enum. */
const DROP_REASON_LABELS: Record<string, string> = {
  RELEASED: 'Handed back without calling',
  EXPIRED: 'Held past the timeout',
  AGENT_ABSENT: 'Agent was not at the desk',
  REASSIGNED: 'Moved to someone else',
};

/** Seconds → the coarsest unit that still says something. A hold is
 *  minutes long; rendering 450 helps nobody. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
