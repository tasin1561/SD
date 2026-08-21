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
import { useConsignmentsList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Record the freight invoice for one ARRIVAL.
 *
 * Not per consignment: a forwarder invoices a shipment, and 300 units
 * can leave Dhaka as 100 now and 200 in September. The operator picks
 * the shipment that actually flew, and the bill is split over the units
 * that landed on it.
 *
 * Only counted India arrivals are offered — an uncounted one would be
 * split over numbers that are still guesses, and the Bangladesh intake
 * never flew at all. Arrivals already carrying a bill are shown as such
 * rather than hidden, so an operator can see the invoice exists instead
 * of wondering where their shipment went.
 *
 * Mode is left blank by default so the seller's own configured mode
 * applies — overriding it here is a per-arrival exception, not the
 * normal path, and the copy says so.
 *
 * FE-2: one bill per arrival is enforced server-side (409
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
  /**
   * Only a Bangladesh-routed consignment is billable, and only once
   * something has actually landed — the bill is amortised over the units
   * that arrived (FRT-1), so splitting it before then would charge a share
   * to units that may never exist. The server enforces both
   * (FREIGHT_NOT_BILLABLE / FREIGHT_NOTHING_LANDED); this list is here so
   * an operator is not typing a uuid to find out.
   */
  // This screen is gated on `money.view`; the consignment list needs
  // `inventory.view`. A finance account may hold one without the other, so
  // the query is switched OFF rather than firing a 403 on load — and the
  // field falls back to accepting the id, which keeps the capability
  // instead of hiding it behind a permission they nearly have.
  const maySeeConsignments = usePermission('inventory.view');
  const consignments = useConsignmentsList(
    { route: 'VIA_BD', pageSize: 100 },
    { enabled: maySeeConsignments },
  );
  /**
   * Every counted India arrival across the billable consignments, newest
   * first. `IN_FINAL` is the shipment that flew; `BD_INTAKE` is goods
   * being handed to us and is never billed.
   */
  const arrivals = (consignments.data?.items ?? []).flatMap((c) =>
    c.receipts
      .filter((r) => r.leg === 'IN_FINAL' && r.status === 'COMPLETED')
      .map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        consignmentNumber: c.consignmentNumber,
        company: c.seller.companyName,
        units: r.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0),
        billed: c.freightCharges.some((f) => f.goodsReceiptId === r.id),
      })),
  );

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
      description="The BD→India cost for one arrival. Pay-now debits the seller's wallet immediately; pay-later leaves a receivable that amortises as the stock sells."
    >
      <div className="space-y-3">
        <FormField
          label="Arrival"
          htmlFor="freight-arrival"
          hint="Pick the shipment that flew. A consignment arriving in more than one shipment gets one bill each — the forwarder invoices per shipment, and the cost is split over the units on it. Only Bangladesh-routed consignments appear."
          required
        >
          {maySeeConsignments ? (
            <Select
              id="freight-arrival"
              value={goodsReceiptId}
              onChange={(e) => setGoodsReceiptId(e.target.value)}
            >
              <option value="">
                {arrivals.length === 0 ? 'No counted India arrivals yet' : 'Select an arrival'}
              </option>
              {arrivals.map((a) => (
                <option key={a.id} value={a.id} disabled={a.billed}>
                  {a.consignmentNumber} · {a.units} units — {a.company}
                  {a.billed ? ' (already billed)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="freight-arrival"
              value={goodsReceiptId}
              onChange={(e) => setGoodsReceiptId(e.target.value)}
              placeholder="0198f3c2-…"
              autoComplete="off"
            />
          )}
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
          disabled={goodsReceiptId === '' || amountInr.trim() === '' || record.isPending}
          onClick={() => void submit()}
        >
          {record.isPending ? 'Recording…' : 'Record bill'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
