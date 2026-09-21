'use client';

import { useEffect, type ReactElement } from 'react';

/**
 * Writes `--scroll-progress` (0–1) on the header so the 3px corridor line
 * under it grows with the page. rAF-throttled; passive listener; nothing
 * re-renders — CSS reads the variable. Under reduced motion the line
 * still moves (it is position, not decoration), but no transition eases it.
 */
export function ScrollProgress(): ReactElement {
  useEffect(() => {
    let frame = 0;
    const el = document.querySelector<HTMLElement>('[data-site-header]');
    if (!el) return;
    const update = (): void => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.setProperty('--scroll-progress', p.toFixed(4));
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return <span aria-hidden className="scroll-progress" />;
}
