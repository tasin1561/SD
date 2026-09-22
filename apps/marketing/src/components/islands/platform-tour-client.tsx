'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { VIGNETTE_IDS, VIGNETTE_LOADERS, type VignetteId } from '@/components/vignettes/registry';
import type { VignetteProps } from '@/components/vignettes/contract';
import { tour } from '@/content/sections/tour';

/** `check-bundle.mjs` finds the platform island's chunk by this string; it must stay referenced. */
export const __SD_ISLAND_PLATFORM__ = 'platform-tour';

const isId = (v: string): v is VignetteId => (VIGNETTE_IDS as readonly string[]).includes(v);

/** One `dynamic()` per vignette at module scope — created once, mounted only when active. */
const VIGNETTES = Object.fromEntries(
  VIGNETTE_IDS.map((id) => [
    id,
    dynamic(
      () =>
        VIGNETTE_LOADERS[id]().then((m) => {
          const C = m.default;
          const marker = m.__SD_VIGNETTE__;
          return {
            default: (p: VignetteProps): ReactElement => (
              <div data-vignette={marker}>
                <C {...p} />
              </div>
            ),
          };
        }),
      { loading: () => <div className="tour__skeleton" aria-hidden /> },
    ),
  ]),
) as Record<VignetteId, (p: VignetteProps) => ReactElement>;

/**
 * SECTION 13's island: six bead tabs, one heading + promise per tab, and
 * ONLY the active vignette mounted (its own chunk). `enabled` = near the
 * viewport AND the active tab, so at most one sequencer runs. A deep link
 * `#platform-<id>` opens that tab. Hovering or focusing a tab warms its
 * chunk so the switch is instant.
 */
export function PlatformTourClient(): ReactElement {
  const [active, setActive] = useState<VignetteId>('stock-in');
  const [near, setNear] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // `#platform-<id>` opens that tab — on mount AND on every hash change, so
  // the header's Platform menu rows (and a shared link) land on the right
  // scene while the section is already on screen.
  useEffect(() => {
    const fromHash = (): void => {
      const m = /^#platform-([a-z-]+)$/.exec(window.location.hash);
      if (m && m[1] && isId(m[1])) setActive(m[1]);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), {
      rootMargin: '300px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const content = tour.find((t) => t.id === active) ?? tour[0];
  const Active = VIGNETTES[active];
  const warm = (id: string): void => {
    if (isId(id)) void VIGNETTE_LOADERS[id]();
  };

  return (
    <div ref={root} className="tour" data-island={__SD_ISLAND_PLATFORM__} data-hue={content?.hue}>
      <div
        className="tour__tabs"
        onPointerOver={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')?.dataset.tab;
          if (id) warm(id);
        }}
      >
        <LiquidBead
          label="Platform tour"
          value={active}
          onChange={(id) => {
            if (isId(id)) setActive(id);
          }}
          tabs={tour.map((t) => ({ id: t.id, label: t.tab, hue: t.hue }))}
        />
      </div>
      {content ? (
        <div key={content.id} className="tour__head">
          <h3 className="tour__title">{content.title}</h3>
          <p className="tour__promise">{content.promise}</p>
        </div>
      ) : null}
      <div className="tour__stage" id={`platform-${active}`}>
        <Active enabled={near} />
      </div>
    </div>
  );
}
