/**
 * Read design tokens off `:root` and be told when the theme changes.
 *
 * Generalises the 2D console's `readColors`: the SAME two triggers every
 * theme-reactive canvas needs — the `data-theme` attribute the toggle
 * writes, and the OS preference flipping under an UNPINNED page (which
 * the console missed, so it stayed dark while the page went light).
 *
 * Scene tokens are plain hex plus separate numeric alphas on purpose:
 * `THREE.Color.setStyle` ignores an rgba() alpha.
 */
export function readTokens<K extends string>(
  names: readonly K[],
  fallback: Record<K, string>,
): Record<K, string> {
  const cs = getComputedStyle(document.documentElement);
  const out = { ...fallback };
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim();
    if (v) out[n] = v;
  }
  return out;
}

/** Calls `cb` on any theme change; returns the unsubscribe. */
export function subscribeThemeTokens(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener('change', cb);
  };
}
