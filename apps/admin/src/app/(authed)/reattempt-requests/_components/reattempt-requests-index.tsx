'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  StatusBadge,
  Toolbar,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useReattemptRequests,
  useDecideReattempt,
  type AdminReattemptRequest,
} from '@/lib/callcenter-hooks';

/**
 * Sellers asking to ring a customer who declined.
 *
 * The whole point of this screen is that a human sees the reason before
 * anybody dials. Approving is what makes the single edge out of
 * REJECTED_BY_CUSTOMER reachable — there is no other way back.
 */
export function ReattemptRequestsIndex(): ReactElement {
  const [status, setStatus] = useState('PENDING');
  const list = useReattemptRequests(status === '' ? undefined : status);
  const [deciding, setDeciding] = useState<{
    row: AdminReattemptRequest;
    approve: boolean;
  } | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Re-attempt requests"
        subtitle="Sellers asking us to call a customer who declined. Read the reason before approving — the customer already said no once."
      />

      <Toolbar>
        <FormField label="Status" htmlFor="ra-status" className="w-56">
          <Select id="ra-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Waiting for a decision</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Declined</option>
            <option value="">All</option>
          </Select>
        </FormField>
      </Toolbar>

      {list.isLoading ? (
        <LoadingState rows={3} />
      ) : list.error !== null ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="When a seller asks us to call a customer who declined, it lands here."
        />
      ) : (
        <div className="space-y-3">
          {(list.data ?? []).map((r) => (
            <Card key={r.id}>
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  {r.orderNumber !== null && (
                    <Link
                      href={`/orders/${r.orderId}`}
                      className="text-accent font-mono text-sm hover:underline"
                    >
                      {r.orderNumber}
                    </Link>
                  )}
                  <StatusBadge
                    kind={
                      r.status === 'PENDING'
                        ? 'pending'
                        : r.status === 'APPROVED'
                          ? 'confirmed'
                          : 'failed'
                    }
                    label={r.status.toLowerCase()}
                  />
                  <span className="text-text-faint text-xs">
                    asked {new Date(r.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>

                {/* The reason IS the decision. Rendered at full size,
                    not truncated into a column. */}
                <p className="text-text-body text-sm leading-relaxed">{r.reason}</p>

                {r.decisionNote !== null && r.decisionNote !== '' && (
                  <p className="text-text-muted text-sm">
                    <span className="text-text-faint">Decision note:</span> {r.decisionNote}
                  </p>
                )}

                {r.status === 'PENDING' && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}>
                      Approve — call again
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeciding({ row: r, approve: false })}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Decide target={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function Decide({
  target,
  onClose,
}: {
  target: { row: AdminReattemptRequest; approve: boolean } | null;
  onClose: () => void;
}): ReactElement {
  const decide = useDecideReattempt();
  const [note, setNote] = useState('');

  function close(): void {
    setNote('');
    decide.reset();
    onClose();
  }

  return (
    <Modal
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        target?.approve === true
          ? 'Put this order back in the call queue?'
          : 'Decline this request?'
      }
      description={
        target?.approve === true
          ? 'The order returns to PENDING_CONFIRMATION and is queued for calling. Its attempt count is unchanged — the customer already declined once, so the next call is the one that has to land.'
          : 'The order stays rejected. The seller can ask again if something changes.'
      }
    >
      <FormField label="Note" htmlFor="ra-note" hint="Optional — recorded with the decision.">
        <Input id="ra-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>

      {decide.error !== null && <ErrorNote message={serverVerdict(decide.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={decide.isPending}
          onClick={() => {
            if (target !== null) {
              decide.mutate(
                { requestId: target.row.id, approve: target.approve, note: note.trim() },
                { onSuccess: close },
              );
            }
          }}
        >
          {decide.isPending ? 'Saving…' : target?.approve === true ? 'Approve' : 'Decline request'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
