import type { ReactElement, ReactNode } from 'react';
import { CorridorMap } from './corridor-map';
import './sign-in.css';

/**
 * SignInScreen — the ONE sign-in / auth screen for the three consoles
 * (admin "operations console", seller "seller portal", reseller "store
 * portal"), replacing three copies of `AuthConsoleShell`.
 *
 * The brand look: Plus Jakarta, the corridor gradient as an accent along
 * the card, and the corridor MAP (`CorridorMap`) as a calm background.
 * No "sys online", no mono telemetry labels.
 *
 * What the apps' login specs pin, and so what this renders verbatim: the
 * text "Skydrop" (exactly once), the `portal` line (exactly as passed),
 * and a heading — `title`, default "Sign in". The app's own form goes in
 * `children` unchanged; it must NOT render its own "Sign in" heading, or
 * the heading query finds two.
 *
 * `themeControl` is a slot: every unauthenticated route funnels through
 * this screen, so mounting the theme switch here covers them all. The
 * content is a `<main>` landmark; the backdrop is `aria-hidden`.
 */
export function SignInScreen({
  portal,
  title = 'Sign in',
  note,
  children,
  footer,
  themeControl,
  logoSrc = '/brand/skydrop-icon.svg',
}: {
  /** "operations console" / "seller portal" / "store portal". */
  readonly portal: string;
  readonly title?: string;
  /** One line under the title — "Accounts are created by invitation." */
  readonly note?: ReactNode;
  /** The app's form, unchanged. */
  readonly children: ReactNode;
  /** Links under the card — "Forgot your password?". */
  readonly footer?: ReactNode;
  readonly themeControl?: ReactNode;
  readonly logoSrc?: string;
}): ReactElement {
  return (
    <div className="sk-signin">
      <div className="sk-signin__backdrop" aria-hidden>
        <CorridorMap className="sk-signin__map" />
        <span className="sk-signin__veil" />
        <span className="sk-signin__glow" />
      </div>
      {themeControl !== undefined && <div className="sk-signin__theme">{themeControl}</div>}
      <main className="sk-signin__main">
        <div className="sk-signin__brand">
          <img
            src={logoSrc}
            alt=""
            aria-hidden="true"
            width={74}
            height={36}
            className="sk-signin__mark"
            draggable={false}
          />
          <div className="sk-signin__names">
            <span className="sk-signin__name">Skydrop</span>
            <span className="sk-signin__portal">{portal}</span>
          </div>
        </div>
        <div className="sk-signin__card">
          <span className="sk-signin__edge" aria-hidden />
          <h1 className="sk-signin__title">{title}</h1>
          {note !== undefined && <div className="sk-signin__note">{note}</div>}
          <div className="sk-signin__form">{children}</div>
        </div>
        {footer !== undefined && <div className="sk-signin__footer">{footer}</div>}
      </main>
    </div>
  );
}
