import type { ReactNode, ReactElement } from 'react';
import { ThemeToggle } from '@skydrop/ui/components';
import { CorridorConsole } from './corridor-console';
import './console.css';

/**
 * The MISSION CONTROL backdrop behind every unauthenticated page.
 *
 * Extracted from the login layout, where it was inline, so /login and
 * everything reached from an email share one skin. They did not: signing
 * in had the animated corridor, the grid and the glow, while accepting
 * an invitation, joining a team, resetting a password and verifying an
 * email were bare cards on a black background.
 *
 * That was the wrong way round. Accepting an invitation is often
 * somebody's FIRST sight of the product — the sign-in page is what they
 * see on their second visit, once they have already decided to trust it.
 *
 * ── WIDTH IS THE PAGE'S BUSINESS, NOT THE SHELL'S ────────────────────
 * apps/admin's equivalent pins `max-w-sm`, which is right there because
 * every admin auth page is a short form. The seller's registration form
 * asks for a company name, contact, two phone numbers and two passwords;
 * squeezing that into 384px to satisfy a shared wrapper would be the
 * layout deciding something the page knows better. So the content slot
 * takes a class, and each page keeps the width it already had.
 */
export function AuthConsoleShell({
  children,
  contentClassName = 'w-full max-w-sm',
}: {
  readonly children: ReactNode;
  readonly contentClassName?: string;
}): ReactElement {
  return (
    // `.mc-login` is what scopes the skin: console.css re-declares the
    // @skydrop/ui tokens inside that class only, which is what keeps the
    // authenticated shell's palette untouched. The name stays despite no
    // longer being login-specific — renaming it means touching every
    // selector in the stylesheet for no behavioural gain.
    <div className="mc-login bg-bg text-text-body relative grid min-h-screen place-items-center overflow-hidden p-6">
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
      {/* Darkens the middle so the card reads first. Atmosphere competing
          with the form is atmosphere working against the one thing the
          page is for. */}
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
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[700px] -translate-x-1/2 rounded-full"
        style={{
          background: 'radial-gradient(closest-side, var(--glow), transparent)',
          opacity: 0.45,
        }}
      />
      {/* A LANDMARK, not a div — see the note in apps/admin's copy.
          The width still comes from the page, which knows better than
          the shell does. */}
      <main className={`relative ${contentClassName}`}>{children}</main>
    </div>
  );
}
