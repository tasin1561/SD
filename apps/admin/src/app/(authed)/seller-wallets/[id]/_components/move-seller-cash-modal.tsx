'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { MkAlert } from '../../_components/money-parts';
import { useReclassifySellerCash } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

export interface HoldingRef {
  readonly accountId: string;
  readonly label: string;
  readonly currency: 'INR' | 'BDT';
  readonly amount: string;
}

/**
 * Correct whose the cash in one account is — this seller's or ours.
 *
 * Nothing leaves the account: the server posts a zero-sum pair, so the
 * statement still agrees. It is for a bank book that attributed cash
 * wrongly, e.g. a debt repaid out of cash that stayed "held for the
 * seller". The server refuses to move more than the giving side holds.
 */
export function MoveSellerCashModal({
  sellerId,
  holding,
  onClose,
}: {
  readonly sellerId: string;
  readonly holding: HoldingRef | null;
  readonly onClose: () => void;
}): ReactElement {
  const move = useReclassifySellerCash();
  const [direction, setDirection] = useState<'TO_CAPITAL' | 'TO_SELLER'>('TO_CAPITAL');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // Their money in a taka account carries a rupee value (what it is worth
  // to their wallet). The server requires it moving toward the seller and
  // refuses it on a rupee account; the field only appears where it means
  // something.
  const [inrValue, setInrValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const foreign = holding !== null && holding.currency !== 'INR';

  function reset(): void {
    setDirection('TO_CAPITAL');
    setAmount('');
    setReason('');
    setInrValue('');
    setError(null);
  }

  /** Rejects on a refusal (after setting the verdict) so the button shows it. */
  async function save(): Promise<void> {
    setError(null);
    if (holding === null) return;
    try {
      await move.mutateAsync({
        accountId: holding.accountId,
        sellerId,
        direction,
        amount: amount.trim(),
        reason: reason.trim(),
        ...(foreign && inrValue.trim() !== '' ? { inrValue: inrValue.trim() } : {}),
      });
      reset();
      onClose();
    } catch (err) {
      // FE-2: the server's verdict, verbatim.
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <Dialog
      open={holding !== null}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      locked={move.isPending}
      title={`Correct whose cash it is — ${holding?.label ?? ''}`}
      description="Relabels cash already in this account between the seller and us. Nothing moves between banks, so the account total does not change."
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <AsyncButton
            labels={{ idle: 'Correct', busy: 'Correcting…', done: 'Corrected', error: 'Refused' }}
            disabled={amount.trim() === ''}
            onAction={save}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        {holding !== null && (
          <div className="mk-subject">
            <span className="mk-subject__label">Held for this seller here</span>
            <span className="mk-subject__main">
              <Money amount={holding.amount} currency={holding.currency} convert={false} />
            </span>
          </div>
        )}
        <Select
          id="move-cash-direction"
          label="Which way"
          requiredMark
          value={direction}
          onChange={(e) =>
            setDirection(e.target.value === 'TO_SELLER' ? 'TO_SELLER' : 'TO_CAPITAL')
          }
        >
          <option value="TO_CAPITAL">It is ours — move it to our capital</option>
          <option value="TO_SELLER">It is theirs — move it from our capital to them</option>
        </Select>
        <TextField
          id="move-cash-amount"
          label={`Amount (${holding?.currency ?? 'INR'})`}
          hint="As a positive figure — the direction above says which way."
          requiredMark
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        {foreign && (
          <TextField
            id="move-cash-inr-value"
            label="Worth to their wallet (INR)"
            hint={
              direction === 'TO_SELLER'
                ? 'Required: the rupees this cash is worth to their wallet — usually what they were credited for it.'
                : 'Optional: leave empty to take it at their average rate in this account.'
            }
            requiredMark={direction === 'TO_SELLER'}
            inputMode="decimal"
            value={inrValue}
            onChange={(e) => setInrValue(e.target.value)}
            placeholder="0.00"
          />
        )}
        <TextArea
          id="move-cash-reason"
          label="Why the bank book was wrong"
          hint="At least a sentence; it is kept with the entries."
          requiredMark
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          showCount
        />
        {error !== null && <MkAlert>{error}</MkAlert>}
      </div>
    </Dialog>
  );
}
