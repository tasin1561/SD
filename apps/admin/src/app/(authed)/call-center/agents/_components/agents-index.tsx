'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Section,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        title="Call agents"
        subtitle="Who is taking calls, what they are holding, and how their attempts are landing."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Agents" value={<Num value={items.length} />} />
        <Stat
          label="Marked available"
          value={<Num value={availableCount} />}
          tone={items.length > 0 && availableCount === 0 ? 'bad' : 'neutral'}
          hint={
            items.length > 0 && availableCount === 0
              ? 'Nobody is available — nothing will be assigned'
              : undefined
          }
        />
        <Stat label="Calls held right now" value={<Num value={holding} />} />
      </div>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={4} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No call agents"
            description="Staff with the call agent role appear here once they exist. Add them from Staff."
          />
        ) : (
          <Table>
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
                  <Td>{a.email}</Td>
                  <Td>
                    <span className="text-text-muted text-xs">
                      {a.settings.workingHoursStart}–{a.settings.workingHoursEnd}{' '}
                      {a.settings.timezone}
                    </span>
                  </Td>
                  <Td>
                    {a.settings.languages.length === 0 ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      a.settings.languages.join(', ')
                    )}
                  </Td>
                  <Td align="right">
                    <span
                      className={
                        a.activeAssigned >= a.settings.maxActiveCalls
                          ? 'text-[var(--color-warn)]'
                          : ''
                      }
                    >
                      {a.activeAssigned} of {a.settings.maxActiveCalls}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge
                      kind={a.settings.isAvailable ? 'delivered' : 'cancelled'}
                      label={a.settings.isAvailable ? 'available' : 'off'}
                    />
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
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
        )}
      </Card>

      {update.error !== null && <ErrorNote message={serverVerdict(update.error)} />}

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
    <Modal
      open={agent !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={agent?.email ?? 'Agent'}
      description="Attempt history and capacity."
    >
      {agent !== null && (
        <>
          <DescriptionList
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
            <Section
              title="Time holding calls"
              // An attempt count says how much work an agent DID. This
              // says what became of the work they TOOK — a dropped hold
              // logs no attempt, so it is invisible above by
              // construction.
              subtitle={
                holds.holdsDropped === 0
                  ? 'Every call this agent picked up ended in a logged outcome.'
                  : `${holds.holdsDropped} of ${holds.holdsCompleted + holds.holdsDropped} calls picked up ended without a call being logged.`
              }
            >
              <DescriptionList
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
            </Section>
          )}

          <Section
            title="Attempts"
            subtitle={
              attempts === 0
                ? 'No attempts logged yet.'
                : `${confirmed} of ${attempts} attempts ended in a confirmed order.`
            }
          >
            {metrics.isLoading ? (
              <SkeletonRows rows={3} />
            ) : outcomes.length === 0 ? (
              <EmptyState
                bare
                title="Nothing logged"
                description="No calls recorded for this agent."
              />
            ) : (
              <Table>
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
                      <Td align="right">
                        {attempts === 0 ? '—' : `${Math.round((count / attempts) * 100)}%`}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>

          <Section
            title="Capacity"
            subtitle="How many calls this agent can hold at once. Lower it if they are drowning; raise it only if they are idle."
          >
            <FormField label="Maximum concurrent calls" htmlFor="ag-max">
              <Input
                id="ag-max"
                type="number"
                min={1}
                value={
                  maxActiveCalls === '' ? String(agent.settings.maxActiveCalls) : maxActiveCalls
                }
                onChange={(e) => setMaxActiveCalls(e.target.value)}
              />
            </FormField>
          </Section>

          {update.error !== null && <ErrorNote message={serverVerdict(update.error)} />}
        </>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Close
        </Button>
        {agent !== null && (
          <Button
            size="md"
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
          >
            {update.isPending ? 'Saving…' : 'Save capacity'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
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
