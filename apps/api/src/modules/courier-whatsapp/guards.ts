import { readFileSync } from 'node:fs';
import { freemem } from 'node:os';

/** Tabs are not opened below this much available memory. */
export const MIN_FREE_MB = 400;
/** A deferred read waits this long when memory is short. */
export const LOW_MEMORY_DELAY_MS = 2 * 60 * 1000;
/** A sweep job older than this is stale when picked up. */
export const SWEEP_STALE_MS = 60 * 60 * 1000;
/** The browser context is recycled after this many reads. */
export const RECYCLE_AFTER_READS = 200;
/** Hard ceiling for one read. */
export const READ_TIMEOUT_MS = 45_000;

/** MemAvailable from /proc when there is one (page cache counts as free), else os.freemem. */
export function availableMemoryMb(
  read: () => string = () => readFileSync('/proc/meminfo', 'utf8'),
  fallback: () => number = freemem,
): number {
  try {
    const m = /MemAvailable:\s+(\d+)\s*kB/.exec(read());
    if (m !== null) return Math.floor(Number(m[1]) / 1024);
  } catch {
    // not Linux, or unreadable
  }
  return Math.floor(fallback() / (1024 * 1024));
}

export function memoryOk(freeMb: number): boolean {
  return freeMb >= MIN_FREE_MB;
}

/**
 * Queue-bound policy: past `max` waiting jobs, new SWEEP jobs are
 * dropped (the sweep re-queues them later); hot, event and viewer jobs
 * are always accepted.
 */
export function shouldDropSweep(kind: string, waiting: number, max: number): boolean {
  return kind === 'sweep' && waiting > max;
}

/** A sweep job is stale if it has waited over an hour; others never are. */
export function isStaleSweep(kind: string, queuedAt: number | undefined, now: number): boolean {
  return kind === 'sweep' && queuedAt !== undefined && now - queuedAt > SWEEP_STALE_MS;
}
