'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Should a looping animation on this element be running right now?
 *
 * True only while the element is on screen AND the tab is visible — the
 * contract's "loops pause off-screen and on a hidden tab", answered once
 * for every primitive that has a loop (the timeline's current-step pulse,
 * the empty state's bob, the sign-in map). The caller maps it to
 * `data-play="1|0"`, and its CSS sets `animation-play-state: paused` on
 * the `0` side, so a paused loop costs nothing.
 *
 * Starts FALSE, so a server render and the first client paint carry a
 * paused loop; the observer turns it on once the element is actually
 * seen. Where IntersectionObserver is missing it assumes visible.
 */
export function useLoopVisible(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  const [tabShown, setTabShown] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      setInView(entries.some((e) => e.isIntersecting));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    const sync = (): void => setTabShown(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return inView && tabShown;
}
