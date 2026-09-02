'use client';

import type { ReactElement } from 'react';

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
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-text-bright mb-1 text-lg font-semibold tracking-tight">
          {looksLikeOutage ? 'Service unavailable' : 'This page did not load'}
        </div>
        <p className="text-text-muted text-sm mb-4">
          {looksLikeOutage
            ? 'We couldn’t reach the API. Your session is intact — this is a temporary outage.'
            : 'Your session is intact — something on this page failed to load.'}
        </p>
        {/* The actual fault, so it can be reported instead of guessed
            at. `digest` is what appears in the server log; the message
            is empty in production builds for client errors, so both are
            shown and whichever exists is the useful one. */}
        {!looksLikeOutage && (error.message !== '' || error.digest !== undefined) ? (
          <p className="text-text-faint mb-5 font-mono text-xs break-all">
            {error.message !== '' ? error.message : `digest ${error.digest ?? 'unknown'}`}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
