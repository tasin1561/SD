import 'server-only';
import { apiOrigin } from './api-origin';

/**
 * Should the tracking page show "Ask about this parcel"? The API answers
 * with a single boolean (switch on, key set, public budget not spent). Cached
 * for 30 seconds so a busy page does not turn into a call per view, and
 * FAIL-CLOSED: any error, timeout or odd body means "no helper", and the page
 * is exactly what it was before the helper existed.
 */
const TTL_MS = 30_000;
const TIMEOUT_MS = 2_500;
let cached: { at: number; value: boolean } | null = null;

export async function parcelAssistantAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cached !== null && now - cached.at < TTL_MS) return cached.value;
  let value = false;
  try {
    const res = await fetch(`${apiOrigin()}/public/parcel-assistant/status`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { available?: unknown };
      value = body.available === true;
    }
  } catch {
    value = false;
  }
  cached = { at: now, value };
  return value;
}
