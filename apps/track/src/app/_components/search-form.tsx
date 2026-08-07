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
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="awb" className="telemetry block text-fg-muted mb-2">
          {t(locale, 'awbLabel')}
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="prompt-blink absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-sky"
          >
            &gt;_
          </span>
          <input
            id="awb"
            type="text"
            autoComplete="off"
            required
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            placeholder={t(locale, 'awbPlaceholder')}
            // 16px on touch, not `text-sm`: mobile Safari zooms the
            // page when a focused input is under 16px and does not zoom
            // back out — on a public tracking page the first thing a
            // customer does is tap this field.
            className="bg-[var(--surface-input)] border-[var(--border-control)] text-fg-strong placeholder:text-fg-muted h-12 w-full rounded-xl border pr-4 pl-12 font-mono text-base transition-colors focus:outline-none focus-visible:border-[var(--focus-ring)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:text-sm"
          />
        </div>
      </div>
      <button
        type="submit"
        className="w-full h-12 rounded-xl bg-sky text-accent-fg text-sm font-medium hover:bg-sky-deep transition-colors"
      >
        {t(locale, 'trackButton')}
      </button>
    </form>
  );
}
