'use client';

import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { MkAlert } from '../../seller-wallets/_components/money-parts';
import type { FxRateView } from '@skydrop/api-client';
import { useSetFxRate } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

export function FxOverrideModal({
  rate,
  onClose,
  onSuccess,
}: {
  readonly rate: FxRateView;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}): ReactElement {
  const [newRate, setNewRate] = useState(rate.rate);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = useSetFxRate();
  const formId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters');
      return;
    }
    setBusy(true);
    try {
      await set.mutateAsync({
        fromCurrency: rate.fromCurrency,
        toCurrency: rate.toCurrency,
        rate: Number(newRate),
        reason: reason.trim(),
      });
      onSuccess();
    } catch (e) {
      setError(serverVerdict(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      locked={busy}
      title={`Override ${rate.fromCurrency} → ${rate.toCurrency}`}
      description="Sets source=MANUAL + isManualOverride=true; recorded in history with the reason."
      size="md"
      footer={
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" size="md" loading={busy}>
            {busy ? 'Saving…' : 'Save override'}
          </Button>
        </DialogFooter>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} className="mk-stack">
        <TextField
          label="Current rate"
          value={Number(rate.rate).toFixed(6)}
          readOnly
          disabled
          inputClassName="sk-figure"
        />
        <TextField
          label="New rate"
          type="number"
          step="0.000001"
          min="0.000001"
          value={newRate}
          onChange={(e) => setNewRate(e.target.value)}
          required
          inputClassName="sk-figure"
        />
        <TextArea
          label="Reason (≥ 10 chars)"
          hint="Goes into audit log + history row"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={10}
          maxLength={2000}
          showCount
          required
        />
        {error && <MkAlert>{error}</MkAlert>}
      </form>
    </Dialog>
  );
}
