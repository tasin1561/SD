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
  type CallQueueRow,
} from '@/lib/callcenter-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
  const [status, setStatus] = useState('');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);
  const [reassigning, setReassigning] = useState<CallQueueRow | null>(null);

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
            <option value="">All statuses</option>
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
                  <Th align="right">Attempts</Th>
                  <Th>Assigned to</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((e) => (
                  <Tr key={e.id}>
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
                      <Num value={e.scheduledAttempts} />
                    </Td>
                    <Td>
                      {e.assignedAgentId === null ? (
                        <span className="text-text-faint">—</span>
                      ) : (
                        agentEmail(agents.data, e.assignedAgentId)
                      )}
                    </Td>
                    <Td>
                      <StatusBadge kind={queueKind(e.status)} label={e.status.toLowerCase()} />
                    </Td>
                    <Td align="right">
                      {e.status === 'ASSIGNED' && (
                        <Button variant="ghost" size="sm" onClick={() => setReassigning(e)}>
                          Reassign
                        </Button>
                      )}
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
