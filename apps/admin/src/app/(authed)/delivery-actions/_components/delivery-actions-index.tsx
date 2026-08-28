'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Textarea,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  useDecideDeliveryAction,
  useDeliveryActionQueue,
  type AdminDeliveryActionView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The operator gate for failed deliveries (CUR-10).
 *
 * A seller has asked us to do something about a parcel that could not be
 * delivered. Approving a re-attempt dispatches a van; approving an RTO
 * turns a moving parcel into a return. Neither may be fired by a
 * seller-facing handler, which is the entire reason this queue exists —
 * a person decides, and the decision is recorded with its reason.
 *
 * RECALL is the exception and is worth recognising on sight: it asks our
 * own agents to phone the customer and reaches no courier at all.
 */
function actionLabel(a: AdminDeliveryActionView['action']): string {
  switch (a) {
    case 'REATTEMPT':
      return 'Re-attempt delivery';
    case 'RECALL':
      return 'Call the customer';
    case 'RTO':
      return 'Return to us';
  }
}

function statusKind(
  s: AdminDeliveryActionView['status'],
): 'pending' | 'confirmed' | 'failed' | 'cancelled' {
  switch (s) {
    case 'PENDING':
    case 'APPROVED':
      return 'pending';
    case 'EXECUTED':
      return 'confirmed';
    case 'FAILED':
      return 'failed';
    case 'REJECTED':
      return 'cancelled';
  }
}

export function DeliveryActionsIndex(): ReactElement {
  const canDecide = usePermission('courier.ops.write');
  const [showAll, setShowAll] = useState(false);
  const queue = useDeliveryActionQueue(showAll ? undefined : 'PENDING');
  const decide = useDecideDeliveryAction();

  const [deciding, setDeciding] = useState<{
    row: AdminDeliveryActionView;
    decision: 'approve' | 'reject';
  } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (deciding === null) return;
    setError(null);
    if (deciding.decision === 'reject' && note.trim().length < 5) {
      setError('Say why — the seller sees this, and an unexplained no comes straight back');
      return;
    }
    try {
      await decide.mutateAsync({
        requestId: deciding.row.id,
        decision: deciding.decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setNote('');
      setDeciding(null);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Failed deliveries"
        subtitle="What sellers have asked us to do about parcels the courier could not hand over."
      />

      <Card>
        <CardBody>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show decided requests too
          </label>
          <p className="text-text-muted mt-1 text-xs">
            Approving a re-attempt sends a van; approving a return ends the sale. A recall only
            queues one of our agents to phone the customer.
          </p>
        </CardBody>
      </Card>

      <Section title={showAll ? 'All requests' : 'Waiting on a decision'}>
        {queue.isLoading ? (
          <LoadingState />
        ) : queue.isError || queue.data === undefined ? (
          <ErrorState
            message={queue.error?.message ?? 'Could not read the queue.'}
            retry={() => void queue.refetch()}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Order</Th>
                <Th>Seller</Th>
                <Th>Asked for</Th>
                <Th>Why</Th>
                <Th>State</Th>
                <Th align="right">Decide</Th>
              </Tr>
            </THead>
            <TBody>
              {queue.data.length === 0 ? (
                <TableEmpty colSpan={6}>
                  {showAll
                    ? 'No seller has asked for anything yet.'
                    : 'Nothing waiting. Failed deliveries appear here when a seller asks us to act.'}
                </TableEmpty>
              ) : (
                queue.data.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link
                        href={`/orders?q=${r.order?.orderNumber ?? ''}`}
                        className="text-accent hover:underline"
                      >
                        {r.order?.orderNumber ?? '—'}
                      </Link>
                      <div className="text-text-faint text-xs">
                        {r.shipment?.awbNumber ?? r.shipment?.shipmentNumber ?? ''}
                      </div>
                    </Td>
                    <Td className="text-text-muted">{r.seller?.companyName ?? '—'}</Td>
                    <Td>
                      <div className="font-medium">{actionLabel(r.action)}</div>
                      {r.action === 'RECALL' && (
                        <div className="text-text-faint text-xs">No courier involved</div>
                      )}
                    </Td>
                    <Td className="text-text-muted max-w-xs text-xs">{r.reason}</Td>
                    <Td>
                      <StatusBadge kind={statusKind(r.status)} label={r.status.toLowerCase()} />
                      {r.executionError !== null && (
                        <div className="text-danger mt-1 text-xs">{r.executionError}</div>
                      )}
                      {r.decisionNote !== null && (
                        <div className="text-text-faint mt-1 text-xs">{r.decisionNote}</div>
                      )}
                    </Td>
                    <Td align="right">
                      {r.status === 'PENDING' && canDecide ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => {
                              setDeciding({ row: r, decision: 'approve' });
                              setNote('');
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeciding({ row: r, decision: 'reject' });
                              setNote('');
                            }}
                          >
                            Decline
                          </Button>
                        </div>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Section>

      <Modal
        open={deciding !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeciding(null);
            setError(null);
          }
        }}
        title={
          deciding?.decision === 'approve'
            ? `Approve: ${deciding ? actionLabel(deciding.row.action) : ''}`
            : 'Decline this request'
        }
        description={
          deciding?.decision === 'approve'
            ? deciding.row.action === 'RECALL'
              ? 'Queues the order for one of our agents to phone the customer. Nothing reaches the courier.'
              : 'This reaches Delhivery. A re-attempt dispatches a van; a return ends the sale.'
            : 'The seller sees your reason.'
        }
      >
        {deciding !== null &&
          deciding.decision === 'approve' &&
          deciding.row.action !== 'RECALL' && (
            <div className="text-warning mb-3 flex gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Delhivery answers asynchronously — this returns a reference, not an outcome. The
                real result arrives on the next scan.
              </p>
            </div>
          )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={
            deciding?.decision === 'approve'
              ? 'Optional note for the seller'
              : 'e.g. Two attempts already made — a third is unlikely to land'
          }
        />
        {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeciding(null)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={decide.isPending}>
            {decide.isPending
              ? 'Working…'
              : deciding?.decision === 'approve'
                ? 'Approve and act'
                : 'Decline'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
