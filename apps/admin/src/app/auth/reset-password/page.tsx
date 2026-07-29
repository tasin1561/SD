import type { ReactElement } from 'react';
import { ResetPasswordForm } from './_components/reset-form';

/**
 * Step 2 of the staff password-reset flow, linked from the reset email
 * as `/auth/reset-password?token=…`.
 *
 * This page did not exist until 2026-07-29, so every staff reset email
 * ever sent landed on a 404 — the API side was complete and nothing on
 * the admin app answered the URL it was mailing out.
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
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-text-bright font-semibold text-lg tracking-tight">Skydrop</div>
          <div className="text-text-faint text-xs mt-0.5">operations console</div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          {token === '' ? (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">Invalid reset link</h1>
              <p className="text-text-muted text-xs mb-4">
                The link is missing its reset token. Open the email again and use the button there
                rather than copying the address by hand.
              </p>
              <a
                href="/login"
                className="inline-block px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">
                Choose a new password
              </h1>
              <p className="text-text-muted text-xs mb-5">
                Minimum 10 characters. Saving signs out every existing session on this account.
              </p>
              <ResetPasswordForm token={token} />
            </>
          )}
        </div>
        <div className="text-text-faint text-xs text-center mt-4">
          <a href="/login" className="text-text-muted hover:text-text-body">
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
