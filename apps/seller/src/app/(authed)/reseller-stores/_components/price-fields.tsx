'use client';

import type { ReactElement } from 'react';
import { TextField } from '@skydrop/ui/app/text-field';
import './reseller-stores.css';
import { useT } from '@/i18n/client';

/** The four figures of a reseller price, as the form edits them (rupees, text). */
export interface PriceDraft {
  transferPriceInr: string;
  minRetailInr: string;
  maxRetailInr: string;
  suggestedRetailInr: string;
}

export const EMPTY_PRICE: PriceDraft = {
  transferPriceInr: '',
  minRetailInr: '',
  maxRetailInr: '',
  suggestedRetailInr: '',
};

export function draftFrom(
  p: {
    transferPriceInr: string;
    minRetailInr: string | null;
    maxRetailInr: string | null;
    suggestedRetailInr: string | null;
  } | null,
): PriceDraft {
  if (p === null) return { ...EMPTY_PRICE };
  return {
    transferPriceInr: p.transferPriceInr,
    minRetailInr: p.minRetailInr ?? '',
    maxRetailInr: p.maxRetailInr ?? '',
    suggestedRetailInr: p.suggestedRetailInr ?? '',
  };
}

/** Blank → null. No rule is checked here: the server decides (FE-2). */
export function priceBody(d: PriceDraft): {
  transferPriceInr: string;
  minRetailInr: string | null;
  maxRetailInr: string | null;
  suggestedRetailInr: string | null;
} {
  const v = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  return {
    transferPriceInr: d.transferPriceInr.trim(),
    minRetailInr: v(d.minRetailInr),
    maxRetailInr: v(d.maxRetailInr),
    suggestedRetailInr: v(d.suggestedRetailInr),
  };
}

/** Transfer price + retail range + suggestion, in rupees. */
export function PriceFields({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: {
  idPrefix: string;
  value: PriceDraft;
  onChange: (next: PriceDraft) => void;
  disabled?: boolean;
}): ReactElement {
  const t = useT();
  const field = (key: keyof PriceDraft, label: string, hint?: string): ReactElement => (
    <TextField
      id={`${idPrefix}-${key}`}
      label={label}
      {...(hint ? { hint } : {})}
      inputMode="decimal"
      inputClassName="sk-figure"
      disabled={disabled}
      value={value[key]}
      onChange={(e) => onChange({ ...value, [key]: e.target.value })}
    />
  );
  return (
    <div className="rs-grid-2">
      {field(
        'transferPriceInr',
        t('resellerStores.transferPriceInr'),
        t('resellerStores.whatTheStorePaysYouPerUnit'),
      )}
      {field('suggestedRetailInr', t('resellerStores.suggestedRetailInr'))}
      {field('minRetailInr', t('resellerStores.lowestRetailInr'))}
      {field('maxRetailInr', t('resellerStores.highestRetailInr'))}
    </div>
  );
}
