import type { ReactElement, ReactNode } from 'react';
import { AuthConsoleHeader, AuthConsoleShell } from '@/components/auth-console/console-shell';
import { TiltPanel } from '@/lib/tilt';

/**
 * The frame every signed-out page sits in.
 *
 * ── 2026-09-20: this stopped being "deliberately plain" ──────────────
 * It used to render the Skydrop mark and one card on a flat
 * background, with a comment arguing that a working tool for somebody
 * else's business should read as exactly that. Admin and seller both
 * met the animated BD→IN corridor on the way in and this did not, so
 * in practice the argument produced one product with two front doors —
 * and this is the door a store user arrives at from an invitation
 * email, which is often the first thing they ever see of Skydrop.
 *
 * ── Why the SHELL lives here and not in three layouts ────────────────
 * apps/admin and apps/seller wrap their auth routes in
 * `login/layout.tsx`, `auth/layout.tsx` and (seller) a third for
 * `password-reset` — three files that each have to remember. This app
 * already funnels all five signed-out pages through this ONE
 * component, so putting the shell here makes forgetting it
 * unrepresentable rather than merely unlikely. A layout would also
 * double-wrap: the shell paints its own full-screen ground.
 *
 * The page API is unchanged (`title` / `subtitle` / `children` /
 * `footer`), so no page needed editing to gain the backdrop.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
  section = 'access',
  note = 'invite-only',
  alert = false,
}: {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /**
   * The panel head's left cap — what this screen IS. The console
   * indexes a page's regions `NN // NAME`; here there is one region
   * and no reading order to number, so it is the dot, the name and a
   * quiet note: the same three parts, no invented ordinal.
   */
  readonly section?: string;
  /** The right-hand cap — the screen's STATE, in two or three words. */
  readonly note?: string;
  /**
   * Turns the head's dot red. For the case a page is showing a
   * refusal rather than a form — a link with no token in it — so the
   * shape of the problem is legible before the prose is read.
   */
  readonly alert?: boolean;
}): ReactElement {
  return (
    <AuthConsoleShell>
      {/*
       * The landmark stays. The shell paints a `<div>` (it is scenery,
       * and admin and seller both lose the landmark because of it),
       * but this frame used to be a real `<main>` and dropping it to
       * gain a backdrop would be trading a screen-reader's way into
       * the page for an animation they cannot see.
       */}
      <main>
        <AuthConsoleHeader label="store portal" />

        <TiltPanel max={3} className="boot-rise boot-rise-2">
          <div className="border-border bg-surface ticks relative overflow-hidden rounded-[var(--radius-3)] border p-6 sm:p-7">
            <div className="border-border mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-3">
              <span className="telemetry text-text-bright inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${alert ? 'bg-critical' : 'bg-accent'}`}
                />
                {section}
              </span>
              <span className="telemetry text-text-faint">{note}</span>
            </div>
            <h1 className="text-text-bright mb-1 text-lg font-semibold">{title}</h1>
            {subtitle !== undefined ? (
              <div className="text-text-muted mb-5 text-sm">{subtitle}</div>
            ) : null}
            {children}
            <div aria-hidden className="glow-follow" />
          </div>
        </TiltPanel>

        {footer !== undefined ? (
          <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
            {footer}
          </div>
        ) : null}
      </main>
    </AuthConsoleShell>
  );
}
