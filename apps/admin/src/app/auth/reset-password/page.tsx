import type { ReactElement } from 'react';
import { ButtonLink } from '@skydrop/ui/app/button';
import { SignInCard } from '@skydrop/ui/app/sign-in';
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

  return token === '' ? (
    <SignInCard
      title="Invalid reset link"
      note="The link is missing its reset token. Open the email again and use the button there rather than copying the address by hand."
      footer={<a href="/login">Back to sign in</a>}
    >
      <ButtonLink href="/login" variant="primary" fullWidth>
        Back to sign in
      </ButtonLink>
    </SignInCard>
  ) : (
    <SignInCard
      title="Choose a new password"
      note="At least 10 characters. Saving signs out every existing session on this account."
      footer={<a href="/login">Back to sign in</a>}
    >
      <ResetPasswordForm token={token} />
    </SignInCard>
  );
}
