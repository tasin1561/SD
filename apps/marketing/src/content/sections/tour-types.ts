/**
 * The platform tour (section 13): one content file per vignette in
 * `src/content/sections/tour-<id>.ts`, re-exported by `site.ts`. Words are
 * lifted from the seller app's own screens (3A is the source of truth) —
 * never invented; any figure that reads as a business fact is `dummy()`.
 */
export type TourHue = 'teal' | 'violet' | 'saffron' | 'magenta' | 'green' | 'blue';

export interface TourBeat {
  id: string;
  /** How long the beat holds, ms (default 1500). */
  ms?: number;
  /** Read aloud in the frame's caption strip — plain sentence, sentence case. */
  caption: string;
}

export interface TourChecklistItem {
  id: string;
  /** The 3A bullet or its restatement — what the mock proves at this beat. */
  text: string;
  /** Which beat (id) makes this line current. */
  beat: string;
}

export interface TourVignetteContent {
  id: 'stock-in' | 'catalogue' | 'orders' | 'returns' | 'money' | 'team';
  hue: TourHue;
  /** Tab label in the tour's bead tablist (short). */
  tab: string;
  /** Plain heading over the vignette. */
  title: string;
  /** One-sentence promise under it. */
  promise: string;
  checklist: readonly TourChecklistItem[];
  beats: readonly TourBeat[];
}
