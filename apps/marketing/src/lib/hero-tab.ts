'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which hero-card tab is open — shared between the hero's action card and
 * the phone's bottom bar, whose bead follows it (owner, Phase 3 review).
 * `null` means "the hero is not on screen": the bar's bead rests on
 * nothing. A module-scope store rather than context, because the two
 * islands are mounted by different server components.
 */
export type HeroTab = 'track' | 'quote' | 'book';

let tab: HeroTab = 'track';
let heroVisible = true;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export function setHeroTab(next: HeroTab): void {
  if (tab === next) return;
  tab = next;
  emit();
}
export function setHeroVisible(v: boolean): void {
  if (heroVisible === v) return;
  heroVisible = v;
  emit();
}
export function requestHeroTab(next: HeroTab): void {
  setHeroTab(next);
  document.getElementById('top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(
    () => document.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(),
    350,
  );
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useHeroTab(): HeroTab {
  return useSyncExternalStore(
    subscribe,
    () => tab,
    () => 'track',
  );
}
/** The bar's value: the hero tab while the hero is on screen, else none. */
export function useBarTab(): HeroTab | '' {
  return useSyncExternalStore(
    subscribe,
    () => (heroVisible ? tab : ''),
    () => 'track',
  );
}
