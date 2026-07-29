import type { ReactElement } from 'react';
import { AuthConsoleHeader } from '@/components/auth-console/console-shell';
import { TiltPanel } from '@/lib/tilt';
import { ResetPasswordForm } from './_components/reset-form';

/**
 * Step 2 of the staff password-reset flow, linked from the reset email
 * as `/auth/reset-password?token=…`.
 *
 * This page did not exist until 2026-07-29, so every staff reset email
 * ever sent landed on a 404 — the API side was complete and nothing on
 * the admin app answered the URL it was mailing out.
 *
 * The shell and card treatment match /login deliberately: someone
 * arriving from an email may be seeing the product for the first time,
 * and a bare card on black read like a different, lesser system.
 */
export default async function StaffResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return (
    <>
      <AuthConsoleHeader label="operations console" />

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface ticks p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              reset access
            </span>
            <span className="telemetry text-text-muted">single use</span>
          </div>

          {token === '' ? (
            <>
              <h1 className="text-text-bright text-lg font-semibold mb-1">Invalid reset link</h1>
              <p className="text-text-muted text-sm mb-6">
                The link is missing its reset token. Open the email again and use the button there
                rather than copying the address by hand.
              </p>
              <a
                href="/login"
                className="block text-center w-full px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <h1 className="text-text-bright text-lg font-semibold mb-1">Choose a new password</h1>
              <p className="text-text-muted text-sm mb-6">
                At least 10 characters. Saving signs out every existing session on this account.
              </p>
              <ResetPasswordForm token={token} />
            </>
          )}
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted text-center mt-5">
        <a href="/login" className="hover:text-text-body transition-colors">
          back to sign in
        </a>
      </div>
    </>
  );
}
