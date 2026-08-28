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
import { useExpenseCategories, useRecordBankEntry } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Money leaving for something we bought.
 *
 * Always OURS — an expense paid out of client money would be spending a
 * seller's balance, so the owner is fixed to capital here rather than
 * offered as a choice. The amount is typed positive and negated on the
 * way out: asking an operator to type a minus sign is asking for the
 * day somebody forgets.
 */
export function ExpenseModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  const categories = useExpenseCategories(false);
  const record = useRecordBankEntry();

  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const account = (accounts.data ?? []).find((a) => a.id === accountId);

  async function save(): Promise<void> {
    setError(null);
    if (account === undefined) {
      setError('Which account did it leave?');
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter what was spent, as a positive number');
      return;
    }
    try {
      await record.mutateAsync({
        accountId: account.id,
        amountCurrency: account.currency as 'INR' | 'BDT',
        type: 'EXPENSE',
        signedAmount: (-n).toFixed(2),
        ownerKind: 'CAPITAL',
        ...(categoryId === '' ? {} : { expenseCategoryId: categoryId }),
        occurredAt: new Date(occurredAt).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setAmount('');
      setReference('');
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
      title="Record an expense"
      description="Money leaving one of our accounts for something we bought. Always ours — never a seller's."
    >
      <div className="space-y-3">
        <FormField label="Paid from" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
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
        <FormField
          label="Category"
          hint={
            (categories.data ?? []).length === 0
              ? 'No categories yet — add one first so this spend can be told apart later.'
              : undefined
          }
        >
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorised</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Amount${account ? ` (${account.currency})` : ''}`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="When" required>
            <Input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Reference" hint="Invoice or transaction id, so it can be matched later">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </FormField>
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={record.isPending}>
          {record.isPending ? 'Recording…' : 'Record expense'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
