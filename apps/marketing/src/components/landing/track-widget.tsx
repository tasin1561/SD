'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';

/**
 * Slim dark band. AWB input → GETs to public tracking page.
 * Client-side so we can validate + build the URL; navigation
 * is a plain <a> when static export doesn't allow useRouter push.
 */
export function TrackWidget(): ReactElement {
  const [awb, setAwb] = useState('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const clean = awb.trim();
    if (!clean) return;
    window.location.assign(
      `https://track.skydrop.online?awb=${encodeURIComponent(clean)}`,
    );
  };

  return (
    <section className="bg-ink text-white py-14 lg:py-16 border-y border-[var(--border-dark)]">
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-[var(--border-dark)] px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-[var(--muted-dark)] mb-3">
              For customers
            </div>
            <h2
              className="font-display font-semibold text-white"
              style={{ fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em' }}
            >
              Already expecting a parcel?
            </h2>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex w-full lg:w-auto lg:min-w-[440px] flex-col sm:flex-row gap-3"
            role="search"
            aria-label="Track a parcel by AWB number"
          >
            <label htmlFor="awb-input" className="sr-only">
              AWB number
            </label>
            <div className="relative flex-1">
              <Search
                size={16}
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-dark)]"
              />
              <input
                id="awb-input"
                type="text"
                inputMode="text"
                placeholder="Enter AWB number"
                autoComplete="off"
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                className="w-full h-12 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-[var(--border-dark)] text-white placeholder:text-[var(--muted-dark)] font-mono text-sm focus:outline-none focus:border-sky/60 transition-colors"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-sky text-ink font-medium text-sm hover:bg-white transition-colors"
            >
              Track <ArrowUpRight size={15} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
