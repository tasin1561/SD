'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  FormField,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { useSettleStoreDispute } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
  const toast = useToast();
  const settle = useSettleStoreDispute();
  const [payer, setPayer] = useState<Payer | ''>(claimPayer ?? '');
  const [amount, setAmount] = useState(claimAmountInr ?? '');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = storeName ?? 'the store';

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
      toast.success('Dispute settled');
    } catch (err) {
      setConfirming(false);
      setError(serverVerdict(err));
    }
  };

  return (
    <Card>
      <CardBody>
        <p className="text-text-muted mb-3 text-sm">
          The money moves between {store}&apos;s wallet and the seller&apos;s — never from ours.
          Both read your note.
          {claimAmountInr != null && claimPayer != null ? (
            <>
              {' '}
              Filled in from what was claimed (₹{claimAmountInr},{' '}
              {claimPayer === 'STORE' ? `${store} owes the seller` : `the seller owes ${store}`}) —
              change it if that is not what you have decided.
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-end gap-2.5">
          <FormField label="Who pays" htmlFor="dispute-payer" className="w-[220px]">
            <Select
              id="dispute-payer"
              value={payer}
              onChange={(e) => setPayer(e.target.value as Payer | '')}
            >
              <option value="">Choose…</option>
              <option value="STORE">The store pays the seller</option>
              <option value="SELLER">The seller pays the store</option>
            </Select>
          </FormField>
          <FormField label="Amount (INR)" htmlFor="dispute-amount" className="w-[140px]">
            <input
              id="dispute-amount"
              className="sd-field"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Note" htmlFor="dispute-notes" className="min-w-[200px] flex-1">
            <Textarea
              id="dispute-notes"
              rows={1}
              placeholder="The seller and the store both read this."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
          <Button
            variant="primary"
            size="md"
            className="shrink-0"
            disabled={payer === '' || amount.trim() === '' || settle.isPending}
            onClick={() => setConfirming(true)}
          >
            Settle
          </Button>
        </div>
        {error !== null ? (
          <p role="alert" className="text-critical mt-3 text-sm">
            {error}
          </p>
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Settle this dispute?"
        description={
          payer === 'STORE'
            ? `${store} pays the seller ₹${amount.trim()}. Both wallets move now and the ticket closes.`
            : `The seller pays ${store} ₹${amount.trim()}. Both wallets move now and the ticket closes.`
        }
        confirmLabel={settle.isPending ? 'Settling…' : 'Settle'}
        disabled={settle.isPending}
        onConfirm={submit}
      />
    </Card>
  );
}
