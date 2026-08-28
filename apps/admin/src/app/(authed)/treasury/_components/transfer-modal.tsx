'use client';

import { useMemo, useState, type ReactElement } from 'react';
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
import { useRecordTransfer } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { useSellersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Money moving between two of our own accounts.
 *
 * BOTH amounts are entered, never one derived from a rate. What left the
 * sending account and what arrived in the receiving one are two facts
 * from two statements, and computing the second from the first would
 * quietly absorb every bank charge and every difference between the rate
 * we were quoted and the rate we got.
 *
 * When the money is a SELLER's and the currencies differ, the quoted
 * rate is a promise: they are credited at the rate they were shown, and
 * the difference between that and what we actually achieved is booked as
 * ours — positive or negative. Honouring a quote that moved against us
 * is a real cost and it is recorded as one.
 */
export function TransferModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  const sellers = useSellersList({ status: 'APPROVED', page: 1, pageSize: 100 });
  const transfer = useRecordTransfer();

  const [fromAccountId, setFrom] = useState('');
  const [toAccountId, setTo] = useState('');
  const [amountOut, setOut] = useState('');
  const [amountIn, setIn] = useState('');
  const [quotedRate, setQuoted] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [movedAt, setMovedAt] = useState(localNow);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = accounts.data ?? [];
  const from = list.find((a) => a.id === fromAccountId);
  const to = list.find((a) => a.id === toAccountId);
  const crossCurrency = from !== undefined && to !== undefined && from.currency !== to.currency;

  const achieved = useMemo(() => {
    const o = Number(amountOut);
    const i = Number(amountIn);
    if (!Number.isFinite(o) || !Number.isFinite(i) || o <= 0) return null;
    return (i / o).toFixed(6);
  }, [amountOut, amountIn]);

  async function save(): Promise<void> {
    setError(null);
    if (fromAccountId === '' || toAccountId === '') {
      setError('Pick both accounts');
      return;
    }
    if (fromAccountId === toAccountId) {
      setError('An account cannot pay itself');
      return;
    }
    const o = Number(amountOut);
    const i = Number(amountIn);
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(i) || i <= 0) {
      setError('Enter what left and what arrived');
      return;
    }
    try {
      await transfer.mutateAsync({
        fromAccountId,
        toAccountId,
        amountOut: o.toFixed(2),
        amountIn: i.toFixed(2),
        ...(quotedRate.trim() === '' ? {} : { quotedRate: Number(quotedRate).toFixed(6) }),
        ...(sellerId === '' ? {} : { sellerId }),
        movedAt: new Date(movedAt).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setOut('');
      setIn('');
      setQuoted('');
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
      title="Move money between accounts"
      description="Both sides are entered from the two statements — nothing is derived from a rate."
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="From" required>
            <Select value={fromAccountId} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Select…</option>
              {list
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.currency}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="To" required>
            <Select value={toAccountId} onChange={(e) => setTo(e.target.value)}>
              <option value="">Select…</option>
              {list
                .filter((a) => a.isActive && a.id !== fromAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.currency}
                  </option>
                ))}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Left${from ? ` (${from.currency})` : ''}`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amountOut}
              onChange={(e) => setOut(e.target.value)}
            />
          </FormField>
          <FormField
            label={`Arrived${to ? ` (${to.currency})` : ''}`}
            required
            hint={achieved !== null && crossCurrency ? `Achieved rate ${achieved}` : undefined}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amountIn}
              onChange={(e) => setIn(e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Whose money"
          hint="Leave as ours unless this is moving a seller's balance between our accounts"
        >
          <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
            <option value="">Ours</option>
            {(sellers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        </FormField>

        {sellerId !== '' && crossCurrency && (
          <FormField
            label="Rate quoted to the seller"
            hint="They are credited at this rate; the gap against what we achieved is booked as ours, either way."
          >
            <Input
              type="number"
              step="0.000001"
              min="0"
              value={quotedRate}
              onChange={(e) => setQuoted(e.target.value)}
              placeholder={achieved ?? '0.000000'}
            />
          </FormField>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="When" required>
            <Input
              type="datetime-local"
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
            />
          </FormField>
          <FormField label="Reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
            />
          </FormField>
        </div>
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>

        {sellerId !== '' && crossCurrency && quotedRate.trim() !== '' && amountOut !== '' && (
          <p className="text-text-muted text-xs">
            The seller would be credited{' '}
            <Money
              amount={(Number(amountOut) * Number(quotedRate)).toFixed(2)}
              currency={to?.currency === 'BDT' ? 'BDT' : 'INR'}
              convert={false}
            />{' '}
            and the remainder booked to us.
          </p>
        )}
      </div>

      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={transfer.isPending}>
          {transfer.isPending ? 'Moving…' : 'Record transfer'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
