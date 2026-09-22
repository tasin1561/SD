'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ms, reducedMotion } from '@/components/micro/motion';

export interface Beat {
  id: string;
  /** How long this beat holds before the next. */
  ms?: number;
  caption: string;
}

export interface BeatsOptions {
  beats: readonly Beat[];
  /** Pause after the last beat before looping. */
  restMs?: number;
  loop?: boolean;
  /** Near-viewport && active tab — the caller decides; false stops the clock. */
  enabled: boolean;
}

export interface Beats {
  index: number;
  count: number;
  beat: Beat | undefined;
  playing: boolean;
  reducedMotion: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  captionProps: { 'aria-live': 'polite'; 'aria-atomic': true };
}

let activeId = 0;
let nextId = 1;

/**
 * A sequencer for a vignette's storyboard. Timers chain off rAF (nothing
 * advances while the tab is hidden), ONE sequencer plays at a time
 * (starting one pauses whichever was playing), and under reduced motion
 * the beat index still advances — captions change, mocks jump to their
 * finished states — because the story is the content and only the motion
 * between states is what the preference asks to remove.
 */
export function useBeats({ beats, restMs = 2000, loop = true, enabled }: BeatsOptions): Beats {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const id = useRef(0);
  if (id.current === 0) id.current = nextId++;
  // Read AFTER mount: on the server this is false, and a client that read it
  // during render would hydrate `data-reduced` against different markup.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(reducedMotion());
  }, []);

  const pause = useCallback((): void => {
    setPlaying(false);
    if (activeId === id.current) activeId = 0;
  }, []);
  const play = useCallback((): void => {
    activeId = id.current;
    setPlaying(true);
  }, []);
  const toggle = useCallback((): void => (playing ? pause() : play()), [playing, pause, play]);

  useEffect(() => {
    if (!enabled) {
      // Leaving the viewport releases the stage too — the tour scrolling away
      // otherwise kept it, and the reseller mock further down never started.
      setPlaying(false);
      if (activeId === id.current) activeId = 0;
    } else if (activeId === 0) play();
  }, [enabled, play]);

  // Release the stage on unmount. Switching tour tabs unmounts the playing
  // vignette, and without this `activeId` kept pointing at it, so the NEXT
  // vignette saw the stage taken and never started — every tab after the
  // first sat on beat 1 with a play button (found capturing beats, final pass).
  useEffect(
    () => () => {
      if (activeId === id.current) activeId = 0;
    },
    [],
  );

  // Another sequencer taking the stage pauses this one; a stage that frees
  // up while this one is enabled and idle is claimed (the reseller mock came
  // into view while the tour still held it, and nothing re-asked).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (playing && activeId !== id.current) setPlaying(false);
      else if (!playing && enabled && activeId === 0) play();
    }, 250);
    return () => window.clearInterval(t);
  }, [playing, enabled, play]);

  useEffect(() => {
    if (!playing || beats.length === 0) return;
    const current = beats[index];
    const hold = ms(current?.ms ?? 1500) + (index === beats.length - 1 ? ms(restMs) : 0);
    let frame = 0;
    let cancelled = false;
    const started = performance.now();
    const tick = (): void => {
      if (cancelled) return;
      if (performance.now() - started >= hold) {
        if (index === beats.length - 1) {
          if (loop) setIndex(0);
          else setPlaying(false);
        } else setIndex(index + 1);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [playing, index, beats, loop, restMs]);

  return {
    index,
    count: beats.length,
    beat: beats[index],
    playing,
    reducedMotion: reduced,
    play,
    pause,
    toggle,
    captionProps: { 'aria-live': 'polite', 'aria-atomic': true },
  };
}
