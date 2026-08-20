'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import {
  useAgents,
  useCallQueue,
  useCallQueueStats,
  useReassignQueueEntry,
  useRescheduleQueueEntry,
  type CallQueueRow,
} from '@/lib/callcenter-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ForceOutcomePanel } from './force-outcome-panel';
import { useRouter } from 'next/navigation';

const PAGE_SIZE = 25;

/**
 * The call queue, from a supervisor's side.
 *
 * `/call-center` is the agent station — pull the next order, log the
 * attempt. This is the other view: what is waiting, who is holding it,
 * and how long it has been sitting there. There was no such view, so an
 * entry assigned to someone who went home stayed assigned until its
 * timer expired and nobody could see that it had.
 *
 * Reassign is the one write here. It is deliberately a supervisor
 * action rather than something an agent can do to their own queue —
 * moving work off a colleague is a decision with a person on the other
 * end of it.
 */
export function QueueIndex(): ReactElement {
  const router = useRouter();
  // Defaults to OPEN, matching this page's own subtitle: "what is
  // waiting to be confirmed, and who is holding it". A COMPLETED row is
  // neither — it is the record of a finished attempt. An order that has
  // been retried has one row per attempt cycle (locked decision #2), so
  // listing every status by default put the history beside the live
  // entry and made a working retry look like a duplicate.
  const [status, setStatus] = useState('OPEN');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);
  const [reassigning, setReassigning] = useState<CallQueueRow | null>(null);
  const [rescheduling, setRescheduling] = useState<CallQueueRow | null>(null);

  const stats = useCallQueueStats();
  const list = useCallQueue({
    ...(status === '' ? {} : { status }),
    ...(agentId === '' ? {} : { agentId }),
    page,
    pageSize: PAGE_SIZE,
  });
  const agents = useAgents();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const byStatus = stats.data?.byStatus ?? {};

  function change(apply: () => void): void {
    apply();
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Call queue"
        subtitle="What is waiting to be confirmed, and who is holding it."
        action={
          <Link href="/call-center">
            <Button variant="ghost" size="md">
              Agent station
            </Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Open"
          hint="Waiting or assigned — not yet resolved"
          value={<Num value={stats.data?.openTotal ?? 0} />}
          tone={(stats.data?.openTotal ?? 0) > 0 ? 'warn' : 'neutral'}
        />
        <Stat label="Pending" value={<Num value={byStatus.PENDING ?? 0} />} />
        <Stat label="Assigned" value={<Num value={byStatus.ASSIGNED ?? 0} />} />
        <Stat
          label="Agents holding work"
          value={<Num value={stats.data?.assignedByAgent.length ?? 0} />}
        />
      </div>

      <Toolbar>
        <FormField label="Status" htmlFor="q-status" className="w-48">
          <Select
            id="q-status"
            value={status}
            onChange={(e) => change(() => setStatus(e.target.value))}
          >
            <option value="OPEN">Open — waiting or assigned</option>
            <option value="">All, including finished attempts</option>
            {['PENDING', 'ASSIGNED', 'COMPLETED', 'EXPIRED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Agent" htmlFor="q-agent" className="w-64">
          <Select
            id="q-agent"
            value={agentId}
            onChange={(e) => change(() => setAgentId(e.target.value))}
          >
            <option value="">All agents</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.email}
              </option>
            ))}
          </Select>
        </FormField>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={6} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            description="Orders enter the queue when they reach pending confirmation, and leave when an agent records an outcome."
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Waiting since</Th>
                  <Th>Available</Th>
                  <Th align="right">Calls</Th>
                  <Th align="right">Pulls</Th>
                  <Th>Assigned to</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((e) => (
                  <Tr key={e.id} onActivate={() => router.push(`/orders/${e.orderId}`)}>
                    <Td>
                      {e.order === null ? (
                        <Ident value={e.orderId} />
                      ) : (
                        <Link href={`/orders/${e.orderId}`} className="text-accent hover:underline">
                          {e.order.orderNumber}
                        </Link>
                      )}
                    </Td>
                    <Td>{waitedFor(e.createdAt)}</Td>
                    <Td>
                      {new Date(e.availableAt) > new Date()
                        ? `in ${waitedFor(new Date().toISOString(), e.availableAt)}`
                        : 'now'}
                    </Td>
                    <Td align="right">
                      {/* Calls LOGGED, and of those the ones the NDR cap
                          is judged on. This column used to show the pull
                          counter, which reads 1 the moment an agent
                          claims the row — so an order nobody had phoned
                          yet showed "Attempts 1". */}
                      <span className="tabular-nums">
                        {e.attemptsCounting}
                        <span className="text-text-faint">/{e.maxAttempts}</span>
                        {e.attemptsLogged > e.attemptsCounting && (
                          <span className="text-text-faint text-xs">
                            {' '}
                            ({e.attemptsLogged} logged)
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td align="right">
                      <Num value={e.scheduledAttempts} />
                    </Td>
                    <Td>
                      {e.agent !== null ? (
                        <span>{e.agent.name}</span>
                      ) : e.assignedAgentId === null ? (
                        <span className="text-text-faint">—</span>
                      ) : (
                        agentEmail(agents.data, e.assignedAgentId)
                      )}
                    </Td>
                    <Td>
                      <StatusBadge kind={queueKind(e.status)} label={e.status.toLowerCase()} />
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        {e.status === 'ASSIGNED' && (
                          <Button variant="ghost" size="sm" onClick={() => setReassigning(e)}>
                            Reassign
                          </Button>
                        )}
                        {/* Timing, not outcome. Force-outcome was the
                            only lever on a call parked hours out, and it
                            works by RECORDING a conversation that did
                            not happen. */}
                        <Button variant="ghost" size="sm" onClick={() => setRescheduling(e)}>
                          Reschedule
                        </Button>
                        <ForceOutcomePanel
                          entryId={e.id}
                          entryStatus={e.status}
                          orderLabel={e.order?.orderNumber ?? e.orderId}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Reassign entry={reassigning} onClose={() => setReassigning(null)} />
      <Reschedule entry={rescheduling} onClose={() => setRescheduling(null)} />
    </div>
  );
}

function agentEmail(
  agents: readonly { agentId: string; email: string }[] | undefined,
  id: string,
): ReactElement {
  const found = agents?.find((a) => a.agentId === id);
  return found === undefined ? <Ident value={id} /> : <span>{found.email}</span>;
}

/** Rough elapsed time — precision past "hours" is noise on a queue. */
function waitedFor(fromIso: string, toIso?: string): string {
  const ms = new Date(toIso ?? new Date().toISOString()).getTime() - new Date(fromIso).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function queueKind(status: string): 'pending' | 'confirmed' | 'delivered' | 'failed' {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'ASSIGNED':
      return 'confirmed';
    case 'COMPLETED':
      return 'delivered';
    default:
      return 'failed';
  }
}

/**
 * Move when a queued call becomes callable.
 *
 * Timing only. It never touches the attempt count, because this is about
 * scheduling, not about pretending a call was or was not made — that is
 * force-outcome, and reaching for it to move a call records a
 * conversation nobody had.
 */
function Reschedule({
  entry,
  onClose,
}: {
  entry: CallQueueRow | null;
  onClose: () => void;
}): ReactElement {
  const reschedule = useRescheduleQueueEntry();
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');

  function close(): void {
    setWhen('');
    setReason('');
    reschedule.reset();
    onClose();
  }

  /** `datetime-local` wants local wall-clock with no zone, so the ISO
   *  string cannot be sliced — it is UTC and would shift the time. */
  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <Modal
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="When should this call become callable?"
      description="Timing only — the attempt count and the order are untouched. A time in the past means it can be picked up straight away."
    >
      <FormField
        label="Callable from"
        htmlFor="q-when"
        hint={
          entry === null
            ? undefined
            : `Currently ${new Date(entry.availableAt).toLocaleString('en-IN')}`
        }
      >
        <Input
          id="q-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </FormField>

      <div className="mt-2 flex flex-wrap gap-2">
        {/* The two real cases: the customer rang back, or they asked for
            later. Typing a datetime for "now" is friction on the more
            urgent of the two. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWhen(toLocalInput(new Date().toISOString()))}
        >
          Now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWhen(toLocalInput(new Date(Date.now() + 60 * 60_000).toISOString()))}
        >
          In 1 hour
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setWhen(toLocalInput(new Date(Date.now() + 24 * 60 * 60_000).toISOString()))
          }
        >
          Tomorrow
        </Button>
      </div>

      <FormField
        label="Why"
        htmlFor="q-why"
        hint="Moving when a customer gets called is a decision someone should be able to account for later."
      >
        <Input
          id="q-why"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Customer rang back and asked to be called now"
        />
      </FormField>

      {reschedule.error !== null && <ErrorNote message={serverVerdict(reschedule.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={when === '' || reason.trim().length < 5 || reschedule.isPending}
          onClick={() => {
            if (entry !== null) {
              reschedule.mutate(
                {
                  entryId: entry.id,
                  // `datetime-local` has no zone; the Date constructor
                  // reads it as LOCAL, which is what the operator typed.
                  availableAt: new Date(when).toISOString(),
                  reason: reason.trim(),
                },
                { onSuccess: close },
              );
            }
          }}
        >
          {reschedule.isPending ? 'Rescheduling…' : 'Reschedule'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function Reassign({
  entry,
  onClose,
}: {
  entry: CallQueueRow | null;
  onClose: () => void;
}): ReactElement {
  const agents = useAgents();
  const reassign = useReassignQueueEntry();
  const [toAgentId, setToAgentId] = useState('');

  function close(): void {
    setToAgentId('');
    reassign.reset();
    onClose();
  }

  const available = (agents.data ?? []).filter(
    (a) => a.settings.isAvailable && a.agentId !== entry?.assignedAgentId,
  );

  return (
    <Modal
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Move this call to another agent"
      description="The order keeps its place and its attempt history — only who is holding it changes."
    >
      <FormField
        label="Give it to"
        htmlFor="q-to"
        hint="Only agents currently marked available are listed."
      >
        <Select id="q-to" value={toAgentId} onChange={(e) => setToAgentId(e.target.value)}>
          <option value="">Select an agent…</option>
          {available.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.email} — holding {a.activeAssigned} of {a.settings.maxActiveCalls}
            </option>
          ))}
        </Select>
      </FormField>

      {available.length === 0 && (
        <ErrorNote message="No other agent is marked available. Set someone available on the Agents screen first." />
      )}
      {reassign.error !== null && <ErrorNote message={serverVerdict(reassign.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={toAgentId === '' || reassign.isPending}
          onClick={() => {
            if (entry !== null) {
              reassign.mutate({ entryId: entry.id, toAgentId }, { onSuccess: close });
            }
          }}
        >
          {reassign.isPending ? 'Moving…' : 'Reassign'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
