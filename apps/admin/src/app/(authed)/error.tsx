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
export default function AuthedError({ reset }: { error: Error; reset: () => void }): ReactElement {
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-text-bright font-semibold text-lg tracking-tight mb-1">
          Service unavailable
        </div>
        <p className="text-text-muted text-sm mb-5">
          We couldn&apos;t reach the API. Your session is intact — this is a temporary outage.
        </p>
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
