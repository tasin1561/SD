import type { ReactElement } from 'react';
import { TiltPanel } from '@/lib/tilt';
import { PasswordResetRequestForm } from './_components/request-form';

/**
 * Step 1 of the seller password-reset flow — the "request" page.
 * Linked to from the login form footer. Posts the email to
 * /auth/seller/password-reset/request. The API always returns a
 * generic 200 regardless of whether the email matches a seller
 * (anti-enumeration); we surface that same generic copy.
 *
 * Step 2 — the actual reset-with-token page — lives at
 * /auth/reset-password and is what the password-reset email links to.
 *
 * Chrome: the console's instrument panel, same as /login. These pages
 * had plain cards on the same backdrop, which read as two products —
 * see the note in `auth-console/console.css`.
 */
export default function PasswordResetPage(): ReactElement {
  return (
    <div className="w-full max-w-sm">
      <div className="boot-rise mb-6 text-center">
        <div className="flex items-center justify-center gap-2.5">
          {/* Decorative — the wordmark beside it already names the brand. */}
          <img
            src="/brand/skydrop-icon.svg"
            alt=""
            aria-hidden="true"
            width={53}
            height={26}
            className="h-[26px] w-auto shrink-0 select-none"
            draggable={false}
          />
          <span className="text-text-bright text-lg font-semibold tracking-tight">Skydrop</span>
        </div>
        <div className="telemetry text-text-muted mt-1.5">seller portal</div>
      </div>

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="border-border bg-surface ticks relative overflow-hidden rounded-[var(--radius-3)] border p-6 sm:p-7">
          <div className="border-border mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-3">
            <span className="telemetry text-text-strong inline-flex items-center gap-2">
              <span aria-hidden className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />
              recovery
            </span>
            <span className="telemetry text-text-faint">step 1 of 2</span>
          </div>
          <h1 className="text-text-bright mb-1 text-base font-semibold">Reset your password</h1>
          <p className="text-text-muted mb-5 text-xs leading-relaxed">
            Enter your seller account email. If we recognize it, you&apos;ll get a reset link by
            email within a few minutes.
          </p>
          <PasswordResetRequestForm />
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
        remembered it?{' '}
        <a
          href="/login"
          className="hover:text-text-bright transition-colors"
          style={{ color: 'var(--sky)' }}
        >
          sign in
        </a>
      </div>
    </div>
  );
}
