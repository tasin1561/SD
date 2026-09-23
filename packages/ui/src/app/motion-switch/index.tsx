'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { MOTION_STORAGE_KEY, motionPreference, type MotionPreference } from '../motion-init';
import {
  applyMotionPreference,
  readMotionPreference,
  writeMotionPreference,
} from '../motion/motion';
import { Switch } from '../switch';
import './motion-switch.css';

/**
 * Keeps <html> in line with the stored motion preference. The app shell
 * calls this ONCE: it re-applies the preference on mount (a React 19
 * hydration mismatch resets <html>'s attributes to its server props, which
 * would drop `data-reduced` until the next load) and follows a change made
 * in another tab through the `storage` event.
 */
export function useMotionPreferenceSync(): void {
  useEffect(() => {
    applyMotionPreference(readMotionPreference());
    function onStorage(e: StorageEvent): void {
      if (e.key !== MOTION_STORAGE_KEY) return;
      applyMotionPreference(motionPreference(e.newValue));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

/**
 * The per-user "Motion: full / reduced" setting, as a switch labelled
 * "Reduce motion". Stored in this browser only (`sd-motion`), applied at
 * once; "reduced" takes the SAME path as the device's own reduced-motion
 * setting, so every animation settles straight into its end state. When
 * the device already asks for less motion, the description says so —
 * switching this off cannot override the device.
 */
export function MotionSwitch({
  size = 'md',
  id,
}: {
  size?: 'sm' | 'md' | undefined;
  id?: string | undefined;
}): ReactElement {
  const [pref, setPref] = useState<MotionPreference | null>(null);
  const [osReduced, setOsReduced] = useState(false);

  useEffect(() => {
    setPref(readMotionPreference());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReduced(mq.matches);
    const onMq = (e: MediaQueryListEvent): void => setOsReduced(e.matches);
    mq.addEventListener('change', onMq);
    function onStorage(e: StorageEvent): void {
      if (e.key === MOTION_STORAGE_KEY) setPref(motionPreference(e.newValue));
    }
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const description = osReduced
    ? 'Your device already asks for reduced motion, so animation stays off whatever this says.'
    : 'Animations settle instantly. Saved in this browser.';

  return (
    <div className="sk-motionsw">
      <Switch
        checked={pref === 'reduced'}
        onCheckedChange={(checked) => {
          const next: MotionPreference = checked ? 'reduced' : 'full';
          writeMotionPreference(next);
          setPref(next);
        }}
        label="Reduce motion"
        description={description}
        disabled={pref === null}
        data-size={size}
        {...(id !== undefined ? { id } : {})}
      />
    </div>
  );
}
