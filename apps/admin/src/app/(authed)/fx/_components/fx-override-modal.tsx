'use client';

import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { MkAlert } from '../../seller-wallets/_components/money-parts';
import type { FxRateView } from '@skydrop/api-client';
import { useSetFxRate } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

export function FxOverrideModal({
  rate,
  onClose,
  onSuccess,
}: {
  readonly rate: FxRateView;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}): ReactElement {
  const t = useT();
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
      setError(t('fxFxOverrideModal.reasonMustBeAtLeast'));
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
      setError(serverVerdict(e, t('fxFxOverrideModal.actionFailed')));
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
      title={t('fxFxOverrideModal.override', {
        fromCurrency: rate.fromCurrency,
        toCurrency: rate.toCurrency,
      })}
      description={t('fxFxOverrideModal.setsSourceManualIsmanualoverrideTrue')}
      size="md"
      footer={
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" disabled={busy} onClick={onClose}>
            {t('fxFxOverrideModal.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" size="md" loading={busy}>
            {busy ? t('fxFxOverrideModal.saving') : t('fxFxOverrideModal.saveOverride')}
          </Button>
        </DialogFooter>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} className="mk-stack">
        <TextField
          label={t('fxFxOverrideModal.currentRate')}
          value={Number(rate.rate).toFixed(6)}
          readOnly
          disabled
          inputClassName="sk-figure"
        />
        <TextField
          label={t('fxFxOverrideModal.newRate')}
          type="number"
          step="0.000001"
          min="0.000001"
          value={newRate}
          onChange={(e) => setNewRate(e.target.value)}
          required
          inputClassName="sk-figure"
        />
        <TextArea
          label={t('fxFxOverrideModal.reason10Chars')}
          hint={t('fxFxOverrideModal.goesIntoAuditLogHistory')}
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
