/**
 * Shared motion plumbing for every app primitive and storytelling control.
 *
 * Two questions every pattern asks, answered ONCE:
 *   - is motion reduced?  The OS preference, OR the per-user setting
 *     (`data-reduced="1"` on <html>, written by the "Motion" switch or the
 *     gallery's simulator) — the same path either way.
 *   - how fast?  `--motion-slow` on <html> (1 = real time; the gallery's
 *     slow-mo sets 4). CSS reads it through `calc()`; JS timers go through
 *     `ms()`.
 *
 * Lifted from apps/marketing's micro library (motion.ts), which stays
 * untouched; the app version adds the stored preference.
 */
import { MOTION_STORAGE_KEY, motionPreference, type MotionPreference } from '../motion-init';

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

/** The stored preference. Browser-only; never throws. */
export function readMotionPreference(): MotionPreference {
  try {
    return motionPreference(window.localStorage.getItem(MOTION_STORAGE_KEY));
  } catch {
    return 'full';
  }
}

/** Store the preference and apply it to <html> now. Never throws. */
export function writeMotionPreference(pref: MotionPreference): void {
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, pref);
  } catch {
    // Storage blocked: the choice still applies to this page.
  }
  applyMotionPreference(pref);
}

/** Put the preference on <html>, where CSS and `reducedMotion()` read it. */
export function applyMotionPreference(pref: MotionPreference): void {
  if (typeof document === 'undefined') return;
  if (pref === 'reduced') document.documentElement.setAttribute('data-reduced', '1');
  else document.documentElement.removeAttribute('data-reduced');
}
