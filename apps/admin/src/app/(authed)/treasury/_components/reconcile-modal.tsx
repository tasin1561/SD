'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
  Textarea,
} from '@skydrop/ui/components';
import { useReconcileAccount } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
  const [error, setError] = useState<string | null>(null);

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

  async function save(): Promise<void> {
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
    try {
      await reconcile.mutateAsync({
        accountId,
        ownerKind: sellerId === '' ? 'CAPITAL' : 'SELLER',
        ...(sellerId === '' ? {} : { sellerId }),
        statedBalance: Number(statedBalance).toFixed(2),
        reason: reason.trim(),
      });
      setStated('');
      setSellerId('');
      setReason('');
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={accountId !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      title={`Reconcile ${accountLabel}`}
      description="Posts the difference as a visible entry. It does not overwrite anything."
    >
      <div className="space-y-3">
        {bySeller.length > 0 && (
          <FormField
            label="Whose balance"
            hint="Each owner is a separate running sum in this account — correct the one the statement is about."
          >
            <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Ours (capital)</option>
              {bySeller.map((b) => (
                <option key={b.sellerId} value={b.sellerId}>
                  {b.companyName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <p className="text-text-muted text-sm">
          Our book says <Money amount={currentBook} currency={currency} convert={false} /> is{' '}
          {sellerId === ''
            ? 'ours'
            : `held for ${bySeller.find((b) => b.sellerId === sellerId)?.companyName ?? 'them'}`}{' '}
          in this account.
        </p>
        <FormField label="What the statement says" required>
          <Input
            type="number"
            step="0.01"
            value={statedBalance}
            onChange={(e) => setStated(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </FormField>
        {delta !== null && delta !== 0 && (
          <div className="flex gap-2 text-sm">
            <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" aria-hidden />
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
          </div>
        )}
        <FormField label="Why the book was wrong" required hint="At least a sentence; it is kept">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Bank charged a wire fee we had not recorded"
          />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={reconcile.isPending}>
          {reconcile.isPending ? 'Posting…' : 'Post adjustment'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
