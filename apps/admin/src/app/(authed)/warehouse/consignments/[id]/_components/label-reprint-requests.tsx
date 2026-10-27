'use client';

import { useState, type ReactElement } from 'react';
import { useStaffIdentity } from '@skydrop/auth/client';
import { useToast } from '@skydrop/ui/components';
import { Check, Printer, X } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Actions, Code, InlineError, Note } from '../../../../inventory/_components/stock-kit';
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
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const STATE_LABEL = (t: Translate<MessageKey>): Record<LabelReprintState, string> => ({
  PENDING: t('warehouseConsignmentsIdLabelReprintRequests.waitingForApproval'),
  APPROVED: t('warehouseConsignmentsIdLabelReprintRequests.approvedReadyToPrint'),
  REJECTED: t('warehouseConsignmentsIdLabelReprintRequests.rejected'),
  PRINTED: t('warehouseConsignmentsIdLabelReprintRequests.printed'),
  EXPIRED: t('warehouseConsignmentsIdLabelReprintRequests.approvalLapsed'),
});

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
  const tr = useT();
  const t = useT();
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
  // Approve and print are confirmed first (owner): an approval lets a
  // serial be printed a second time, and a print uses the approval up.
  const [approving, setApproving] = useState<LabelReprintRequestView | null>(null);
  const [printing, setPrinting] = useState<LabelReprintRequestView | null>(null);

  const rows = requests.data ?? [];
  if (rows.length === 0 && !requests.isError) return null;

  async function onApprove(r: LabelReprintRequestView): Promise<void> {
    setError(null);
    try {
      await approve.mutateAsync({ requestId: r.id });
      toast.success(
        tr('warehouseConsignmentsIdLabelReprintRequests.approvedCanPrintItNow', {
          value:
            r.requestedBy.email ?? tr('warehouseConsignmentsIdLabelReprintRequests.theRequester'),
        }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onReject(r: LabelReprintRequestView): Promise<void> {
    setError(null);
    try {
      await reject.mutateAsync({ requestId: r.id, note: rejectNote.trim() });
      toast.success(t('warehouseConsignmentsIdLabelReprintRequests.rejected'));
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
      toast.success(
        t('warehouseConsignmentsIdLabelReprintRequests.labelSReadyToReprint', {
          labelsLength: sheet.labels.length,
        }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  const rejecting = rejectingId === null ? null : (rows.find((x) => x.id === rejectingId) ?? null);

  return (
    <div className="stk-stack stk-stack--tight">
      <p className="cns-requests__title">
        {t('warehouseConsignmentsIdLabelReprintRequests.labelReprintRequests')}
      </p>
      {requests.isError && (
        <InlineError
          message={t('warehouseConsignmentsIdLabelReprintRequests.couldNotLoadTheReprint', {
            value: serverVerdict(requests.error),
          })}
          retry={() => void requests.refetch()}
        />
      )}
      {error !== null && <InlineError message={error} />}
      <ul className="cns-requests">
        {rows.map((r) => {
          const mine = me !== null && r.requestedBy.id === me.id;
          return (
            <li key={r.id} className="cns-request">
              <div className="cns-request__head">
                <StatusChip
                  size="sm"
                  kind={labelReprintStateKind(r.state)}
                  label={STATE_LABEL(t)[r.state]}
                />
                <Code>{r.serials.join(', ')}</Code>
              </div>
              <p className="stk-note">{r.reason}</p>
              <p className="stk-note" data-tone="faint">
                {t('warehouseConsignmentsIdLabelReprintRequests.askedBy', {
                  value:
                    r.requestedBy.email ??
                    t('warehouseConsignmentsIdLabelReprintRequests.aColleague'),
                  value2: when(r.requestedAt),
                })}
                {r.decidedBy !== null && r.decidedAt !== null && (
                  <>
                    {' '}
                    {t('warehouseConsignmentsIdLabelReprintRequests.decidedBy', {
                      value:
                        r.decidedBy.email ??
                        t('warehouseConsignmentsIdLabelReprintRequests.aColleague'),
                      value2: when(r.decidedAt),
                    })}
                  </>
                )}
                {r.decisionNote !== null && <> — “{r.decisionNote}”</>}
              </p>

              {r.state === 'PENDING' && mine && (
                <Note tone="faint">
                  {t('warehouseConsignmentsIdLabelReprintRequests.somebodyElseHoldingTheReprint')}
                </Note>
              )}
              {r.state === 'PENDING' && !mine && mayDecide && (
                <Actions>
                  <Button
                    size="sm"
                    icon={<Check size={14} />}
                    disabled={approve.isPending}
                    onClick={() => setApproving(r)}
                  >
                    {approve.isPending
                      ? t('warehouseConsignmentsIdLabelReprintRequests.approving')
                      : t('warehouseConsignmentsIdLabelReprintRequests.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} />}
                    onClick={() => setRejectingId(r.id)}
                  >
                    {t('warehouseConsignmentsIdLabelReprintRequests.reject')}
                  </Button>
                </Actions>
              )}
              {r.state === 'APPROVED' && mine && (
                <Actions>
                  <Button
                    size="sm"
                    icon={<Printer size={14} />}
                    disabled={print.isPending}
                    onClick={() => setPrinting(r)}
                  >
                    {print.isPending
                      ? t('warehouseConsignmentsIdLabelReprintRequests.preparing')
                      : t('warehouseConsignmentsIdLabelReprintRequests.printTheseLabels')}
                  </Button>
                  {r.approvalExpiresAt !== null && (
                    <span className="stk-faint stk-note">
                      {t('warehouseConsignmentsIdLabelReprintRequests.printsOnceUntil', {
                        value: when(r.approvalExpiresAt),
                      })}
                    </span>
                  )}
                </Actions>
              )}
              {r.state === 'APPROVED' && !mine && (
                <Note tone="faint">
                  {t('warehouseConsignmentsIdLabelReprintRequests.onlyCanPrintThis', {
                    value:
                      r.requestedBy.email ??
                      t('warehouseConsignmentsIdLabelReprintRequests.thePersonWhoAsked'),
                  })}
                  {r.approvalExpiresAt !== null && (
                    <>
                      {t('warehouseConsignmentsIdLabelReprintRequests.until', {
                        value: when(r.approvalExpiresAt),
                      })}
                    </>
                  )}
                  .
                </Note>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(next) => {
          if (!next) setApproving(null);
        }}
        title={t('warehouseConsignmentsIdLabelReprintRequests.approveThisReprint')}
        entity={approving?.serials.join(', ') ?? ''}
        entityIsIdentifier
        consequence={tr('warehouseConsignmentsIdLabelReprintRequests.canThenPrintTheseLabels', {
          value:
            approving?.requestedBy.email ??
            tr('warehouseConsignmentsIdLabelReprintRequests.thePersonWhoAsked2'),
        })}
        confirmLabel={t('warehouseConsignmentsIdLabelReprintRequests.approve')}
        onConfirm={async () => {
          if (approving !== null) await onApprove(approving);
        }}
      />

      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(next) => {
          if (!next) setRejectingId(null);
        }}
        title={t('warehouseConsignmentsIdLabelReprintRequests.rejectThisReprint')}
        entity={rejecting?.serials.join(', ') ?? ''}
        entityIsIdentifier
        consequence={t('warehouseConsignmentsIdLabelReprintRequests.nothingIsPrintedAndThe')}
        confirmLabel={t('warehouseConsignmentsIdLabelReprintRequests.reject2')}
        destructive
        onConfirm={async () => {
          if (rejecting !== null) await onReject(rejecting);
        }}
      >
        <input
          className="stk-input"
          aria-label={t('warehouseConsignmentsIdLabelReprintRequests.whyNot')}
          value={rejectNote}
          placeholder={t('warehouseConsignmentsIdLabelReprintRequests.whyNotThePersonWho')}
          onChange={(e) => setRejectNote(e.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={printing !== null}
        onOpenChange={(next) => {
          if (!next) setPrinting(null);
        }}
        title={t('warehouseConsignmentsIdLabelReprintRequests.printTheseLabels2')}
        entity={printing?.serials.join(', ') ?? ''}
        entityIsIdentifier
        consequence={t('warehouseConsignmentsIdLabelReprintRequests.theApprovalIsUsedUp')}
        confirmLabel={t('warehouseConsignmentsIdLabelReprintRequests.printTheseLabels')}
        onConfirm={async () => {
          if (printing !== null) await onPrint(printing);
        }}
      />
    </div>
  );
}
