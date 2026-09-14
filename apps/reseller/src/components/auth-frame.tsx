import type { ReactElement, ReactNode } from 'react';

/**
 * The frame every signed-out page sits in: the Skydrop mark, the portal's
 * name, and one card. Deliberately plain — the reseller portal is a
 * working tool for somebody else's business, and its sign-in should read
 * as exactly that.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): ReactElement {
  return (
    <main className="bg-bg text-text-body grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          {/* Decorative — the wordmark beside it names the brand. A static SVG, nothing to optimise. */}
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
        </div>
        <p className="text-text-muted mb-4 text-center text-sm">reseller portal</p>
        <div className="border-border bg-surface rounded-xl border p-6">
          <h1 className="text-text-bright mb-1 text-lg font-semibold">{title}</h1>
          {subtitle !== undefined ? (
            <div className="text-text-muted mb-5 text-sm">{subtitle}</div>
          ) : null}
          {children}
        </div>
        {footer !== undefined ? (
          <div className="text-text-muted mt-5 text-center text-sm">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}
