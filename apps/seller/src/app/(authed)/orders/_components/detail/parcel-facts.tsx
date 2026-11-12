'use client';

import type { ReactElement, ReactNode } from 'react';
import { Money, type JourneyParcelView } from '@skydrop/ui/components';
import { useLocale, useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import { CopyButton } from './copy-button';
import { fmtDay, fmtFull, fmtWhen } from './format';

/** True when the courier's collectable differs from ours (a money disagreement). */
export function collectableMismatch(parcel: JourneyParcelView | null): boolean {
  return (
    parcel !== null &&
    parcel.paymentMode === 'COD' &&
    parcel.courierCollectableInr !== null &&
    parcel.courierCollectableInr !== parcel.collectableAmountInr
  );
}

interface Row {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly warn?: boolean;
}

/**
 * What the courier says the parcel IS — the seller-local copy of the shared
 * `ParcelFacts`: English-only strings, 11-12px text and `₹1050.00` template
 * strings became translated, 13px-plus, `Money`-formatted. Every branch and
 * field of the original is kept.
 *
 * The chargeable weight is shown beside the declared one whenever they
 * differ, because the gap is the whole story: the courier bills on theirs.
 * A disagreement about the collectable amount is stated, not hidden: silent,
 * it arrives weeks later as a remittance that is short.
 */
export function ParcelFacts({
  parcel,
  trackingUrlBase,
}: {
  readonly parcel: JourneyParcelView;
  /** Origin of the PUBLIC tracking site; passed in, never baked in. */
  readonly trackingUrlBase: string;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };
  const declared = parcel.declaredWeightGrams;
  const charged = parcel.chargeableWeightGrams;
  const differs = declared !== null && charged !== null && declared !== charged;
  const mismatch = collectableMismatch(parcel);
  const trackUrl =
    parcel.awbNumber === null ? null : `${trackingUrlBase.replace(/\/+$/, '')}/${parcel.awbNumber}`;

  const rows: Row[] = [
    {
      label: t('orderPage.parcel.billedWeight'),
      value:
        charged === null ? (
          <span className="cod-faint">{t('orderPage.parcel.notWeighed')}</span>
        ) : (
          <span className="sk-figure">{charged} g</span>
        ),
      ...(differs ? { hint: t('orderPage.parcel.youDeclared', { grams: String(declared) }) } : {}),
    },
    {
      label: t('orderPage.parcel.size'),
      value: parcel.dimensionsCm ?? <span className="cod-faint">—</span>,
    },
    {
      label: t('orderPage.parcel.expected'),
      value:
        parcel.expectedDeliveryAt === null ? (
          <span className="cod-faint">{t('orderPage.parcel.notStated')}</span>
        ) : (
          fmtDay(parcel.expectedDeliveryAt, locale)
        ),
    },
    {
      label: t('orderPage.parcel.collects'),
      value:
        // PREPAID collects nothing, and that is a fact rather than a
        // missing value — an em-dash here reads as "we do not know".
        parcel.paymentMode !== 'COD' ? (
          <span className="cod-faint">{t('orderPage.parcel.nothingPrepaid')}</span>
        ) : parcel.collectableAmountInr === null ? (
          <span className="cod-faint">—</span>
        ) : (
          <Money amount={parcel.collectableAmountInr} size="md" />
        ),
      ...(parcel.paymentMode === 'COD'
        ? {
            hint: mismatch
              ? richMessage(t('orderPage.parcel.mismatch'), {
                  amount: <Money amount={parcel.courierCollectableInr ?? '0'} />,
                })
              : t('orderPage.parcel.collectsHint'),
            warn: mismatch,
          }
        : {}),
    },
    {
      label: t('orderPage.parcel.pickedUp'),
      value:
        parcel.courierPickedUpAt === null ? (
          <span className="cod-faint">{t('orderPage.parcel.notYet')}</span>
        ) : (
          <time
            dateTime={parcel.courierPickedUpAt}
            title={fmtFull(parcel.courierPickedUpAt, locale)}
          >
            {fmtWhen(parcel.courierPickedUpAt, locale, words)}
          </time>
        ),
    },
    ...(parcel.courierStatusLine === null
      ? []
      : [
          {
            label: t('orderPage.parcel.latest'),
            value: parcel.courierStatusLine,
            ...(parcel.courierStatusLocation === null
              ? {}
              : { hint: parcel.courierStatusLocation }),
          } satisfies Row,
        ]),
    ...(parcel.courierSortCode === null
      ? []
      : [
          {
            // Opaque to us, and the first thing their support asks for.
            label: t('orderPage.parcel.routing'),
            value: <span className="sk-ident">{parcel.courierSortCode}</span>,
          } satisfies Row,
        ]),
  ];

  return (
    <>
      {/* The parcel's identity, above what it weighs. */}
      <div className="cod-parcel__id">
        <span className="cod-parcel__awblabel">{t('orderPage.parcel.awb')}</span>
        <span className="cod-parcel__awb">
          <span className="sk-ident cod-wrap">{parcel.awbNumber ?? parcel.shipmentNumber}</span>
          {parcel.awbNumber !== null ? (
            <CopyButton value={parcel.awbNumber} label={t('orderPage.parcel.awb')} />
          ) : null}
        </span>
        <span className="cod-parcel__courier">
          {parcel.courierCode}
          {parcel.courierAccountLabel == null || parcel.courierAccountLabel === ''
            ? null
            : ` · ${parcel.courierAccountLabel}`}
        </span>
      </div>
      {trackUrl !== null && (
        <div className="cod-parcel__share">
          <span className="cod-parcel__awblabel">{t('orderPage.parcel.share')}</span>
          <a href={trackUrl} target="_blank" rel="noreferrer" className="cod-parcel__url cod-wrap">
            {trackUrl}
          </a>
          <CopyButton value={trackUrl} label={t('orderPage.copyLink')} showLabel />
        </div>
      )}
      <dl className="cod-dl">
        {rows.map((r) => (
          <div key={r.label} className="cod-dl__row" data-warn={r.warn === true ? '1' : undefined}>
            <dt>{r.label}</dt>
            <dd>
              {r.value}
              {r.hint !== undefined && <span className="cod-dl__hint">{r.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
