'use client';

import { useState, type ReactElement } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Currency, InboundFreightMode } from '@skydrop/db';
import { freightModeWords } from '@skydrop/ui/status';
import { useRecordFreight } from '@/lib/ops-hooks';
import { useConsignmentFreightMode, useConsignmentsList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { MkAlert, MkCallout } from '../../seller-wallets/_components/money-parts';

/**
 * What a freight rate may be AGREED in.
 *
 * The rate is settled on the phone, and half those calls happen in taka
 * — so the figure typed here is the figure on the invoice, and the bill
 * is converted to rupees once, at the moment it is recorded. Left as a
 * text box, "TAKA" or "bdt " saves cleanly and surfaces far later as a
 * bill that could not be priced; the same reasoning as the fee-currency
 * picker in `@/lib/fee-currency`, which is the precedent here. A
 * separate list because a freight bill is not a fee and the two have no
 * reason to move together.
 *
 * FE-2: convenience, not enforcement. The server validates regardless.
 */
const BILL_CURRENCIES = [
  { value: Currency.INR, label: 'INR — rupees (₹)' },
  { value: Currency.BDT, label: 'BDT — taka (৳)' },
] as const;

const SYMBOL: Record<Currency, string> = { INR: '₹', BDT: '৳' };

/** What each mode means for WHICH stop carries the bill. */
const MODE_OPTIONS = [
  {
    value: InboundFreightMode.PAY_ADVANCE,
    label: 'Pay in advance — bill the Bangladesh intake, before it flies',
  },
  { value: InboundFreightMode.PAY_NOW, label: 'Pay now — debit the wallet on record' },
  { value: InboundFreightMode.PAY_LATER, label: 'Pay later — leave a receivable' },
] as const;

const LEG_WORDS = { BD_INTAKE: 'Bangladesh intake', IN_FINAL: 'India arrival' } as const;

/** `null` is a goods receipt that belongs to no consignment leg — the
 *  picker never offers one, so this only guards the type. */
function legWords(leg: string | null): string {
  if (leg === 'BD_INTAKE') return LEG_WORDS.BD_INTAKE;
  if (leg === 'IN_FINAL') return LEG_WORDS.IN_FINAL;
  return 'stop';
}

const SOURCE_WORDS: Record<'CONSIGNMENT' | 'SELLER' | 'SYSTEM_DEFAULT', string> = {
  CONSIGNMENT: 'pinned on this consignment',
  SELLER: "from the seller's settings",
  SYSTEM_DEFAULT: 'the platform default',
};

/**
 * Record the freight invoice for one ARRIVAL.
 *
 * Not per consignment: a forwarder invoices a shipment, and 300 units
 * can leave Dhaka as 100 now and 200 in September. The operator picks
 * the shipment that actually flew, and the bill is split over the units
 * that landed on it.
 *
 * WHICH stop is billed is the consignment's freight mode: PAY_ADVANCE
 * bills the BANGLADESH INTAKE — the count and weight the rate is applied
 * to, raised before the goods fly — while PAY_NOW and PAY_LATER both
 * bill the INDIA ARRIVAL, which is what a forwarder invoices. So both
 * legs are offered, each labelled with which it is, and the mode in
 * force for the chosen consignment is read back and stated once
 * something is picked. The picker is CONVENIENCE: the server refuses the
 * wrong leg by name (FREIGHT_NOT_THE_BD_INTAKE / FREIGHT_NOT_AN_ARRIVAL)
 * and that verdict is shown as-is, so this does not try to predict it.
 *
 * Only counted stops are offered — an uncounted one would be split over
 * numbers that are still guesses. Stops already carrying a bill are shown
 * as such rather than hidden, so an operator can see the invoice exists
 * instead of wondering where their shipment went.
 *
 * Mode is left blank by default so whatever is already in force applies
 * — overriding it here PINS the consignment, which is a per-shipment
 * exception rather than the normal path, and the copy says so.
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
   * Every COUNTED stop across the billable consignments — both legs.
   *
   * `IN_FINAL` is the shipment that flew, billed on PAY_NOW and
   * PAY_LATER; `BD_INTAKE` is the Dhaka count, billed on PAY_ADVANCE.
   * Which one is right depends on the consignment's mode, so both are
   * offered with the leg spelled out and the server decides — the two
   * refusals it gives (FREIGHT_NOT_THE_BD_INTAKE /
   * FREIGHT_NOT_AN_ARRIVAL) each name the leg it wanted.
   */
  const arrivals = (consignments.data?.items ?? []).flatMap((c) =>
    c.receipts
      .filter((r) => (r.leg === 'IN_FINAL' || r.leg === 'BD_INTAKE') && r.status === 'COMPLETED')
      .map((r) => ({
        id: r.id,
        leg: r.leg,
        legWords: legWords(r.leg),
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
  /** What the rates below are AGREED in. The bill is charged in rupees
   *  whatever this says — the conversion happens once, on record. */
  const [currency, setCurrency] = useState<Currency>(Currency.INR);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const symbol = SYMBOL[currency];

  /**
   * What mode is in force for the chosen consignment, and where it came
   * from — read only once something is picked, because the chain is per
   * consignment and fetching it for a whole list would be a request per
   * row to answer a question nobody has asked yet.
   *
   * Convenience only. It does not gate the submit (FE-2).
   */
  const freightMode = useConsignmentFreightMode(selected?.c.id ?? null, {
    enabled: maySeeConsignments,
  });
  const resolvedMode =
    mode === '' ? (freightMode.data?.mode ?? null) : (mode as InboundFreightMode);
  const expectedLeg = resolvedMode === InboundFreightMode.PAY_ADVANCE ? 'BD_INTAKE' : 'IN_FINAL';
  const selectedLeg = selected?.r.leg ?? null;
  const legDisagrees = selectedLeg !== null && resolvedMode !== null && selectedLeg !== expectedLeg;

  function reset(): void {
    setGoodsReceiptId('');
    setPriced({});
    setMode('');
    setCurrency(Currency.INR);
    setNote('');
    setError(null);
  }

  /** Rejects on a refusal (after setting the verdict) so the button shows it. */
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
            rate: p.rate.trim(),
            ...(p.basis === 'PER_KG' ? { chargeableWeightKg: p.weightKg.trim() } : {}),
          };
        }),
        // Omitted when INR: the server defaults to it, and sending the
        // default is one more thing that can disagree with it.
        ...(currency === Currency.INR ? {} : { currency }),
        ...(mode === '' ? {} : { mode }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success('Freight bill recorded.');
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      size="xl"
      locked={record.isPending}
      title="Record a freight bill"
      description="The BD→India cost for one arrival. Pay-now debits the seller's wallet immediately; pay-later leaves a receivable that amortises as the stock sells."
      footer={
        <DialogFooter>
          <Button
            variant="secondary"
            size="md"
            onClick={() => onOpenChange(false)}
            disabled={record.isPending}
          >
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            disabled={goodsReceiptId === '' || !allPriced}
            labels={{ idle: 'Record bill', busy: 'Recording…', done: 'Recorded', error: 'Refused' }}
            onAction={submit}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        {maySeeConsignments ? (
          <Select
            id="freight-arrival"
            label="Which stop is being billed"
            hint="On pay-in-advance terms that is the BANGLADESH INTAKE — the count and weight the rate is applied to, billed before the goods fly. On pay-now and pay-later it is the INDIA ARRIVAL, which is what a forwarder invoices; a consignment landing in two shipments gets one bill each. Only counted stops on Bangladesh-routed consignments appear."
            requiredMark
            value={goodsReceiptId}
            onChange={(e) => setGoodsReceiptId(e.target.value)}
          >
            <option value="">
              {arrivals.length === 0 ? 'No counted India arrivals yet' : 'Select an arrival'}
            </option>
            {arrivals.map((a) => (
              <option key={a.id} value={a.id} disabled={a.billed}>
                {a.consignmentNumber} · {a.legWords} · {a.units} units — {a.company}
                {a.billed ? ' (already billed)' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <TextField
            id="freight-arrival"
            label="Which stop is being billed"
            hint="On pay-in-advance terms that is the BANGLADESH INTAKE — the count and weight the rate is applied to, billed before the goods fly. On pay-now and pay-later it is the INDIA ARRIVAL, which is what a forwarder invoices; a consignment landing in two shipments gets one bill each. Only counted stops on Bangladesh-routed consignments appear."
            requiredMark
            value={goodsReceiptId}
            onChange={(e) => setGoodsReceiptId(e.target.value)}
            placeholder="0198f3c2-…"
            autoComplete="off"
            inputClassName="sk-ident"
          />
        )}

        {/* What is actually in force for this consignment, once one is
            picked. Convenience: the server refuses the wrong leg by name
            and that verdict is shown as-is (FE-2). */}
        {selectedLeg !== null && freightMode.data !== undefined && (
          <MkCallout
            tone={legDisagrees ? 'warn' : 'info'}
            icon={legDisagrees ? <TriangleAlert size={16} /> : <Info size={16} />}
          >
            <p>
              {freightModeWords(freightMode.data.mode, 'STAFF')} —{' '}
              {SOURCE_WORDS[freightMode.data.source]}
              {freightMode.data.locked ? ', and fixed now a bill exists' : ''}.{' '}
              {legDisagrees
                ? `That bills the ${legWords(expectedLeg).toLowerCase()}, and this is the ${legWords(selectedLeg).toLowerCase()}. Pin the mode below if this stop is the one you mean.`
                : `This is the ${legWords(selectedLeg).toLowerCase()}, which is the stop that mode bills.`}
            </p>
          </MkCallout>
        )}

        {goodsReceiptId !== '' && (
          <div className="mk-stack">
            <h3 className="mk-form__heading">
              What the forwarder charged
              <span className="mk-faint">
                {products.length} product{products.length === 1 ? '' : 's'}
              </span>
            </h3>
            <p className="mk-small">
              Price each product the way the invoice does — per kg or per piece, at its own rate. A
              per-kg line needs the chargeable weight from the invoice, not one worked out from the
              catalogue: volumetric weight and rounding up to the next half-kilo are both normal.
              Every product must be priced.
            </p>

            <div className="mk-filters">
              <Select
                id="freight-currency"
                label="Agreed in"
                hint="The currency the rate was agreed in on the phone — type the figures exactly as they are on the invoice. The bill is converted to rupees at the rate in force when it is recorded, and the seller is charged rupees either way."
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {BILL_CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>

            {products.length === 0 ? (
              <p className="mk-muted">This arrival has no counted products.</p>
            ) : (
              <div className="mk-scroll">
                <table className="mk-grid-table">
                  {/* Explicit widths: without them the product column takes
                      whatever is left after the inputs, and the name wraps to
                      three lines while a <select> renders blank because its
                      label no longer fits. */}
                  <colgroup>
                    <col />
                    <col style={{ width: '4rem' }} />
                    <col style={{ width: '8rem' }} />
                    <col style={{ width: '8rem' }} />
                    <col style={{ width: '7rem' }} />
                    <col style={{ width: '8rem' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th data-align="right">Units</th>
                      <th>Priced</th>
                      <th data-align="right">Rate {symbol}</th>
                      <th data-align="right">Kg</th>
                      <th data-align="right">Line {symbol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((l) => {
                      const p = priceOf(l.id);
                      const perKg = p.basis === 'PER_KG';
                      return (
                        <tr key={l.id}>
                          <td>
                            <div className="mk-cell">
                              <span className="mk-body">{l.variant.product.name}</span>
                              <span className="mk-faint sk-ident mk-wrap">
                                {l.variant.skuCode}
                                {l.variant.variantLabel === null
                                  ? ''
                                  : ` · ${l.variant.variantLabel}`}
                              </span>
                            </div>
                          </td>
                          <td data-align="right" className="sk-figure">
                            {l.receivedQty}
                          </td>
                          <td>
                            <Select
                              aria-label={`Basis for ${l.variant.skuCode}`}
                              value={p.basis}
                              onChange={(e) => setPrice(l.id, { basis: e.target.value })}
                            >
                              <option value="PER_KG">per kg</option>
                              <option value="PER_PIECE">per pcs</option>
                            </Select>
                          </td>
                          <td>
                            <TextField
                              aria-label={`Rate for ${l.variant.skuCode}`}
                              inputMode="decimal"
                              value={p.rate}
                              onChange={(e) => setPrice(l.id, { rate: e.target.value })}
                              placeholder={perKg ? '300' : '40'}
                            />
                          </td>
                          <td>
                            {perKg ? (
                              <TextField
                                aria-label={`Chargeable weight for ${l.variant.skuCode}`}
                                inputMode="decimal"
                                value={p.weightKg}
                                onChange={(e) => setPrice(l.id, { weightKg: e.target.value })}
                                placeholder="12.5"
                              />
                            ) : (
                              <span className="mk-faint">—</span>
                            )}
                          </td>
                          <td data-align="right">
                            <Money amount={lineTotal(l)} currency={currency} convert={false} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="mk-small" colSpan={5}>
                        Freight total, before any pay-later service charge
                        {currency === Currency.INR
                          ? ''
                          : ' — converted to rupees at the rate in force when this is recorded'}
                      </td>
                      <td data-align="right" className="mk-strong">
                        <Money amount={grandTotal} currency={currency} convert={false} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        <Select
          id="freight-mode"
          label="Mode"
          hint="Leave it alone unless this consignment is an exception — whatever is already in force applies. Choosing one here PINS the consignment to it, and it decides which stop the bill hangs on."
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="">
            {freightMode.data === undefined
              ? 'Use whatever is already in force'
              : `Use whatever is already in force (${freightModeWords(freightMode.data.mode, 'STAFF')}, ${SOURCE_WORDS[freightMode.data.source]})`}
          </option>
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>

        <TextArea
          id="freight-note"
          label="Note"
          hint="Optional."
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error !== null && <MkAlert>{error}</MkAlert>}
      </div>
    </Dialog>
  );
}
