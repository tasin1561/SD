'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { HeroArt } from './hero-island';
import { HeroActionCard } from './hero-action-card';
import type { Direction } from './direction';

/**
 * The hero's one piece of shared state — the DIRECTION the visitor wants
 * to ship — lives here so the quote and the booking form agree. The
 * headline and the trust row arrive as server-rendered children: they are
 * the LCP candidates and carry no JS of their own.
 */
export function HeroClient({
  headline,
  trust,
}: {
  headline: ReactNode;
  trust: ReactNode;
}): ReactElement {
  const [direction, setDirection] = useState<Direction>('out');
  return (
    <div className="hero__grid" data-direction={direction}>
      <div className="hero__art-slot">
        <HeroArt />
      </div>
      <div className="hero__copy">
        {headline}
        <HeroActionCard direction={direction} onDirectionChange={setDirection} />
        {trust}
      </div>
    </div>
  );
}
