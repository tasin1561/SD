'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { HeroArt } from './hero-island';
import { HeroActionCard, HeroSampleCard } from './hero-action-card';
import { setHeroVisible, useHeroTab } from '@/lib/hero-tab';
import type { Direction } from './direction';

/**
 * The hero's shared state — the DIRECTION the visitor wants to ship —
 * lives here so the map, the quote and the booking form agree. The
 * headline and the trust row arrive as server-rendered children: they
 * are the LCP candidates and carry no JS of their own. The map draws its
 * city names only from `lg` up; on a phone it sits behind the copy and a
 * name showing through a headline is noise.
 */
export function HeroClient({
  headline,
  trust,
}: {
  headline: ReactNode;
  trust: ReactNode;
}): ReactElement {
  const [direction, setDirection] = useState<Direction>('out');
  const [labels, setLabels] = useState(true);
  const tab = useHeroTab();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = (): void => setLabels(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // The bottom bar's bead follows the open tab while the hero is on
  // screen and rests on nothing once it has scrolled away.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setHeroVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      setHeroVisible(true);
    };
  }, []);

  return (
    <div ref={root} className="hero__grid" data-direction={direction}>
      <div className="hero__art-slot">
        <HeroArt direction={direction} labels={labels} />
        {tab === 'track' ? <HeroSampleCard className="hero__sample-overlay" /> : null}
      </div>
      <div className="hero__copy">
        {headline}
        <HeroActionCard direction={direction} onDirectionChange={setDirection} />
        {trust}
      </div>
    </div>
  );
}
