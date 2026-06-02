'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

export function SearchForm({ locale }: { readonly locale: Locale }): ReactElement {
  const router = useRouter();
  const [awb, setAwb] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = awb.trim();
    if (!trimmed) return;
    router.push(`/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="awb" className="block text-text-muted text-xs mb-1">
          {t(locale, 'awbLabel')}
        </label>
        <input
          id="awb"
          type="text"
          autoComplete="off"
          required
          value={awb}
          onChange={(e) => setAwb(e.target.value)}
          placeholder={t(locale, 'awbPlaceholder')}
          className="w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        className="w-full px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
      >
        {t(locale, 'trackButton')}
      </button>
    </form>
  );
}
