'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Ident, Money } from '@skydrop/ui/components';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { MkAlert, MkDl, WithdrawalChip } from '../../seller-wallets/_components/money-parts';
import {
  useMarkWithdrawalPaid,
  useRejectWithdrawal,
  type WithdrawalRequestView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

type Mode = 'paid' | 'reject';

/**
 * Resolve one withdrawal request — link a remittance, or reject with a
 * reason.
 *
 * "Mark paid" deliberately asks for a remittance ID rather than an
 * amount: the money must already have been recorded as a remittance
 * (which is what actually debited the wallet). Asking for the link
 * makes it impossible to close a request without the withdrawal existing.
 */
export function ResolveWithdrawalModal({
  request,
  onClose,
}: {
  readonly request: WithdrawalRequestView | null;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  // Paying is only possible once approved — `markPaid` refuses anything
  // else. A PENDING request can still be rejected, so the modal opens
  // in the only mode that would work rather than offering one the
  // server will refuse.
  const payable = request?.status === 'APPROVED';
  const canResolve = usePermission('money.withdrawals.review');
  const toast = useToast();
  const markPaid = useMarkWithdrawalPaid();
  const reject = useRejectWithdrawal();

  const [mode, setMode] = useState<Mode>('paid');
  // Re-seeded per request: opening a pending one after an approved one
  // would otherwise land on a mode it cannot use.
  useEffect(() => {
    setMode(payable ? 'paid' : 'reject');
  }, [request?.id, payable]);
  const [remittanceId, setRemittanceId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode('paid');
    setRemittanceId('');
    setReason('');
    setError(null);
  }, [request?.id]);

  /** Rejects on a refusal (after setting the verdict) so the button shows it. */
  async function submit(): Promise<void> {
    if (request === null) return;
    setError(null);
    try {
      if (mode === 'paid') {
        await markPaid.mutateAsync({
          requestId: request.id,
          linkedRemittanceId: remittanceId.trim(),
        });
        toast.success(t('withdrawalsResolveWithdrawalModal.withdrawalMarkedPaid'));
      } else {
        await reject.mutateAsync({
          requestId: request.id,
          reason: reason.trim(),
        });
        toast.success(t('withdrawalsResolveWithdrawalModal.withdrawalRejected'));
      }
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  const busy = markPaid.isPending || reject.isPending;
  const canSubmit = mode === 'paid' ? remittanceId.trim() !== '' : reason.trim() !== '';

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      tone={mode === 'reject' ? 'critical' : 'default'}
      locked={busy}
      title={t('withdrawalsResolveWithdrawalModal.resolveWithdrawalRequest')}
      description={
        request === null ? undefined : (
          <span className="mk-balances">
            <WithdrawalChip status={request.status} />
            <span className="mk-faint">
              {t('withdrawalsResolveWithdrawalModal.raised', {
                value: new Date(request.createdAt).toLocaleString(),
              })}
            </span>
          </span>
        )
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t('withdrawalsResolveWithdrawalModal.cancel')}
          </Button>
          <AsyncButton
            variant={mode === 'reject' ? 'destructive' : 'primary'}
            size="md"
            disabled={!canSubmit || !canResolve}
            labels={{
              idle:
                mode === 'paid'
                  ? t('withdrawalsResolveWithdrawalModal.markPaid')
                  : t('withdrawalsResolveWithdrawalModal.rejectRequest'),
              busy: t('withdrawalsResolveWithdrawalModal.saving'),
              done: t('withdrawalsResolveWithdrawalModal.saved'),
              error: t('withdrawalsResolveWithdrawalModal.refused'),
            }}
            onAction={submit}
          />
        </DialogFooter>
      }
    >
      {request !== null && (
        <div className="mk-stack">
          <MkDl
            items={[
              {
                label: t('withdrawalsResolveWithdrawalModal.amount'),
                value: (
                  <Money amount={request.amountRequested} currency={request.currency} size="md" />
                ),
              },
              {
                label: t('withdrawalsResolveWithdrawalModal.client'),
                value: (
                  <Link href={`/sellers/${request.sellerId}`} className="mk-inline-link">
                    <Ident value={request.sellerId} />
                  </Link>
                ),
              },
              {
                label: t('withdrawalsResolveWithdrawalModal.source'),
                value:
                  request.requestedBy === 'SYSTEM'
                    ? t('withdrawalsResolveWithdrawalModal.autoWithdrawCycle')
                    : t('withdrawalsResolveWithdrawalModal.clientInitiated'),
              },
              {
                label: t('withdrawalsResolveWithdrawalModal.note'),
                value:
                  request.note === null || request.note === '' ? (
                    <span className="mk-faint">—</span>
                  ) : (
                    request.note
                  ),
              },
            ]}
          />

          <fieldset className="mk-radios">
            <legend className="sr-only">{t('withdrawalsResolveWithdrawalModal.outcome')}</legend>
            {(payable ? (['paid', 'reject'] as const) : (['reject'] as const)).map((m) => (
              <label key={m} className="mk-radio">
                <input
                  type="radio"
                  name="withdrawal-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>
                  {m === 'paid'
                    ? t('withdrawalsResolveWithdrawalModal.markPaid')
                    : t('withdrawalsResolveWithdrawalModal.reject')}
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'paid' ? (
            <TextField
              id="wd-remittance"
              label={t('withdrawalsResolveWithdrawalModal.remittanceId')}
              hint={t('withdrawalsResolveWithdrawalModal.theRemittanceThatActuallyPaid')}
              requiredMark
              value={remittanceId}
              onChange={(e) => setRemittanceId(e.target.value)}
              placeholder="0198f3c2-…"
              autoComplete="off"
              inputClassName="sk-ident"
            />
          ) : (
            <TextArea
              id="wd-reason"
              label={t('withdrawalsResolveWithdrawalModal.reason')}
              hint={t('withdrawalsResolveWithdrawalModal.shownToTheClientSay')}
              requiredMark
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('withdrawalsResolveWithdrawalModal.balanceIsBelowTheMinimum')}
            />
          )}

          {error !== null && <MkAlert>{error}</MkAlert>}
        </div>
      )}
    </Dialog>
  );
}
