import type { ReactElement } from 'react';

/**
 * Every tour vignette is a client component with this ONE prop: the tour
 * shell decides `enabled` (near the viewport AND the active tab) and the
 * vignette hands it to `useBeats`. A vignette exports it as `default` plus
 * a string marker `__SD_VIGNETTE__ = '<id>'` that `check-bundle.mjs` uses
 * to find its chunk (≤ 5 KB gz each).
 */
export interface VignetteProps {
  enabled: boolean;
}
export type VignetteComponent = (props: VignetteProps) => ReactElement;
