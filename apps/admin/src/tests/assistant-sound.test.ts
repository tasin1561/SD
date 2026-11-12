import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MUTE_KEY,
  isAssistantMuted,
  playAssistantChime,
  playAssistantError,
  playAssistantTick,
  primeAssistantSound,
  resetAssistantSoundForTests,
  setAssistantMuted,
} from '@skydrop/ui/app/assistant';

const created = vi.hoisted(() => ({ contexts: 0, oscillators: 0 }));

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    created.contexts++;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createOscillator() {
    created.oscillators++;
    const o = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: (n: unknown) => n,
      start: vi.fn(),
      stop: vi.fn(),
    };
    return o;
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (n: unknown) => n,
    };
  }
}

beforeEach(() => {
  created.contexts = 0;
  created.oscillators = 0;
  resetAssistantSoundForTests();
  window.localStorage.clear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});
afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  vi.restoreAllMocks();
});

describe('assistant sounds', () => {
  it('make no sound and create no AudioContext before a user gesture', () => {
    playAssistantTick();
    playAssistantChime();
    playAssistantError();
    expect(created.contexts).toBe(0);
    expect(created.oscillators).toBe(0);
  });

  it('play once primed: tick 1 note, chime 2, error 1', () => {
    primeAssistantSound();
    playAssistantTick();
    expect(created.oscillators).toBe(1);
    playAssistantChime();
    expect(created.oscillators).toBe(3);
    playAssistantError();
    expect(created.oscillators).toBe(4);
  });

  it('mute is remembered and silences everything', () => {
    primeAssistantSound();
    setAssistantMuted(true);
    expect(window.localStorage.getItem(MUTE_KEY)).toBe('1');
    expect(isAssistantMuted()).toBe(true);
    playAssistantChime();
    expect(created.oscillators).toBe(0);
    setAssistantMuted(false);
    expect(isAssistantMuted()).toBe(false);
  });

  it('a throwing localStorage does not break anything and still mutes the session', () => {
    primeAssistantSound();
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setAssistantMuted(true)).not.toThrow();
    expect(isAssistantMuted()).toBe(true);
    expect(() => playAssistantTick()).not.toThrow();
    expect(created.oscillators).toBe(0);
  });

  it('a constructor that throws is swallowed', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function () {
      throw new Error('no audio');
    };
    expect(() => primeAssistantSound()).not.toThrow();
    expect(() => playAssistantChime()).not.toThrow();
  });
});
