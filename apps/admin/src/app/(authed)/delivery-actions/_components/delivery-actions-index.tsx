'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Truck } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import {
  useDecideDeliveryAction,
  useDeliveryActionQueue,
  type AdminDeliveryActionView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AgeChip, Notice, OoCard, OoSection } from '../../orders/_components/order-ops-parts';

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
    case 'EXPIRED':
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

  /** Resolves true when the decision landed; false when refused (the reason is in `error`). */
  async function submit(): Promise<boolean> {
    if (deciding === null) return false;
    setError(null);
    if (deciding.decision === 'reject' && note.trim().length < 5) {
      setError('Say why — the seller sees this, and an unexplained no comes straight back');
      return false;
    }
    try {
      await decide.mutateAsync({
        requestId: deciding.row.id,
        decision: deciding.decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setNote('');
      setDeciding(null);
      return true;
    } catch (err) {
      setError(serverVerdict(err));
      return false;
    }
  }

  const rows = queue.data ?? [];

  return (
    <div className="oo-page">
      <PageHeader
        title="Failed deliveries"
        subtitle="What sellers have asked us to do about parcels the courier could not hand over. A Reseller store's ask that its seller chose to approve is shown for reference only — Seller staff decide it, not Skydrop admin."
      />

      <OoCard>
        <Checkbox
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          label="Show decided requests too"
          description="Approving a re-attempt sends a van; approving a return ends the sale. A recall only queues one of our agents to phone the customer."
        />
      </OoCard>

      <OoSection
        title={showAll ? 'All requests' : 'Waiting on a decision'}
        note={queue.data === undefined ? undefined : `${rows.length} shown`}
        flush
      >
        {queue.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows rows={4} cols={6} label="Loading the queue…" />
          </div>
        ) : queue.isError || queue.data === undefined ? (
          <div className="oo-card__pad">
            <ErrorState
              message={queue.error?.message ?? 'Could not read the queue.'}
              retry={() => void queue.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone={showAll ? 'neutral' : 'positive'}
            icon={<Truck size={20} />}
            title={showAll ? 'No requests yet' : 'Nothing waiting'}
            description={
              showAll
                ? 'No seller has asked for anything yet.'
                : 'Nothing waiting. Failed deliveries appear here when a seller asks us to act.'
            }
          />
        ) : (
          <Table caption="Failed-delivery requests">
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
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      href={`/orders?q=${r.order?.orderNumber ?? ''}`}
                      className="oo-link sk-ident"
                    >
                      {r.order?.orderNumber ?? '—'}
                    </Link>
                    <span className="oo-sub sk-ident">
                      {r.shipment?.awbNumber ?? r.shipment?.shipmentNumber ?? ''}
                    </span>
                  </Td>
                  <Td className="oo-muted">
                    {r.seller?.companyName ?? '—'}
                    {r.resellerStore !== null && (
                      <span className="oo-sub">
                        Reseller store: {r.resellerStore.displayName ?? r.resellerStore.name}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="oo-strong">{actionLabel(r.action)}</span>
                    {r.action === 'RECALL' && <span className="oo-sub">No courier involved</span>}
                  </Td>
                  <Td className="oo-muted oo-clip">{r.reason}</Td>
                  <Td>
                    <div className="oo-stack oo-stack--tight">
                      <span className="oo-row">
                        <StatusChip
                          size="sm"
                          kind={statusKind(r.status)}
                          label={r.status.toLowerCase()}
                        />
                        <AgeChip title="When the seller asked">
                          {new Date(r.createdAt).toLocaleString('en-IN')}
                        </AgeChip>
                      </span>
                      {r.executionError !== null && (
                        <span className="oo-error">{r.executionError}</span>
                      )}
                      {r.decisionNote !== null && (
                        <span className="oo-faint">{r.decisionNote}</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    {r.waitingOnSeller ? (
                      // Seller staff decide this one — the Reseller
                      // store's policy says so. Skydrop admin can see it,
                      // and the server refuses a decision here anyway.
                      <span className="oo-muted">Waiting on seller staff</span>
                    ) : r.status === 'PENDING' && canDecide ? (
                      <div className="oo-row oo-row--end">
                        <Button
                          size="sm"
                          variant="primary"
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
                      <span className="oo-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </OoSection>

      <Dialog
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
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              labels={{
                idle: deciding?.decision === 'approve' ? 'Approve and act' : 'Decline',
                busy: 'Working…',
              }}
              onAction={async () => {
                const ok = await submit();
                if (!ok) throw new Error('refused');
              }}
            />
          </DialogFooter>
        }
      >
        {deciding !== null && (
          <div className="oo-stack">
            <div className="oo-row">
              <span className="sk-ident oo-strong">{deciding.row.order?.orderNumber ?? '—'}</span>
              <span className="oo-muted">
                {deciding.row.seller?.companyName ?? '—'} · {actionLabel(deciding.row.action)}
              </span>
            </div>
            {deciding.decision === 'approve' && deciding.row.action !== 'RECALL' && (
              <Notice tone="warn" icon={<AlertTriangle size={16} />}>
                <p>
                  Delhivery answers asynchronously — this returns a reference, not an outcome. The
                  real result arrives on the next scan.
                </p>
              </Notice>
            )}
            <TextArea
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                deciding.decision === 'approve'
                  ? 'Optional note for the seller'
                  : 'e.g. Two attempts already made — a third is unlikely to land'
              }
            />
            {error !== null && (
              <p className="oo-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
