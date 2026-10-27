'use client';

import { useState, type ReactElement } from 'react';
// The legacy `useToast` stays: the FE-2 test mounts this under the legacy
// Toaster only.
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import './tickets.css';
import { useSettleStoreDispute } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

type Payer = 'STORE' | 'SELLER';

/**
 * RS-7 — settle a reseller store ↔ seller dispute. The money moves
 * BETWEEN the store's and the seller's wallets as one pair, never from
 * ours; the ordinary refund does not apply to this ticket type (the API
 * refuses it with STORE_DISPUTE_USE_SETTLEMENT).
 *
 * FE-2: the amount is not validated here beyond "something typed" — the
 * server decides whether it is a valid amount and whether the ticket can
 * still be settled, and its `[CODE] message` is shown as it came.
 */
export function StoreDisputeSettle({
  ticketId,
  storeName,
  claimAmountInr,
  claimPayer,
}: {
  readonly ticketId: string;
  readonly storeName: string | null;
  /**
   * RS-7 (2026-09-19) — the raiser's CLAIM on a figure correction, used
   * to seed the two fields.
   *
   * A starting point, never an answer: it is what one party says is owed
   * and staff decide what actually is, so both fields stay editable and
   * nothing is submitted until somebody presses Settle. Seeding them is
   * the difference between "type the figure from the thread above" and
   * "check this figure", and re-typing is where a digit gets dropped.
   */
  readonly claimAmountInr?: string | null;
  readonly claimPayer?: Payer | null;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const settle = useSettleStoreDispute();
  const [payer, setPayer] = useState<Payer | ''>(claimPayer ?? '');
  const [amount, setAmount] = useState(claimAmountInr ?? '');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = storeName ?? t('ticketsStoreDisputeSettle.theStore');

  const submit = async (): Promise<void> => {
    if (payer === '') return;
    setError(null);
    try {
      await settle.mutateAsync({
        ticketId,
        payer,
        amountInr: amount.trim(),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      setConfirming(false);
      setPayer('');
      setAmount('');
      setNotes('');
      toast.success(t('ticketsStoreDisputeSettle.disputeSettled'));
    } catch (err) {
      setConfirming(false);
      setError(serverVerdict(err));
    }
  };

  return (
    <AfCard>
      <p className="af-muted">
        {t('ticketsStoreDisputeSettle.theMoneyMovesBetweenS', { store })}
        {claimAmountInr != null && claimPayer != null ? (
          <>
            {' '}
            {t('ticketsStoreDisputeSettle.filledInFromWhatWas', {
              claimAmountInr,
              value:
                claimPayer === 'STORE' ? `${store} owes the client` : `the client owes ${store}`,
            })}
          </>
        ) : null}
      </p>
      <div className="tk-move">
        <Select
          id="dispute-payer"
          label={t('ticketsStoreDisputeSettle.whoPays')}
          value={payer}
          onChange={(e) => setPayer(e.target.value as Payer | '')}
        >
          <option value="">{t('ticketsStoreDisputeSettle.choose')}</option>
          <option value="STORE">{t('ticketsStoreDisputeSettle.theStorePaysTheClient')}</option>
          <option value="SELLER">{t('ticketsStoreDisputeSettle.theClientPaysTheStore')}</option>
        </Select>
        <TextField
          id="dispute-amount"
          label={t('ticketsStoreDisputeSettle.amountInr')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="tk-move__notes">
          <TextArea
            id="dispute-notes"
            label={t('ticketsStoreDisputeSettle.note')}
            rows={1}
            placeholder={t('ticketsStoreDisputeSettle.theClientAndTheStore')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            // Display only: SettleStoreDisputeDto allows 2000; never enforced here.
            countMax={2000}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={payer === '' || amount.trim() === '' || settle.isPending}
          onClick={() => setConfirming(true)}
        >
          {t('ticketsStoreDisputeSettle.settle')}
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="af-error">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('ticketsStoreDisputeSettle.settleThisDispute')}
        entity={storeName ?? t('ticketsStoreDisputeSettle.memberStore')}
        consequence={
          payer === 'STORE'
            ? t('ticketsStoreDisputeSettle.paysTheClientBothWallets', {
                store,
                value: amount.trim(),
              })
            : t('ticketsStoreDisputeSettle.theClientPaysBothWallets', {
                store,
                value: amount.trim(),
              })
        }
        confirmLabel={t('ticketsStoreDisputeSettle.settle')}
        onConfirm={submit}
      />
    </AfCard>
  );
}
