'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
} from '@skydrop/ui/components';
import { usePlaceInvestment } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function InvestmentModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  const place = usePlaceInvestment();

  const [label, setLabel] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [placedAt, setPlacedAt] = useState(localNow);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const account = (accounts.data ?? []).find((a) => a.id === fromAccountId);

  async function save(): Promise<void> {
    setError(null);
    if (label.trim() === '' || counterparty.trim() === '' || fromAccountId === '') {
      setError('What it is, who holds it, and which account it left');
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter the principal');
      return;
    }
    try {
      await place.mutateAsync({
        label: label.trim(),
        counterparty: counterparty.trim(),
        fromAccountId,
        amount: n.toFixed(2),
        placedAt: new Date(placedAt).toISOString(),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setLabel('');
      setCounterparty('');
      setAmount('');
      setNote('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title="Place capital"
      description="Ours only. Client money is not ours to place, and the server refuses it."
    >
      <div className="space-y-3">
        <FormField label="What" required>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 6-month fixed deposit"
            maxLength={120}
          />
        </FormField>
        <FormField label="With whom" required>
          <Input
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="e.g. HDFC Bank"
            maxLength={200}
          />
        </FormField>
        <FormField label="From account" required>
          <Select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Principal${account ? ` (${account.currency})` : ''}`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="Placed on" required>
            <Input
              type="datetime-local"
              value={placedAt}
              onChange={(e) => setPlacedAt(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={place.isPending}>
          {place.isPending ? 'Placing…' : 'Place'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
