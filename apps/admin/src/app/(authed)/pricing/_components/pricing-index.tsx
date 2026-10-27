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
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

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
const FALLBACK_TEXT = (t: Translate<MessageKey>): Record<string, string> => ({
  NO_RATE_CARD: t('pricingPricingIndex.noRateCardAppliesTo'),
  NO_RATE_CARD_ITEM: t('pricingPricingIndex.noRateExistsForThis'),
  ZONE_FALLBACK_DEFAULT: t('pricingPricingIndex.theDestinationPincodeDidNot'),
  NO_COURIER: t('pricingPricingIndex.noCourierResolvedTheDefault'),
  NO_GST_RATE: t('pricingPricingIndex.noGstRateConfiguredThe'),
  TIERED_SURCHARGE_NOT_IMPLEMENTED: t('pricingPricingIndex.aTieredSurchargeRuleApplies'),
});

export function PricingIndex(): ReactElement {
  const t = useT();
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
        title={t('pricingPricingIndex.pricingPreview')}
        subtitle={t('pricingPricingIndex.whatTheEngineWouldCharge')}
      />

      {/* Above the calculator: a shipment nobody priced is worth more
          than a price nobody asked for. */}
      <div className="mo-stack">
        <ChargesBackfillCard />
        <BillUnbilledCard />
      </div>

      <MoSection title={t('pricingPricingIndex.theShipment')}>
        <div className="mo-fields" data-cols="2">
          <TextField
            id="pp-seller"
            label={t('pricingPricingIndex.clientId')}
            hint={t('pricingPricingIndex.theirRateCardAndDiscounts')}
            value={form.sellerId}
            onChange={(e) => set('sellerId', e.target.value)}
          />
          <TextField
            id="pp-pin"
            label={t('pricingPricingIndex.destinationPincode')}
            value={form.recipientPostalCode}
            onChange={(e) => set('recipientPostalCode', e.target.value)}
            placeholder="560001"
          />
          <TextField
            id="pp-weight"
            label={t('pricingPricingIndex.weightGrams')}
            type="number"
            min={1}
            value={form.totalWeightGrams}
            onChange={(e) => set('totalWeightGrams', e.target.value)}
          />
          <TextField
            id="pp-value"
            label={t('pricingPricingIndex.declaredValue')}
            type="number"
            min={0}
            value={form.declaredValueInr}
            onChange={(e) => set('declaredValueInr', e.target.value)}
          />
          <Select
            id="pp-mode"
            label={t('pricingPricingIndex.payment')}
            value={form.paymentMode}
            onChange={(e) => set('paymentMode', e.target.value)}
          >
            <option value="PREPAID">{t('pricingPricingIndex.prepaid')}</option>
            <option value="COD">{t('pricingPricingIndex.cashOnDelivery')}</option>
          </Select>
          {form.paymentMode === 'COD' && (
            <TextField
              id="pp-cod"
              label={t('pricingPricingIndex.codAmount')}
              hint={t('pricingPricingIndex.whatTheCustomerPaysThe')}
              type="number"
              min={0}
              value={form.codAmountInr}
              onChange={(e) => set('codAmountInr', e.target.value)}
            />
          )}
          <TextField
            id="pp-courier"
            label={t('pricingPricingIndex.courier')}
            hint={t('pricingPricingIndex.optionalDefaultsToTheSystem')}
            value={form.courierCode}
            onChange={(e) => set('courierCode', e.target.value)}
            placeholder="delhivery"
          />
        </div>

        <div className="mo-row">
          <AsyncButton
            size="md"
            labels={{
              idle: t('pricingPricingIndex.calculate'),
              busy: t('pricingPricingIndex.calculating'),
              done: t('pricingPricingIndex.calculated'),
            }}
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
              title={t('pricingPricingIndex.readThisBeforeQuotingThe')}
            >
              <p>{t('pricingPricingIndex.theEngineAnsweredButSome')}</p>
              <ul className="pr-fallbacks">
                {r.unresolved.map((u) => (
                  <li key={u.reason}>
                    <span className="mo-warn">
                      {FALLBACK_TEXT(t)[u.reason] ?? u.reason.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    {u.detail !== undefined && <span className="mo-faint"> ({u.detail})</span>}
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          <MoSection title={t('pricingPricingIndex.howItResolved')}>
            <Facts
              items={[
                { label: t('pricingPricingIndex.rateCard'), value: r.rateCardCode ?? '—' },
                { label: t('pricingPricingIndex.courier'), value: r.courierCode ?? '—' },
                { label: t('pricingPricingIndex.service'), value: r.serviceType },
                { label: t('pricingPricingIndex.zone'), value: r.zone },
                {
                  label: t('pricingPricingIndex.chargeableWeight'),
                  value: <Num value={r.chargeableWeightGrams} suffix="g" />,
                },
                {
                  label: t('pricingPricingIndex.clientDiscount'),
                  value:
                    r.sellerDiscountPercent === null
                      ? t('pricingPricingIndex.none')
                      : `${r.sellerDiscountPercent}%`,
                },
              ]}
            />
          </MoSection>

          <MoSection title={t('pricingPricingIndex.theCharge')} flush>
            <Table caption={t('pricingPricingIndex.theCharge')}>
              <THead>
                <Tr>
                  <Th>{t('pricingPricingIndex.line')}</Th>
                  <Th align="right">{t('pricingPricingIndex.amount')}</Th>
                </Tr>
              </THead>
              <TBody>
                <Tr>
                  <Td>{t('pricingPricingIndex.baseShipping')}</Td>
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
                  <Td>{t('pricingPricingIndex.gstAt', { gstRatePercent: r.gstRatePercent })}</Td>
                  <Td align="right">
                    <Money amount={r.gstAmountInr} />
                  </Td>
                </Tr>
                <Tr className="mo-total-row">
                  <Td>
                    <strong>{t('pricingPricingIndex.total')}</strong>
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
            title={t('pricingPricingIndex.margin')}
            note={t('pricingPricingIndex.internalOnlyNeverShownTo')}
          >
            <Facts
              items={[
                {
                  label: t('pricingPricingIndex.weCharge'),
                  value: <Money amount={r.margin.baseChargeInr} />,
                },
                {
                  label: t('pricingPricingIndex.courierCostsUs'),
                  value:
                    r.margin.costToSkydropInr === null ? (
                      <span className="mo-faint">
                        {t('pricingPricingIndex.notRecordedOnTheRate')}
                      </span>
                    ) : (
                      <Money amount={r.margin.costToSkydropInr} />
                    ),
                },
                {
                  label: t('pricingPricingIndex.margin'),
                  value:
                    r.margin.marginInr === null ? (
                      <span className="mo-faint">
                        {t('pricingPricingIndex.unknownWithoutARecordedCost')}
                      </span>
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
