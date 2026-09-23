'use client';

import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import './sign-in-map.css';

/**
 * LazyCorridorMap — the sign-in screen's background map, loaded LAZILY.
 *
 * The map is full-detail Natural Earth coastline (≈ 32 KB of geometry,
 * ≈ 11 KB gzipped with its renderer) and is decoration: nothing on the
 * sign-in form depends on it. So the form ships without it and is
 * interactive at once; after first paint, when the browser is idle, this
 * loader imports `./corridor-map` (its own chunk) and the canvas fades in.
 * No poster: until then the frame shows the plain background gradient.
 *
 * Recorded budget exception (owner, 2026-09-23): the map chunk is over the
 * 3 KB per-primitive budget on purpose — full detail kept, cost moved off
 * the critical path.
 */
type MapComponent = ComponentType<{ readonly className?: string }>;

export function LazyCorridorMap({ className }: { readonly className?: string }): ReactElement {
  const [Map, setMap] = useState<MapComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void import('./corridor-map').then((m) => {
        if (!cancelled) setMap(() => m.CorridorMap);
      });
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback !== undefined) {
      const id = w.requestIdleCallback(load, { timeout: 2000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(load, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  return (
    <span className={className} data-map-ready={Map !== null || undefined} aria-hidden="true">
      {Map !== null ? <Map className="sk-lazymap__canvas" /> : null}
    </span>
  );
}
