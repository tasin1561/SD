'use client';

import type { ReactElement } from 'react';
import { CorridorConsole } from '@/components/landing/corridor-console';

/**
 * The hero's ART LAYER: the existing corridor map animation (owner,
 * 2026-09-21 — "use the existing dark and light theme map animations").
 * `CorridorConsole` is the 2D canvas the site has carried since Precision
 * Logistics: Dhaka → the Indian metros, parcels in flight, a radar sweep,
 * every colour read off the `--map-*` tokens so it follows the theme. It
 * starts on idle, pauses off-screen and when the tab is hidden, and draws
 * ONE frame under reduced motion. No poster, no gate, no lazy chunk: the
 * canvas is text-free, so it is never the LCP (the headline is).
 */
export function HeroArt(): ReactElement {
  return (
    <div className="hero-art" data-hero-art="corridor">
      <CorridorConsole />
    </div>
  );
}
