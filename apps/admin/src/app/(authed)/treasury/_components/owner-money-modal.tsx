'use client';

import { useEffect, useState, type ReactElement } from 'react';
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
import { useRecordOwnerMoney } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The owner putting money into the business, or taking it out.
 *
 * Its own action, not a reconciliation: a reconciliation says the book
 * was WRONG, and the P&L reads a positive one as money we did not know we
 * had — so an injection recorded that way read as profit, and a drawing
 * as a loss. Recorded here it is equity, on no P&L line at all.
 */
export function OwnerMoneyModal({
  accountId,
  accountLabel,
  currency,
  onClose,
}: {
  readonly accountId: string | null;
  readonly accountLabel: string;
  readonly currency: 'INR' | 'BDT';
  readonly onClose: () => void;
}): ReactElement {
  const record = useRecordOwnerMoney();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One key per opening of the form, kept across retries: a retried save
  // is answered with the entry already recorded instead of a second one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (accountId !== null) setIdempotencyKey(crypto.randomUUID());
  }, [accountId]);

  function reset(): void {
    setDirection('IN');
    setAmount('');
    setOccurredOn(new Date().toISOString().slice(0, 10));
    setReason('');
    setReference('');
    setError(null);
  }

  async function save(): Promise<void> {
    setError(null);
    if (accountId === null) return;
    try {
      await record.mutateAsync({
        accountId,
        direction,
        amount: amount.trim(),
        occurredAt: new Date(occurredOn).toISOString(),
        reason: reason.trim(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey,
      });
      reset();
      onClose();
    } catch (err) {
      // FE-2: the server's verdict, verbatim — no client-side mirror of
      // its rules (amount, reason length) to pre-empt it.
      setError(serverVerdict(err));
    }
  }

  const preview = amount.trim() !== '' && !Number.isNaN(Number(amount)) ? amount.trim() : null;

  return (
    <Modal
      open={accountId !== null}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title={`Owner money — ${accountLabel}`}
      description="Money you put into the business or took out of it. Recorded as equity: it is never counted as income or as an expense."
    >
      <div className="space-y-3">
        <FormField label="Which way" htmlFor="owner-money-direction" required>
          <Select
            id="owner-money-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value === 'OUT' ? 'OUT' : 'IN')}
          >
            <option value="IN">Put in — money into the business</option>
            <option value="OUT">Taken out — money out of the business</option>
          </Select>
        </FormField>
        <FormField
          label={`Amount (${currency})`}
          htmlFor="owner-money-amount"
          hint="As a positive figure — the direction above says which way."
          required
        >
          <Input
            id="owner-money-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </FormField>
        {preview !== null && (
          <p className="text-text-muted text-sm">
            {direction === 'IN' ? 'Adds' : 'Takes'}{' '}
            <Money
              amount={direction === 'IN' ? preview : `-${preview}`}
              currency={currency}
              convert={false}
              direction={direction === 'IN' ? 'credit' : 'debit'}
            />{' '}
            {direction === 'IN' ? 'to' : 'from'} our own money in this account.
          </p>
        )}
        <FormField label="On" htmlFor="owner-money-date" required>
          <Input
            id="owner-money-date"
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </FormField>
        <FormField
          label="What it was for"
          htmlFor="owner-money-reason"
          hint="At least a sentence; it is kept with the entry."
          required
        >
          <Textarea
            id="owner-money-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Founder's capital for the October stock purchase"
          />
        </FormField>
        <FormField label="Bank reference" htmlFor="owner-money-ref" hint="Optional.">
          <Input
            id="owner-money-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
          />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={record.isPending || amount.trim() === ''}>
          {record.isPending ? 'Recording…' : 'Record'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
