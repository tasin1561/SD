'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useDecideStoreAction,
  useStoreActionRequests,
  type StoreActionRequestRow,
} from '@/lib/reseller-store-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** What the store asked for, in the seller's words rather than an enum. */
const ASKED_FOR: Record<StoreActionRequestRow['action'], string> = {
  RECALL: 'Call the customer again',
  REATTEMPT: 'Try delivering it again',
  RTO: 'Send the parcel back',
};

/**
 * 2026-09-16 — the asks your reseller stores are waiting on.
 *
 * Only the ones your own policy marked “ask me first” stop here; the ones
 * you let through have already run. Nothing happens on these until you
 * answer, and the store has a customer waiting for that answer — which is
 * why a rejection needs a reason and the store is emailed either way.
 */
export default function StoreActionRequestsPage(): ReactElement {
  const requests = useStoreActionRequests();
  const [rejecting, setRejecting] = useState<StoreActionRequestRow | null>(null);

  const header = (
    <PageHeader
      title="Waiting on you"
      subtitle="Things your reseller stores have asked for. Until you answer, nothing happens on the parcel."
      action={
        <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
          All reseller stores →
        </Link>
      }
    />
  );

  if (requests.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading what your stores are waiting on" rows={4} />
      </div>
    );
  }
  if (requests.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={serverVerdict(requests.error)} retry={() => void requests.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Section title="Asks from your stores">
        {requests.data.length === 0 ? (
          <EmptyState
            title="Nothing is waiting"
            description="When a store asks for something you chose to approve yourself, it appears here. Anything you let them do on their own never stops here at all."
            action={
              <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
                Change what your stores can do
              </Link>
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Store</Th>
                <Th>Order</Th>
                <Th>They asked for</Th>
                <Th>Why</Th>
                <Th>Asked</Th>
                <Th>Your answer</Th>
              </Tr>
            </THead>
            <TBody>
              {requests.data.map((r) => (
                <RequestRow key={r.id} request={r} onReject={() => setRejecting(r)} />
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <RejectModal request={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

function RequestRow({
  request,
  onReject,
}: {
  request: StoreActionRequestRow;
  onReject: () => void;
}): ReactElement {
  const decide = useDecideStoreAction();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: true });
      toast.success('Approved — it is being carried out, and the store has been told.');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_ALREADY_DECIDED when somebody
      // else got there first, which is the common one on a shared queue.
      setError(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td>{request.resellerStore?.name ?? '—'}</Td>
      <Td>
        <span className="font-mono text-xs">{request.order?.orderNumber ?? '—'}</span>
        {request.order === null ? null : (
          <div className="text-text-muted text-xs">{request.order.recipientName}</div>
        )}
      </Td>
      <Td>{ASKED_FOR[request.action]}</Td>
      <Td className="max-w-xs">
        <span className="text-text-body text-xs">{request.reason}</span>
      </Td>
      <Td className="text-text-muted text-xs">{when(request.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => void approve()}
          >
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={decide.isPending} onClick={onReject}>
            Reject
          </Button>
        </div>
        {error !== null ? (
          <p role="alert" className="text-critical mt-1 text-xs">
            {error}
          </p>
        ) : null}
      </Td>
    </Tr>
  );
}

/**
 * Rejecting takes a reason, and the server refuses without one
 * (`DELIVERY_ACTION_REASON_REQUIRED`). It is shown to the store, because
 * somebody there has to go back to a customer with it.
 */
function RejectModal({
  request,
  onClose,
}: {
  request: StoreActionRequestRow | null;
  onClose: () => void;
}): ReactElement {
  const decide = useDecideStoreAction();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      await decide.mutateAsync({ requestId: request.id, approve: false, note: note.trim() });
      toast.success('Turned down. The store has been sent your reason.');
      setNote('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote('');
          setError(null);
          onClose();
        }
      }}
      title={
        request === null
          ? 'Turn it down'
          : `Turn down “${ASKED_FOR[request.action]}” on ${request.order?.orderNumber ?? 'this order'}?`
      }
      description="The store reads this. They have a customer waiting on the answer, so say why."
    >
      <div className="space-y-4">
        <FormField label="Your reason" htmlFor="reject-note" required>
          <Textarea
            id="reject-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            disabled={note.trim() === '' || decide.isPending}
            onClick={() => void submit()}
          >
            {decide.isPending ? 'Sending…' : 'Turn it down'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
