'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { mountHeroScene, type Direction, type SceneHandle } from './scene-core';

/**
 * The React face of the scene — the lazy chunk's default export. It owns
 * nothing but the host element and forwards `direction` changes to the
 * running scene; the scene itself is plain TypeScript in `scene-core.ts`.
 */
export default function HeroScene({
  direction,
  poster = false,
  onReady,
  onFallback,
  onStats,
  alt,
}: {
  direction: Direction;
  poster?: boolean;
  onReady?: () => void;
  onFallback?: () => void;
  onStats?: (s: { calls: number; triangles: number }) => void;
  alt: string;
}): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const dirRef = useRef(direction);
  dirRef.current = direction;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const h = mountHeroScene(el, {
      direction: dirRef.current,
      poster,
      // Poster mode renders synchronously inside mountHeroScene, so `h` is
      // not assigned yet when this fires — the stats come WITH the call.
      onReady: (stats) => {
        onReady?.();
        onStats?.(stats);
      },
      onFallback: () => onFallback?.(),
    });
    handle.current = h;
    return () => {
      h.dispose();
      handle.current = null;
    };
    // Mount once; direction changes go through setDirection below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poster]);
  useEffect(() => {
    handle.current?.setDirection(direction);
  }, [direction]);
  return <div ref={host} className="hero-scene-host" role="img" aria-label={alt} data-scene-host />;
}
