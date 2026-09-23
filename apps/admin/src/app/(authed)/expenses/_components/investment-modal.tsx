'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { PiggyBank } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { useToast } from '@skydrop/ui/app/toast';
import { usePlaceInvestment } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { localNow } from '@/lib/datetime-local';
import '../../treasury/_components/money.css';
import './expenses.css';

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
  // The checked form waits here for a confirm that restates it.
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  // One key per opening of the form, reused on every retry: a
  // double-click or a retried timeout places the capital ONCE.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
  }, [open]);

  const account = (accounts.data ?? []).find((a) => a.id === fromAccountId);

  /** The form's own checks, unchanged; passing them opens the confirm. */
  function review(): void {
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
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    const n = Number(amount);
    try {
      await place.mutateAsync({
        label: label.trim(),
        counterparty: counterparty.trim(),
        fromAccountId,
        amount: n.toFixed(2),
        placedAt: new Date(placedAt).toISOString(),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        idempotencyKey,
      });
      setLabel('');
      setCounterparty('');
      setAmount('');
      setNote('');
      onOpenChange(false);
      toast.success('Capital placed');
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setError(null);
        }}
        icon={<PiggyBank size={18} />}
        title="Place capital"
        description="Ours only. Client money is not ours to place, and the server refuses it."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={place.isPending}>
              {place.isPending ? 'Placing…' : 'Place'}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <TextField
            label="What"
            requiredMark
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 6-month fixed deposit"
            maxLength={120}
            showCount
          />
          <TextField
            label="With whom"
            requiredMark
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="e.g. HDFC Bank"
            maxLength={200}
          />
          <Select
            label="From account"
            requiredMark
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
          >
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
          <div className="mo-fields" data-cols="2">
            <TextField
              label={`Principal${account ? ` (${account.currency})` : ''}`}
              requiredMark
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <DateField
              label="Placed on"
              requiredMark
              type="datetime-local"
              value={placedAt}
              onChange={(e) => setPlacedAt(e.target.value)}
            />
          </div>
          <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          {error !== null && !confirming && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={open && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title="Place this capital?"
        entity={`${label.trim()} · ${counterparty.trim()}`}
        amount={
          <Money
            amount={Number(amount).toFixed(2)}
            currency={(account?.currency ?? 'INR') as 'INR' | 'BDT'}
            convert={false}
          />
        }
        consequence="The principal leaves our account and is held as an investment until a return is recorded against it."
        confirmLabel="Place"
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      >
        <div className="ex-confirm-lines">
          <span>
            From: {account === undefined ? '—' : `${account.label} · ${account.bankName}`}
          </span>
          <span>
            Placed on: {placedAt === '' ? '—' : new Date(placedAt).toLocaleString('en-IN')}
          </span>
        </div>
      </ConfirmDialog>
    </>
  );
}
