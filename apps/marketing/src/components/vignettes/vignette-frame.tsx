'use client';

import { Pause, Play } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { Beats } from './use-beats';

/**
 * The ONE shell every vignette sits in: a 3D-ish frame, the caption strip
 * that reads the current beat aloud (`aria-live`), and a ≥44px pause/play.
 * The MOCK inside is `aria-hidden`; the same words are in the caption and
 * the checklist beside it, so nothing is conveyed by the picture alone.
 */
export function VignetteFrame({
  beats,
  title,
  hue,
  children,
}: {
  beats: Beats;
  title: string;
  hue: string;
  children: ReactNode;
}): ReactElement {
  return (
    <figure
      role="group"
      aria-label={title}
      className="overflow-hidden rounded-lg border shadow-[var(--shadow-hud)]"
      style={{ borderColor: `var(--${hue}-line)`, background: 'var(--surface-2)' }}
    >
      <div
        aria-hidden
        className="relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: `var(--${hue}-tint)` }}
      >
        {children}
      </div>
      <figcaption
        className="flex items-center justify-between gap-3 border-t px-3 py-2"
        style={{ borderColor: `var(--${hue}-line)` }}
      >
        <span className="text-[13px] text-fg-body" {...beats.captionProps}>
          {beats.beat?.caption ?? ''}
        </span>
        <span className="flex items-center gap-1">
          <span className="tabular text-[11px] text-fg-faint">
            {beats.index + 1}/{Math.max(1, beats.index + 1)}
          </span>
          <button
            type="button"
            onClick={beats.toggle}
            aria-label={beats.playing ? 'Pause' : 'Play'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg-strong"
          >
            {beats.playing ? (
              <Pause size={16} aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
