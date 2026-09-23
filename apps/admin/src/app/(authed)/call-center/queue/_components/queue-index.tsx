'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Ident, Num } from '@skydrop/ui/components';
import { ArrowLeftRight, Clock3, Headset, PhoneCall, Users } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { AgeChip, LinkButton, OoCard } from '../../../orders/_components/order-ops-parts';
import '../../_components/call-center.css';
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

/** Mirrors the server's MinLength on RescheduleQueueEntryDto.reason. */
const MIN_RESCHEDULE_REASON = 5;

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
    <div className="oo-page">
      <PageHeader
        title="Call queue"
        subtitle="What is waiting to be confirmed, and who is holding it."
        action={
          <LinkButton href="/call-center" variant="ghost" icon={<Headset size={15} />}>
            Agent station
          </LinkButton>
        }
      />

      {/* A value is ABSENT rather than 0 while loading: a tile reading
          "0 open" that then becomes 8 has said something false in
          between. The count-up runs once, when the figure first lands. */}
      <div className="oo-kpis">
        <KpiCard
          label="Open"
          hint="Waiting or assigned — not yet resolved"
          icon={<PhoneCall size={14} />}
          tone={(stats.data?.openTotal ?? 0) > 0 ? 'pending' : 'neutral'}
          {...(stats.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: stats.data.openTotal })}
        />
        <KpiCard
          label="Pending"
          icon={<Clock3 size={14} />}
          {...(stats.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: byStatus.PENDING ?? 0 })}
        />
        <KpiCard
          label="Assigned"
          icon={<ArrowLeftRight size={14} />}
          {...(stats.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: byStatus.ASSIGNED ?? 0 })}
        />
        <KpiCard
          label="Agents holding work"
          icon={<Users size={14} />}
          {...(stats.data === undefined
            ? { figure: <span className="oo-faint">—</span> }
            : { value: stats.data.assignedByAgent.length })}
        />
      </div>

      <div className="cc-filters">
        <Select
          id="q-status"
          label="Status"
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
        <Select
          id="q-agent"
          label="Agent"
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
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={6} cols={8} label="Loading the call queue…" />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          tone="positive"
          title="Queue is empty"
          description="Orders enter the queue when they reach pending confirmation, and leave when an agent records an outcome."
        />
      ) : (
        <OoCard flush>
          <Table caption="Call queue">
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
                      <Link href={`/orders/${e.orderId}`} className="oo-link sk-ident">
                        {e.order.orderNumber}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <AgeChip>{waitedFor(e.createdAt)}</AgeChip>
                  </Td>
                  <Td className="sk-figure">
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
                    <span className="sk-figure">
                      {e.attemptsCounting}
                      <span className="oo-faint">/{e.maxAttempts}</span>
                      {e.attemptsLogged > e.attemptsCounting && (
                        <span className="oo-faint"> ({e.attemptsLogged} logged)</span>
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
                      <span className="oo-faint">—</span>
                    ) : (
                      agentEmail(agents.data, e.assignedAgentId)
                    )}
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={queueKind(e.status)}
                      label={e.status.toLowerCase()}
                    />
                  </Td>
                  <Td align="right">
                    <div className="cc-row-actions">
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
          <Pagination
            className="cc-pager"
            label="Call queue pages"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </OoCard>
      )}

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
  const reasonShort = Math.max(0, MIN_RESCHEDULE_REASON - reason.trim().length);

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
    <Dialog
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="When should this call become callable?"
      description="Timing only — the attempt count and the order are untouched. A time in the past means it can be picked up straight away."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            size="md"
            state={reschedule.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Reschedule', busy: 'Rescheduling…' }}
            disabled={when === '' || reasonShort > 0 || reschedule.isPending}
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
          />
        </DialogFooter>
      }
    >
      <div className="oo-stack">
        <DateField
          id="q-when"
          type="datetime-local"
          label="Callable from"
          hint={
            entry === null
              ? undefined
              : `Currently ${new Date(entry.availableAt).toLocaleString('en-IN')}`
          }
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />

        <div className="cc-presets">
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

        <TextField
          id="q-why"
          label="Why"
          // Same reasoning as the seller's re-attempt dialog: a disabled
          // button with no stated minimum leaves someone typing and
          // guessing.
          hint={
            <>
              Moving when a customer gets called is a decision someone should be able to account for
              later.{' '}
              {reasonShort > 0 && (
                <span className="oo-warn">
                  {reasonShort} more {reasonShort === 1 ? 'character' : 'characters'} needed.
                </span>
              )}
            </>
          }
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Customer rang back and asked to be called now"
        />

        {reschedule.error !== null && (
          <p className="oo-error" role="alert">
            {serverVerdict(reschedule.error)}
          </p>
        )}
      </div>
    </Dialog>
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
    <Dialog
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Move this call to another agent"
      description="The order keeps its place and its attempt history — only who is holding it changes."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            size="md"
            state={reassign.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Reassign', busy: 'Moving…' }}
            disabled={toAgentId === '' || reassign.isPending}
            onClick={() => {
              if (entry !== null) {
                reassign.mutate({ entryId: entry.id, toAgentId }, { onSuccess: close });
              }
            }}
          />
        </DialogFooter>
      }
    >
      <div className="oo-stack">
        <Select
          id="q-to"
          label="Give it to"
          hint="Only agents currently marked available are listed."
          value={toAgentId}
          onChange={(e) => setToAgentId(e.target.value)}
        >
          <option value="">Select an agent…</option>
          {available.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.email} — holding {a.activeAssigned} of {a.settings.maxActiveCalls}
            </option>
          ))}
        </Select>

        {available.length === 0 && (
          <p className="oo-error" role="alert">
            No other agent is marked available. Set someone available on the Agents screen first.
          </p>
        )}
        {reassign.error !== null && (
          <p className="oo-error" role="alert">
            {serverVerdict(reassign.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
