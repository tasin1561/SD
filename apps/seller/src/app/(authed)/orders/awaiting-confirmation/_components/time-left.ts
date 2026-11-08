/** Urgency bands for an auto-confirm deadline. Pure, so the page and its test share it. */
export type Urgency = 'expired' | 'urgent' | 'soon' | 'calm';

export const URGENT_MS = 2 * 60 * 60 * 1000;
export const SOON_MS = 6 * 60 * 60 * 1000;

export function msLeft(deadlineIso: string, now: number): number {
  return new Date(deadlineIso).getTime() - now;
}

export function urgencyOf(ms: number): Urgency {
  if (ms <= 0) return 'expired';
  if (ms <= URGENT_MS) return 'urgent';
  if (ms <= SOON_MS) return 'soon';
  return 'calm';
}

/** Whole days / hours / minutes left, rounded UP so "0m" never shows for a live order. */
export function partsOf(ms: number): { d: number; h: number; m: number } {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  return {
    d: Math.floor(totalMin / 1440),
    h: Math.floor((totalMin % 1440) / 60),
    m: totalMin % 60,
  };
}
