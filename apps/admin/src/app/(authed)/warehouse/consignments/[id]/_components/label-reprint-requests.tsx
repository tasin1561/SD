'use client';

import { useState, type ReactElement } from 'react';
import { useStaffIdentity } from '@skydrop/auth/client';
import { Button, ErrorNote, Input, StatusBadge, useToast } from '@skydrop/ui/components';
import { labelReprintStateKind } from '@skydrop/ui/status';
import type { LabelReprintRequestView, LabelReprintState, LabelSheet } from '@skydrop/api-client';
import {
  useApproveLabelReprint,
  useLabelReprintRequests,
  usePrintLabelReprint,
  useRejectLabelReprint,
} from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

const STATE_LABEL: Record<LabelReprintState, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved — ready to print',
  REJECTED: 'Rejected',
  PRINTED: 'Printed',
  EXPIRED: 'Approval lapsed',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * LBL-5b — this consignment's label reprint requests.
 *
 * Which buttons show is COSMETIC (FE-2): the server refuses a
 * self-approval, a print by anyone but the person who asked, a second
 * print and a lapsed approval whatever this screen offered, and its
 * verdict is shown as it came.
 */
export function LabelReprintRequests({
  consignmentId,
  onSheet,
}: {
  readonly consignmentId: string;
  readonly onSheet: (sheet: LabelSheet) => void;
}): ReactElement | null {
  const toast = useToast();
  const requests = useLabelReprintRequests(consignmentId);
  const approve = useApproveLabelReprint();
  const reject = useRejectLabelReprint();
  const print = usePrintLabelReprint();
  const mayDecide = usePermission('warehouse.labels.reprint');
  const me = useStaffIdentity();

  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const rows = requests.data ?? [];
  if (rows.length === 0 && !requests.isError) return null;

  async function onApprove(r: LabelReprintRequestView): Promise<void> {
    setError(null);
    try {
      await approve.mutateAsync({ requestId: r.id });
      toast.success(`Approved — ${r.requestedBy.email ?? 'the requester'} can print it now`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onReject(r: LabelReprintRequestView): Promise<void> {
    setError(null);
    try {
      await reject.mutateAsync({ requestId: r.id, note: rejectNote.trim() });
      toast.success('Rejected');
      setRejectingId(null);
      setRejectNote('');
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onPrint(r: LabelReprintRequestView): Promise<void> {
    setError(null);
    try {
      const sheet = await print.mutateAsync({ requestId: r.id });
      onSheet(sheet);
      toast.success(`${sheet.labels.length} label(s) ready to reprint`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-text-muted text-xs font-medium">Label reprint requests</p>
      {requests.isError && (
        <ErrorNote
          message={`Could not load the reprint requests: ${serverVerdict(requests.error)}`}
          retry={() => void requests.refetch()}
        />
      )}
      {error !== null && <ErrorNote message={error} />}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const mine = me !== null && r.requestedBy.id === me.id;
          return (
            <li
              key={r.id}
              className="border-border-subtle flex flex-col gap-1 rounded border p-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind={labelReprintStateKind(r.state)} label={STATE_LABEL[r.state]} />
                <span className="font-mono">{r.serials.join(', ')}</span>
              </div>
              <p className="text-text-muted">{r.reason}</p>
              <p className="text-text-faint">
                Asked by {r.requestedBy.email ?? 'a colleague'} · {when(r.requestedAt)}
                {r.decidedBy !== null && r.decidedAt !== null && (
                  <>
                    {' '}
                    · decided by {r.decidedBy.email ?? 'a colleague'} · {when(r.decidedAt)}
                  </>
                )}
                {r.decisionNote !== null && <> — “{r.decisionNote}”</>}
              </p>

              {r.state === 'PENDING' && mine && (
                <p className="text-text-faint">
                  Somebody else holding the reprint permission has to approve this.
                </p>
              )}
              {r.state === 'PENDING' && !mine && mayDecide && (
                <div className="flex flex-col gap-2">
                  {rejectingId === r.id ? (
                    <>
                      <Input
                        aria-label="Why not"
                        value={rejectNote}
                        placeholder="Why not? The person who asked reads this."
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          disabled={reject.isPending}
                          onClick={() => void onReject(r)}
                        >
                          {reject.isPending ? 'Rejecting…' : 'Reject'}
                        </Button>
                        <Button variant="ghost" onClick={() => setRejectingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={approve.isPending} onClick={() => void onApprove(r)}>
                        {approve.isPending ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button variant="ghost" onClick={() => setRejectingId(r.id)}>
                        Reject…
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {r.state === 'APPROVED' && mine && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={print.isPending} onClick={() => void onPrint(r)}>
                    {print.isPending ? 'Preparing…' : 'Print these labels'}
                  </Button>
                  {r.approvalExpiresAt !== null && (
                    <span className="text-text-faint">
                      Prints once, until {when(r.approvalExpiresAt)}
                    </span>
                  )}
                </div>
              )}
              {r.state === 'APPROVED' && !mine && (
                <p className="text-text-faint">
                  Only {r.requestedBy.email ?? 'the person who asked'} can print this
                  {r.approvalExpiresAt !== null && <>, until {when(r.approvalExpiresAt)}</>}.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
