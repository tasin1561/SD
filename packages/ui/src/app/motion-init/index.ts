/**
 * The per-user motion preference ("Motion: full / reduced"), and the no-flash
 * script that applies it before first paint.
 *
 * The preference lives in localStorage ONLY (`sd-motion`), never on the
 * server — no API change. "reduced" puts `data-reduced="1"` on <html>, which
 * is exactly the path the OS `prefers-reduced-motion` takes in
 * `brand/app.css` and in `reducedMotion()`: one reduced-motion path, two
 * ways in. Default is full.
 *
 * NO `'use client'`: a root layout is a server component and must be able
 * to inline `motionInitScript` as a string (the same reason theme-init.ts is
 * its own module). Inline it WITH THE CSP NONCE:
 *
 *   <script nonce={nonce} dangerouslySetInnerHTML={{ __html: motionInitScript }} />
 *
 * A hydration mismatch makes React 19 reset <html>'s attributes to its
 * server props, which would drop the attribute until the next load; the
 * `MotionPreference` switch and `useMotionPreferenceSync()` re-apply it on
 * mount, so it cannot stay lost.
 */

/** localStorage key for the preference. */
export const MOTION_STORAGE_KEY = 'sd-motion';

export type MotionPreference = 'full' | 'reduced';

/** A stored value narrowed to a preference; anything else is the default. */
export function motionPreference(value: string | null | undefined): MotionPreference {
  return value === 'reduced' ? 'reduced' : 'full';
}

/** Runs before hydration. Never throws: storage may be blocked. */
export const motionInitScript = `(function(){try{if(localStorage.getItem('${MOTION_STORAGE_KEY}')==='reduced'){document.documentElement.setAttribute('data-reduced','1');}}catch(e){}})();`;
