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
  /**
   * Per-product pricing, keyed by goods-receipt-line id. Every counted
   * product must be priced before this can be submitted — one left out
   * would ship freight-free permanently, because a unit with no
   * allocation row is skipped when it leaves.
   */
  const [priced, setPriced] = useState<
    Record<string, { basis: string; rate: string; weightKg: string }>
  >({});
  const selected = (consignments.data?.items ?? [])
    .flatMap((c) => c.receipts.map((r) => ({ c, r })))
    .find((x) => x.r.id === goodsReceiptId);
  const products = (selected?.r.lines ?? []).filter((l) => (l.receivedQty ?? 0) > 0);

  function priceOf(id: string): { basis: string; rate: string; weightKg: string } {
    return priced[id] ?? { basis: 'PER_KG', rate: '', weightKg: '' };
  }
  function setPrice(id: string, patch: Partial<{ basis: string; rate: string; weightKg: string }>) {
    setPriced((prev) => ({ ...prev, [id]: { ...priceOf(id), ...patch } }));
  }
  /** rate x weight, or rate x units — the same arithmetic the server does. */
  function lineTotal(l: { readonly id: string; readonly receivedQty: number | null }): number {
    const p = priceOf(l.id);
    const rate = Number(p.rate);
    if (!Number.isFinite(rate) || p.rate.trim() === '') return 0;
    if (p.basis === 'PER_KG') {
      const kg = Number(p.weightKg);
      return Number.isFinite(kg) ? rate * kg : 0;
    }
    return rate * (l.receivedQty ?? 0);
  }
  const grandTotal = products.reduce((sum, l) => sum + lineTotal(l), 0);
  /**
   * Cosmetic completeness only (FE-2) — the server refuses a missing or
   * weightless line itself with FREIGHT_LINE_MISSING /
   * FREIGHT_WEIGHT_REQUIRED. This just stops the operator submitting a
   * form they can see is half-filled.
   */
  const allPriced =
    products.length > 0 &&
    products.every((l) => {
      const p = priceOf(l.id);
      if (p.rate.trim() === '') return false;
      return p.basis !== 'PER_KG' || p.weightKg.trim() !== '';
    });

  const [mode, setMode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setGoodsReceiptId('');
    setPriced({});
    setMode('');
    setNote('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await record.mutateAsync({
        goodsReceiptId: goodsReceiptId.trim(),
        lines: products.map((l) => {
          const p = priceOf(l.id);
          return {
            goodsReceiptLineId: l.id,
            basis: p.basis,
            rateInr: p.rate.trim(),
            ...(p.basis === 'PER_KG' ? { chargeableWeightKg: p.weightKg.trim() } : {}),
          };
        }),
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

        {goodsReceiptId !== '' && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-text-secondary text-sm font-medium">
                What the forwarder charged
              </span>
              <span className="text-text-faint text-xs">
                {products.length} product{products.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-text-muted mb-2 text-xs">
              Price each product the way the invoice does — per kg or per piece, at its own rate. A
              per-kg line needs the chargeable weight from the invoice, not one worked out from the
              catalogue: volumetric weight and rounding up to the next half-kilo are both normal.
              Every product must be priced.
            </p>

            {products.length === 0 ? (
              <p className="text-text-muted text-sm">This arrival has no counted products.</p>
            ) : (
              <div className="border-border overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-text-muted border-b text-left text-xs">
                      <th className="px-2 py-1.5 font-medium">Product</th>
                      <th className="px-2 py-1.5 text-right font-medium">Units</th>
                      <th className="px-2 py-1.5 font-medium">Priced</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rate ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">Kg</th>
                      <th className="px-2 py-1.5 text-right font-medium">Line ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((l) => {
                      const p = priceOf(l.id);
                      const perKg = p.basis === 'PER_KG';
                      return (
                        <tr key={l.id} className="border-border/60 border-b last:border-0">
                          <td className="px-2 py-1.5">
                            <div className="text-text-primary">{l.variant.product.name}</div>
                            <div className="text-text-faint font-mono text-xs">
                              {l.variant.skuCode}
                              {l.variant.variantLabel === null
                                ? ''
                                : ` · ${l.variant.variantLabel}`}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{l.receivedQty}</td>
                          <td className="px-2 py-1.5">
                            <Select
                              aria-label={`Basis for ${l.variant.skuCode}`}
                              value={p.basis}
                              onChange={(e) => setPrice(l.id, { basis: e.target.value })}
                            >
                              <option value="PER_KG">per kg</option>
                              <option value="PER_PIECE">per pcs</option>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              aria-label={`Rate for ${l.variant.skuCode}`}
                              inputMode="decimal"
                              className="text-right"
                              value={p.rate}
                              onChange={(e) => setPrice(l.id, { rate: e.target.value })}
                              placeholder={perKg ? '300' : '40'}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            {perKg ? (
                              <Input
                                aria-label={`Chargeable weight for ${l.variant.skuCode}`}
                                inputMode="decimal"
                                className="text-right"
                                value={p.weightKg}
                                onChange={(e) => setPrice(l.id, { weightKg: e.target.value })}
                                placeholder="12.5"
                              />
                            ) : (
                              <span className="text-text-faint block text-right">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {lineTotal(l).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-border border-t">
                      <td className="text-text-muted px-2 py-1.5 text-xs" colSpan={5}>
                        Freight total, before any pay-later service charge
                      </td>
                      <td className="text-text-primary px-2 py-1.5 text-right font-medium tabular-nums">
                        ₹{grandTotal.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

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
          disabled={goodsReceiptId === '' || !allPriced || record.isPending}
          onClick={() => void submit()}
        >
          {record.isPending ? 'Recording…' : 'Record bill'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
