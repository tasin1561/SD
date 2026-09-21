import type { VignetteComponent } from './contract';

/** What a vignette module exports: the component, and the marker `check-bundle.mjs` finds its chunk by. */
export interface VignetteModule {
  default: VignetteComponent;
  __SD_VIGNETTE__: string;
}

/**
 * Six vignettes, one lazy chunk each. The tour shell creates one
 * `dynamic()` per id, mounts ONLY the active tab's, and warms the next on
 * pointerenter/focus by calling its loader (`import()` caches the promise).
 * The shell READS `__SD_VIGNETTE__` into the DOM so the marker survives
 * tree-shaking and the ≤ 5 KB per-vignette gate can see each chunk.
 */
export const VIGNETTE_IDS = [
  'stock-in',
  'catalogue',
  'orders',
  'returns',
  'money',
  'team',
] as const;
export type VignetteId = (typeof VIGNETTE_IDS)[number];

export const VIGNETTE_LOADERS: Record<VignetteId, () => Promise<VignetteModule>> = {
  'stock-in': () => import('./stock-in'),
  catalogue: () => import('./catalogue'),
  orders: () => import('./orders'),
  returns: () => import('./returns'),
  money: () => import('./money'),
  team: () => import('./team'),
};
