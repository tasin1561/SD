/**
 * When to read a parcel's WhatsApp window next. Pure.
 *
 *  - A read that finds NEW bubbles from cold schedules the next one in
 *    5 minutes; consecutive reads that keep finding new ones double the
 *    gap (5, 10, 20, 40, ...). A customer reply resets it to 5 minutes.
 *  - A read with nothing new doubles the gap too.
 *  - The hot window ends 3 hours after the last new bubble, and a gap
 *    that reaches 6 hours is no longer "hot": either way the parcel goes
 *    back to the cold 6-hour debounce (gapMs null).
 */
export const HOT_BASE_MS = 5 * 60 * 1000;
export const COLD_MS = 6 * 60 * 60 * 1000;
export const HOT_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface CadenceState {
  /** Current hot gap; null = cold. */
  readonly gapMs: number | null;
  readonly lastNewAt: Date | null;
}

export interface CadenceNext extends CadenceState {
  readonly nextReadAt: Date;
  readonly hot: boolean;
}

export function nextCadence(input: {
  readonly now: Date;
  readonly prev: CadenceState;
  readonly foundNew: boolean;
  /** A bubble from the customer's side. Only true when the window tells sides apart. */
  readonly replied?: boolean;
}): CadenceNext {
  const { now, prev, foundNew } = input;
  const lastNewAt = foundNew ? now : prev.lastNewAt;
  const cold = (): CadenceNext => ({
    gapMs: null,
    lastNewAt,
    nextReadAt: new Date(now.getTime() + COLD_MS),
    hot: false,
  });

  let gap: number;
  if (foundNew) {
    gap = input.replied === true || prev.gapMs === null ? HOT_BASE_MS : prev.gapMs * 2;
  } else {
    if (prev.gapMs === null) return cold();
    gap = prev.gapMs * 2;
  }
  const windowOpen = lastNewAt !== null && now.getTime() - lastNewAt.getTime() < HOT_WINDOW_MS;
  if (gap >= COLD_MS || !windowOpen) return cold();
  return { gapMs: gap, lastNewAt, nextReadAt: new Date(now.getTime() + gap), hot: true };
}
