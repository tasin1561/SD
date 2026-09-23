import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { ButtonLink } from '@skydrop/ui/app/button';
import { VerifyEmailPanel } from './_components/verify-panel';

/**
 * Seller email verification, linked from the verification email as
 * `/auth/verify-email?token=…`.
 *
 * Same story as the reset page: the API had been mailing this URL and
 * nothing served it, so the link 404'd.
 */
export default async function SellerVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  if (token === '') {
    return (
      <SignInCard
        title="Verify your email"
        note="The link is missing its verification token. Open the email again and use the button there rather than copying the address by hand."
      >
        <ButtonLink href="/login" variant="primary">
          Back to sign in
        </ButtonLink>
      </SignInCard>
    );
  }

  return (
    <SignInCard title="Verify your email" note="Confirming the address on your seller account.">
      <VerifyEmailPanel token={token} />
    </SignInCard>
  );
}
