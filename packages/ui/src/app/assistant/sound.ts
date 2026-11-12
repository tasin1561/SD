'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The assistant's three sounds, generated with the Web Audio API (no file
 * to ship, nothing for the CSP to block). Modelled on the warehouse bench
 * tone engine but deliberately a separate, softer family so a packer never
 * mistakes a chat chime for a scan verdict:
 *   send   a faint, very short tick
 *   done   two soft rising sine notes — the answer FINISHED (not per token)
 *   error  one low falling triangle tone — a notice, not a crash
 *
 * Never plays before the page has had a user gesture: the context is only
 * created by `primeAssistantSound`, which a pointerdown/keydown triggers.
 * Every path swallows its own failure and every storage access is wrapped.
 */
export const MUTE_KEY = 'skydrop.assistant.sound.muted';

type Ctor = new () => AudioContext;
interface Note {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly seconds: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

const TICK: readonly Note[] = [
  { from: 1400, to: 1000, at: 0, seconds: 0.045, type: 'sine', gain: 0.07 },
];
const CHIME: readonly Note[] = [
  { from: 659, to: 659, at: 0, seconds: 0.14, type: 'sine', gain: 0.1 },
  { from: 988, to: 988, at: 0.1, seconds: 0.26, type: 'sine', gain: 0.1 },
];
const ERROR: readonly Note[] = [
  { from: 220, to: 150, at: 0, seconds: 0.3, type: 'triangle', gain: 0.12 },
];

let ctx: AudioContext | null = null;
let unavailable = false;
/** True once a user gesture has primed audio; nothing plays before. */
let primed = false;
let memoryOverride: boolean | null = null;
const listeners = new Set<(muted: boolean) => void>();

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create or resume the context. Call it from a user gesture. */
export function primeAssistantSound(): void {
  if (unavailable) return;
  try {
    if (ctx === null) {
      const C = audioCtor();
      if (C === null) {
        unavailable = true;
        return;
      }
      ctx = new C();
    }
    primed = true;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    unavailable = true;
  }
}

export function isAssistantMuted(): boolean {
  if (memoryOverride !== null) return memoryOverride;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAssistantMuted(next: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    memoryOverride = null;
  } catch {
    // The choice still holds for this visit; it just will not be remembered.
    memoryOverride = next;
  }
  for (const fn of listeners) fn(next);
}

function play(score: readonly Note[]): void {
  if (isAssistantMuted() || !primed || unavailable) return;
  const c = ctx;
  if (c === null) return;
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
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(n.gain, start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(amp).connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // A refused audio graph must never break the chat.
  }
}

export const playAssistantTick = (): void => play(TICK);
export const playAssistantChime = (): void => play(CHIME);
export const playAssistantError = (): void => play(ERROR);

/** Test seam: forget the context, the gesture and any in-memory mute. */
export function resetAssistantSoundForTests(): void {
  ctx = null;
  unavailable = false;
  primed = false;
  memoryOverride = null;
  listeners.clear();
}

export interface AssistantSound {
  readonly muted: boolean;
  readonly toggleMute: () => void;
  readonly tick: () => void;
  readonly chime: () => void;
  readonly error: () => void;
}

export function useAssistantSound(): AssistantSound {
  const [muted, setMuted] = useState<boolean>(false);
  useEffect(() => {
    setMuted(isAssistantMuted());
    listeners.add(setMuted);
    const onGesture = (): void => primeAssistantSound();
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture);
    return () => {
      listeners.delete(setMuted);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);
  const toggleMute = useCallback(() => {
    const next = !isAssistantMuted();
    setAssistantMuted(next);
    if (!next) {
      primeAssistantSound();
      playAssistantTick();
    }
  }, []);
  return useMemo(
    () => ({
      muted,
      toggleMute,
      tick: playAssistantTick,
      chime: playAssistantChime,
      error: playAssistantError,
    }),
    [muted, toggleMute],
  );
}
