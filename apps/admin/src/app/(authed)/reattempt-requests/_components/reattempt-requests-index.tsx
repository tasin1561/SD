'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PhoneCall } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useReattemptRequests,
  useDecideReattempt,
  type AdminReattemptRequest,
} from '@/lib/callcenter-hooks';
import { AgeChip } from '../../orders/_components/order-ops-parts';

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
    <div className="oo-page">
      <PageHeader
        title="Re-attempt requests"
        subtitle="Sellers asking us to call a customer who declined. Read the reason before approving — the customer already said no once."
      />

      <FilterBar activeCount={status === 'PENDING' ? 0 : 1}>
        <FilterField>
          <Select
            id="ra-status"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="PENDING">Waiting for a decision</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Declined</option>
            <option value="">All</option>
          </Select>
        </FilterField>
      </FilterBar>

      {list.isLoading ? (
        <SkeletonRows rows={3} cols={3} label="Loading requests…" />
      ) : list.error !== null ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          tone={status === 'PENDING' ? 'positive' : 'neutral'}
          icon={<PhoneCall size={20} />}
          title="Nothing waiting"
          description="When a seller asks us to call a customer who declined, it lands here."
        />
      ) : (
        <ul className="oo-queue" aria-label="Re-attempt requests">
          {(list.data ?? []).map((r) => (
            <li
              key={r.id}
              className="oo-qcard"
              data-severity={r.status === 'PENDING' ? 'medium' : undefined}
            >
              <div className="oo-qcard__head">
                <div className="oo-qcard__title">
                  {r.orderNumber !== null && (
                    <Link href={`/orders/${r.orderId}`} className="oo-link sk-ident">
                      {r.orderNumber}
                    </Link>
                  )}
                </div>
                <div className="oo-qcard__chips">
                  <StatusChip
                    size="sm"
                    kind={
                      r.status === 'PENDING'
                        ? 'pending'
                        : r.status === 'APPROVED'
                          ? 'confirmed'
                          : 'failed'
                    }
                    label={r.status.toLowerCase()}
                  />
                  <AgeChip title="When the seller asked">
                    asked {new Date(r.createdAt).toLocaleString('en-IN')}
                  </AgeChip>
                </div>
              </div>

              {/* The reason IS the decision. Rendered at full size,
                  not truncated into a column. */}
              <p className="oo-body">{r.reason}</p>

              {r.status === 'APPROVED' && r.extraAttempts > 0 && (
                <p className="oo-p">
                  <span className="oo-faint">Granted:</span>{' '}
                  <span className="sk-figure">{r.extraAttempts}</span> extra{' '}
                  {r.extraAttempts === 1 ? 'call' : 'calls'}
                </p>
              )}

              {r.decisionNote !== null && r.decisionNote !== '' && (
                <p className="oo-p">
                  <span className="oo-faint">Decision note:</span> {r.decisionNote}
                </p>
              )}

              {r.status === 'PENDING' && (
                <div className="oo-row">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setDeciding({ row: r, approve: true })}
                  >
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
            </li>
          ))}
        </ul>
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
  const [extra, setExtra] = useState('1');

  function close(): void {
    setNote('');
    setExtra('1');
    decide.reset();
    onClose();
  }

  return (
    <Dialog
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
          ? 'The order returns to PENDING_CONFIRMATION and is queued for calling. Its attempt count is unchanged; choose how many extra calls to allow, or it comes back already at its cap.'
          : 'The order stays rejected. The seller can ask again if something changes.'
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{
              idle: target?.approve === true ? 'Approve' : 'Decline request',
              busy: 'Saving…',
            }}
            onAction={async () => {
              if (target !== null) {
                await decide.mutateAsync({
                  requestId: target.row.id,
                  approve: target.approve,
                  note: note.trim(),
                  extraAttempts: Number(extra),
                });
                close();
              }
            }}
          />
        </DialogFooter>
      }
    >
      <div className="oo-stack">
        {target !== null && (
          <div className="oo-row">
            <span className="sk-ident oo-strong">{target.row.orderNumber ?? '—'}</span>
            <span className="oo-muted">asked by the seller</span>
          </div>
        )}
        {target?.approve === true && (
          <Select
            id="ra-extra"
            label="Extra calls to allow"
            hint="On top of the seller's normal cap. One is usually right — an approval that grants none puts the order back already out of chances, so the first unanswered ring rejects it again."
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          >
            {['1', '2', '3', '4', '5'].map((n) => (
              <option key={n} value={n}>
                {n} more {n === '1' ? 'call' : 'calls'}
              </option>
            ))}
          </Select>
        )}

        <TextField
          id="ra-note"
          label="Note"
          hint="Optional — recorded with the decision."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {decide.error !== null && (
          <p className="oo-error" role="alert">
            {serverVerdict(decide.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
