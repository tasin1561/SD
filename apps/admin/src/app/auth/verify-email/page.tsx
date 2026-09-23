import type { ReactElement } from 'react';
import { ButtonLink } from '@skydrop/ui/app/button';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { VerifyEmailPanel } from './_components/verify-panel';

/**
 * Staff email verification, linked from the verification email as
 * `/auth/verify-email?token=…`.
 *
 * Same story as the reset page: the API had been mailing this URL and
 * nothing served it, so the link 404'd. Shell and card match /login
 * for the same reason — this is often the first screen a new staff
 * member sees.
 */
export default async function StaffVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return token === '' ? (
    <SignInCard
      title="Verify your email"
      note="The link is missing its verification token. Open the email again and use the button there rather than copying the address by hand."
      footer={<a href="/login">Back to sign in</a>}
    >
      <ButtonLink href="/login" variant="primary" fullWidth>
        Back to sign in
      </ButtonLink>
    </SignInCard>
  ) : (
    <SignInCard
      title="Verify your email"
      note="Confirming the address on your staff account."
      footer={<a href="/login">Back to sign in</a>}
    >
      <VerifyEmailPanel token={token} />
    </SignInCard>
  );
}
