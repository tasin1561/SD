import type { ReactNode, ReactElement } from 'react';
import { CorridorConsole } from './_components/corridor-console';
import './login-console.css';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated user
 * lands here, the login page itself redirects them onward; we don't
 * gate access. The (authed) layout is the gate.
 *
 * Skin: MISSION CONTROL, scoped to `.mc-login` (login-console.css
 * re-declares the @skydrop/ui tokens inside that class only) so the
 * admin shell keeps its own palette untouched.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
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
