'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * SEC 06 — LOOKUP. Console prompt: `> TRACK` + AWB input, GETs to the
 * public tracking page.
 */
export function TrackWidget(): ReactElement {
  const [awb, setAwb] = useState('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const clean = awb.trim();
    if (!clean) return;
    window.location.assign(`https://track.skydrop.online?awb=${encodeURIComponent(clean)}`);
  };

  return (
    <section className="relative bg-surface py-14 lg:py-16 border-t border-line overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0 opacity-50" />
      <div className="relative max-w-4xl mx-auto px-5 sm:px-8">
        <div className="panel ticks p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <div className="telemetry text-fg-muted mb-2">sec 06 · lookup</div>
              <h2
                className="font-display font-semibold text-fg-strong"
                style={{ fontSize: 'clamp(1.4rem, 2.4vw, 1.9rem)', letterSpacing: '-0.02em' }}
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
                <span
                  aria-hidden
                  className="prompt-blink absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-sky"
                >
                  &gt;_
                </span>
                <input
                  id="awb-input"
                  type="text"
                  inputMode="text"
                  placeholder="TRACK <awb-number>"
                  autoComplete="off"
                  value={awb}
                  onChange={(e) => setAwb(e.target.value)}
                  className="w-full h-12 pl-12 pr-4 rounded-xl bg-surface border border-line text-fg-strong placeholder:text-fg-muted font-mono text-sm focus:outline-none focus:border-sky transition-colors"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-sky text-accent-fg font-medium text-sm hover:bg-sky-deep transition-colors"
              >
                Track <ArrowUpRight size={15} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
