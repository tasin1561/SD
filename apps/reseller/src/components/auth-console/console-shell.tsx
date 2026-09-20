import type { ReactNode, ReactElement } from 'react';
import { CorridorConsole } from './corridor-console';
import './console.css';

/**
 * The MISSION CONTROL shell behind every unauthenticated page.
 *
 * ── Why the store portal has one at all ──────────────────────────────
 * It did not, and that was the gap: signing in to admin or to the
 * seller console met the animated BD→IN corridor, and signing in to
 * the store portal met a card on a flat background. A store user is a
 * CUSTOMER of this product — often meeting it for the first time on an
 * invitation link — so the front door reading as an afterthought is
 * exactly backwards.
 *
 * ── Which palette, and why it is NOT the seller's ────────────────────
 * The skin re-declares the @skydrop/ui tokens inside `.mc-login` only,
 * which is what keeps the authenticated shell's palette untouched.
 * Since the shell must match the app BEHIND it, the copy that belongs
 * here is the one tracking whatever that app renders in — and
 * apps/reseller imports `@skydrop/ui/tokens.css`, the same sheet
 * apps/admin uses. So this file is apps/admin's copy, not apps/seller's:
 * apps/seller moved to PRECISION LOGISTICS (`seller-theme.css`) and its
 * console.css moved with it. Three copies now exist and only two of
 * them are meant to agree; see the note at the top of console.css.
 *
 * The class name stays `mc-login` despite no longer being
 * login-specific — renaming it would mean touching every selector in
 * the stylesheet for no behavioural gain.
 */
export function AuthConsoleShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="mc-login bg-bg text-text-body relative grid min-h-screen place-items-center overflow-hidden p-6">
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
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}

/**
 * The wordmark + status line every auth page opens with.
 *
 * `label` names the SURFACE, and for this app it says "store portal"
 * rather than anything about the seller behind it: a store user signs
 * in to their own shopfront, and naming somebody else's console on the
 * way in would be the first thing the product got wrong about them.
 */
export function AuthConsoleHeader({ label }: { readonly label: string }): ReactElement {
  return (
    <div className="boot-rise mb-6 text-center">
      <div className="flex items-center justify-center gap-3">
        {/* Decorative — the wordmark beside it already names the brand. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/skydrop-icon.svg"
          alt=""
          aria-hidden="true"
          width={74}
          height={36}
          className="h-9 w-auto shrink-0 select-none"
          draggable={false}
        />
        <span className="text-text-bright text-2xl font-semibold tracking-tight">Skydrop</span>
        <span className="telemetry text-text-muted inline-flex items-center gap-1.5">
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
