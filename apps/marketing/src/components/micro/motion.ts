/**
 * Shared motion plumbing for the micro-interaction library.
 *
 * Two questions every pattern asks, answered ONCE:
 *   - is motion reduced?  The OS preference, OR the gallery's simulator
 *     (`data-reduced="1"` on <html>, dev only) — so a reviewer can see the
 *     reduced answer without changing their OS.
 *   - how fast?  `--motion-slow` on <html> (1 = real time, 4 = the
 *     gallery's ×0.25 slow-mo). CSS reads it through `calc()`; JS timers
 *     go through `ms()`.
 */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.reduced === '1') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionSlow(): number {
  if (typeof window === 'undefined') return 1;
  const v = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--motion-slow'),
  );
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** A duration in real milliseconds, scaled by the slow-mo factor. */
export function ms(base: number): number {
  return Math.round(base * motionSlow());
}

export function sleep(base: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms(base)));
}
