import type { ReactElement } from 'react';
import { OtherPortals, SignInCard } from '@skydrop/ui/app/sign-in';
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
          Enter your client account email. If we recognize it, you&apos;ll get a reset link by email
          within a few minutes.
        </>
      }
      footer={
        <>
          <p>
            Remembered it? <a href="/login">Sign in</a>
          </p>
          {/*
           * The chooser belongs on THIS page as much as on /login, and
           * for a worse reason. The API answers a reset request the same
           * way whether or not the email has an account here
           * (anti-enumeration), so somebody who is in the wrong console
           * is told "if we recognize it, you'll get a reset link" and
           * then gets nothing — a dead end that reads as success and
           * teaches them to wait. A client on the store portal's reset
           * page, or a store user on this one, needs the way out before
           * they submit, not a reassuring message afterwards.
           */}
          <OtherPortals self="client" title="Reset it somewhere else?" />
        </>
      }
    >
      <PasswordResetRequestForm />
    </SignInCard>
  );
}
