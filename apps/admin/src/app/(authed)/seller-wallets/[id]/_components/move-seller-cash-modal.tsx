'use client';

import { useState, type ReactElement } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setDirection('TO_CAPITAL');
    setAmount('');
    setReason('');
    setError(null);
  }

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
      });
      reset();
      onClose();
    } catch (err) {
      // FE-2: the server's verdict, verbatim.
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={holding !== null}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title={`Correct whose cash it is — ${holding?.label ?? ''}`}
      description="Relabels cash already in this account between the seller and us. Nothing moves between banks, so the account total does not change."
    >
      <div className="space-y-3">
        {holding !== null && (
          <p className="text-text-muted text-sm">
            Held for this seller here:{' '}
            <Money amount={holding.amount} currency={holding.currency} convert={false} />
          </p>
        )}
        <FormField label="Which way" htmlFor="move-cash-direction" required>
          <Select
            id="move-cash-direction"
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value === 'TO_SELLER' ? 'TO_SELLER' : 'TO_CAPITAL')
            }
          >
            <option value="TO_CAPITAL">It is ours — move it to our capital</option>
            <option value="TO_SELLER">It is theirs — move it from our capital to them</option>
          </Select>
        </FormField>
        <FormField
          label={`Amount (${holding?.currency ?? 'INR'})`}
          htmlFor="move-cash-amount"
          hint="As a positive figure — the direction above says which way."
          required
        >
          <Input
            id="move-cash-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </FormField>
        <FormField
          label="Why the bank book was wrong"
          htmlFor="move-cash-reason"
          hint="At least a sentence; it is kept with the entries."
          required
        >
          <Textarea
            id="move-cash-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
          />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={move.isPending || amount.trim() === ''}>
          {move.isPending ? 'Correcting…' : 'Correct'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
