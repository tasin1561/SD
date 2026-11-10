'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The warehouse's two scan sounds — ONE pair, shared by every bench.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * The benches are worked by amateurs who may read no English at all, and
 * whose eyes are on the item in their hands rather than on the monitor.
 * Sound is the one feedback channel that needs neither literacy nor eye
 * contact: a packer with their back to the screen still knows whether the
 * last scan was taken. So every accepted scan plays the ACCEPTED sound and
 * every refusal — including the ones that only set an inline message —
 * plays the REFUSED one. Silence is never a scan's answer.
 *
 * ── ONE PAIR, EVERYWHERE ─────────────────────────────────────────────
 * A different beep per screen would be worse than none: the packer learns
 * the pair at one bench and has to carry it to the next. Hence a single
 * module rather than a per-screen helper, and a single mute setting per
 * DEVICE rather than per screen — nobody should have to mute six benches.
 * It lives in `apps/admin/src/lib` because only the admin warehouse
 * consoles scan; putting it in `@skydrop/ui` would restart every app on
 * deploy for a thing no other app uses.
 *
 * ── THE TWO SOUNDS ───────────────────────────────────────────────────
 * They must be tellable apart across a noisy room, so they differ in
 * pitch, direction, length AND timbre — not in volume:
 *   accepted  two short bright RISING sine notes (~110 ms total)
 *   refused   a long low buzzing FALLING pair on a sawtooth (~520 ms)
 * Generated with the Web Audio API — a couple of oscillators. No audio
 * file: nothing to ship, nothing for the CSP to block, no fetch on a
 * warehouse connection.
 *
 * ── SOUND IS NEVER THE ONLY SIGNAL ───────────────────────────────────
 * It accompanies the on-screen state and the error dialog; it never
 * replaces them. A deaf packer loses nothing, and a muted station still
 * shows the mute state so nobody concludes the feature is broken.
 *
 * ── IT CAN NEVER BREAK A SCAN ────────────────────────────────────────
 * Browsers refuse audio before the first user gesture, a locked-down
 * device may refuse it always, and `AudioContext` can throw on
 * construction. Every path here is wrapped and returns void: the scan
 * handler must not be able to fail because of a beep.
 */

const MUTE_KEY = 'skydrop.warehouse.scanSound.muted';

/** One context for the whole console; created on the first gesture. */
let ctx: AudioContext | null = null;
let unavailable = false;

type Ctor = new () => AudioContext;

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create or resume the context. Safe to call on every gesture and every
 * scan; cheap after the first success, and it gives up permanently rather
 * than retrying a browser that has said no.
 */
export function primeScanSound(): void {
  if (unavailable) return;
  try {
    if (ctx === null) {
      const Ctor = audioCtor();
      if (Ctor === null) {
        unavailable = true;
        return;
      }
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    unavailable = true;
  }
}

/** Everything mounted on the page follows one mute setting. */
const listeners = new Set<(muted: boolean) => void>();

/**
 * Only set when `localStorage` REFUSED the write (private mode can throw on
 * access alone). Remembering the choice across visits is a nicety; muting
 * the room right now is the point, so the session keeps it in memory.
 */
let memoryOverride: boolean | null = null;

function currentMuted(): boolean {
  if (memoryOverride !== null) return memoryOverride;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(next: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    memoryOverride = null;
  } catch {
    memoryOverride = next;
  }
  for (const fn of listeners) fn(next);
}

interface Note {
  /** Hz at the start of the note. */
  readonly from: number;
  /** Hz at the end — a glide, which is what makes the shape obvious. */
  readonly to: number;
  /** Seconds from the start of the sound. */
  readonly at: number;
  readonly seconds: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

const ACCEPTED: readonly Note[] = [
  { from: 880, to: 988, at: 0, seconds: 0.055, type: 'sine', gain: 0.22 },
  { from: 1318, to: 1480, at: 0.055, seconds: 0.075, type: 'sine', gain: 0.22 },
];

const REFUSED: readonly Note[] = [
  { from: 196, to: 150, at: 0, seconds: 0.26, type: 'sawtooth', gain: 0.16 },
  { from: 150, to: 104, at: 0.27, seconds: 0.26, type: 'sawtooth', gain: 0.16 },
];

/** Play a tiny score. Never throws, never awaits, never blocks a scan. */
function play(score: readonly Note[]): void {
  if (currentMuted()) return;
  primeScanSound();
  const c = ctx;
  if (c === null || unavailable) return;
  try {
    const t0 = c.currentTime + 0.001;
    for (const n of score) {
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = n.type;
      const start = t0 + n.at;
      const end = start + n.seconds;
      osc.frequency.setValueAtTime(n.from, start);
      osc.frequency.linearRampToValueAtTime(n.to, end);
      // A short attack and a ramp to (near) zero: a hard stop clicks, and a
      // click is the one artefact that sounds like a fault rather than a cue.
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(n.gain, start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(amp).connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // A refused or exhausted audio graph is not a scan failure.
  }
}

/** The accepted cue. Call it wherever a scan was TAKEN. */
export function playScanAccepted(): void {
  play(ACCEPTED);
}

/** The refused cue. Call it on EVERY path where the screen says no. */
export function playScanRefused(): void {
  play(REFUSED);
}

export interface ScanSound {
  /** A scan was taken. */
  readonly accepted: () => void;
  /** The screen said no — any refusal, inline message or dialog. */
  readonly refused: () => void;
  readonly muted: boolean;
  readonly toggleMute: () => void;
  /** Unlock audio on a user gesture (a keypress in the scan field counts). */
  readonly prime: () => void;
}

/**
 * The hook every scan surface uses.
 *
 * It also primes the context on the first gesture anywhere on the page, so
 * a bench does not have to remember to: the packer's first keypress or tap
 * IS the gesture the browser was waiting for.
 */
export function useScanSound(): ScanSound {
  const [isMuted, setIsMuted] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : currentMuted(),
  );

  useEffect(() => {
    setIsMuted(currentMuted());
    listeners.add(setIsMuted);
    const onGesture = (): void => primeScanSound();
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      listeners.delete(setIsMuted);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  const toggleMute = useCallback(() => {
    const next = !currentMuted();
    writeMuted(next);
    // Unmuting is a gesture, and the cue proves the speaker works.
    if (!next) {
      primeScanSound();
      playScanAccepted();
    }
  }, []);

  // Memoised so a caller can put it in an effect's dependency list without
  // the effect re-running on every render.
  return useMemo(
    () => ({
      accepted: playScanAccepted,
      refused: playScanRefused,
      muted: isMuted,
      toggleMute,
      prime: primeScanSound,
    }),
    [isMuted, toggleMute],
  );
}
