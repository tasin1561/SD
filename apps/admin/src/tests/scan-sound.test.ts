/**
 * The shared warehouse scan sounds — `src/lib/scan-sound.ts`.
 *
 * The one rule that matters more than the sound itself: NO SOUND PATH MAY
 * EVER THROW. A bench where a scan fails because the speaker is missing,
 * because the browser has not had a gesture yet, or because `localStorage`
 * throws in private mode, is worse than a silent bench. jsdom has no
 * `AudioContext` at all, which is exactly the hostile environment to
 * assert against.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playScanAccepted, playScanRefused, primeScanSound, useScanSound } from '@/lib/scan-sound';
import { renderHook, act } from '@testing-library/react';

const KEY = 'skydrop.warehouse.scanSound.muted';

describe('scan sounds — never break a scan', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('plays nothing and throws nothing where there is no AudioContext', () => {
    expect(() => primeScanSound()).not.toThrow();
    expect(() => playScanAccepted()).not.toThrow();
    expect(() => playScanRefused()).not.toThrow();
  });

  it('survives a localStorage that throws (private mode)', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useScanSound());
    expect(() => act(() => result.current.toggleMute())).not.toThrow();
    // It still muted the session, it just could not write it down.
    expect(result.current.muted).toBe(true);
    spy.mockRestore();
    // Put it back so the next test starts from "audible" (the module is a
    // singleton on purpose — one setting for every bench on the device).
    act(() => result.current.toggleMute());
  });
});

describe('scan sounds — one mute setting per device', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts audible, remembers a mute, and says so', () => {
    const { result } = renderHook(() => useScanSound());
    expect(result.current.muted).toBe(false);
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('1');
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('0');
  });

  it('is SHARED: muting from one bench mutes every other mounted one', () => {
    const a = renderHook(() => useScanSound());
    const b = renderHook(() => useScanSound());
    act(() => a.result.current.toggleMute());
    expect(a.result.current.muted).toBe(true);
    // A packer must not have to mute six screens.
    expect(b.result.current.muted).toBe(true);
    act(() => b.result.current.toggleMute());
  });
});
