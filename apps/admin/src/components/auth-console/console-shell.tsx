import type { ReactNode, ReactElement } from 'react';
import { ThemeToggle } from '@skydrop/ui/components';
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
      {/* THE TOGGLE LIVES IN `AppShell`, WHICH IS THE AUTHENTICATED
          CHROME — so before this, no signed-out page had one. A visitor
          got whatever their OS said, or a cookie pinned during some
          earlier signed-in session, and on the sign-in screen that is
          exactly the moment somebody has neither. Nothing failed: the
          page rendered perfectly and simply could not be changed.

          It belongs HERE rather than on each page because every
          unauthenticated route funnels through this shell (admin and
          seller via their /auth, /login and /password-reset layouts;
          reseller via AuthFrame), so one mount covers all of them and a
          new auth page inherits it without anybody remembering.

          Above the backdrop: the corridor, the grid and the glows are
          `absolute inset-0`, so the toggle needs its own stacking
          context to stay clickable. */}
      <ThemeToggle className="absolute top-4 right-4 z-20" />
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
      {/* A LANDMARK, not a div. Every auth page renders bare content
          into this slot, so without a <main> here a screen-reader user
          has no way to skip the decorative corridor, the grid and the
          two glow layers above — all of which are aria-hidden and
          therefore silent, leaving them to arrow through nothing.
          apps/reseller's AuthFrame already had one; these two did not. */}
      <main className="relative w-full max-w-sm">{children}</main>
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
      <div className="flex items-center justify-center gap-3">
        {/* Decorative — the wordmark beside it already names the brand. */}
        <img
          src="/brand/skydrop-icon.svg"
          alt=""
          aria-hidden="true"
          width={74}
          height={36}
          className="h-9 w-auto shrink-0 select-none"
          draggable={false}
        />
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
