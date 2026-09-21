'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { MICRO_REGISTRY } from './registry';

/**
 * The motion gallery — every pattern, driven through its states, with a
 * theme switch, a reduced-motion SIMULATOR (`data-reduced` on <html>,
 * which the hooks and every pattern's CSS respect — dev only) and a ×0.25
 * slow-mo (`--motion-slow`, read by CSS through calc() and by JS timers).
 * Not by wrapping columns in scoped token copies: that would be a fifth
 * palette copy.
 */
export function MotionGallery(): ReactElement {
  const [reduced, setReduced] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (reduced) root.dataset.reduced = '1';
    else delete root.dataset.reduced;
    root.style.setProperty('--motion-slow', slow ? '4' : '1');
  }, [reduced, slow]);
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
            Skydrop marketing rebuild · Phase 2 · dev route
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Motion gallery — 15 patterns + 2 extras</h1>
          <p className="mt-2 max-w-[70ch] text-sm text-fg-muted">
            Each demo runs a FAKE task so the busy state can be seen; on the page a success frame
            only ever follows the real result (`useAsyncState`). Links navigate at once and show
            hover feedback only.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-body">
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => setReduced(e.target.checked)}
            />{' '}
            simulate reduced motion
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-body">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />{' '}
            slow-mo ×0.25
          </label>
          <ThemeToggle />
        </div>
      </header>
      {MICRO_REGISTRY.map((m) => (
        <section
          key={m.id}
          id={m.id}
          data-pattern={m.id}
          className="rounded-lg border border-line bg-surface-2 p-5"
        >
          <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-fg-strong">
              <span className="tabular mr-2 text-fg-faint">
                {Number.isInteger(m.n)
                  ? String(m.n).padStart(2, '0')
                  : `${String(Math.floor(m.n)).padStart(2, '0')}b`}
              </span>
              {m.name}
            </h2>
            <p className="text-xs text-fg-muted">{m.where}</p>
          </header>
          <m.Demo />
        </section>
      ))}
    </main>
  );
}
