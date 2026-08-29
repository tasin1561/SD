'use client';

import { BillUnbilledCard, ChargesBackfillCard } from './charges-backfill-card';
import { useState, type ReactElement } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  ErrorNote,
  FormField,
  Input,
  Money,
  Num,
  PageHeader,
  Section,
  Select,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        title="Pricing preview"
        subtitle="What the engine would charge for a shipment, without creating an order to find out."
      />

      {/* Above the calculator: a shipment nobody priced is worth more
          than a price nobody asked for. */}
      <div className="mb-4 flex flex-col gap-4">
        <ChargesBackfillCard />
        <BillUnbilledCard />
      </div>

      <Card>
        <CardHeader title="The shipment" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Seller id"
              htmlFor="pp-seller"
              hint="Their rate card and discounts apply."
            >
              <Input
                id="pp-seller"
                value={form.sellerId}
                onChange={(e) => set('sellerId', e.target.value)}
              />
            </FormField>
            <FormField label="Destination pincode" htmlFor="pp-pin">
              <Input
                id="pp-pin"
                value={form.recipientPostalCode}
                onChange={(e) => set('recipientPostalCode', e.target.value)}
                placeholder="560001"
              />
            </FormField>
            <FormField label="Weight (grams)" htmlFor="pp-weight">
              <Input
                id="pp-weight"
                type="number"
                min={1}
                value={form.totalWeightGrams}
                onChange={(e) => set('totalWeightGrams', e.target.value)}
              />
            </FormField>
            <FormField label="Declared value (₹)" htmlFor="pp-value">
              <Input
                id="pp-value"
                type="number"
                min={0}
                value={form.declaredValueInr}
                onChange={(e) => set('declaredValueInr', e.target.value)}
              />
            </FormField>
            <FormField label="Payment" htmlFor="pp-mode">
              <Select
                id="pp-mode"
                value={form.paymentMode}
                onChange={(e) => set('paymentMode', e.target.value)}
              >
                <option value="PREPAID">Prepaid</option>
                <option value="COD">Cash on delivery</option>
              </Select>
            </FormField>
            {form.paymentMode === 'COD' && (
              <FormField
                label="COD amount (₹)"
                htmlFor="pp-cod"
                hint="What the customer pays the courier."
              >
                <Input
                  id="pp-cod"
                  type="number"
                  min={0}
                  value={form.codAmountInr}
                  onChange={(e) => set('codAmountInr', e.target.value)}
                />
              </FormField>
            )}
            <FormField
              label="Courier"
              htmlFor="pp-courier"
              hint="Optional — defaults to the system courier."
            >
              <Input
                id="pp-courier"
                value={form.courierCode}
                onChange={(e) => set('courierCode', e.target.value)}
                placeholder="delhivery"
              />
            </FormField>
          </div>

          <div className="mt-4">
            <Button
              size="md"
              disabled={!complete || preview.isPending}
              onClick={() =>
                preview.mutate({
                  sellerId: form.sellerId.trim(),
                  recipientPostalCode: form.recipientPostalCode.trim(),
                  paymentMode: form.paymentMode,
                  codAmountInr: Number(form.codAmountInr || 0),
                  declaredValueInr: Number(form.declaredValueInr),
                  totalWeightGrams: Number(form.totalWeightGrams),
                  ...(form.courierCode.trim() === ''
                    ? {}
                    : { courierCode: form.courierCode.trim() }),
                  ...(form.serviceType.trim() === ''
                    ? {}
                    : { serviceType: form.serviceType.trim() }),
                })
              }
            >
              {preview.isPending ? 'Calculating…' : 'Calculate'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {preview.error !== null && <ErrorNote message={serverVerdict(preview.error)} />}

      {r !== undefined && (
        <>
          {r.unresolved.length > 0 && (
            <Section
              title="Read this before quoting the number"
              subtitle="The engine answered, but some of what it needed was missing and it fell back."
            >
              <ul className="space-y-2">
                {r.unresolved.map((u) => (
                  <li key={u.reason} className="text-sm">
                    <span className="text-[var(--color-warn)]">
                      {FALLBACK_TEXT[u.reason] ?? u.reason.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    {u.detail !== undefined && (
                      <span className="text-text-faint"> ({u.detail})</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="How it resolved">
            <DescriptionList
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
          </Section>

          <Section title="The charge">
            <Table>
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
                <Tr>
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
          </Section>

          <Section
            title="Margin"
            subtitle="Internal only — never shown to a seller and never touches their wallet."
          >
            <DescriptionList
              items={[
                { label: 'We charge', value: <Money amount={r.margin.baseChargeInr} /> },
                {
                  label: 'Courier costs us',
                  value:
                    r.margin.costToSkydropInr === null ? (
                      <span className="text-text-faint">Not recorded on the rate card</span>
                    ) : (
                      <Money amount={r.margin.costToSkydropInr} />
                    ),
                },
                {
                  label: 'Margin',
                  value:
                    r.margin.marginInr === null ? (
                      <span className="text-text-faint">Unknown without a recorded cost</span>
                    ) : (
                      <Money
                        amount={r.margin.marginInr}
                        direction={Number(r.margin.marginInr) < 0 ? 'debit' : 'credit'}
                      />
                    ),
                },
              ]}
            />
          </Section>
        </>
      )}
    </div>
  );
}
