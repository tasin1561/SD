'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { InboundFreightMode } from '@skydrop/db';
import { useRecordFreight } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Record the freight invoice for one consignment.
 *
 * Mode is left blank by default so the seller's own configured mode
 * applies — overriding it here is a per-consignment exception, not the
 * normal path, and the copy says so.
 *
 * FE-2: one bill per goods receipt is enforced server-side (409
 * FREIGHT_ALREADY_RECORDED); the UI does not attempt to predict it.
 */
export function RecordFreightModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const record = useRecordFreight();

  const [goodsReceiptId, setGoodsReceiptId] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [mode, setMode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setGoodsReceiptId('');
    setAmountInr('');
    setMode('');
    setNote('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await record.mutateAsync({
        goodsReceiptId: goodsReceiptId.trim(),
        amountInr: amountInr.trim(),
        ...(mode === '' ? {} : { mode }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success('Freight bill recorded.');
      reset();
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
        if (!next) reset();
      }}
      size="md"
      title="Record a freight bill"
      description="The BD→India cost for one consignment. Pay-now debits the seller's wallet immediately; pay-later leaves a receivable that amortises as the stock sells."
    >
      <div className="space-y-3">
        <FormField
          label="Goods receipt ID"
          htmlFor="freight-receipt"
          hint="The receipt this consignment arrived on. One bill per receipt."
          required
        >
          <Input
            id="freight-receipt"
            value={goodsReceiptId}
            onChange={(e) => setGoodsReceiptId(e.target.value)}
            placeholder="0198f3c2-…"
            autoComplete="off"
          />
        </FormField>

        <FormField
          label="Freight amount (INR)"
          htmlFor="freight-amount"
          hint="What the freight forwarder billed, before any pay-later service charge."
          required
        >
          <Input
            id="freight-amount"
            inputMode="decimal"
            value={amountInr}
            onChange={(e) => setAmountInr(e.target.value)}
            placeholder="18500.00"
          />
        </FormField>

        <FormField
          label="Mode"
          htmlFor="freight-mode"
          hint="Leave on the seller's default unless this consignment is an exception."
        >
          <Select id="freight-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Use the seller&apos;s configured mode</option>
            <option value={InboundFreightMode.PAY_NOW}>Pay now — debit the wallet on record</option>
            <option value={InboundFreightMode.PAY_LATER}>Pay later — leave a receivable</option>
          </Select>
        </FormField>

        <FormField label="Note" htmlFor="freight-note" hint="Optional.">
          <Textarea
            id="freight-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={goodsReceiptId.trim() === '' || amountInr.trim() === '' || record.isPending}
          onClick={() => void submit()}
        >
          {record.isPending ? 'Recording…' : 'Record bill'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
