'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Chip, LiveDot } from './chrome';

/**
 * SEC 06 — LOOKUP.
 *
 * A console prompt for a waybill number, handing off to the public
 * tracking page. It sits between the comparison and the FAQ because
 * that is where a visitor who is already a CUSTOMER of one of our
 * sellers lands — they followed a link from a delivery message and do
 * not care about any of the rest of this page. Making them read to the
 * footer to find it would be a small daily cruelty.
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
    <section className="relative overflow-hidden border-t border-line bg-surface py-12 lg:py-16">
      <div aria-hidden className="grid-bg absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-5xl px-5 sm:px-6">
        <div className="overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[var(--shadow-2)]">
          <div className="panel-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
            <span className="mono-caps flex items-center gap-2 text-fg-muted">
              <LiveDot />
              <span className="text-fg-strong">sec 06</span>
              <span aria-hidden className="text-fg-faint">
                {'//'}
              </span>
              <span>parcel lookup</span>
            </span>
            <Chip>no sign-in needed</Chip>
          </div>

          <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
            <div className="min-w-0">
              <h2 className="text-[19px] font-bold text-fg-strong sm:text-[22px]">
                Already expecting a parcel?
              </h2>
              <p className="mt-1.5 m-0 max-w-[44ch] text-[14px] leading-relaxed text-fg-body">
                Enter the waybill number from your delivery message. The tracking page reads in
                English and हिंदी.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex w-full flex-col gap-2.5 sm:flex-row lg:w-auto lg:min-w-[420px]"
              role="search"
              aria-label="Track a parcel by waybill number"
            >
              <label htmlFor="awb-input" className="sr-only">
                Waybill number
              </label>
              <div className="relative flex-1">
                <Search
                  size={15}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
                />
                <input
                  id="awb-input"
                  type="text"
                  inputMode="text"
                  placeholder="Waybill number"
                  autoComplete="off"
                  value={awb}
                  onChange={(e) => setAwb(e.target.value)}
                  className="h-11 w-full rounded-sm border border-border-control bg-surface-input pl-9 pr-3 font-mono text-[14px] text-fg-strong transition-colors placeholder:font-sans placeholder:text-fg-faint focus:border-sky focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-sm bg-accent-fill px-5 text-[14px] font-semibold text-accent-fg transition-colors hover:bg-accent-fill-hover"
              >
                Track
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
