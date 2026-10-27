import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { ButtonLink } from '@skydrop/ui/app/button';
import { VerifyEmailPanel } from './_components/verify-panel';
import { getT } from '@/i18n/server';

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
  const { t } = await getT();
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  if (token === '') {
    return (
      <SignInCard title={t('authVerify.verifyYourEmail')} note={t('authVerify.theLinkIsMissing')}>
        <ButtonLink href="/login" variant="primary">
          {t('authVerify.backToSignIn')}
        </ButtonLink>
      </SignInCard>
    );
  }

  return (
    <SignInCard
      title={t('authVerify.verifyYourEmail')}
      note={t('authVerify.confirmingTheAddressOn')}
    >
      <VerifyEmailPanel token={token} />
    </SignInCard>
  );
}
