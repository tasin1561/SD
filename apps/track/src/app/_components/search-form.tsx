'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactElement } from 'react';

export function SearchForm(): ReactElement {
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
          AWB number
        </label>
        <input
          id="awb"
          type="text"
          autoComplete="off"
          required
          value={awb}
          onChange={(e) => setAwb(e.target.value)}
          placeholder="e.g. DL12345678"
          className="w-full px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm focus:border-accent focus:outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        className="w-full px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
      >
        Track
      </button>
    </form>
  );
}
