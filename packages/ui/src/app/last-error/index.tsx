/**
 * The last server error a person was shown, held in memory so the
 * assistant can be told about it.
 *
 * One tiny module-level slot, written in the single place every console
 * already turns a server `[CODE] message` into on-screen text
 * (`serverVerdict`), so no screen has to know the assistant exists.
 * Memory only and short-lived: it is context for a question, not a log,
 * and it is never persisted anywhere (FE-1 spirit: nothing durable).
 */
export interface LastError {
  readonly code: string | null;
  readonly message: string;
  readonly at: number;
}

/** An error older than this is no longer "what just went wrong". */
export const LAST_ERROR_TTL_MS = 10 * 60 * 1000;

let last: LastError | null = null;

export function recordLastError(
  code: string | null | undefined,
  message: string,
  now: number = Date.now(),
): void {
  const text = message.trim();
  if (text === '') return;
  last = { code: code === undefined || code === '' ? null : code, message: text, at: now };
}

export function readLastError(now: number = Date.now()): LastError | null {
  if (last === null) return null;
  if (now - last.at > LAST_ERROR_TTL_MS) return null;
  return last;
}

export function clearLastError(): void {
  last = null;
}
