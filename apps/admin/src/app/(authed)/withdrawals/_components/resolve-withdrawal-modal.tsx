'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  DescriptionList,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Money,
  Textarea,
  useToast,
  WithdrawalStatusBadge,
} from '@skydrop/ui/components';
import {
  useMarkWithdrawalPaid,
  useRejectWithdrawal,
  type WithdrawalRequestView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

type Mode = 'paid' | 'reject';

/**
 * Resolve one withdrawal request — link a remittance, or reject with a
 * reason.
 *
 * "Mark paid" deliberately asks for a remittance ID rather than an
 * amount: the money must already have been recorded as a remittance
 * (which is what actually debited the wallet). Asking for the link
 * makes it impossible to close a request without the payout existing.
 */
export function ResolveWithdrawalModal({
  request,
  onClose,
}: {
  readonly request: WithdrawalRequestView | null;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const markPaid = useMarkWithdrawalPaid();
  const reject = useRejectWithdrawal();

  const [mode, setMode] = useState<Mode>('paid');
  const [remittanceId, setRemittanceId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode('paid');
    setRemittanceId('');
    setReason('');
    setError(null);
  }, [request?.id]);

  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      if (mode === 'paid') {
        await markPaid.mutateAsync({
          requestId: request.id,
          linkedRemittanceId: remittanceId.trim(),
        });
        toast.success('Withdrawal marked paid.');
      } else {
        await reject.mutateAsync({
          requestId: request.id,
          reason: reason.trim(),
        });
        toast.success('Withdrawal rejected.');
      }
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const busy = markPaid.isPending || reject.isPending;
  const canSubmit = mode === 'paid' ? remittanceId.trim() !== '' : reason.trim() !== '';

  return (
    <Modal
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      title="Resolve withdrawal request"
      description={
        request === null ? undefined : (
          <span className="flex items-center gap-2">
            <WithdrawalStatusBadge status={request.status} />
            <span className="text-text-faint">
              raised {new Date(request.createdAt).toLocaleString()}
            </span>
          </span>
        )
      }
    >
      {request !== null && (
        <div className="space-y-4">
          <DescriptionList
            items={[
              {
                label: 'Amount',
                value: (
                  <Money amount={request.amountRequested} currency={request.currency} size="md" />
                ),
              },
              {
                label: 'Seller',
                value: (
                  <Link
                    href={`/sellers/${request.sellerId}`}
                    className="text-accent hover:underline"
                  >
                    <Ident value={request.sellerId} />
                  </Link>
                ),
              },
              {
                label: 'Source',
                value:
                  request.requestedBy === 'SYSTEM' ? 'Auto-withdraw cycle' : 'Seller-initiated',
              },
              {
                label: 'Note',
                value:
                  request.note === null || request.note === '' ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    request.note
                  ),
              },
            ]}
          />

          <fieldset className="border-border border-t pt-3">
            <legend className="sr-only">Outcome</legend>
            <div className="flex gap-4 text-sm">
              {(['paid', 'reject'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="withdrawal-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span className="text-text-body">{m === 'paid' ? 'Mark paid' : 'Reject'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === 'paid' ? (
            <FormField
              label="Remittance ID"
              htmlFor="wd-remittance"
              hint="The remittance that actually paid this out. Record it under Remittances first — this only links the two."
              required
            >
              <Input
                id="wd-remittance"
                value={remittanceId}
                onChange={(e) => setRemittanceId(e.target.value)}
                placeholder="0198f3c2-…"
                autoComplete="off"
              />
            </FormField>
          ) : (
            <FormField
              label="Reason"
              htmlFor="wd-reason"
              hint="Shown to the seller. Say what would make a resubmission succeed."
              required
            >
              <Textarea
                id="wd-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Balance is below the minimum withdrawal threshold this cycle."
              />
            </FormField>
          )}

          {error !== null && <ErrorNote message={error} />}
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={mode === 'reject' ? 'destructive' : 'primary'}
          size="md"
          disabled={!canSubmit || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : mode === 'paid' ? 'Mark paid' : 'Reject request'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
