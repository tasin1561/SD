import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
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
 * Chrome: the layout's `SignInFrame`, same as /login, so the front door
 * and the recovery pages read as one product. This page renders only
 * its card.
 */
export default function PasswordResetPage(): ReactElement {
  return (
    <SignInCard
      title="Reset your password"
      note={
        <>
          Enter your seller account email. If we recognize it, you&apos;ll get a reset link by email
          within a few minutes.
        </>
      }
      footer={
        <p>
          Remembered it? <a href="/login">Sign in</a>
        </p>
      }
    >
      <PasswordResetRequestForm />
    </SignInCard>
  );
}
