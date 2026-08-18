import type { ReactElement } from 'react';
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
 */
export default function PasswordResetPage(): ReactElement {
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
          <h1 className="text-text-bright text-base font-semibold mb-1">Reset your password</h1>
          <p className="text-text-muted text-xs mb-5">
            Enter your seller account email. If we recognize it, you&apos;ll get a reset link by
            email within a few minutes.
          </p>
          <PasswordResetRequestForm />
        </div>
        <div className="text-text-faint text-xs text-center mt-4">
          Remembered it?{' '}
          <a href="/login" className="text-text-muted hover:text-text-body">
            Back to sign in
          </a>
        </div>
      </div>
    </>
  );
}
