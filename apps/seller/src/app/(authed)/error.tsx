'use client';

import { useEffect, type ReactElement } from 'react';

/**
 * Authed route-group error boundary. The (authed) layout throws on
 * 5xx from the SSR /me call (network down, API offline) — we render
 * a "service unavailable" page rather than masking outage as
 * "logged out" (which would dump the user at /login confusingly).
 *
 * The 401/forbidden path doesn't reach here — those return a result
 * that the layout handles via redirect. Only thrown errors land in
 * error.tsx.
 */
export default function AuthedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  // The API being unreachable is ONE reason to land here. Any thrown
  // error in this segment lands here too, and this page used to assert
  // the network cause without looking — which sent a real component
  // fault off to be diagnosed as an outage. Say which it was.
  const looksLikeOutage = /fetch failed|ECONNREFUSED|NetworkError|Failed to fetch/i.test(
    error.message,
  );

  /*
    A DEPLOYED-OVER TAB, which is not a fault at all.

    A tab open across a deploy still holds the previous build's HTML,
    and every route it has not visited yet points at a JS chunk whose
    hash no longer exists. Navigating there throws
    "Loading chunk NNN failed" — and `reset()` cannot fix it, because
    re-rendering the same stale build asks for the same missing file.
    So "Try again" fails forever and the page reads as broken software
    when the only thing wrong is that it is out of date.

    A hard reload fetches the current build and the route works. Done
    automatically rather than offered as a button: there is nothing for
    a person to decide here, and the alternative is a dead end.

    Guarded against a reload LOOP — if the chunk is genuinely missing
    from the new build too, one retry per session is enough to find
    that out, and after it the message below is shown instead.
  */
  const isStaleBuild = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported/i.test(
    error.message,
  );
  useEffect(() => {
    if (!isStaleBuild) return;
    const KEY = 'sd-chunk-reload';
    try {
      if (sessionStorage.getItem(KEY) !== null) return;
      sessionStorage.setItem(KEY, '1');
    } catch {
      // Private mode, storage disabled — reloading once is still the
      // right move; we just cannot remember that we did.
    }
    window.location.reload();
  }, [isStaleBuild]);
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-text-bright mb-1 text-lg font-semibold tracking-tight">
          {isStaleBuild
            ? 'Updating…'
            : looksLikeOutage
              ? 'Service unavailable'
              : 'This page did not load'}
        </div>
        <p className="text-text-muted text-sm mb-4">
          {isStaleBuild
            ? 'This tab was open while a new version shipped, so it asked for a file that no longer exists. Reloading to pick up the current one.'
            : looksLikeOutage
              ? 'We couldn’t reach the API. Your session is intact — this is a temporary outage.'
              : 'Your session is intact — something on this page failed to load.'}
        </p>
        {/* The actual fault, so it can be reported instead of guessed
            at. `digest` is what appears in the server log; the message
            is empty in production builds for client errors, so both are
            shown and whichever exists is the useful one. */}
        {!looksLikeOutage && !isStaleBuild && (error.message !== '' || error.digest !== undefined) ? (
          <p className="text-text-faint mb-5 font-mono text-xs break-all">
            {error.message !== '' ? error.message : `digest ${error.digest ?? 'unknown'}`}
          </p>
        ) : null}
        <button
          type="button"
          onClick={isStaleBuild ? () => window.location.reload() : reset}
          className="px-3 py-1.5 rounded-[5px] bg-accent-fill text-accent-fg text-sm font-medium hover:bg-accent-fill-hover transition-colors"
        >
          {isStaleBuild ? 'Reload now' : 'Try again'}
        </button>
      </div>
    </div>
  );
}
