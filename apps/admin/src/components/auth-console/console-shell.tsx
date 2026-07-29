import type { ReactNode, ReactElement } from 'react';
import { CorridorConsole } from './corridor-console';
import './console.css';

/**
 * The MISSION CONTROL shell behind every unauthenticated page.
 *
 * Extracted from the login layout so /login and everything under
 * /auth share one skin. They did not: sign-in had the animated
 * corridor, the grid and the glow, while the pages a user is sent to
 * from an email — reset password, verify email, accept invitation —
 * were bare cards on a black background. Arriving from an email is
 * often someone's FIRST sight of the product, so that was the wrong
 * way round.
 *
 * The skin re-declares the @skydrop/ui tokens inside `.mc-login` only
 * (see console.css), which is what keeps the authenticated shell's
 * palette untouched. That scoping is why the class name stays even
 * though this is no longer login-specific — renaming it would mean
 * touching every selector in the stylesheet for no behavioural gain.
 */
export function AuthConsoleShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="mc-login relative min-h-screen grid place-items-center bg-bg text-text-body p-6 overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-55">
        <CorridorConsole />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(closest-side at 50% 45%, var(--color-bg) 35%, transparent 100%)',
          opacity: 0.85,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[480px] rounded-full"
        style={{
          background: 'radial-gradient(closest-side, var(--glow), transparent)',
          opacity: 0.45,
        }}
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}

/**
 * The wordmark + status line every auth page opens with.
 *
 * `label` names the surface ("operations console", "reset access") so
 * a page that arrived from an email says what it is before the card
 * does.
 */
export function AuthConsoleHeader({ label }: { readonly label: string }): ReactElement {
  return (
    <div className="boot-rise mb-6 text-center">
      <div className="flex items-baseline justify-center gap-3">
        <span className="text-text-bright font-semibold text-2xl tracking-tight">Skydrop</span>
        <span className="telemetry inline-flex items-center gap-1.5 text-text-muted">
          <span
            aria-hidden
            className="status-dot inline-block h-1 w-1 rounded-full"
            style={{ background: 'var(--green)' }}
          />
          sys online
        </span>
      </div>
      <div className="telemetry text-text-muted mt-2">{label}</div>
    </div>
  );
}
