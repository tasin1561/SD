import type { ReactElement } from 'react';
import { ResetPasswordForm } from './_components/reset-form';

/**
 * Step 2 of the seller password-reset flow — the "confirm with new
 * password" page. Linked to from the password-reset email
 * (`/auth/reset-password?token=...`).
 *
 * If the token is missing from the URL we render a small "invalid
 * link" panel; otherwise the client form lets the seller set a new
 * password and posts to /auth/seller/password-reset/confirm. The API
 * clears any existing seller refresh cookie on success, so they have
 * to sign in fresh.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return (
    <>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
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
            <span className="text-text-bright font-semibold text-lg tracking-tight">Skydrop</span>
          </div>
          <div className="text-text-faint text-xs mt-0.5">Seller</div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          {token === '' ? (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">Invalid reset link</h1>
              <p className="text-text-muted text-xs mb-4">
                The link is missing the reset token. Open the reset email again and click the button
                there, or request a new link.
              </p>
              <a
                href="/password-reset"
                className="inline-block px-3 py-1.5 rounded-[5px] bg-accent-fill text-accent-fg text-sm font-medium hover:bg-accent-fill-hover transition-colors"
              >
                Request a new link
              </a>
            </>
          ) : (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">
                Choose a new password
              </h1>
              <p className="text-text-muted text-xs mb-5">
                Minimum 10 characters. After saving you&apos;ll need to sign in again.
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
    </>
  );
}
