import type { ReactElement, ReactNode } from 'react';
import { LazyCorridorMap } from '../sign-in-map';
import './sign-in.css';

/**
 * SignInScreen — the ONE sign-in / auth screen for the three consoles
 * (admin "operations console", seller "seller portal", reseller "store
 * portal"), replacing three copies of `AuthConsoleShell`.
 *
 * The brand look: Plus Jakarta, the corridor gradient as an accent along
 * the card, and the corridor MAP (`LazyCorridorMap`, loaded after first paint) as a calm background.
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
export function SignInFrame({
  portal,
  children,
  themeControl,
  logoSrc = '/brand/skydrop-icon.svg',
  wide = false,
}: {
  /** "operations console" / "seller portal" / "store portal". */
  readonly portal: string;
  /** One or more `SignInCard`s (and whatever sits under them). */
  readonly children: ReactNode;
  readonly themeControl?: ReactNode;
  readonly logoSrc?: string;
  /** A wider column, for the account-setup forms with two fields a row. */
  readonly wide?: boolean;
}): ReactElement {
  return (
    <div className="sk-signin">
      <div className="sk-signin__backdrop" aria-hidden>
        <LazyCorridorMap className="sk-signin__map" />
        <span className="sk-signin__veil" />
        <span className="sk-signin__glow" />
      </div>
      {themeControl !== undefined && <div className="sk-signin__theme">{themeControl}</div>}
      <main className="sk-signin__main" data-wide={wide || undefined}>
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
        {children}
      </main>
    </div>
  );
}

/**
 * One card on the sign-in screen: the corridor edge, the heading, an
 * optional note, the page's own content unchanged, and links under it.
 */
export function SignInCard({
  title,
  note,
  children,
  footer,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  /** The page's own content; `null` for a card that is only a message. */
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): ReactElement {
  return (
    <>
      <div className="sk-signin__card">
        <span className="sk-signin__edge" aria-hidden />
        <h1 className="sk-signin__title">{title}</h1>
        {note !== undefined && <div className="sk-signin__note">{note}</div>}
        {children !== null && children !== undefined && children !== false && (
          <div className="sk-signin__form">{children}</div>
        )}
      </div>
      {footer !== undefined && <div className="sk-signin__footer">{footer}</div>}
    </>
  );
}

/** Frame + one card: the whole sign-in screen in one call. */
export function SignInScreen({
  portal,
  title = 'Sign in',
  note,
  children,
  footer,
  themeControl,
  logoSrc = '/brand/skydrop-icon.svg',
}: {
  readonly portal: string;
  readonly title?: string;
  readonly note?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly themeControl?: ReactNode;
  readonly logoSrc?: string;
}): ReactElement {
  return (
    <SignInFrame portal={portal} themeControl={themeControl} logoSrc={logoSrc}>
      <SignInCard title={title} note={note} footer={footer}>
        {children}
      </SignInCard>
    </SignInFrame>
  );
}
