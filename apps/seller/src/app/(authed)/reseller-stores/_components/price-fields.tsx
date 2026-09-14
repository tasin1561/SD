'use client';

import type { ReactElement } from 'react';
import { FormField, Input } from '@skydrop/ui/components';

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
  const field = (key: keyof PriceDraft, label: string, hint?: string): ReactElement => (
    <FormField label={label} htmlFor={`${idPrefix}-${key}`} {...(hint ? { hint } : {})}>
      <Input
        id={`${idPrefix}-${key}`}
        inputMode="decimal"
        disabled={disabled}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </FormField>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {field('transferPriceInr', 'Transfer price (₹)', 'What the store pays you per unit.')}
      {field('suggestedRetailInr', 'Suggested retail (₹)')}
      {field('minRetailInr', 'Lowest retail (₹)')}
      {field('maxRetailInr', 'Highest retail (₹)')}
    </div>
  );
}
