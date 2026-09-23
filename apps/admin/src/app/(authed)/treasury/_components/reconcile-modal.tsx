'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, Scale } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { useReconcileAccount } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { Notice } from './money-parts';

/**
 * The book disagreed with the bank. Say so, in writing.
 *
 * The correction is posted as an ENTRY, never as an overwrite: the
 * ledger is the history of what we believed and when, and silently
 * setting a balance to the right number destroys the evidence of the
 * thing that went wrong. What lands is the DIFFERENCE, carrying the
 * reason, so a later reader can see both that it happened and why.
 */
export function ReconcileModal({
  accountId,
  accountLabel,
  currency,
  bookBalance,
  bySeller,
  onClose,
}: {
  readonly accountId: string | null;
  readonly accountLabel: string;
  readonly currency: 'INR' | 'BDT';
  readonly bookBalance: string;
  /** Whose money is in this account, so a seller's holding can be corrected too. */
  readonly bySeller: ReadonlyArray<{ sellerId: string; companyName: string; amount: string }>;
  readonly onClose: () => void;
}): ReactElement {
  const reconcile = useReconcileAccount();
  // '' means OUR money. A seller id corrects what we hold for them.
  const [sellerId, setSellerId] = useState('');
  const [statedBalance, setStated] = useState('');
  const [reason, setReason] = useState('');
  // Our own money only: the P&L leaves exactly the marked entry off its
  // reconciliation line, so an opening balance never reads as income.
  const [opening, setOpening] = useState(false);
  // A seller's holding in a taka account: what the correction is worth to
  // their wallet, in rupees. Required there by the server; not asked for
  // anywhere else.
  const [inrValue, setInrValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsInrValue = sellerId !== '' && currency !== 'INR';

  // Each owner is its own running sum, so the figure being corrected has
  // to be that owner's — comparing a seller's stated holding against the
  // account's capital balance would post a wildly wrong difference.
  const currentBook =
    sellerId === ''
      ? bookBalance
      : (bySeller.find((b) => b.sellerId === sellerId)?.amount ?? '0.00');

  const delta =
    statedBalance.trim() === '' || Number.isNaN(Number(statedBalance))
      ? null
      : Number(statedBalance) - Number(currentBook);

  const [confirming, setConfirming] = useState(false);

  // The form's checks, unchanged, run before the confirm step opens.
  function review(): void {
    setError(null);
    if (statedBalance.trim() === '' || Number.isNaN(Number(statedBalance))) {
      setError('What does the statement actually say?');
      return;
    }
    if (reason.trim().length < 10) {
      setError('Say what was wrong — at least a sentence');
      return;
    }
    if (accountId === null) return;
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    if (accountId === null) return;
    try {
      await reconcile.mutateAsync({
        accountId,
        ownerKind: sellerId === '' ? 'CAPITAL' : 'SELLER',
        ...(sellerId === '' ? {} : { sellerId }),
        statedBalance: Number(statedBalance).toFixed(2),
        reason: reason.trim(),
        ...(sellerId === '' && opening ? { isOpeningBalance: true } : {}),
        ...(needsInrValue && inrValue.trim() !== '' ? { inrValue: inrValue.trim() } : {}),
      });
      setStated('');
      setSellerId('');
      setReason('');
      setOpening(false);
      setInrValue('');
      setConfirming(false);
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const ownerWords =
    sellerId === ''
      ? 'our own money'
      : `the holding for ${bySeller.find((b) => b.sellerId === sellerId)?.companyName ?? 'the seller'}`;

  return (
    <>
      <Dialog
        open={accountId !== null && !confirming}
        onOpenChange={(next) => {
          if (!next) {
            setError(null);
            onClose();
          }
        }}
        icon={<Scale size={18} />}
        title={`Reconcile ${accountLabel}`}
        description="Posts the difference as a visible entry. It does not overwrite anything."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={reconcile.isPending}>
              Review adjustment
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          {bySeller.length > 0 && (
            <Select
              label="Whose balance"
              hint="Each owner is a separate running sum in this account — correct the one the statement is about."
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">Ours (capital)</option>
              {bySeller.map((b) => (
                <option key={b.sellerId} value={b.sellerId}>
                  {b.companyName}
                </option>
              ))}
            </Select>
          )}
          <p className="mo-p">
            Our book says <Money amount={currentBook} currency={currency} convert={false} /> is{' '}
            {sellerId === ''
              ? 'ours'
              : `held for ${bySeller.find((b) => b.sellerId === sellerId)?.companyName ?? 'them'}`}{' '}
            in this account.
          </p>
          <TextField
            label="What the statement says"
            requiredMark
            type="number"
            inputMode="decimal"
            step="0.01"
            inputClassName="sk-figure"
            value={statedBalance}
            onChange={(e) => setStated(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {delta !== null && delta !== 0 && (
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <p>
                An adjustment of{' '}
                <Money
                  amount={delta.toFixed(2)}
                  currency={currency}
                  convert={false}
                  direction={delta < 0 ? 'debit' : 'credit'}
                />{' '}
                will be posted against {sellerId === '' ? 'our own money' : 'their holding'}.
              </p>
            </Notice>
          )}
          {needsInrValue && (
            <TextField
              label="Worth to their wallet (INR)"
              requiredMark
              hint="The rupees this difference is worth to the seller's wallet — the book keeps a taka holding at what it was credited for, not at today's rate."
              type="number"
              inputMode="decimal"
              step="0.01"
              inputClassName="sk-figure"
              value={inrValue}
              onChange={(e) => setInrValue(e.target.value)}
              placeholder="0.00"
            />
          )}
          {sellerId === '' && (
            <Checkbox
              checked={opening}
              onChange={(e) => setOpening(e.target.checked)}
              label={
                <span>
                  This is the account&apos;s <strong>opening balance</strong>
                </span>
              }
              description="Money the business already had when the book started. It is left off the P&L instead of reading as income. Once per account."
            />
          )}
          <TextArea
            label="Why the book was wrong"
            requiredMark
            hint="At least a sentence; it is kept"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            showCount
            placeholder="e.g. Bank charged a wire fee we had not recorded"
          />
          {error !== null && !confirming && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={accountId !== null && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title="Post this adjustment?"
        entity={accountLabel}
        amount={
          <span className="mo-stack mo-stack--tight">
            <span>
              Statement{' '}
              <Money
                amount={Number(statedBalance).toFixed(2)}
                currency={currency}
                convert={false}
              />
            </span>
            {delta !== null && (
              <span>
                Adjustment{' '}
                <Money
                  amount={delta.toFixed(2)}
                  currency={currency}
                  convert={false}
                  direction={delta < 0 ? 'debit' : 'credit'}
                />
              </span>
            )}
          </span>
        }
        consequence={`Posts the ${currency} difference as a new entry against ${ownerWords} in ${accountLabel}${sellerId === '' && opening ? ', marked as the opening balance' : ''}; nothing is overwritten.`}
        confirmLabel="Post adjustment"
        destructive={false}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
