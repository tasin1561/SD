'use client';

import { BillUnbilledCard, ChargesBackfillCard } from './charges-backfill-card';
import { useState, type ReactElement } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { Money, Num } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { TriangleAlert } from 'lucide-react';
import { Facts, MoSection, Notice } from '../../treasury/_components/money-parts';
import './pricing.css';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * What would this shipment cost?
 *
 * The pricing engine has always been callable and never visible, so the
 * only way to answer a seller asking "what will you charge me for a 2kg
 * parcel to Jaipur" was to create an order and look at the charges.
 *
 * The part worth looking at is not the total — it is the FALLBACKS. The
 * engine answers even when the data behind it is missing: a zone it
 * could not resolve falls back to DEFAULT, a weight slab with no rate
 * card item scores zero base shipping. Both produce a confident-looking
 * number that is wrong, so this screen puts them above the total rather
 * than in a footnote.
 */

interface ChargeLine {
  type: string;
  description: string;
  amountInr: string;
  surchargeRuleId: string | null;
}

interface Unresolved {
  reason: string;
  detail?: string;
}

interface PricingResult {
  rateCardCode: string | null;
  courierCode: string | null;
  serviceType: string;
  zone: string;
  chargeableWeightGrams: number;
  baseShippingInr: string;
  sellerDiscountPercent: string | null;
  surcharges: readonly ChargeLine[];
  gstRatePercent: string;
  gstAmountInr: string;
  totalInr: string;
  unresolved: readonly Unresolved[];
  margin: {
    baseChargeInr: string;
    costToSkydropInr: string | null;
    marginInr: string | null;
  };
}

interface PreviewBody {
  sellerId: string;
  recipientPostalCode: string;
  paymentMode: string;
  codAmountInr: number;
  declaredValueInr: number;
  totalWeightGrams: number;
  courierCode?: string;
  serviceType?: string;
}

function usePricingPreview(): UseMutationResult<PricingResult, Error, PreviewBody> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PricingResult>('/api/admin/pricing/preview', { method: 'POST', body }),
  });
}

/** Plain-language explanations. A code alone tells you nothing actionable. */
const FALLBACK_TEXT: Record<string, string> = {
  NO_RATE_CARD:
    'No rate card applies to this seller — base shipping is zero, which is not a price.',
  NO_RATE_CARD_ITEM:
    'No rate exists for this courier, zone and weight slab. Base shipping fell back to zero.',
  ZONE_FALLBACK_DEFAULT:
    'The destination pincode did not resolve to a zone, so the DEFAULT zone rate was used.',
  NO_COURIER: 'No courier resolved — the default courier setting may be unset.',
  NO_GST_RATE: 'No GST rate configured; the built-in 18% was used.',
  TIERED_SURCHARGE_NOT_IMPLEMENTED:
    'A tiered surcharge rule applies but tiered calculation is not built — it contributed zero.',
};

export function PricingIndex(): ReactElement {
  const preview = usePricingPreview();
  const [form, setForm] = useState({
    sellerId: '',
    recipientPostalCode: '',
    paymentMode: 'PREPAID',
    codAmountInr: '0',
    declaredValueInr: '',
    totalWeightGrams: '',
    courierCode: '',
    serviceType: '',
  });

  function set(key: keyof typeof form, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const complete =
    form.sellerId.trim() !== '' &&
    form.recipientPostalCode.trim() !== '' &&
    form.declaredValueInr !== '' &&
    form.totalWeightGrams !== '';

  const r = preview.data;

  return (
    <div className="mo-page">
      <PageHeader
        title="Pricing preview"
        subtitle="What the engine would charge for a shipment, without creating an order to find out."
      />

      {/* Above the calculator: a shipment nobody priced is worth more
          than a price nobody asked for. */}
      <div className="mo-stack">
        <ChargesBackfillCard />
        <BillUnbilledCard />
      </div>

      <MoSection title="The shipment">
        <div className="mo-fields" data-cols="2">
          <TextField
            id="pp-seller"
            label="Seller id"
            hint="Their rate card and discounts apply."
            value={form.sellerId}
            onChange={(e) => set('sellerId', e.target.value)}
          />
          <TextField
            id="pp-pin"
            label="Destination pincode"
            value={form.recipientPostalCode}
            onChange={(e) => set('recipientPostalCode', e.target.value)}
            placeholder="560001"
          />
          <TextField
            id="pp-weight"
            label="Weight (grams)"
            type="number"
            min={1}
            value={form.totalWeightGrams}
            onChange={(e) => set('totalWeightGrams', e.target.value)}
          />
          <TextField
            id="pp-value"
            label="Declared value (₹)"
            type="number"
            min={0}
            value={form.declaredValueInr}
            onChange={(e) => set('declaredValueInr', e.target.value)}
          />
          <Select
            id="pp-mode"
            label="Payment"
            value={form.paymentMode}
            onChange={(e) => set('paymentMode', e.target.value)}
          >
            <option value="PREPAID">Prepaid</option>
            <option value="COD">Cash on delivery</option>
          </Select>
          {form.paymentMode === 'COD' && (
            <TextField
              id="pp-cod"
              label="COD amount (₹)"
              hint="What the customer pays the courier."
              type="number"
              min={0}
              value={form.codAmountInr}
              onChange={(e) => set('codAmountInr', e.target.value)}
            />
          )}
          <TextField
            id="pp-courier"
            label="Courier"
            hint="Optional — defaults to the system courier."
            value={form.courierCode}
            onChange={(e) => set('courierCode', e.target.value)}
            placeholder="delhivery"
          />
        </div>

        <div className="mo-row">
          <AsyncButton
            size="md"
            labels={{ idle: 'Calculate', busy: 'Calculating…', done: 'Calculated' }}
            disabled={!complete || preview.isPending}
            onAction={() =>
              preview.mutateAsync({
                sellerId: form.sellerId.trim(),
                recipientPostalCode: form.recipientPostalCode.trim(),
                paymentMode: form.paymentMode,
                codAmountInr: Number(form.codAmountInr || 0),
                declaredValueInr: Number(form.declaredValueInr),
                totalWeightGrams: Number(form.totalWeightGrams),
                ...(form.courierCode.trim() === '' ? {} : { courierCode: form.courierCode.trim() }),
                ...(form.serviceType.trim() === '' ? {} : { serviceType: form.serviceType.trim() }),
              })
            }
          />
        </div>
      </MoSection>

      {preview.error !== null && <ErrorState message={serverVerdict(preview.error)} />}

      {r !== undefined && (
        <>
          {r.unresolved.length > 0 && (
            <Notice
              tone="warn"
              icon={<TriangleAlert size={16} />}
              title="Read this before quoting the number"
            >
              <p>The engine answered, but some of what it needed was missing and it fell back.</p>
              <ul className="pr-fallbacks">
                {r.unresolved.map((u) => (
                  <li key={u.reason}>
                    <span className="mo-warn">
                      {FALLBACK_TEXT[u.reason] ?? u.reason.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    {u.detail !== undefined && <span className="mo-faint"> ({u.detail})</span>}
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          <MoSection title="How it resolved">
            <Facts
              items={[
                { label: 'Rate card', value: r.rateCardCode ?? '—' },
                { label: 'Courier', value: r.courierCode ?? '—' },
                { label: 'Service', value: r.serviceType },
                { label: 'Zone', value: r.zone },
                {
                  label: 'Chargeable weight',
                  value: <Num value={r.chargeableWeightGrams} suffix="g" />,
                },
                {
                  label: 'Seller discount',
                  value: r.sellerDiscountPercent === null ? 'None' : `${r.sellerDiscountPercent}%`,
                },
              ]}
            />
          </MoSection>

          <MoSection title="The charge" flush>
            <Table caption="The charge">
              <THead>
                <Tr>
                  <Th>Line</Th>
                  <Th align="right">Amount</Th>
                </Tr>
              </THead>
              <TBody>
                <Tr>
                  <Td>Base shipping</Td>
                  <Td align="right">
                    <Money amount={r.baseShippingInr} />
                  </Td>
                </Tr>
                {r.surcharges.map((s) => (
                  <Tr key={`${s.type}-${s.description}`}>
                    <Td>{s.description}</Td>
                    <Td align="right">
                      <Money amount={s.amountInr} />
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td>GST at {r.gstRatePercent}%</Td>
                  <Td align="right">
                    <Money amount={r.gstAmountInr} />
                  </Td>
                </Tr>
                <Tr className="mo-total-row">
                  <Td>
                    <strong>Total</strong>
                  </Td>
                  <Td align="right">
                    <strong>
                      <Money amount={r.totalInr} />
                    </strong>
                  </Td>
                </Tr>
              </TBody>
            </Table>
          </MoSection>

          <MoSection
            title="Margin"
            note="Internal only — never shown to a seller and never touches their wallet."
          >
            <Facts
              items={[
                { label: 'We charge', value: <Money amount={r.margin.baseChargeInr} /> },
                {
                  label: 'Courier costs us',
                  value:
                    r.margin.costToSkydropInr === null ? (
                      <span className="mo-faint">Not recorded on the rate card</span>
                    ) : (
                      <Money amount={r.margin.costToSkydropInr} />
                    ),
                },
                {
                  label: 'Margin',
                  value:
                    r.margin.marginInr === null ? (
                      <span className="mo-faint">Unknown without a recorded cost</span>
                    ) : (
                      <Money
                        amount={r.margin.marginInr}
                        direction={Number(r.margin.marginInr) < 0 ? 'debit' : 'credit'}
                      />
                    ),
                },
              ]}
            />
          </MoSection>
        </>
      )}
    </div>
  );
}
