import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { ButtonLink } from '@skydrop/ui/app/button';
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
 *
 * The card's title says WHICH of those two it is, so the state of the
 * link is legible before the prose is read.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  const footer = (
    <p>
      <a href="/login">Back to sign in</a>
    </p>
  );

  if (token === '') {
    return (
      <SignInCard
        title="Invalid reset link"
        note="The link is missing the reset token. Open the reset email again and click the button there, or request a new link."
        footer={footer}
      >
        <ButtonLink href="/password-reset" variant="primary">
          Request a new link
        </ButtonLink>
      </SignInCard>
    );
  }

  return (
    <SignInCard
      title="Choose a new password"
      note={<>Minimum 10 characters. After saving you&apos;ll need to sign in again.</>}
      footer={footer}
    >
      <ResetPasswordForm token={token} />
    </SignInCard>
  );
}
