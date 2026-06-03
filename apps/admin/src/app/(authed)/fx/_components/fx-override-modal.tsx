'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Textarea,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { FxRateView } from '@skydrop/api-client';
import { useSetFxRate } from '@/lib/api-hooks';

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
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : e.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Override ${rate.fromCurrency} → ${rate.toCurrency}`}
      description="Sets source=MANUAL + isManualOverride=true; recorded in history with the reason."
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="Current rate">
          <Input value={Number(rate.rate).toFixed(6)} readOnly disabled />
        </FormField>
        <FormField label="New rate" required>
          <Input
            type="number"
            step="0.000001"
            min="0.000001"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Reason (≥ 10 chars)"
          required
          hint="Goes into audit log + history row"
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </FormField>
        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? 'Saving…' : 'Save override'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
